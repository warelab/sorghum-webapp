#!/usr/bin/python

"""
Server-side cache in front of selected WordPress REST endpoints.

The publications page used to make N paginated requests directly to
content.sorghumbase.org from the browser. This blueprint exposes:

    GET /api/wp_cache/<resource>          full JSON list (cached)
    GET /api/wp_cache/<resource>/meta     {count, fetched_at} (cached)

Backed by Redis when available, with an in-process fallback so the page
still works if Redis is down. Refills are serialized by a Redis-side
SET-NX lock so concurrent requests across uWSGI workers don't all
hammer WordPress for the same data; if Redis is unavailable, a
threading.Lock keeps the in-process fallback path from doing the same.
"""

import flask
import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .. import app
from .. import wordpress_api as api

try:
    import redis as redis_mod
except ImportError:
    redis_mod = None

logger = logging.getLogger("sorghumbase")

wp_cache_page = flask.Blueprint("wp_cache_page", __name__)

# Resource name in our URL -> entry describing how to refill the cache.
# Two flavors:
#   { "path": "<wp_rest_path>", "params"?: {...} }
#       Page through a single WP REST endpoint. `params` holds fixed
#       query args baked into the cache key.
#   { "builder": callable() -> json_serializable }
#       Run a custom Python function (e.g. multi-query aggregations like
#       /api/people). The return value is stored as-is.
# Builder entries are typically registered from their owning controller
# module after import (see controllers/people.py).
RESOURCES = {
    "posts":                {"path": "posts", "params": {"categories_exclude": "8,17", "_embed": "wp:featuredmedia,author"}},
    "publications":         {"path": "scientific_paper"},
    "tags":                 {"path": "tags"},
    "projects":             {"path": "project"},
    "working_groups":       {"path": "working_group"},
    # conferences is registered below as a builder so we can fold the
    # featured-media + sponsor logo URLs into the payload server-side.
    # "conferences":          {"path": "conference"},
    "conference_sessions":  {"path": "conference_session"},
    "conference_abstracts": {"path": "conference_abstract", "params": {"orderby": "date", "order": "asc"}},
    "conference_people":    {"path": "conference_person"},
    "organizations":        {"path": "organization"},
    "sicna_tags":           {"path": "tags", "params": {"search": "sicna"}},
    "events":               {"path": "event"},
    "resource_links":       {"path": "resource-link"},
    "post_categories":      {"path": "categories", "params": {"per_page": 50}},
}


# Category IDs powering the three home-page post strips. Used by the
# home_posts builder below; matched to the section keys the React
# component (search_app/src/components/homePosts.js) expects.
_HOME_POSTS_SECTIONS = (
    ("news",       2),
    ("highlights", 1022),
    ("topics",     3092),
)


def _normalize_home_post(raw):
    media = (raw.get("_embedded") or {}).get("wp:featuredmedia") or []
    featured_url = media[0].get("source_url") if media else None
    title = (raw.get("title") or {}).get("rendered")
    excerpt = (raw.get("excerpt") or {}).get("rendered")
    return {
        "slug":         raw.get("slug"),
        "title":        title,
        "excerpt":      excerpt,
        "date":         raw.get("date"),
        "featuredUrl":  featured_url,
    }


def _build_home_posts():
    """wp_cache builder for the home page's three post strips. One WP
    REST call per section (3 posts each, with featured media embedded),
    fetched in parallel. The returned dict shape matches what
    homePosts.js renders, so the React side just consumes it directly."""
    base_url = app.config["WP_BASE_URL"].rstrip("/") + "/posts"
    auth = getattr(api, "authenticator", None) if api else None
    session = _wp_session()

    def fetch_section(item):
        key, category_id = item
        params = {
            "categories": category_id,
            "per_page": 3,
            "orderby": "date",
            "order": "desc",
            "_embed": "wp:featuredmedia",
            "skip_cache": 1,
        }
        resp = session.get(base_url, params=params, auth=auth, timeout=60)
        resp.raise_for_status()
        return key, [_normalize_home_post(p) for p in resp.json()]

    payload = {}
    with ThreadPoolExecutor(max_workers=len(_HOME_POSTS_SECTIONS)) as ex:
        for key, posts in ex.map(fetch_section, _HOME_POSTS_SECTIONS):
            payload[key] = posts
    return payload


RESOURCES["home_posts"] = {"builder": _build_home_posts}


def _build_conferences():
    """wp_cache builder for the conferences resource. Fetches the WP
    conference list, then resolves featured-media + sponsor resource_image
    IDs into URLs in a single batched media call. The client used to make
    a second WP REST round trip from the browser to do this; baking the
    URLs in server-side means the conference page renders without any
    extra fetch (and WP is hit at most once per cache refill, not per
    visitor)."""
    conferences, _total = _fetch_all_from_wp({"path": "conference"})

    media_ids = set()
    for conf in conferences:
        fm = conf.get("featured_media")
        if fm:
            media_ids.add(int(fm))
        for sponsor in (conf.get("sponsors") or []):
            ri = sponsor.get("resource_image")
            if ri:
                media_ids.add(int(ri))

    media_by_id = {}
    if media_ids:
        base_url = app.config["WP_BASE_URL"].rstrip("/") + "/media"
        auth = getattr(api, "authenticator", None) if api else None
        session = _wp_session()
        ids_csv = ",".join(str(i) for i in sorted(media_ids))
        # WP per_page max is 100; we have far fewer images than that
        # across all conferences combined.
        resp = session.get(
            base_url,
            params={"include": ids_csv, "per_page": 100, "skip_cache": 1},
            auth=auth, timeout=60,
        )
        resp.raise_for_status()
        for m in resp.json():
            media_by_id[m.get("id")] = m

    def _featured_url(m):
        # About-section hero uses the full-size variant; fall back to the
        # bare source_url if a smaller upload skipped the full size.
        try:
            return m["media_details"]["sizes"]["full"]["source_url"]
        except (KeyError, TypeError):
            return m.get("source_url")

    for conf in conferences:
        fm = conf.get("featured_media")
        if fm and media_by_id.get(fm):
            conf["featured_image_url"] = _featured_url(media_by_id[fm])
        for sponsor in (conf.get("sponsors") or []):
            ri = sponsor.get("resource_image")
            if ri and media_by_id.get(ri):
                sponsor["resource_image_url"] = media_by_id[ri].get("source_url")

    return conferences


RESOURCES["conferences"] = {"builder": _build_conferences}

_redis_client = None
_redis_init_lock = threading.Lock()
_resource_locks = {}
_resource_locks_guard = threading.Lock()
_mem_cache = {}  # fallback when Redis is unavailable: {resource: (items, meta)}


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client or None
    if redis_mod is None:
        _redis_client = False
        return None
    with _redis_init_lock:
        if _redis_client is not None:
            return _redis_client or None
        url = app.config.get("REDIS_URL", "redis://localhost:6379/0")
        try:
            client = redis_mod.from_url(url, socket_connect_timeout=2, socket_timeout=10)
            client.ping()
            _redis_client = client
            logger.info("wp_cache connected to Redis at %s", url)
        except Exception as e:
            logger.warning("wp_cache: Redis unavailable (%s); using in-process cache", e)
            _redis_client = False
    return _redis_client or None


def _resource_lock(resource):
    with _resource_locks_guard:
        lock = _resource_locks.get(resource)
        if lock is None:
            lock = threading.Lock()
            _resource_locks[resource] = lock
        return lock


_wp_session_singleton = None


def _wp_session():
    """Shared requests.Session with retry-on-failure mounted. Necessary
    because the WP REST API occasionally returns a 5xx or the local DNS
    resolver flakes for a moment, and the 8-way parallel fetch in
    _fetch_all_from_wp turns a single transient blip into a 500 on the
    cache route."""
    global _wp_session_singleton
    if _wp_session_singleton is not None:
        return _wp_session_singleton
    s = requests.Session()
    retry = Retry(
        total=5,
        connect=5,
        read=3,
        backoff_factor=0.5,  # waits 0.5, 1, 2, 4, 8s between retries
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "HEAD"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=16)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    _wp_session_singleton = s
    return s


def _fetch_all_from_wp(resource_entry):
    base_url = app.config["WP_BASE_URL"].rstrip("/") + "/" + resource_entry["path"]
    fixed = resource_entry.get("params", {})
    auth = getattr(api, "authenticator", None) if api else None
    per_page = 100
    session = _wp_session()

    params = {"per_page": per_page, "page": 1, "skip_cache": 1, **fixed}
    r = session.get(base_url, params=params, auth=auth, timeout=60)
    r.raise_for_status()
    total = int(r.headers.get("X-WP-Total", 0))
    total_pages = int(r.headers.get("X-WP-TotalPages", 1))
    items = r.json()

    if total_pages > 1:
        def fetch_page(p):
            pp = {"per_page": per_page, "page": p, "skip_cache": 1, **fixed}
            resp = session.get(base_url, params=pp, auth=auth, timeout=60)
            resp.raise_for_status()
            return resp.json()

        with ThreadPoolExecutor(max_workers=8) as ex:
            for chunk in ex.map(fetch_page, range(2, total_pages + 1)):
                items.extend(chunk)

    return items, total


def _read_cache(resource, ttl):
    rds = _get_redis()
    if rds:
        try:
            data_raw = rds.get(f"wp_cache:{resource}:data")
            meta_raw = rds.get(f"wp_cache:{resource}:meta")
            if data_raw and meta_raw:
                meta = json.loads(meta_raw)
                if time.time() - meta.get("fetched_at", 0) < ttl:
                    return json.loads(data_raw), meta
        except Exception as e:
            logger.warning("wp_cache: redis read failed (%s); falling through", e)
    cached = _mem_cache.get(resource)
    if cached:
        items, meta = cached
        if time.time() - meta.get("fetched_at", 0) < ttl:
            return items, meta
    return None, None


def _write_cache(resource, items, meta, ttl):
    rds = _get_redis()
    if rds:
        try:
            payload_ttl = ttl + 300  # keep payload slightly longer than the freshness window
            rds.setex(f"wp_cache:{resource}:data", payload_ttl, json.dumps(items))
            rds.setex(f"wp_cache:{resource}:meta", payload_ttl, json.dumps(meta))
        except Exception as e:
            logger.warning("wp_cache: redis write failed (%s); using memory only", e)
    _mem_cache[resource] = (items, meta)


# Atomic compare-and-delete so we only release the lock if we still own it.
# (TTL might have expired and another worker could now hold the same key.)
_RELEASE_LOCK_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] "
    "then return redis.call('del', KEYS[1]) "
    "else return 0 end"
)

# How long any one refill is allowed to take before the lock auto-expires.
# Must be > the slowest realistic _fetch_all_from_wp() run.
_LOCK_TTL_SECONDS = 120
_LOCK_POLL_SECONDS = 0.5
_LOCK_WAIT_BUDGET = _LOCK_TTL_SECONDS + 30


def _do_fetch_and_store(resource, ttl):
    entry = RESOURCES[resource]
    logger.info("wp_cache: refreshing %s from WordPress", resource)
    t0 = time.time()
    if "builder" in entry:
        items = entry["builder"]()
        total = None
    else:
        items, total = _fetch_all_from_wp(entry)
    try:
        count = len(items)
    except TypeError:
        count = 0
    meta = {
        "count": count,
        "fetched_at": time.time(),
        "fetch_seconds": round(time.time() - t0, 2),
    }
    if total is not None:
        meta["wp_total"] = total
    _write_cache(resource, items, meta, ttl)
    _sync_typesense(resource, items)
    return items, meta


def _sync_typesense(resource, items):
    """Best-effort mirror of the refilled resource into Typesense.

    Imported lazily so a missing typesense client or library never blocks
    the WP cache refresh path.
    """
    try:
        from . import typesense_index
    except Exception as e:
        logger.debug("typesense_index import failed (%s); skipping sync", e)
        return
    try:
        typesense_index.sync_resource(resource, items)
    except Exception as e:
        logger.warning("typesense sync failed for %s (%s)", resource, e)


def _refresh_with_redis_lock(resource, ttl, rds):
    """Cross-worker serialization. Whoever wins SET-NX fills the cache;
    everyone else polls until the data shows up, then returns it."""
    lock_key = f"wp_cache:{resource}:lock"
    token = uuid.uuid4().hex
    deadline = time.time() + _LOCK_WAIT_BUDGET

    while True:
        try:
            acquired = rds.set(lock_key, token, nx=True, ex=_LOCK_TTL_SECONDS)
        except Exception as e:
            logger.warning("wp_cache: lock acquire failed (%s); fetching unguarded", e)
            return _do_fetch_and_store(resource, ttl)

        if acquired:
            try:
                # Re-check in case the previous holder finished between our
                # initial cache read and our SET-NX win.
                items, meta = _read_cache(resource, ttl)
                if items is not None:
                    return items, meta
                return _do_fetch_and_store(resource, ttl)
            finally:
                try:
                    rds.eval(_RELEASE_LOCK_LUA, 1, lock_key, token)
                except Exception:
                    pass

        # Lock held by another worker. Wait for the cache to be populated.
        time.sleep(_LOCK_POLL_SECONDS)
        items, meta = _read_cache(resource, ttl)
        if items is not None:
            return items, meta
        if time.time() > deadline:
            logger.warning(
                "wp_cache: gave up waiting on lock for %s after %ss; fetching unguarded",
                resource, _LOCK_WAIT_BUDGET,
            )
            return _do_fetch_and_store(resource, ttl)


def _refresh_with_thread_lock(resource, ttl):
    """Fallback when Redis is unavailable: serialize within this worker only."""
    with _resource_lock(resource):
        items, meta = _read_cache(resource, ttl)
        if items is not None:
            return items, meta
        return _do_fetch_and_store(resource, ttl)


def _get_or_refresh(resource):
    ttl = int(app.config.get("WP_CACHE_TTL", 3600))
    items, meta = _read_cache(resource, ttl)
    if items is not None:
        return items, meta

    rds = _get_redis()
    if rds:
        return _refresh_with_redis_lock(resource, ttl, rds)
    return _refresh_with_thread_lock(resource, ttl)


def _invalidate(resource):
    rds = _get_redis()
    if rds:
        try:
            rds.delete(f"wp_cache:{resource}:data", f"wp_cache:{resource}:meta")
        except Exception:
            pass
    _mem_cache.pop(resource, None)


@wp_cache_page.route("/api/wp_cache/_resources")
def list_resources():
    return flask.jsonify(sorted(RESOURCES.keys()))


@wp_cache_page.route("/api/wp_cache/_timestamps")
def list_timestamps():
    """Returns {resource_name: fetched_at_epoch_seconds} for every
    registered resource. Reads meta blobs directly from Redis -- no WP
    traffic, no cache refill, cheap.

    Used by client-side caches to detect when their local copy is
    behind the server's. A resource that's never been warmed reports 0.
    """
    rds = _get_redis()
    out = {}
    for resource in RESOURCES.keys():
        ts = 0
        if rds is not None:
            try:
                raw = rds.get(f"wp_cache:{resource}:meta")
                if raw:
                    meta = json.loads(raw)
                    ts = float(meta.get("fetched_at", 0) or 0)
            except Exception:
                pass
        else:
            cached = _mem_cache.get(resource)
            if cached:
                ts = float((cached[1] or {}).get("fetched_at", 0) or 0)
        out[resource] = ts
    return flask.jsonify(out)


@wp_cache_page.route("/api/wp_cache/<resource>")
def cache_resource(resource):
    if resource not in RESOURCES:
        flask.abort(404)
    if flask.request.args.get("force") == "1":
        _invalidate(resource)
    items, meta = _get_or_refresh(resource)
    response = flask.jsonify(items)
    response.headers["X-Wp-Cache-Count"] = str(meta["count"])
    response.headers["X-Wp-Cache-Fetched-At"] = str(meta["fetched_at"])
    return response


@wp_cache_page.route("/api/wp_cache/<resource>/meta")
def cache_resource_meta(resource):
    if resource not in RESOURCES:
        flask.abort(404)
    if flask.request.args.get("force") == "1":
        _invalidate(resource)
    _, meta = _get_or_refresh(resource)
    return flask.jsonify(meta)
