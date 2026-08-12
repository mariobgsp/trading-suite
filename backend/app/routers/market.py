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
from app.movers import sector_performance, top_movers

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
