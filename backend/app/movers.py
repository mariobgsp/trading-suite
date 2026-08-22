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
from datetime import UTC, datetime, timedelta
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
        except Exception:  # noqa: BLE001
            # scrape must never crash the API
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


def _recent_stock_digests(max_days: int = 7, want: int = 5):
    """Stock digests stored inside recent daily rotation snapshots,
    oldest first. These give the multi-day view that separates genuine
    accumulation from one-off foreign-flow noise."""
    out: list[list[dict[str, Any]]] = []
    for offset in range(1, max_days + 1):
        day = datetime.now(UTC) - timedelta(days=offset)
        snap = db.get(f"rotation:snap:{day.strftime('%Y-%m-%d')}")
        if isinstance(snap, dict) and isinstance(snap.get("stock_digest"), list):
            out.append(snap["stock_digest"])
            if len(out) >= want:
                break
    return out


def sector_performance(force: bool = False) -> dict[str, Any]:
    """Per-sector avg % change, ticker count, and gainer count (rotation view)."""
    rows = fetch_universe(force)
    by_sector: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        sector = r["sector"] or "Unclassified"
        by_sector.setdefault(sector, []).append(r)

    # Smart-money layer: IDX official net foreign flow per stock, joined by
    # ticker. Accumulation = positive net foreign IDR (foreigners buying).
    try:
        from app.idx import foreign_flow_universe

        _flow = foreign_flow_universe(force=force)
        flow_by_ticker = (
            {r["ticker"]: r for r in _flow.get("rows") or []}
            if _flow.get("available", True)
            else {}
        )
    except Exception:  # noqa: BLE001 - flow is a bonus layer, never fatal
        flow_by_ticker = {}

    # Daily per-stock digest archived inside each snapshot — the multi-day
    # memory behind valid-accumulation detection.
    stock_digest = [
        {
            "t": r["symbol"],
            "c": r["price"],
            "v": r.get("volume") or 0,
            "p": r["change_percent"],
        }
        for r in rows
        if r.get("price") is not None
    ]
    stock_history: dict[str, list[dict[str, Any]]] = {}
    for dset in _recent_stock_digests():
        for d in dset:
            stock_history.setdefault(d["t"], []).append(d)

    out = []
    for sector, members in by_sector.items():
        ordered = sorted(members, key=lambda m: m["change_percent"], reverse=True)
        out.append(
            {
                "sector": sector,
                "avg_change_percent": round(
                    sum(m["change_percent"] for m in members) / len(members), 2
                ),
                "count": len(members),
                "gainers": sum(1 for m in members if m["change_percent"] > 0),
                "losers": sum(1 for m in members if m["change_percent"] < 0),
                # Who is actually moving in this sector — top 5 up, top 5 down.
                "movers": {
                    "gainers": [
                        {
                            "ticker": m["symbol"],
                            "name": m.get("name"),
                            "price": m.get("price"),
                            "change_percent": m["change_percent"],
                        }
                        for m in ordered[:5]
                        if m["change_percent"] > 0
                    ],
                    "losers": [
                        {
                            "ticker": m["symbol"],
                            "name": m.get("name"),
                            "price": m.get("price"),
                            "change_percent": m["change_percent"],
                        }
                        for m in reversed(ordered[-5:])
                        if m["change_percent"] < 0
                    ],
                },
            }
        )
        # VALID accumulation: multi-day price+volume behaviour — buying volume
        # dominant while the price has NOT run away yet. Foreign flow is only a
        # bonus badge (it often disagrees with price: rebalancing, local exits).
        valid = []
        for m in members:
            hist = stock_history.get(m["symbol"], [])
            if len(hist) < 2:
                continue  # need >=2 prior days of behaviour, not just today
            points = hist + [{"c": m["price"], "v": m.get("volume") or 0, "p": m["change_percent"]}]
            first_c = points[0]["c"]
            if first_c <= 0:
                continue
            price_move = (points[-1]["c"] - first_c) / first_c * 100
            # "Belum lari" is judged on the PEAK, not the net: a stock that
            # spiked +10% and round-tripped to +4% net HAS run — it no longer
            # offers an accumulation entry.
            peak_move = (max(p["c"] for p in points) - first_c) / first_c * 100
            buy_v = sum(p["v"] for p in points if p["p"] > 0)
            sell_v = sum(p["v"] for p in points if p["p"] < 0)
            tot_v = buy_v + sell_v
            if tot_v <= 0:
                continue
            buy_share = buy_v / tot_v * 100
            if buy_share < 60 or abs(price_move) > 6 or peak_move > 8 or price_move < -3:
                continue  # distribution-ish, already chased, or falling knife
            flow_row = flow_by_ticker.get(m["symbol"])
            # Stage: "watch" = still completely flat (peak <=3%) — the earliest
            # accumulation names, nothing has moved yet. "moving" = already
            # walking up but within the belum-lari bounds.
            stage = "watch" if peak_move <= 3 and abs(price_move) <= 2 else "moving"
            valid.append(
                {
                    "ticker": m["symbol"],
                    "name": m.get("name"),
                    "days": len(points),
                    "buy_share": round(buy_share, 1),
                    "price_move": round(price_move, 2),
                    "peak_move": round(peak_move, 2),
                    "stage": stage,
                    "flow_agrees": bool(flow_row and (flow_row.get("net_foreign_idr") or 0) > 0),
                }
            )
        valid.sort(key=lambda x: x["buy_share"], reverse=True)
        out[-1]["valid_accumulation"] = valid[:6]
    out.sort(key=lambda s: s["avg_change_percent"], reverse=True)
    return {
        "count": len(out),
        "tickers": len(rows),
        "as_of": datetime.now(UTC).isoformat(),
        "stock_digest": stock_digest,
        "sectors": out,
    }
