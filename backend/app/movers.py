"""IDX market movers + sector performance — scraped from TradingView's scanner API.

The official IDX digital-statistic page blocks direct fetches (HTTP 403) and
Yahoo's screener API ignores the region param for IDX (returns US symbols), so
the scanner API of TradingView's Indonesia market (`scanner.tradingview.com/
indonesia/scan`) is the scraping source: one POST returns the whole ~885-ticker
universe with close, % change, sector, and market cap. Results are cached in
SQLite (short TTL) so the pilot pages can poll without hammering upstream.
"""

from __future__ import annotations

import math
import threading
from datetime import UTC, datetime
from typing import Any

import requests

from app import db

SCAN_URL = "https://scanner.tradingview.com/indonesia/scan"
COLUMNS = [
    "name",
    "close",
    "change",
    "change_abs",
    "sector",
    "market_cap_basic",
    "volume",
]
CACHE_KEY = "idx:tv:scan"
CACHE_TTL_SECONDS = 300  # 5 min — movers are a "today" readout, not long-lived

_LOCK = threading.Lock()
_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def _to_float(v: Any) -> float | None:
    try:
        f = float(v)
        return f if not math.isnan(f) else None
    except (TypeError, ValueError):
        return None


def _scrape_universe() -> list[dict[str, Any]]:
    """POST the TradingView Indonesia scan; return normalized ticker rows."""
    resp = requests.post(
        SCAN_URL,
        headers={"Content-Type": "application/json", "User-Agent": _UA},
        json={"symbols": {"tickers": [], "query": {"types": []}}, "columns": COLUMNS},
        timeout=20,
    )
    resp.raise_for_status()
    rows: list[dict[str, Any]] = []
    for item in resp.json().get("data", []):
        vals = item.get("d") or []
        if len(vals) < len(COLUMNS):
            continue
        raw = dict(zip(COLUMNS, vals))
        symbol = (item.get("s") or "").split(":")[-1].upper()
        if not symbol:
            continue
        close = _to_float(raw.get("close"))
        change_pct = _to_float(raw.get("change"))
        if close is None or change_pct is None:
            continue
        rows.append(
            {
                "symbol": symbol,
                "name": str(raw.get("name") or symbol),
                "price": round(close, 2),
                "change": _to_float(raw.get("change_abs")),
                "change_percent": round(change_pct, 2),
                "sector": str(raw.get("sector") or ""),
                "market_cap": _to_float(raw.get("market_cap_basic")),
                "volume": _to_float(raw.get("volume")),
            }
        )
    return rows


def fetch_universe(force: bool = False) -> list[dict[str, Any]]:
    """Cached universe snapshot; falls back to stale cache when upstream fails."""
    if not force:
        cached = db.get_fresh(CACHE_KEY, CACHE_TTL_SECONDS)
        if cached is not None:
            return cached
    with _LOCK:
        if not force:
            cached = db.get_fresh(CACHE_KEY, CACHE_TTL_SECONDS)
            if cached is not None:
                return cached
        try:
            rows = _scrape_universe()
        except Exception:  # noqa: BLE001 - scrape must never crash the API
            stale = db.get(CACHE_KEY)
            return stale or []
        if rows:
            db.set(CACHE_KEY, rows)
        return rows


def top_movers(
    side: str = "gainers",
    limit: int = 20,
    force: bool = False,
) -> dict[str, Any]:
    """Top gainers/losers by % change from previous close (IDX convention)."""
    rows = fetch_universe(force)
    side = "gainers" if side != "losers" else "losers"
    ordered = sorted(rows, key=lambda r: r["change_percent"], reverse=True)
    if side == "losers":
        ordered = list(reversed(ordered))
    return {
        "side": side,
        "count": len(rows),
        "as_of": datetime.now(UTC).isoformat(),
        "movers": ordered[: max(1, min(limit, 50))],
    }


def sector_performance(force: bool = False) -> dict[str, Any]:
    """Per-sector avg % change, ticker count, and gainer count (rotation view)."""
    rows = fetch_universe(force)
    by_sector: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        sector = r["sector"] or "Unclassified"
        by_sector.setdefault(sector, []).append(r)

    out = []
    for sector, members in by_sector.items():
        out.append(
            {
                "sector": sector,
                "avg_change_percent": round(
                    sum(m["change_percent"] for m in members) / len(members), 2
                ),
                "count": len(members),
                "gainers": sum(1 for m in members if m["change_percent"] > 0),
                "losers": sum(1 for m in members if m["change_percent"] < 0),
            }
        )
    out.sort(key=lambda s: s["avg_change_percent"], reverse=True)
    return {
        "count": len(out),
        "tickers": len(rows),
        "as_of": datetime.now(UTC).isoformat(),
        "sectors": out,
    }
