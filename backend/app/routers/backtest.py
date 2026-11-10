"""API router: backtesting."""

from __future__ import annotations

import asyncio
import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app import backtest as backtest_module
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


# ── compare-all: the Backtest tab's engine call ──────────────────────────────

@router.get("/compare")
async def compare(
    ticker: str = Query("^JKSE"),
    period: str = Query("2y"),
    capital: float = Query(10_000_000.0),
    force: bool = Query(False),
) -> dict[str, Any]:
    """Run every strategy on one target and price them against the index.

    The benchmark stays ^JKSE wherever the target itself is something else, so
    the table always answers "did I beat the market or only my own stock?".
    Cached in the computed store: ten simulations plus ten walk-forward pairs on
    one shared history are cheap, but the fetches are not.
    """
    if period not in _ALLOWED_PERIODS:
        raise HTTPException(status_code=400, detail=f"invalid period '{period}'")
    if not math.isfinite(capital) or capital <= 0:
        raise HTTPException(status_code=400, detail="capital must be > 0")
    code = ticker.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="ticker is required")

    from app import computed_cache

    cache_key = f"computed:backtest:v4:{code}:{period}:{int(capital)}"
    if not force:
        cached = computed_cache.read(cache_key, 6 * 3600)
        if cached is not None:
            result, meta = cached
            result["cache"] = meta.as_dict()
            return result

    # TSMOM needs a 12-month lookback before the window; everything else runs
    # on exactly the requested span, per the router's own TSMOM contract above.
    history = await asyncio.to_thread(
        fetch_history, code, _TSMOM_FETCH.get(period, period), "1d", force
    )
    if not history:
        raise HTTPException(status_code=404, detail=f"no history for {code}")
    start_idx = None
    fetched_days = _PERIOD_DAYS.get(period)
    if fetched_days is not None:
        start_idx = max(len(history) - fetched_days, 0) or None

    bench_history = None
    if code != backtest_module.BENCHMARK_TICKER:
        bench_history = await asyncio.to_thread(
            fetch_history, backtest_module.BENCHMARK_TICKER, _TSMOM_FETCH.get(period, period), "1d", force
        )

    result = await asyncio.to_thread(
        backtest_module.compare_all, history, capital, bench_history, start_idx
    )
    result.update(
        {
            "ticker": code,
            "period": period,
            "bars": len(history) - (start_idx or 0),
            "index": backtest_module.BENCHMARK_TICKER if bench_history else None,
        }
    )
    computed_cache.write(cache_key, result)
    return result


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
