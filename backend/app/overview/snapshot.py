"""Snapshot orchestration for the market dashboard.

The GET path only reads SQLite. The expensive work (study frames + one
TradingView scan + group indices) runs in a single-flight background job and is
persisted under a versioned key.

Read states:

  * current snapshot       -> 200, `stale: false`
  * older snapshot         -> 200, `stale: true`, build triggered
  * no snapshot            -> 202, `state: "building"`, build started
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app import computed_cache, db
from app.overview import gauge, rotation, summary, universe
from app.plan.bars import session_is_final

log = logging.getLogger(__name__)

FORMULA_VERSION = 1
CACHE_VERSION = "v1"
SNAPSHOT_TTL = int(os.getenv("OVERVIEW_CACHE_TTL", "900"))
PREFIX = f"computed:overview:{CACHE_VERSION}"
LATEST_KEY = f"{PREFIX}:latest"
STATUS_KEY = f"{PREFIX}:status"


def _snapshot_key(session: str) -> str:
    return f"{PREFIX}:snapshot:{session}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def current_session(now: datetime | None = None) -> date:
    """The last completed weekday session, in Jakarta time."""
    moment = (now or datetime.now(universe.JAKARTA)).astimezone(universe.JAKARTA)
    day = moment.date()
    while day.weekday() >= 5 or not session_is_final(day, moment):
        day -= timedelta(days=1)
    return day


_LOCK = threading.Lock()
_THREAD: threading.Thread | None = None
_STATE: dict[str, Any] = {
    "state": "idle",
    "phase": None,
    "message": None,
    "started_at": None,
    "finished_at": None,
    "seconds": None,
    "error": None,
    "session": None,
}


def _status_payload() -> dict[str, Any]:
    payload = dict(_STATE)
    if payload.get("state") == "idle":
        stored = db.get(STATUS_KEY)
        if isinstance(stored, dict):
            payload = stored
    payload["formula_version"] = FORMULA_VERSION
    return payload


def _set_status(**changes: Any) -> None:
    _STATE.update(changes)
    db.set(STATUS_KEY, _status_payload())


def status() -> dict[str, Any]:
    return _status_payload()


def _read_latest() -> tuple[dict[str, Any], dict[str, Any], str | None] | None:
    pointer = db.get(LATEST_KEY)
    if not isinstance(pointer, dict):
        return None
    session = str(pointer.get("session") or "")
    if not session:
        return None
    cached = computed_cache.read(_snapshot_key(session), SNAPSHOT_TTL)
    if cached is None:
        return None
    payload, meta = cached
    return payload, meta.as_dict(), session


def latest() -> tuple[dict[str, Any], int]:
    """Return (payload, HTTP status). Never performs the heavy computation."""
    current = current_session().isoformat()
    found = _read_latest()
    if found is None:
        start_build()
        return {
            "state": "building",
            "session": current,
            "status": status(),
            "snapshot": None,
        }, 202

    payload, meta, session = found
    stale = session != current
    building = bool(_THREAD and _THREAD.is_alive())
    if stale and not building:
        start_build()
        building = True
    out = dict(payload)
    out["stale"] = stale
    out["building"] = building
    out["cache"] = meta
    out["status"] = status()
    return out, 200


def start_build(*, refresh: bool = False) -> dict[str, Any]:
    """Start the snapshot job, or return the one already running."""
    global _THREAD
    with _LOCK:
        if _THREAD is not None and _THREAD.is_alive():
            return status()
        _STATE.update(
            state="running",
            phase="queued",
            message="queued",
            started_at=_now_iso(),
            finished_at=None,
            seconds=None,
            error=None,
            session=None,
        )
        db.set(STATUS_KEY, _status_payload())
        _THREAD = threading.Thread(
            target=_run,
            kwargs={"refresh": refresh},
            daemon=True,
            name="overview-build",
        )
        _THREAD.start()
    return status()


def refresh() -> dict[str, Any]:
    return start_build(refresh=True)


def _run(refresh: bool) -> None:
    _ = refresh  # the flag is part of the job contract; the build is the same
    started = time.perf_counter()
    try:
        _set_status(phase="universe", message="reading market universe")
        inputs = universe.load_inputs()
        _set_status(phase="summary", message="computing breadth and benchmark")
        market = summary.build(inputs)
        _set_status(phase="gauge", message="computing market-stress gauge")
        stress = gauge.build(market)
        _set_status(phase="rotation", message="building sector and group rotations")
        rotations = rotation.build_all(inputs)
        session = str(inputs.get("as_of") or current_session().isoformat())
        snapshot = {
            "as_of": session,
            "history_as_of": inputs.get("coverage", {}).get("history_as_of"),
            "print_as_of": inputs.get("coverage", {}).get("print_as_of"),
            "source": inputs.get("source"),
            "coverage": inputs.get("coverage", {}),
            "market": market,
            "gauge": stress,
            "sectors": rotations["sectors"],
            "conglomerates": rotations["conglomerates"],
            "industries": rotations["industries"],
            "warnings": list(inputs.get("warnings") or []),
            "built_at": _now_iso(),
            "formula_version": FORMULA_VERSION,
        }
        _set_status(phase="persist", message="saving snapshot")
        computed_cache.write(_snapshot_key(session), snapshot)
        db.set(
            LATEST_KEY,
            {
                "session": session,
                "built_at": snapshot["built_at"],
                "formula_version": FORMULA_VERSION,
            },
        )
        elapsed = time.perf_counter() - started
        _set_status(
            state="done",
            phase=None,
            message="snapshot ready",
            finished_at=_now_iso(),
            seconds=round(elapsed, 2),
            session=session,
            error=None,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("overview build failed")
        elapsed = time.perf_counter() - started
        _set_status(
            state="failed",
            phase=None,
            message="build failed",
            finished_at=_now_iso(),
            seconds=round(elapsed, 2),
            error=str(exc)[:400],
        )


def cache_stats() -> dict[str, Any]:
    base = computed_cache.stats("overview")
    base["latest"] = db.get(LATEST_KEY)
    base["status"] = status()
    return base


def clear_cache() -> int:
    removed = computed_cache.clear("overview")
    db.delete(LATEST_KEY)
    db.delete(STATUS_KEY)
    return removed


def archive(session: str) -> dict[str, Any] | None:
    cached = computed_cache.read(_snapshot_key(session), SNAPSHOT_TTL)
    if cached is None:
        return None
    payload, meta = cached
    out = dict(payload)
    out["cache"] = meta.as_dict()
    return out


def warm() -> None:
    """Startup warm-up: serve the disk snapshot first, then refresh if stale."""
    try:
        current = current_session().isoformat()
        found = _read_latest()
        if found is not None and found[2] == current:
            return
        start_build()
    except Exception as exc:  # noqa: BLE001
        log.warning("overview warm failed: %s", exc)
