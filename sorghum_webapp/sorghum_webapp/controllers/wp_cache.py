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
    "publications":         {"path": "scientific_paper"},
    "tags":                 {"path": "tags"},
    "projects":             {"path": "project"},
    "working_groups":       {"path": "working_group"},
    "conferences":          {"path": "conference"},
    "conference_sessions":  {"path": "conference_session"},
    "conference_abstracts": {"path": "conference_abstract", "params": {"orderby": "date", "order": "asc"}},
    "conference_people":    {"path": "conference_person"},
    "organizations":        {"path": "organization"},
    "sicna_tags":           {"path": "tags", "params": {"search": "sicna"}},
    "events":               {"path": "event"},
}

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


def _fetch_all_from_wp(resource_entry):
    base_url = app.config["WP_BASE_URL"].rstrip("/") + "/" + resource_entry["path"]
    fixed = resource_entry.get("params", {})
    auth = getattr(api, "authenticator", None) if api else None
    per_page = 100

    params = {"per_page": per_page, "page": 1, "skip_cache": 1, **fixed}
    r = requests.get(base_url, params=params, auth=auth, timeout=60)
    r.raise_for_status()
    total = int(r.headers.get("X-WP-Total", 0))
    total_pages = int(r.headers.get("X-WP-TotalPages", 1))
    items = r.json()

    if total_pages > 1:
        def fetch_page(p):
            pp = {"per_page": per_page, "page": p, "skip_cache": 1, **fixed}
            resp = requests.get(base_url, params=pp, auth=auth, timeout=60)
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
    return items, meta


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
