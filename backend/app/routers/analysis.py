"""API router: entry plans — AI narration dismantled.

Rule-based entry plan remains; the AI narration layer has been removed
so this endpoint returns instantly from cache/deterministic logic only.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query

from app.backtest import pattern_backtests
from app.entry import entry_plan

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/entry/{ticker}")
async def entry(ticker: str, force: bool = Query(False)) -> dict[str, Any]:
    """Rule-based entry plan (AI narration disabled — deterministic only)."""
    return await asyncio.to_thread(entry_plan, ticker, force)


@router.get("/backtest/{ticker}")
async def pattern_backtest(ticker: str, force: bool = Query(False)) -> dict[str, Any]:
    """Backtest pullback / breakout / mild-mover patterns on this stock."""
    return await asyncio.to_thread(pattern_backtests, ticker.upper(), force)
