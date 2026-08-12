"""API router: market regime + stockbit bandarmology."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter

from app.regime import regime_history, regime_snapshot, stockbit_available, stockbit_market_detector

router = APIRouter(prefix="/api/regime", tags=["regime"])


@router.get("/snapshot")
async def snapshot(force: bool = False) -> dict[str, Any]:
    """IHSG market regime: BULL / CAUTION / BEAR."""
    return await asyncio.to_thread(regime_snapshot, force)


@router.get("/history")
async def history() -> dict[str, Any]:
    """IHSG (^JKSE) 1y history for the regime chart."""
    return await asyncio.to_thread(regime_history)


@router.get("/stockbit")
async def stockbit_status() -> dict[str, Any]:
    return {"available": stockbit_available()}


@router.get("/stockbit/detector/{ticker}")
async def stockbit_detector(ticker: str) -> dict[str, Any]:
    """Bandarmology market detector (top broker / broker summary)."""
    return await asyncio.to_thread(stockbit_market_detector, ticker)
