"""API router: bandarmology validator."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query

from app.market import fetch_history
from app.validator import BandarmologyAnalyzer

router = APIRouter(prefix="/api/validator", tags=["validator"])


@router.get("/{ticker}")
async def validate(
    ticker: str,
    days: int = Query(30, ge=5, le=120),
    force: bool = Query(False),
) -> dict[str, Any]:
    """Full bandarmology analysis: phase, intent radar, flow metrics."""
    history = await asyncio.to_thread(
        fetch_history, ticker, period="1y", interval="1d", force=force
    )
    if not history:
        return {"ticker": ticker, "error": "no history"}
    analyzer = BandarmologyAnalyzer()
    result = await asyncio.to_thread(analyzer.analyze, history, days)
    result["ticker"] = ticker
    return result
