"""API router: sentiment news radar (Google News + IDX feeds)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter

from app.sentiment import fetch_idx_news, fetch_sentiment_news

router = APIRouter(prefix="/api/sentiment", tags=["sentiment"])


@router.get("/news")
async def news(force: bool = False) -> dict[str, Any]:
    """Google News RSS sentiment feed (whale/financials/action/commodity)."""
    return await asyncio.to_thread(fetch_sentiment_news, force)


@router.get("/idx")
async def idx(force: bool = False) -> dict[str, Any]:
    """IDX official + local finance feeds."""
    return await asyncio.to_thread(fetch_idx_news, force)
