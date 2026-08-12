"""API router: cross-analysis — entry plans fusing technicals, validator,
regime, and beta, with an AI narration."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query

from app.entry import entry_plan  # pyright: ignore[reportMissingImports]

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/entry/{ticker}")
async def entry(ticker: str, force: bool = Query(False)) -> dict[str, Any]:
    """Rule-based entry plan (score/zone/stop/targets/triggers) + AI narration."""
    return await asyncio.to_thread(entry_plan, ticker, force)
