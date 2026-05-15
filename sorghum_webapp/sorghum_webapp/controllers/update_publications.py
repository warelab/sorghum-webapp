#!/usr/bin/python

''' Maintenance UI: enrich draft scientific_paper posts from PubMed and
publish selected ones.

GET /update_publications scans WordPress for `scientific_paper` posts in
`draft` status. For each draft whose only seed data is a `pubmed_id`,
it looks up the enriched payload in a Redis-backed cache keyed by
pubmed_id, fetching from PubMed only on cache miss. The rendered page
shows a checkbox per candidate. The admin selects rows and submits the
form to POST /update_publications/publish, which applies the cached
enrichment to each chosen draft, sets status=publish, and PUTs the
result back to WordPress. No WordPress writes happen on GET.

This controller is Redis-only by design. The wp_cache layer falls back
to an in-process dict when Redis is unreachable, but the multi-step
GET-then-POST flow here needs cross-worker visibility (enrichment from
worker A, publish from worker B). Rather than silently degrade and
serve stale or empty results from a per-worker memory cache, every
endpoint here raises a 503 with a clear message when Redis is down.
'''

import json
import logging
import os
import uuid

import flask
from flask import request, render_template, redirect
from requests.auth import HTTPBasicAuth
from wordpress_orm.entities.tag import Tag

from ..wordpress_orm_extensions.scientific_paper import ScientificPaperRequest
from ..utilities.pubmedIDpull import getMetaData

from .. import app
from .. import wordpress_api as api
from . import valueFromRequest
from .navbar import navbar_template
from .local_media import local_banner
from .wp_cache import _get_redis, _invalidate as _wp_cache_invalidate, _get_or_refresh as _wp_cache_get

logger = logging.getLogger("sorghumbase")

update_publications_page = flask.Blueprint("update_publications_page", __name__)

DRAFT_PAGE_SIZE = 100
PUBMED_BATCH = 100

# Redis hash storing enrichment payloads keyed by pubmed_id. One TTL on
# the whole hash; HSETs implicitly refresh it via _cache_set.
ENRICHMENT_HASH = "wp_cache:pubmed_enrichment"
ENRICHMENT_TTL_SECONDS = 24 * 3600

# Single-use Redis keys carry publish-run error details across the
# POST -> redirect -> GET handoff (across uWSGI workers).
PUBLISH_RUN_PREFIX = "wp_cache:publish_run:"
PUBLISH_RUN_TTL_SECONDS = 600


def _require_redis():
    ''' Return the Redis client or abort 503. Update-publications is a
    rarely-used admin tool — there is no graceful degradation here. '''
    rds = _get_redis()
    if rds is None:
        flask.abort(503, description=(
            "/update_publications requires Redis (cross-worker state for "
            "PubMed enrichment + publish errors). Redis appears to be down."
        ))
    return rds


def _ensure_wp_auth():
    ''' paper.update() PUTs to WordPress and requires authentication. The
    global auth block in __init__.py only fires when SB_WP_* *and*
    MANTIS_* are all configured; fill in basic auth from SB_WP_* on
    demand so this endpoint works in dev environments. '''
    if getattr(api, "authenticator", None) is not None:
        return
    username = os.environ.get("SB_WP_USERNAME")
    password = os.environ.get("SB_WP_PASSWORD")
    if username and password:
        api.authenticator = HTTPBasicAuth(username, password)


def _cache_get(pubmed_id):
    rds = _require_redis()
    raw = rds.hget(ENRICHMENT_HASH, pubmed_id)
    if raw:
        return json.loads(raw)
    return None


def _cache_set(pubmed_id, payload):
    rds = _require_redis()
    rds.hset(ENRICHMENT_HASH, pubmed_id, json.dumps(payload))
    rds.expire(ENRICHMENT_HASH, ENRICHMENT_TTL_SECONDS)


def _cache_del(pubmed_id):
    rds = _require_redis()
    rds.hdel(ENRICHMENT_HASH, pubmed_id)


def _stash_publish_errors(errors):
    ''' Write the publish-run error list to Redis under a one-shot token.
    Returns the token so the caller can hand it back via the redirect. '''
    if not errors:
        return None
    rds = _require_redis()
    token = uuid.uuid4().hex
    rds.setex(PUBLISH_RUN_PREFIX + token, PUBLISH_RUN_TTL_SECONDS, json.dumps(errors))
    return token


def _consume_publish_errors(token):
    ''' Read-and-delete the error list keyed by `token`. Returns [] if the
    token is missing or expired. '''
    if not token:
        return []
    rds = _require_redis()
    raw = rds.get(PUBLISH_RUN_PREFIX + token)
    if not raw:
        return []
    rds.delete(PUBLISH_RUN_PREFIX + token)
    return json.loads(raw)


def _serialize_enrichment(paper, status, error=None):
    ''' Capture the fields getMetaData populates so /publish can apply
    them without re-hitting PubMed. '''
    return {
        "status": status,  # "ready" | "no_authors" | "error"
        "error": error,
        "wp_id": paper.s.id,
        "pubmed_id": paper.s.pubmed_id or "",
        "title": paper.s.title or "",
        "abstract": paper.s.abstract or "",
        "paper_authors": paper.s.paper_authors or "",
        "source_url": paper.s.source_url or "",
        "doi": paper.s.doi or "",
        "journal": paper.s.journal or "",
        "publication_date": paper.s.publication_date or "",
        "date": paper.s.date or "",
        "keywords": paper.s.keywords or "",
        "affiliations": paper.s.affiliations or [],
        "funding_agencies": paper.s.funding_agencies or [],
    }


def _fetch_all_drafts():
    drafts = []
    page = 1
    while True:
        req = ScientificPaperRequest(api=api)
        req.status = "draft"
        req.per_page = DRAFT_PAGE_SIZE
        req.page = page
        chunk = req.get() or []
        if not chunk:
            break
        drafts.extend(chunk)
        if len(chunk) < DRAFT_PAGE_SIZE:
            break
        page += 1
    return drafts


def _needs_enrichment(paper, force):
    if not (paper.s.pubmed_id or ""):
        return False
    if force:
        return True
    return not (paper.s.content or "")


def _enrich_via_pubmed(papers):
    ''' Run getMetaData on a list of paper objects, then cache one payload
    per pubmed_id. Returns the serialized payloads in input order. '''
    payloads = []
    for i in range(0, len(papers), PUBMED_BATCH):
        batch = papers[i:i + PUBMED_BATCH]
        try:
            getMetaData(batch)
        except Exception as e:
            logger.exception("update_publications: pubmed fetch failed")
            for p in batch:
                payload = _serialize_enrichment(p, "error", error=str(e))
                _cache_set(p.s.pubmed_id, payload)
                payloads.append(payload)
            continue
        for p in batch:
            status = "ready" if (p.s.paper_authors or "").strip() else "no_authors"
            payload = _serialize_enrichment(p, status)
            _cache_set(p.s.pubmed_id, payload)
            payloads.append(payload)
    return payloads


def _wp_title(item):
    ''' WP REST returns title as {"rendered": "..."}; Pods custom fields
    are sometimes flat strings. Handle both. '''
    title = item.get("title")
    if isinstance(title, dict):
        return title.get("rendered") or ""
    return title or ""


def _existing_published_by_pubmed_id():
    ''' {pubmed_id: {"wp_id": id, "title": str}} for every already-
    published scientific paper. Pulled from wp_cache:publications.
    Used both to flag duplicates in the listing and to refuse re-publish
    in the POST handler. '''
    try:
        items, _ = _wp_cache_get("publications")
    except Exception as e:
        logger.warning("update_publications: could not load published-papers snapshot (%s); "
                       "duplicate check will only see within-batch collisions", e)
        return {}
    out = {}
    for p in (items or []):
        pmid = (p.get("pubmed_id") or "").strip()
        if pmid:
            out[pmid] = {"wp_id": p.get("id"), "title": _wp_title(p)}
    return out


def _existing_tag_names():
    ''' Lowercased set of tag names already known to WordPress. Used to
    decide whether the publish run actually created any new tags. '''
    try:
        items, _ = _wp_cache_get("tags")
    except Exception as e:
        logger.warning("update_publications: could not load tags snapshot (%s); "
                       "will conservatively invalidate the tags cache", e)
        return None  # caller treats None as "unknown -> always invalidate"
    return {(t.get("name") or "").strip().lower() for t in (items or [])}


# Form fields the user can fill in for empty PubMed records. Keep this in
# sync with the inputs in templates/update_publications.html.
_EDITABLE_SCALAR_FIELDS = {
    "title", "paper_authors", "journal", "publication_date",
    "doi", "source_url", "keywords", "abstract",
}
_EDITABLE_LIST_FIELDS = {"affiliations", "funding_agencies"}


def _collect_edits(form):
    ''' Pull out form keys of the shape `edit__<pmid>__<field>` and return
    {pmid: {field: value}}. Only fields we know about are kept. '''
    edits = {}
    for key, value in form.items():
        if not key.startswith("edit__"):
            continue
        parts = key.split("__", 2)
        if len(parts) != 3:
            continue
        _, pmid, field = parts
        value = (value or "").strip()
        if not value:
            continue
        if field in _EDITABLE_LIST_FIELDS:
            entries = [line.strip() for line in value.splitlines() if line.strip()]
            if entries:
                edits.setdefault(pmid, {})[field] = entries
        elif field in _EDITABLE_SCALAR_FIELDS:
            edits.setdefault(pmid, {})[field] = value
    return edits


def _apply_edits(payload, fields):
    ''' Overlay user-supplied edits on top of a cached enrichment payload.
    Only overwrites genuinely empty values so PubMed data wins where it
    exists. '''
    if not fields:
        return payload
    merged = dict(payload)
    for k, v in fields.items():
        existing = merged.get(k)
        if existing in (None, "", [], {}):
            merged[k] = v
    if merged.get("paper_authors", "").strip():
        merged["status"] = "ready"
    return merged


@update_publications_page.route('/update_publications')
def update_publications():
    # Fail loudly before touching WP if Redis is unreachable; the page
    # depends on shared state across uWSGI workers.
    _require_redis()

    force_update = valueFromRequest(key="force_update", request=request, boolean=True) or False
    force_refresh = valueFromRequest(key="force_refresh", request=request, boolean=True) or False

    published = valueFromRequest(key="published", request=request, integer=True)
    error_count = valueFromRequest(key="errors", request=request, integer=True)
    run_token = valueFromRequest(key="run", request=request) or ""

    already_published = _existing_published_by_pubmed_id()

    with api.Session():
        drafts = _fetch_all_drafts()
        candidates = [p for p in drafts if _needs_enrichment(p, force_update)]

        if force_refresh:
            for p in candidates:
                _cache_del(p.s.pubmed_id)

        # Short-circuit: drafts whose pubmed_id is already represented by
        # a published paper get flagged "published" without consulting
        # the enrichment cache or PubMed.
        published_rows = []
        live_candidates = []
        for paper in candidates:
            pmid = paper.s.pubmed_id
            hit = already_published.get(pmid)
            if hit:
                published_rows.append({
                    "status": "published",
                    "wp_id": paper.s.id,
                    "pubmed_id": pmid,
                    "title": "",
                    "abstract": "",
                    "paper_authors": "",
                    "source_url": "",
                    "doi": "",
                    "journal": "",
                    "publication_date": "",
                    "date": "",
                    "keywords": "",
                    "affiliations": [],
                    "funding_agencies": [],
                    "duplicate_of": hit,
                })
            else:
                live_candidates.append(paper)

        cached_rows = []
        to_fetch = []
        for paper in live_candidates:
            cached = _cache_get(paper.s.pubmed_id)
            if cached and cached.get("wp_id") == paper.s.id:
                cached_rows.append(cached)
            else:
                to_fetch.append(paper)

        newly_enriched = _enrich_via_pubmed(to_fetch)

    rows = published_rows + cached_rows + newly_enriched
    rows.sort(key=lambda r: r.get("date") or "", reverse=True)

    templateDict = navbar_template('Research')
    templateDict["banner_media"] = local_banner("sorghum_panicle")
    templateDict["rows"] = rows
    templateDict["ready_count"] = sum(1 for r in rows if r["status"] == "ready")
    templateDict["force_update"] = force_update
    templateDict["last_published"] = published
    templateDict["last_errors"] = error_count
    templateDict["last_error_details"] = _consume_publish_errors(run_token)

    return render_template("update_publications.html", **templateDict)


@update_publications_page.route('/update_publications/publish', methods=['POST'])
def publish_selected():
    _require_redis()
    _ensure_wp_auth()
    if getattr(api, "authenticator", None) is None:
        flask.abort(503, description=(
            "WordPress basic auth not configured; set SB_WP_USERNAME and SB_WP_PASSWORD"
        ))

    selected = request.form.getlist("pubmed_ids")
    edits = _collect_edits(request.form)
    published = 0
    errors = []

    # Snapshots taken before the loop so we can (a) reject duplicates and
    # (b) detect whether the run actually created any new tags.
    existing_pubmed_ids = set(_existing_published_by_pubmed_id().keys())
    existing_tag_names = _existing_tag_names()  # None if snapshot unavailable
    new_tags_created = False
    published_this_run = set()  # catches within-batch pubmed_id collisions

    with api.Session():
        for pmid in selected:
            payload = _cache_get(pmid)
            if not payload:
                errors.append(f"{pmid}: not in cache (reload the page to re-fetch from PubMed)")
                continue
            payload = _apply_edits(payload, edits.get(pmid, {}))
            if not (payload.get("paper_authors") or "").strip():
                errors.append(f"{pmid}: paper_authors is empty; fill it in before publishing")
                continue
            if pmid in existing_pubmed_ids:
                errors.append(f"{pmid}: a published paper with this PubMed ID already exists; skipping")
                continue
            if pmid in published_this_run:
                errors.append(f"{pmid}: duplicate of another row published earlier in this batch; skipping")
                continue
            try:
                req = ScientificPaperRequest(api=api)
                req.include = [str(payload["wp_id"])]
                req.status = "draft"
                results = req.get() or []
                if not results:
                    errors.append(f"{pmid}: draft id={payload['wp_id']} not found")
                    continue
                paper = results[0]

                paper.s.title = payload["title"]
                paper.s.abstract = payload["abstract"]
                paper.s.paper_authors = payload["paper_authors"]
                paper.s.source_url = payload["source_url"]
                paper.s.doi = payload["doi"]
                paper.s.journal = payload["journal"]
                paper.s.publication_date = payload["publication_date"]
                paper.s.date = payload["date"]
                paper.s.keywords = payload["keywords"]
                paper.s.affiliations = payload["affiliations"]
                paper.s.funding_agencies = payload["funding_agencies"]

                if payload["keywords"] and payload["keywords"] != "No keywords in Pubmed":
                    tag_ids = []
                    for kw in [w.strip() for w in payload["keywords"].split(",") if w.strip()]:
                        kw_lc = kw.lower()
                        if existing_tag_names is not None and kw_lc not in existing_tag_names:
                            new_tags_created = True
                            existing_tag_names.add(kw_lc)
                        tag = Tag(api=api)
                        tag.s.name = kw
                        tag_ids.append(str(tag.post))
                    if tag_ids:
                        paper.s.tags = ", ".join(tag_ids)

                parts = [payload["abstract"], payload["paper_authors"]]
                if payload["keywords"] and payload["keywords"] != "No keywords in Pubmed":
                    parts.append(payload["keywords"])
                parts.append(payload["pubmed_id"])
                if payload["doi"]:
                    parts.append(payload["doi"])
                paper.s.content = "\n".join(p for p in parts if p)

                paper.s.status = "publish"

                paper.update()
                _cache_del(pmid)
                published += 1
                published_this_run.add(pmid)
            except Exception as e:
                logger.exception("update_publications: publish failed for %s", pmid)
                errors.append(f"{pmid}: {e}")

    if published > 0:
        _wp_cache_invalidate("publications")
        # Only invalidate the tags cache if the publish run actually
        # created at least one new tag (or if we couldn't load the tag
        # snapshot and have to be conservative).
        if existing_tag_names is None or new_tags_created:
            _wp_cache_invalidate("tags")
            logger.info(
                "update_publications: invalidated wp_cache:publications and "
                "wp_cache:tags after publishing %d paper(s)", published,
            )
        else:
            logger.info(
                "update_publications: invalidated wp_cache:publications after "
                "publishing %d paper(s); no new tags so leaving wp_cache:tags",
                published,
            )

    token = _stash_publish_errors(errors)
    suffix = f"&run={token}" if token else ""
    return redirect(f"/update_publications?published={published}&errors={len(errors)}{suffix}")
