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
    {"name": "title",    "type": "string"},
    {"name": "excerpt",  "type": "string", "optional": True},
    {"name": "url",      "type": "string", "index": False, "optional": True},
    {"name": "category", "type": "string", "facet": True},
    {"name": "date",     "type": "int64",  "sort": True},
    {"name": "tags",     "type": "string[]", "optional": True, "facet": True},
    # Category-specific extras; only papers populate these today, but the
    # field has to exist in the shared schema for `query_by` to accept it.
    {"name": "authors",  "type": "string", "optional": True},
    {"name": "journal",  "type": "string", "optional": True, "facet": True},
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
    return {
        "id": _wp_id(item),
        "title": _wp_title(item),
        "excerpt": _wp_excerpt(item),
        "url": f"/post/{_wp_slug(item)}",
        "category": "posts",
        "date": _wp_date(item),
    }


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


# Maps wp_cache RESOURCES key -> (typesense collection, mapper, query_by).
# query_by must reference only fields that actually exist on this collection's
# schema, otherwise multi_search returns an error for that sub-query and we
# silently lose the whole category. Papers carry extra author/journal fields;
# the others only have the common title/excerpt fields.
_QB_COMMON = {"query_by": "title,excerpt", "query_by_weights": "3,1"}
_QB_PAPERS = {"query_by": "title,authors,journal,excerpt", "query_by_weights": "4,3,2,1"}

COLLECTIONS = {
    "posts":                ("posts",          _map_post,           _QB_COMMON),
    "publications":         ("papers",         _map_paper,          _QB_PAPERS),
    "projects":             ("projects",       _map_project,        _QB_COMMON),
    "conference_abstracts": ("abstracts",      _map_abstract,       _QB_COMMON),
    "resource_links":       ("resource_links", _map_resource_link,  _QB_COMMON),
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
    try:
        client.collections[collection_name].retrieve()
        return
    except ObjectNotFound:
        pass
    except Exception as e:
        logger.warning("typesense: retrieve %s failed (%s); attempting create", collection_name, e)
    try:
        client.collections.create(_schema_for(collection_name))
        logger.info("typesense: created collection %s", collection_name)
    except ObjectAlreadyExists:
        pass


def sync_resource(resource_name, items):
    """Upsert `items` into the Typesense collection mapped to `resource_name`.

    No-ops if Typesense is unreachable or the resource has no mapping.
    Called from wp_cache after a successful refill.
    """
    mapping = COLLECTIONS.get(resource_name)
    if not mapping:
        return
    if not isinstance(items, list):
        return
    client = get_client()
    if not client:
        return
    collection_name, mapper, _qb = mapping
    try:
        ensure_collection(client, collection_name)
    except Exception as e:
        logger.warning("typesense: ensure_collection(%s) failed (%s)", collection_name, e)
        return

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
        return

    t0 = time.time()
    try:
        # `upsert` is the simplest correct behavior; `emplace` would let us
        # avoid re-sending unchanged docs but needs a per-doc diff first.
        result = client.collections[collection_name].documents.import_(
            docs, {"action": "upsert"}
        )
    except Exception as e:
        logger.warning("typesense: import to %s failed (%s)", collection_name, e)
        return

    failed = 0
    if isinstance(result, list):
        for line in result:
            if isinstance(line, dict) and not line.get("success", True):
                failed += 1
    logger.info(
        "typesense: synced %s -> %s (%d docs, %d failed, %.2fs)",
        resource_name, collection_name, len(docs), failed, time.time() - t0,
    )

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


# ---------------------------------------------------------------------------
# Typeahead endpoint
# ---------------------------------------------------------------------------

_HIT_FIELDS = "id,title,excerpt,url,category,date,authors,journal"


@typesense_page.route("/api/typeahead/_status")
def typeahead_status():
    # Force a fresh attempt so the response reflects current state.
    get_client()
    return flask.jsonify(client_status())


@typesense_page.route("/api/typesense/counts")
def typesense_counts():
    """Return num_documents per collection. Used by React components to
    decide whether their money-clip local cache is stale: if the locally
    cached list length doesn't match the count here, the client invalidates
    and refetches from /api/wp_cache/<resource>."""
    client = get_client()
    if not client:
        return flask.jsonify({"error": "search index unavailable",
                              "reason": _client_reason}), 503
    counts = {}
    for collection_name, _mapper, _qb in COLLECTIONS.values():
        try:
            meta = client.collections[collection_name].retrieve()
            counts[collection_name] = int(meta.get("num_documents", 0))
        except Exception as e:
            logger.debug("typesense_counts: %s unavailable (%s)", collection_name, e)
            counts[collection_name] = None
    return flask.jsonify(counts)


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
    for collection_name, _mapper, qb in COLLECTIONS.values():
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
