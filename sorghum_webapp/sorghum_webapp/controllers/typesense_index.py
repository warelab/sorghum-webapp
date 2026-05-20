#!/usr/bin/python

"""
Typesense integration for sorghumbase.

Provides the type-ahead endpoint (`/api/typeahead`) and a small indexer
that mirrors selected wp_cache resources into Typesense collections.
The indexer is invoked from wp_cache._do_fetch_and_store so a single
cron-driven refresh keeps both Redis and Typesense in sync.
"""

import html
import logging
import os
import re
import threading
import time

import flask
from flask import request

from .. import app

try:
    import typesense as ts_mod
    from typesense.exceptions import ObjectNotFound, ObjectAlreadyExists
except ImportError:
    ts_mod = None
    ObjectNotFound = ObjectAlreadyExists = Exception

logger = logging.getLogger("sorghumbase")

typesense_page = flask.Blueprint("typesense_page", __name__)


# ---------------------------------------------------------------------------
# Collection schemas
# ---------------------------------------------------------------------------
# One collection per category. Shared field set so the React typeahead can
# render hits uniformly; category-specific extras live in the mapper below.

_COMMON_FIELDS = [
    {"name": "title",      "type": "string"},
    {"name": "excerpt",    "type": "string", "optional": True},
    {"name": "url",        "type": "string", "index": False, "optional": True},
    {"name": "category",   "type": "string", "facet": True},
    {"name": "date",       "type": "int64",  "sort": True},
    {"name": "tags",       "type": "string[]", "optional": True, "facet": True},
    # Category-specific extras; only some collections populate each, but the
    # field has to exist in the shared schema for `query_by`/`filter_by` to
    # accept it. Optional means absence is fine.
    {"name": "authors",    "type": "string",   "optional": True},
    {"name": "journal",    "type": "string",   "optional": True, "facet": True},
    {"name": "categories", "type": "int32[]",  "optional": True, "facet": True},
]

_DEFAULT_SORT = "_text_match:desc,date:desc"


def _strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def _to_epoch(date_str):
    if not date_str:
        return 0
    from datetime import datetime
    s = date_str.strip().replace("Z", "+00:00")
    # Try ISO-8601 (WP date / date_gmt) first; then bare YYYY-MM-DD as Pods
    # often stores publication_date that way.
    for fmt in (None, "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d"):
        try:
            dt = datetime.fromisoformat(s) if fmt is None else datetime.strptime(s, fmt)
            return int(dt.timestamp())
        except Exception:
            continue
    return 0


def _wp_id(item):
    val = item.get("id")
    return str(val) if val is not None else None


def _wp_title(item):
    t = item.get("title")
    if isinstance(t, dict):
        return _strip_html(t.get("rendered"))
    return _strip_html(t or "")


def _wp_excerpt(item):
    e = item.get("excerpt")
    if isinstance(e, dict):
        e = e.get("rendered")
    if not e:
        c = item.get("content")
        if isinstance(c, dict):
            e = c.get("rendered")
    text = _strip_html(e or "")
    return text[:280]


def _wp_date(item):
    return _to_epoch(item.get("date_gmt") or item.get("date"))


def _wp_slug(item):
    return item.get("slug") or ""


def _map_post(item):
    raw_cats = item.get("categories") or []
    cats = [int(c) for c in raw_cats if isinstance(c, int) or (isinstance(c, str) and c.isdigit())]
    doc = {
        "id": _wp_id(item),
        "title": _wp_title(item),
        "excerpt": _wp_excerpt(item),
        "url": f"/post/{_wp_slug(item)}",
        "category": "posts",
        "date": _wp_date(item),
    }
    if cats:
        doc["categories"] = cats
    return doc


def _map_paper(item):
    # Pods plugin exposes these at the top level of the JSON response (see
    # wordpress_orm_extensions/scientific_paper.py schema_fields).
    authors = _strip_html(item.get("paper_authors") or "")
    journal = _strip_html(item.get("journal") or "")
    # Prefer the curated publication_date over WP's post-creation date so
    # sorts and the typeahead date label reflect when the paper appeared.
    pub_epoch = _to_epoch(item.get("publication_date"))
    doc = {
        "id": _wp_id(item),
        "title": _wp_title(item),
        "excerpt": _wp_excerpt(item),
        "url": f"/paper/{_wp_slug(item)}",
        "category": "papers",
        "date": pub_epoch or _wp_date(item),
    }
    if authors:
        doc["authors"] = authors
    if journal:
        doc["journal"] = journal
    return doc


def _map_project(item):
    return {
        "id": _wp_id(item),
        "title": _wp_title(item),
        "excerpt": _wp_excerpt(item),
        "url": f"/project/{_wp_slug(item)}",
        "category": "projects",
        "date": _wp_date(item),
    }


def _map_abstract(item):
    return {
        "id": _wp_id(item),
        "title": _wp_title(item),
        "excerpt": _wp_excerpt(item),
        "url": f"/abstract/{_wp_slug(item)}",
        "category": "abstracts",
        "date": _wp_date(item),
    }


def _map_event(item):
    slug = _wp_slug(item)
    # `/events` is a timeline; linking to a specific event surfaces it via
    # the `event=` query param, which the EventsList component reads to flip
    # past/upcoming view, scroll, and auto-expand the card.
    return {
        "id": _wp_id(item),
        "title": _wp_title(item),
        "excerpt": _wp_excerpt(item),
        "url": f"/events?event={slug}" if slug else "/events",
        "category": "events",
        "date": _wp_date(item),
    }


def _map_tag(item):
    name = (item.get("name") or "").strip()
    return {
        "id": str(item.get("id") or ""),
        "title": name,
        "url": "",
        "category": "tags",
        "date": 0,
    }


def _map_resource_link(item):
    # ACF field name varies; fall back to the listing page if no external URL.
    acf = item.get("acf") or {}
    url = (
        acf.get("external_link")
        or acf.get("link")
        or acf.get("url")
        or item.get("resource_link_url")
        or "/resource_links"
    )
    return {
        "id": _wp_id(item),
        "title": _wp_title(item),
        "excerpt": _wp_excerpt(item),
        "url": url,
        "category": "resource_links",
        "date": _wp_date(item),
    }


# Maps wp_cache RESOURCES key -> entry describing how to index and query.
# query_by must reference only fields that actually exist on this collection's
# schema, otherwise multi_search returns an error for that sub-query and we
# silently lose the whole category. Papers carry extra author/journal fields;
# the others only have the common title/excerpt fields.
# `typeahead` controls whether this collection participates in /api/typeahead.
# Collections kept out of the typeahead still get indexed + counted so the
# client-side cache invalidation pattern works the same for them.
# `query_by_only` is a hint for tags-style collections that have no body text.
_QB_COMMON = {"query_by": "title,excerpt", "query_by_weights": "3,1"}
_QB_PAPERS = {"query_by": "title,authors,journal,excerpt", "query_by_weights": "4,3,2,1"}
_QB_TITLE  = {"query_by": "title", "query_by_weights": "1"}

COLLECTIONS = {
    "posts":                {"collection": "posts",          "mapper": _map_post,           "qb": _QB_COMMON, "typeahead": True},
    "publications":         {"collection": "papers",         "mapper": _map_paper,          "qb": _QB_PAPERS, "typeahead": True},
    "projects":             {"collection": "projects",       "mapper": _map_project,        "qb": _QB_COMMON, "typeahead": True},
    "conference_abstracts": {"collection": "abstracts",      "mapper": _map_abstract,       "qb": _QB_COMMON, "typeahead": True},
    "resource_links":       {"collection": "resource_links", "mapper": _map_resource_link,  "qb": _QB_COMMON, "typeahead": True},
    "events":               {"collection": "events",         "mapper": _map_event,          "qb": _QB_COMMON, "typeahead": True},
    "tags":                 {"collection": "tags",           "mapper": _map_tag,            "qb": _QB_TITLE,  "typeahead": False},
}


def _schema_for(collection_name):
    return {
        "name": collection_name,
        "fields": _COMMON_FIELDS,
        "default_sorting_field": "date",
    }


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

_client = None
_client_reason = "not initialized"
_client_lock = threading.Lock()


def _api_key():
    # Prefer env var so secrets stay out of cfg files.
    key = os.environ.get("TYPESENSE_API_KEY")
    if key:
        return key
    cfg = app.config.get("TYPESENSE_API_KEY")
    if cfg and "READ THE TYPESENSE API KEY" not in cfg:
        return cfg
    return None


def get_client():
    """Return the Typesense client or None. Populates _client_reason on failure
    so callers (and the /api/typeahead/_status probe) can report what went wrong
    instead of swallowing it as a generic 503.

    Connection failures retry on next call so a transient outage self-heals;
    config errors (missing lib / missing key) cache to avoid log spam.
    """
    global _client, _client_reason
    if _client:
        return _client
    if ts_mod is None:
        _client_reason = "typesense python library not installed"
        logger.warning(_client_reason)
        _client = False
        return None
    api_key = _api_key()
    if not api_key:
        _client_reason = (
            "TYPESENSE_API_KEY not set in env or configuration_files cfg"
        )
        logger.warning(_client_reason)
        _client = False
        return None
    with _client_lock:
        if _client:
            return _client
        host = app.config.get("TYPESENSE_HOST", "localhost")
        port = int(app.config.get("TYPESENSE_PORT", 8108))
        protocol = app.config.get("TYPESENSE_PROTOCOL", "http")
        try:
            client = ts_mod.Client({
                "nodes": [{"host": host, "port": port, "protocol": protocol}],
                "api_key": api_key,
                "connection_timeout_seconds": 5,
            })
            # The python client is a lazy config object; there's no portable
            # health API across versions, so skip the probe. Real connection
            # errors surface from the first request (search / collection op).
            _client = client
            _client_reason = "ok"
            logger.info("typesense client configured for %s://%s:%s", protocol, host, port)
            return _client
        except Exception as e:
            _client_reason = f"client init for {protocol}://{host}:{port} failed: {e!r}"
            logger.warning("typesense unavailable: %s", _client_reason)
            return None


def client_status():
    return {
        "ok": bool(_client),
        "reason": _client_reason,
        "host": app.config.get("TYPESENSE_HOST", "localhost"),
        "port": app.config.get("TYPESENSE_PORT", 8108),
        "protocol": app.config.get("TYPESENSE_PROTOCOL", "http"),
        "library_installed": ts_mod is not None,
        "api_key_present": bool(_api_key()),
    }


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

def ensure_collection(client, collection_name):
    """Create the collection if missing; if it exists, add any schema fields
    that have been declared in `_COMMON_FIELDS` since this collection was
    first created. The latter prevents `filter_by`/`query_by` against newly
    added fields (e.g. `categories`) from failing on long-lived collections.
    """
    existing = None
    try:
        existing = client.collections[collection_name].retrieve()
    except ObjectNotFound:
        pass
    except Exception as e:
        logger.warning("typesense: retrieve %s failed (%s); attempting create", collection_name, e)

    if existing is None:
        try:
            client.collections.create(_schema_for(collection_name))
            logger.info("typesense: created collection %s", collection_name)
        except ObjectAlreadyExists:
            pass
        return

    have = {f.get("name") for f in (existing.get("fields") or [])}
    missing = [f for f in _COMMON_FIELDS if f["name"] not in have]
    if not missing:
        return
    try:
        client.collections[collection_name].update({"fields": missing})
        logger.info(
            "typesense: added fields %s to collection %s",
            [f["name"] for f in missing], collection_name,
        )
    except Exception as e:
        logger.warning(
            "typesense: failed to extend schema for %s (%s); "
            "delete the collection and re-warm to recover",
            collection_name, e,
        )


def sync_resource(resource_name, items, prune=True):
    """Upsert `items` into the Typesense collection mapped to `resource_name`.

    Returns a status dict so callers (e.g. update_publications) can report
    what happened:
        {"ok": bool, "collection": str | None, "count": int, "failed": int,
         "error": str | None, "skipped": "no_mapping" | "not_a_list" | "no_client" | None}

    `prune=True` (default) deletes docs whose IDs aren't present in `items` —
    appropriate when `items` is the full list from WordPress. Callers doing an
    incremental upsert of just a few new docs (e.g. update_publications after
    publishing a draft) should pass `prune=False`.
    """
    entry = COLLECTIONS.get(resource_name)
    if not entry:
        return {"ok": False, "collection": None, "count": 0, "failed": 0,
                "error": None, "skipped": "no_mapping"}
    if not isinstance(items, list):
        return {"ok": False, "collection": entry["collection"], "count": 0,
                "failed": 0, "error": None, "skipped": "not_a_list"}
    client = get_client()
    if not client:
        return {"ok": False, "collection": entry["collection"], "count": 0,
                "failed": 0, "error": _client_reason, "skipped": "no_client"}
    collection_name = entry["collection"]
    mapper = entry["mapper"]
    try:
        ensure_collection(client, collection_name)
    except Exception as e:
        logger.warning("typesense: ensure_collection(%s) failed (%s)", collection_name, e)
        return {"ok": False, "collection": collection_name, "count": 0,
                "failed": 0, "error": f"ensure_collection: {e}", "skipped": None}

    docs = []
    for raw in items:
        try:
            doc = mapper(raw)
        except Exception as e:
            logger.debug("typesense: mapper(%s) skipped item: %s", resource_name, e)
            continue
        if not doc.get("id") or not doc.get("title"):
            continue
        docs.append(doc)

    if not docs:
        # Wipe the collection if upstream returned nothing — avoids stale hits.
        try:
            client.collections[collection_name].documents.delete({"filter_by": "id:!=__none__"})
        except Exception:
            pass
        return {"ok": True, "collection": collection_name, "count": 0,
                "failed": 0, "error": None, "skipped": None}

    t0 = time.time()
    try:
        # `upsert` is the simplest correct behavior; `emplace` would let us
        # avoid re-sending unchanged docs but needs a per-doc diff first.
        result = client.collections[collection_name].documents.import_(
            docs, {"action": "upsert"}
        )
    except Exception as e:
        logger.warning("typesense: import to %s failed (%s)", collection_name, e)
        return {"ok": False, "collection": collection_name, "count": 0,
                "failed": len(docs), "error": f"import: {e}", "skipped": None}

    failed = 0
    if isinstance(result, list):
        for line in result:
            if isinstance(line, dict) and not line.get("success", True):
                failed += 1
    logger.info(
        "typesense: synced %s -> %s (%d docs, %d failed, %.2fs)",
        resource_name, collection_name, len(docs), failed, time.time() - t0,
    )

    status = {"ok": failed == 0, "collection": collection_name,
              "count": len(docs) - failed, "failed": failed,
              "error": None, "skipped": None}

    if not prune:
        return status

    # Drop docs that disappeared upstream.
    try:
        live_ids = {d["id"] for d in docs}
        existing = client.collections[collection_name].documents.export({"include_fields": "id"})
        if existing:
            import json as _json
            stale = []
            for line in existing.splitlines():
                if not line:
                    continue
                try:
                    rec = _json.loads(line)
                except Exception:
                    continue
                if rec.get("id") and rec["id"] not in live_ids:
                    stale.append(rec["id"])
            for sid in stale:
                try:
                    client.collections[collection_name].documents[sid].delete()
                except Exception:
                    pass
            if stale:
                logger.info("typesense: pruned %d stale docs from %s", len(stale), collection_name)
    except Exception as e:
        logger.debug("typesense: stale-prune skipped for %s (%s)", collection_name, e)

    return status


# ---------------------------------------------------------------------------
# Typeahead endpoint
# ---------------------------------------------------------------------------

_HIT_FIELDS = "id,title,excerpt,url,category,date,authors,journal"


@typesense_page.route("/api/typeahead/_status")
def typeahead_status():
    # Force a fresh attempt so the response reflects current state.
    get_client()
    return flask.jsonify(client_status())


def _posts_search_from_wp_cache(category_ids, page, per_page):
    """Fallback for /api/posts/search when Typesense is unavailable and the
    request has no `q`. Pulls the full posts list from wp_cache (Redis),
    maps + filters + paginates in-process. Identical hit shape to the
    Typesense path, minus the `*_highlight` fields."""
    from .wp_cache import _get_or_refresh
    items, _meta = _get_or_refresh("posts")
    docs = [_map_post(it) for it in (items or [])]
    if category_ids:
        wanted = set(category_ids)
        docs = [d for d in docs if wanted.intersection(d.get("categories") or [])]
    docs.sort(key=lambda d: d.get("date") or 0, reverse=True)
    found = len(docs)
    start = (page - 1) * per_page
    page_docs = docs[start:start + per_page]
    hits = [{
        "id": d.get("id"),
        "title": d.get("title"),
        "excerpt": d.get("excerpt"),
        "url": d.get("url"),
        "date": d.get("date"),
        "categories": d.get("categories") or [],
        "title_highlight": None,
        "excerpt_highlight": None,
    } for d in page_docs]
    return found, hits


@typesense_page.route("/api/posts/search")
def posts_search():
    """Paginated posts search. Used by /posts to serve list pages from
    Typesense (relevance ordering when `q` is set, date descending otherwise)
    with optional `categories` filter. When Typesense is unavailable and
    the caller didn't ask for full-text search, we fall back to filtering
    the Redis-backed wp_cache posts list -- same data, no relevance ranking."""
    q = (request.args.get("q") or "").strip()
    page = max(1, int(request.args.get("page") or 1))
    per_page = max(1, min(int(request.args.get("per_page") or 20), 100))
    cats_raw = (request.args.get("categories") or "").strip()
    category_ids = []
    if cats_raw:
        for piece in cats_raw.split(","):
            piece = piece.strip()
            if piece.isdigit():
                category_ids.append(int(piece))

    client = get_client()
    if not client:
        if q:
            return flask.jsonify({"error": "search index unavailable",
                                  "reason": _client_reason}), 503
        try:
            found, hits = _posts_search_from_wp_cache(category_ids, page, per_page)
        except Exception as e:
            logger.warning("wp_cache fallback for posts_search failed (%s)", e)
            return flask.jsonify({"error": "search index unavailable",
                                  "reason": _client_reason}), 503
        return flask.jsonify({
            "q": q,
            "categories": category_ids,
            "page": page,
            "per_page": per_page,
            "found": found,
            "total_pages": max(1, (found + per_page - 1) // per_page) if found else 0,
            "hits": hits,
            "source": "wp_cache",
        })

    params = {
        "q": q or "*",
        "query_by": "title,excerpt" if q else "title",
        "query_by_weights": "3,1" if q else "1",
        "page": page,
        "per_page": per_page,
        "include_fields": "id,title,excerpt,url,category,date,categories",
        "highlight_fields": "title,excerpt",
        "sort_by": "_text_match:desc,date:desc" if q else "date:desc",
    }
    if category_ids:
        joined = ",".join(str(c) for c in category_ids)
        params["filter_by"] = f"categories:=[{joined}]"

    try:
        result = client.collections["posts"].documents.search(params)
    except Exception as e:
        logger.warning("typesense: posts search failed (%s)", e)
        return flask.jsonify({"error": "search backend error",
                              "reason": str(e)}), 502

    hits = []
    for h in result.get("hits", []):
        doc = h.get("document") or {}
        hl = h.get("highlight") or {}
        hits.append({
            "id": doc.get("id"),
            "title": doc.get("title"),
            "excerpt": doc.get("excerpt"),
            "url": doc.get("url"),
            "date": doc.get("date"),
            "categories": doc.get("categories") or [],
            "title_highlight": (hl.get("title") or {}).get("snippet"),
            "excerpt_highlight": (hl.get("excerpt") or {}).get("snippet"),
        })

    found = result.get("found", 0)
    return flask.jsonify({
        "q": q,
        "categories": category_ids,
        "page": page,
        "per_page": per_page,
        "found": found,
        "total_pages": max(1, (found + per_page - 1) // per_page) if found else 0,
        "hits": hits,
    })


@typesense_page.route("/api/typeahead")
def typeahead():
    q = (request.args.get("q") or "").strip()
    per_cat = max(1, min(int(request.args.get("per_cat", 5)), 20))

    if not q:
        return flask.jsonify({"q": "", "groups": [], "facets": {}})

    client = get_client()
    if not client:
        return flask.jsonify({"error": "search index unavailable", "reason": _client_reason}), 503

    searches = []
    collections_in_order = []
    for entry in COLLECTIONS.values():
        if not entry.get("typeahead"):
            continue
        collection_name = entry["collection"]
        qb = entry["qb"]
        collections_in_order.append(collection_name)
        searches.append({
            "collection": collection_name,
            "q": q,
            "query_by": qb["query_by"],
            "query_by_weights": qb["query_by_weights"],
            "sort_by": _DEFAULT_SORT,
            "per_page": per_cat,
            "include_fields": _HIT_FIELDS,
            "highlight_fields": qb["query_by"],
            "facet_by": "category",
        })

    try:
        result = client.multi_search.perform({"searches": searches}, {})
    except Exception as e:
        logger.warning("typesense: multi_search failed (%s)", e)
        flask.abort(502, description="search backend error")

    groups = []
    facets = {}
    errors = {}
    for r, collection_name in zip(result.get("results", []), collections_in_order):
        if r.get("error"):
            errors[collection_name] = r["error"]
            logger.warning("typesense: %s sub-query failed: %s", collection_name, r["error"])
            continue
        hits = []
        for h in r.get("hits", []):
            doc = h.get("document") or {}
            hl = h.get("highlight") or {}
            hits.append({
                "id": doc.get("id"),
                "title": doc.get("title"),
                "excerpt": doc.get("excerpt"),
                "url": doc.get("url"),
                "category": doc.get("category"),
                "date": doc.get("date"),
                "authors": doc.get("authors"),
                "journal": doc.get("journal"),
                "title_highlight": (hl.get("title") or {}).get("snippet"),
                "excerpt_highlight": (hl.get("excerpt") or {}).get("snippet"),
                "authors_highlight": (hl.get("authors") or {}).get("snippet"),
                "journal_highlight": (hl.get("journal") or {}).get("snippet"),
            })
        if not hits and not r.get("found"):
            continue
        category = (hits[0]["category"] if hits else None) or (r.get("request_params") or {}).get("collection_name")
        groups.append({
            "category": category,
            "found": r.get("found", 0),
            "hits": hits,
        })
        facets[category] = r.get("found", 0)

    payload = {"q": q, "groups": groups, "facets": facets}
    if errors:
        payload["errors"] = errors
    return flask.jsonify(payload)
