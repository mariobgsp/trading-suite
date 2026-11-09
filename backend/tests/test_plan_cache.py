from __future__ import annotations

from typing import Any

from app import computed_cache
from app import plan as planner


class _FakePlan:
    def __init__(self, number: int) -> None:
        self.number = number

    def as_dict(self) -> dict[str, Any]:
        return {"number": self.number}


class _StubSource:
    def __init__(self, stamp: str) -> None:
        self._stamp = stamp

    def load(self, codes):
        raise AssertionError("the cache test must not load bars")

    def stamp(self) -> str:
        return self._stamp


def test_plan_payload_is_reused_until_the_data_stamp_changes(monkeypatch):
    computed_cache.clear("plan")
    previous = planner._active
    calls = []

    def fake_plan(as_of=None, exit_method=None):
        calls.append((as_of, exit_method))
        return _FakePlan(len(calls))

    monkeypatch.setattr(planner, "plan", fake_plan)
    try:
        planner.set_source(_StubSource("snapshot-1"), "cache-test")
        first = planner.plan_payload()
        second = planner.plan_payload()
        assert first == second == {"number": 1}
        assert len(calls) == 1, "the second call must come from the persisted plan"

        planner.set_source(_StubSource("snapshot-2"), "cache-test")
        third = planner.plan_payload()
        assert third == {"number": 2}
        assert len(calls) == 2, "a new data snapshot must recompute"
    finally:
        planner.set_source(*previous)
        computed_cache.clear("plan")


def test_invalidate_drops_the_persisted_plan(monkeypatch):
    computed_cache.clear("plan")
    previous = planner._active
    calls = []

    def fake_plan(as_of=None, exit_method=None):
        calls.append(1)
        return _FakePlan(len(calls))

    monkeypatch.setattr(planner, "plan", fake_plan)
    try:
        planner.set_source(_StubSource("snapshot-1"), "cache-test")
        planner.plan_payload()
        planner.invalidate()
        planner.plan_payload()
        assert len(calls) == 2, "invalidate must not leave the old artifact behind"
    finally:
        planner.set_source(*previous)
        computed_cache.clear("plan")
