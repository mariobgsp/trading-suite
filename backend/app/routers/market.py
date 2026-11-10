"""API router: market data, quotes, indices, forex, indicators."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app import db
from app.beta import beta_correlation
from app.indicators import compute_indicators, momentum_signal
from app.market import (
    fetch_forex,
    fetch_history,
    fetch_indices,
    fetch_quote,
    fetch_quotes,
)
from app.movers import fetch_universe, sector_performance, top_movers

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/indices")
async def indices() -> list[dict[str, Any]]:
    """IHSG index quotes (^JKSE, LQ45, IDX30, ...)."""
    return await asyncio.to_thread(fetch_indices)


@router.get("/quote/{ticker}")
async def quote(ticker: str, force: bool = False) -> dict[str, Any]:
    """Single quote for a ticker."""
    result = await asyncio.to_thread(fetch_quote, ticker, force)
    return result or {"symbol": ticker, "error": "quote unavailable (upstream down?)"}


@router.get("/quotes")
async def quotes(
    tickers: str = Query(..., description="comma-separated tickers"),
    force: bool = False,
) -> dict[str, Any]:
    """Multiple quotes, e.g. ?tickers=BBCA,BBRI,BMRI."""
    ticker_list = [t.strip() for t in tickers.split(",") if t.strip()]
    results = await asyncio.to_thread(fetch_quotes, ticker_list, force)
    return {"quotes": results, "count": len(results)}


@router.get("/history/{ticker}")
async def history(
    ticker: str,
    period: str = "1y",
    interval: str = "1d",
    force: bool = False,
) -> dict[str, Any]:
    """OHLCV history + indicator bundle for charting."""
    records = await asyncio.to_thread(fetch_history, ticker, period, interval, force)
    indicators = compute_indicators(records)
    return {
        "symbol": ticker,
        "period": period,
        "interval": interval,
        "history": records,
        "indicators": indicators["columns"],
        "latest_indicators": indicators["latest"],
        "momentum": momentum_signal(indicators["latest"]),
    }


@router.get("/beta/{ticker}")
async def beta(ticker: str, force: bool = False) -> dict[str, Any]:
    """Beta / correlation / excess return vs ^JKSE (3M/6M/1Y) — NYAHAM vault."""
    return await asyncio.to_thread(beta_correlation, ticker, force)


@router.get("/movers")
async def movers(
    side: str = "gainers",
    limit: int = 20,
    force: bool = False,
) -> dict[str, Any]:
    """Top IDX gainers/losers by % change — scraped from TradingView scanner API."""
    if side not in ("gainers", "losers"):
        raise HTTPException(status_code=400, detail=f"side must be gainers|losers, got {side!r}")
    return await asyncio.to_thread(top_movers, side, max(1, min(limit, 50)), force)


@router.get("/sectors")
async def sectors(force: bool = False) -> dict[str, Any]:
    """Sector rotation readout: avg % change + gainer/loser counts per sector."""
    return await asyncio.to_thread(sector_performance, force)


@router.get("/forex")
async def forex(force: bool = False) -> dict[str, Any]:
    """USD/IDR rate."""
    rate = await asyncio.to_thread(fetch_forex, force)
    return {"pair": "USDIDR=X", "rate": rate}


@router.get("/cache/stats")
async def cache_stats() -> dict[str, Any]:
    return db.stats()


@router.get("/profile/{ticker}")
async def profile(ticker: str, force: bool = False) -> dict[str, Any]:
    """One name's identity card: identity labels from the scan, live quote on top.

    The Deep Dive tab opens on this. Every field is nullable on purpose: a typo
    or a dead upstream must render the page's own missing-name state, never a 500.
    """
    return await asyncio.to_thread(_profile, ticker.strip().upper(), force)


def _profile(code: str, force: bool) -> dict[str, Any]:
    scan: dict[str, dict[str, Any]] = {}
    try:
        scan = {row["symbol"]: row for row in fetch_universe(force)}
    except Exception:  # noqa: BLE001 - the scan is one source among two
        pass
    row = scan.get(code) or {}

    quote: dict[str, Any] = {}
    try:
        fetched = fetch_quote(code, force) or {}
        if not fetched.get("error"):
            quote = fetched
    except Exception:  # noqa: BLE001 - quote failure degrades to scan fields
        pass

    price = quote.get("price") or row.get("price")
    change_percent = quote.get("change_percent")
    if change_percent is None and row.get("change_percent") is not None:
        change_percent = row["change_percent"]
    return {
        "ticker": code,
        "found": bool(row or quote.get("price")),
        "symbol_yf": quote.get("symbol") if quote else None,
        "name": row.get("name") or quote.get("long_name") or quote.get("short_name") or None,
        "sector": row.get("sector") or None,
        "industry": row.get("industry") or None,
        "market_cap": row.get("market_cap"),
        "volume": _pick_number(quote.get("volume"), row.get("volume")),
        "price": price,
        "change": quote.get("change") or row.get("change"),
        "change_percent": change_percent,
        "prev_close": quote.get("previous_close"),
        "quote_live": bool(quote.get("price")),
    }


def _pick_number(first: Any, second: Any) -> float | None:
    try:
        value = float(first)
        if value == value and value != 0:
            return value
    except (TypeError, ValueError):
        pass
    try:
        value = float(second)
        return value if value == value else None
    except (TypeError, ValueError):
        return None


@router.get("/sector-members")
async def sector_members(
    sector: str = Query(...),
    field: str = Query("sector"),
    limit: int = Query(40),
    force: bool = Query(False),
) -> dict[str, Any]:
    """One group's constituents from the cached scan, ranked by the day's move.

    The Markets tab expands a sector (or industry) row with this. `field`
    selects which grouping column to filter on; `limit` keeps the payload
    bounded — the panel says so instead of silently truncating.
    """
    field_key = "industry" if field == "industry" else "sector"
    return await asyncio.to_thread(_sector_members, sector.strip(), field_key, max(1, min(limit, 80)), force)


def _sector_members(sector_name: str, field: str, limit: int, force: bool) -> dict[str, Any]:
    scan: list[dict[str, Any]] = []
    try:
        scan = fetch_universe(force)
    except Exception:  # noqa: BLE001 - absence of the scan is a designed state
        scan = []
    wanted = sector_name.strip().casefold()
    members = [
        row for row in scan
        if (row.get(field) or "").strip().casefold() == wanted
        and row.get("price") is not None
        and row.get("change_percent") is not None
    ]
    members.sort(key=lambda r: r["change_percent"], reverse=True)
    up = sum(1 for r in members if r["change_percent"] > 0)
    down = sum(1 for r in members if r["change_percent"] < 0)
    avg = sum(r["change_percent"] for r in members) / len(members) if members else None
    return {
        "sector": sector_name,
        "field": field,
        "available": bool(members),
        "reason": None if members else "no members of this group in the current scan",
        "count": len(members),
        "shown": min(len(members), limit),
        "avg_change_pct": round(avg, 2) if avg is not None else None,
        "up": up,
        "down": down,
        "flat": len(members) - up - down,
        "members": [
            {
                "ticker": row["symbol"],
                "name": row.get("name") or row["symbol"],
                "price": row.get("price"),
                "change_percent": row.get("change_percent"),
                "market_cap": row.get("market_cap"),
                "value": (row.get("price") or 0.0) * (row.get("volume") or 0.0) or None,
            }
            for row in members[:limit]
        ],
    }
