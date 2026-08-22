"""Sector rotation history: daily sector-performance snapshots archived in SQLite.

TradingView's scanner gives today's per-sector average change (movers.py), but
rotation analysis needs history: is a sector strengthening or fading over 5/20
days? This module snapshots sector_performance once per trading day under
`rotation:snap:YYYY-MM-DD` and serves rank-change history on demand.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app import db
from app.movers import sector_performance

logger = logging.getLogger(__name__)

SNAPSHOT_TTL = 30 * 24 * 3600  # 30 days — long enough for 5/20-day rotation math
_DAY_KEY = "%Y-%m-%d"


def _today_snapshot(force: bool = False) -> dict[str, Any] | None:
    """Today's sector performance, stored under a dated key (once per day)."""
    key = f"rotation:snap:{datetime.now(UTC).strftime(_DAY_KEY)}"
    if not force:
        cached = db.get_fresh(key, SNAPSHOT_TTL)
        if cached is not None:
            return cached
    try:
        snap = sector_performance(force=force)
        if snap and snap.get("sectors"):
            db.set(key, snap)
            return snap
    except Exception as exc:  # noqa: BLE001 - archive must never crash the API
        logger.warning("rotation snapshot failed: %s", exc)
    stale = db.get(key)
    return stale or None


def _recent_keys(days: int) -> list[tuple[str, datetime]]:
    """Date keys for the last `days` calendar days (newest first), by cache scan."""
    cutoff = datetime.now(UTC) - timedelta(days=days)
    # kv_cache has no key-prefix scan; iterate backwards from today so the
    # archive stays cheap and bounded.
    out: list[tuple[str, datetime]] = []
    for offset in range(days + 2):
        day = datetime.now(UTC) - timedelta(days=offset)
        if day < cutoff:
            break
        key = f"rotation:snap:{day.strftime(_DAY_KEY)}"
        if db.get(key) is not None:
            out.append((key, day))
    return out


def rotation_history(days: int = 20, force: bool = False) -> dict[str, Any]:
    """Sector rotation readout: current snapshot + N-day rank-change deltas.

    Rank change is the sector's position shift in the strength ranking between
    its earliest archived snapshot and today: negative = gaining relative
    strength, positive = fading. Requires at least 2 archived days; earlier
    days fill in as the daily archive accumulates.
    """
    days = max(5, min(days, 60))
    today = _today_snapshot(force=force)
    if today is None:
        return {"error": "no sector data (upstream unavailable?)", "sectors": []}

    keys = _recent_keys(days)
    # Build per-sector strength series from each snapshot.
    series: dict[str, list[float]] = {}
    dates: list[str] = []
    for key, day in sorted(keys, key=lambda k: k[1]):
        snap = db.get(key)
        if not snap or not snap.get("sectors"):
            continue
        dates.append(day.strftime("%m-%d"))
        for s in snap["sectors"]:
            try:
                series.setdefault(s["sector"], []).append(float(s["avg_change_percent"]))
            except (TypeError, ValueError, KeyError):
                continue

    rows: list[dict[str, Any]] = []
    for s in today.get("sectors", []):
        name = s["sector"]
        hist = series.get(name, [])
        avg5 = sum(hist[-5:]) / len(hist[-5:]) if hist[-5:] else None
        avg20 = sum(hist) / len(hist) if hist else None
        # Rank in today vs earliest snapshot (rank 1 = strongest).
        ranks_today = {s2["sector"]: i + 1 for i, s2 in enumerate(today.get("sectors", []))}
        earliest = db.get(keys[-1][0]) if keys else None
        ranks_early = (
            {s2["sector"]: i + 1 for i, s2 in enumerate(earliest.get("sectors", []))}
            if earliest
            else {}
        )
        rank_now = ranks_today.get(name)
        rank_early = ranks_early.get(name)
        rank_delta = None
        if rank_now is not None and rank_early is not None:
            rank_delta = rank_early - rank_now  # negative = gaining
        rows.append(
            {
                "sector": name,
                "count": s["count"],
                "gainers": s["gainers"],
                "losers": s["losers"],
                "avg_change_percent": s["avg_change_percent"],
                "avg5": round(avg5, 2) if avg5 is not None else None,
                "avg20": round(avg20, 2) if avg20 is not None else None,
                "rank": rank_now,
                "rank_delta": rank_delta,
                "movers": s.get("movers"),
                "accumulation": s.get("accumulation"),
            }
        )
    rows.sort(key=lambda r: r["avg_change_percent"], reverse=True)

    return {
        "as_of": today.get("as_of"),
        "days_archived": len(dates),
        "dates": dates,
        "sectors": rows,
    }
