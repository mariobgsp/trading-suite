"""API router: backtesting."""

from __future__ import annotations

import asyncio
import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.backtest import STRATEGIES, run_backtest, walk_forward
from app.market import fetch_history

router = APIRouter(prefix="/api/backtest", tags=["backtest"])

_ALLOWED_PERIODS = {"3mo", "6mo", "1y", "2y", "5y", "10y", "max"}
_ALLOWED_INTERVALS = {"1d", "1wk", "1mo"}

# Approx trading days per period (used to trim the tsmom simulation window).
_PERIOD_DAYS = {"3mo": 63, "6mo": 126, "1y": 252, "2y": 504, "5y": 1260, "10y": 2520}
# TSMOM's 12-month lookback needs years of warmup, so fetch a longer window
# than requested and only simulate the tail.
_TSMOM_FETCH = {"3mo": "5y", "6mo": "5y", "1y": "5y", "2y": "5y", "5y": "10y", "10y": "max", "max": "max"}


@router.get("/strategies")
async def strategies() -> dict[str, Any]:
    return {"strategies": list(STRATEGIES)}


@router.get("/{ticker}")
async def backtest(
    ticker: str,
    strategy: str = Query("momentum"),
    period: str = Query("2y"),
    interval: str = Query("1d"),
    initial_capital: float = Query(10_000_000.0),
    force: bool = Query(False),
) -> dict[str, Any]:
    """Run a backtest for a ticker and return trades + equity curve + stats."""
    # Validate inputs up-front so bad params return 400, not a 500.
    if strategy not in STRATEGIES:
        raise HTTPException(status_code=400, detail=f"unknown strategy '{strategy}'")
    if period not in _ALLOWED_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period '{period}'")
    if interval not in _ALLOWED_INTERVALS:
        raise HTTPException(status_code=400, detail=f"invalid interval '{interval}'")
    if not math.isfinite(initial_capital) or initial_capital <= 0:
        raise HTTPException(status_code=400, detail="initial_capital must be > 0")

    if strategy == "tsmom":
        history = await asyncio.to_thread(
            fetch_history, ticker, _TSMOM_FETCH[period], interval, force
        )
    else:
        history = await asyncio.to_thread(fetch_history, ticker, period, interval, force)
    if not history:
        raise HTTPException(status_code=404, detail=f"no history for {ticker}")
    start_idx: int | None = None
    if strategy == "tsmom" and period in _PERIOD_DAYS:
        start_idx = max(len(history) - _PERIOD_DAYS[period], 0) or None
    result = await asyncio.to_thread(
        run_backtest, history, strategy, initial_capital, start_idx=start_idx
    )
    result["symbol"] = ticker
    result["period"] = period
    result["interval"] = interval
    # Out-of-sample guard: first half vs second half of the fetched series.
    validation = await asyncio.to_thread(walk_forward, history, strategy, initial_capital)
    result["validation"] = validation
    return result
