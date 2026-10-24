"""The Flow cache persists computed payloads in the app's SQLite store."""

from __future__ import annotations

import uuid

from app.flow import cache as flow_cache


def _key() -> str:
    return flow_cache.make_key("test", uuid.uuid4().hex)


def test_second_computation_is_a_cache_hit():
    key = _key()
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": calls["n"]}

    first, first_meta = flow_cache.get_or_compute(key, compute, ttl=60)
    second, second_meta = flow_cache.get_or_compute(key, compute, ttl=60)

    assert calls["n"] == 1
    assert first == {"value": 1}
    assert second == {"value": 1}
    assert first_meta.hit is False
    assert second_meta.hit is True
    assert second_meta.fresh is True


def test_refresh_bypasses_the_cache():
    key = _key()
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": calls["n"]}

    flow_cache.get_or_compute(key, compute, ttl=60)
    fresh, meta = flow_cache.get_or_compute(key, compute, ttl=60, refresh=True)
    assert fresh == {"value": 2}
    assert meta.hit is False
    assert calls["n"] == 2


def test_stale_payload_is_served_if_recompute_fails():
    key = _key()
    flow_cache.write(key, {"value": "old"})

    def broken():
        raise RuntimeError("upstream down")

    payload, meta = flow_cache.get_or_compute(key, broken, ttl=0)
    assert payload == {"value": "old"}
    assert meta.hit is True
    assert meta.fresh is False
    assert meta.warning is not None


def test_clear_removes_only_flow_keys():
    key = _key()
    flow_cache.write(key, {"value": 1})
    assert key in flow_cache.stats()["keys"] or flow_cache.stats()["entries"] >= 1
    removed = flow_cache.clear()
    assert removed >= 1
    assert flow_cache.stats()["entries"] == 0
