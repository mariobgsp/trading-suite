"""Computed cache and the dashboard snapshot job."""

from __future__ import annotations

import time
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pandas as pd

from app import computed_cache, db
from app.overview import snapshot


def test_computed_cache_roundtrip_and_refresh():
    key = computed_cache.make_key("test", "v1", uuid.uuid4().hex)
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": calls["n"]}

    first, meta = computed_cache.get_or_compute(key, compute, ttl=60)
    second, meta2 = computed_cache.get_or_compute(key, compute, ttl=60)
    assert first == {"value": 1}
    assert second == {"value": 1}
    assert calls["n"] == 1
    assert meta.hit is False
    assert meta2.hit is True

    refreshed, _ = computed_cache.get_or_compute(key, compute, ttl=60, refresh=True)
    assert refreshed == {"value": 2}
    assert calls["n"] == 2


def _inputs(session: date) -> dict:
    class Frames:
        bars: dict = {}
        benchmark = pd.DataFrame()

    return {
        "source": "test",
        "frames": Frames(),
        "joined": [],
        "benchmark": pd.Series(dtype=float),
        "history_as_of": session,
        "print_date": session,
        "history_gap_days": 0,
        "use_print": False,
        "as_of": session,
        "coverage": {
            "universe": 0,
            "joined": 0,
            "missing_history": 0,
            "missing_print": 0,
            "history_floor": 200,
            "history_as_of": session.isoformat(),
            "print_as_of": session.isoformat(),
            "use_current_print": False,
            "history_gap_days": 0,
        },
        "warnings": [],
    }


def test_current_session_uses_the_last_completed_weekday():
    jakarta = ZoneInfo("Asia/Jakarta")
    assert snapshot.current_session(datetime(2026, 10, 24, 12, tzinfo=jakarta)).isoformat() == "2026-10-23"
    assert snapshot.current_session(datetime(2026, 10, 26, 10, tzinfo=jakarta)).isoformat() == "2026-10-23"


def test_build_job_persists_a_snapshot(monkeypatch):
    snapshot.clear_cache()
    session = date(2026, 10, 23)
    monkeypatch.setattr(snapshot, "current_session", lambda now=None: session)
    monkeypatch.setattr(snapshot.universe, "load_inputs", lambda now=None: _inputs(session))

    snapshot.refresh()
    for _ in range(100):
        if snapshot.status()["state"] in {"done", "failed"}:
            break
        time.sleep(0.05)
    assert snapshot.status()["state"] == "done"
    payload, code = snapshot.latest()
    assert code == 200
    assert payload["as_of"] == session.isoformat()
    assert payload["cache"]["hit"] is True
    assert "market" in payload


def test_latest_returns_stale_snapshot_while_rebuilding(monkeypatch):
    snapshot.clear_cache()
    old = "2026-10-22"
    computed_cache.write(
        snapshot._snapshot_key(old),
        {"as_of": old, "market": {}, "sectors": {}, "conglomerates": {}, "industries": {}},
    )
    db.set(snapshot.LATEST_KEY, {"session": old, "formula_version": 1})
    monkeypatch.setattr(snapshot, "current_session", lambda now=None: date(2026, 10, 23))
    calls = {"n": 0}
    monkeypatch.setattr(snapshot, "start_build", lambda **kwargs: calls.__setitem__("n", calls["n"] + 1) or {"state": "running"})
    payload, code = snapshot.latest()
    assert code == 200
    assert payload["stale"] is True
    assert calls["n"] == 1


def test_latest_never_calls_the_universe_loader(monkeypatch):
    snapshot.clear_cache()
    session = "2026-10-23"
    computed_cache.write(snapshot._snapshot_key(session), {"as_of": session, "market": {}})
    db.set(snapshot.LATEST_KEY, {"session": session, "formula_version": 1})
    monkeypatch.setattr(snapshot, "current_session", lambda now=None: date(2026, 10, 23))
    monkeypatch.setattr(
        snapshot.universe,
        "load_inputs",
        lambda now=None: (_ for _ in ()).throw(AssertionError("GET must not build")),
    )
    payload, code = snapshot.latest()
    assert code == 200
    assert payload["as_of"] == session


def test_latest_returns_202_when_no_snapshot(monkeypatch):
    snapshot.clear_cache()
    monkeypatch.setattr(snapshot, "current_session", lambda now=None: date(2026, 10, 23))
    monkeypatch.setattr(snapshot, "start_build", lambda **kwargs: {"state": "running"})
    payload, code = snapshot.latest()
    assert code == 202
    assert payload["state"] == "building"
