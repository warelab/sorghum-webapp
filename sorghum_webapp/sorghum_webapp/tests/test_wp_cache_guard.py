"""Tests for the wp_cache refill guard (controllers/wp_cache.py).

A broken WordPress used to be able to destroy the caches: an HTTP 200 with an
empty list was stored as if it were real content, and the Typesense sync then
deleted the matching collection. These tests pin the guard that prevents it.

Redis is forced unavailable so everything runs against the in-process
_mem_cache fallback -- no Redis needed to run the suite.
"""

import time

import pytest


RESOURCE = "publications"


def _wp_cache():
    """Import the controller lazily.

    sorghum_webapp.app is None until create_app() runs, and wp_cache binds it
    with `from .. import app` at import time -- so importing at module scope
    (before the `app` fixture) would capture None and every config lookup
    would fail.
    """
    from ..controllers import wp_cache
    return wp_cache


def _items(n, tag="ok"):
    return [{"id": i, "tag": tag} for i in range(n)]


@pytest.fixture
def wpc(app, monkeypatch):
    """wp_cache with Redis disabled, a clean cache, and Typesense stubbed."""
    wp_cache = _wp_cache()
    monkeypatch.setattr(wp_cache, "_redis_client", False)
    monkeypatch.setattr(wp_cache, "_mem_cache", {})

    synced = []
    monkeypatch.setattr(
        wp_cache, "_sync_typesense",
        lambda resource, items: synced.append((resource, items)),
    )
    wp_cache.synced = synced

    def set_wp(items, total=None, raises=None):
        def fake(entry):
            if raises is not None:
                raise raises
            return items, total
        monkeypatch.setattr(wp_cache, "_fetch_all_from_wp", fake)

    wp_cache.set_wp = set_wp
    return wp_cache


def _prime(wpc, n):
    """Put a known-good payload of n records in the cache."""
    wpc.set_wp(_items(n))
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert meta["count"] == n
    del wpc.synced[:]
    return meta


# --- payload sizing --------------------------------------------------------

def test_payload_size_counts_dict_branches(app):
    wp_cache = _wp_cache()
    # home_posts / people return a dict of lists; len() would say 3 forever.
    payload = {"news": _items(5), "highlights": _items(3), "topics": _items(2)}
    assert wp_cache._payload_size(payload) == 10
    assert wp_cache._payload_size({"news": [], "highlights": [], "topics": []}) == 0
    assert wp_cache._payload_size(_items(7)) == 7
    assert wp_cache._payload_size(None) == 0


# --- the guard -------------------------------------------------------------

def test_cold_cache_accepts_first_fill(wpc):
    wpc.set_wp(_items(400))
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert len(items) == 400
    assert meta["count"] == 400
    assert "last_refill_error" not in meta
    assert wpc.synced, "a cold fill should sync Typesense"


def test_empty_response_keeps_cache(wpc):
    before = _prime(wpc, 400)

    wpc.set_wp([])
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)

    assert len(items) == 400, "the good payload must survive"
    assert meta["count"] == 400
    assert meta["fetched_at"] == before["fetched_at"], "clients must not re-download"
    assert "WordPress returned 0 items" in meta["last_refill_error"]
    assert meta["stale_since"]
    assert not wpc.synced, "Typesense must not be resynced with an empty payload"


def test_big_shrink_is_rejected(wpc):
    _prime(wpc, 400)
    wpc.set_wp(_items(300))  # -25%, past the 20% tolerance
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert len(items) == 400
    assert "shrink tolerance" in meta["last_refill_error"]
    assert not wpc.synced


def test_small_shrink_is_accepted(wpc):
    # The guard must not be so eager that ordinary deletions trip it.
    _prime(wpc, 400)
    wpc.set_wp(_items(340))  # -15%
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert len(items) == 340
    assert "last_refill_error" not in meta
    assert wpc.synced


def test_growth_is_accepted(wpc):
    _prime(wpc, 400)
    wpc.set_wp(_items(450))
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert len(items) == 450
    assert "last_refill_error" not in meta


def test_short_fetch_vs_wp_total_is_rejected(wpc):
    # WP said 400 records matched but pagination only yielded 100.
    _prime(wpc, 400)
    wpc.set_wp(_items(100), total=400)
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert len(items) == 400
    assert "X-WP-Total" in meta["last_refill_error"]


def test_fetch_exception_keeps_cache(wpc):
    before = _prime(wpc, 400)

    wpc.set_wp(None, raises=RuntimeError("502 Bad Gateway"))
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)

    assert len(items) == 400
    assert meta["fetched_at"] == before["fetched_at"]
    assert "502 Bad Gateway" in meta["last_refill_error"]
    assert not wpc.synced


def test_fetch_exception_on_cold_cache_propagates(wpc):
    # Nothing to protect -- the route should 500 and the cron warm report FAILED.
    wpc.set_wp(None, raises=RuntimeError("502 Bad Gateway"))
    with pytest.raises(RuntimeError):
        wpc._do_fetch_and_store(RESOURCE, 3600)


def test_allow_shrink_overrides_the_guard(wpc):
    _prime(wpc, 400)
    wpc.set_wp(_items(10))
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600, allow_shrink=True)
    assert len(items) == 10
    assert "last_refill_error" not in meta
    assert wpc.synced


def test_recovery_clears_the_stale_markers(wpc):
    _prime(wpc, 400)

    wpc.set_wp([])
    _, stale_meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert stale_meta["last_refill_error"]

    wpc.set_wp(_items(410))
    items, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert len(items) == 410
    assert "last_refill_error" not in meta
    assert "stale_since" not in meta


def test_stale_since_is_pinned_to_the_first_rejection(wpc):
    _prime(wpc, 400)

    wpc.set_wp([])
    _, first = wpc._do_fetch_and_store(RESOURCE, 3600)
    time.sleep(0.01)
    _, second = wpc._do_fetch_and_store(RESOURCE, 3600)

    assert second["stale_since"] == first["stale_since"]
    assert second["last_refill_attempt"] > first["last_refill_attempt"]


def test_unchanged_content_still_reuses_fetched_at(wpc):
    # The change-detection optimisation must survive the guard rework.
    before = _prime(wpc, 400)
    wpc.set_wp(_items(400))
    _, meta = wpc._do_fetch_and_store(RESOURCE, 3600)
    assert meta["fetched_at"] == before["fetched_at"]
    assert not wpc.synced, "identical content needs no reindex"


# --- Typesense deletion guards ---------------------------------------------

class _FakeDocs:
    def __init__(self, collection):
        self.collection = collection

    def delete(self, *args, **kwargs):
        self.collection.deleted_all = True
        return {}

    def import_(self, docs, opts):
        self.collection.imported = docs
        return [{"success": True} for _ in docs]

    def export(self, *args, **kwargs):
        self.collection.exported = True
        return ""


class _FakeCollection:
    def __init__(self, num_documents):
        self.num_documents = num_documents
        self.deleted_all = False
        self.imported = None
        self.exported = False
        self.documents = _FakeDocs(self)

    def retrieve(self):
        return {"num_documents": self.num_documents}


class _FakeClient:
    def __init__(self, collection):
        self.collections = {"papers": collection}


@pytest.fixture
def ts(app, monkeypatch):
    from ..controllers import typesense_index
    monkeypatch.setattr(typesense_index, "ensure_collection", lambda c, n: None)
    return typesense_index


def test_typesense_empty_payload_does_not_wipe(ts, monkeypatch):
    collection = _FakeCollection(num_documents=400)
    monkeypatch.setattr(ts, "get_client", lambda: _FakeClient(collection))

    status = ts.sync_resource("publications", [])

    assert status["skipped"] == "empty_payload"
    assert not collection.deleted_all, "an empty upstream must not wipe the index"


def test_typesense_empty_payload_wipes_when_explicitly_allowed(ts, monkeypatch):
    collection = _FakeCollection(num_documents=400)
    monkeypatch.setattr(ts, "get_client", lambda: _FakeClient(collection))

    status = ts.sync_resource("publications", [], allow_empty=True)

    assert status["skipped"] is None
    assert collection.deleted_all


def test_typesense_skips_prune_on_a_big_shrink(ts, monkeypatch):
    collection = _FakeCollection(num_documents=400)
    monkeypatch.setattr(ts, "get_client", lambda: _FakeClient(collection))

    items = [{"id": i, "title": {"rendered": "Paper %d" % i}} for i in range(10)]
    status = ts.sync_resource("publications", items)

    # Upserts still happen; only the deletions are held back. The prune starts
    # by exporting the live ids, so never exporting proves it was skipped.
    assert status["ok"]
    assert len(collection.imported) == 10
    assert not collection.exported, "prune should be skipped on a 400 -> 10 shrink"


def test_typesense_prunes_normally_when_the_set_is_stable(ts, monkeypatch):
    collection = _FakeCollection(num_documents=10)
    monkeypatch.setattr(ts, "get_client", lambda: _FakeClient(collection))

    items = [{"id": i, "title": {"rendered": "Paper %d" % i}} for i in range(10)]
    ts.sync_resource("publications", items)

    assert collection.exported, "a healthy sync must still prune stale docs"
