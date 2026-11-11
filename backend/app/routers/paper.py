"""HTTP seam for the paper book. A thin adapter: offload, return.

Nothing here places an order. The book is filled by the sync; these endpoints
exist so a screen can read it, a person can backfill a missed week, and a
start-over is one call rather than a deleted file.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app import paper

router = APIRouter(prefix="/api/paper", tags=["paper"])


@router.get("/state")
async def state() -> dict[str, Any]:
    """The whole book: cash, equity, positions, closed trades, the watermark."""
    try:
        return await asyncio.to_thread(paper.snapshot)
    except paper.PaperStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/settle")
async def settle(until: str | None = Query(None)) -> dict[str, Any]:
    """Settle every session since the watermark, optionally only up to `until`.

    Idempotent by construction: a second call with no new bars writes nothing.
    """
    try:
        return await asyncio.to_thread(paper.settle, until)
    except paper.PaperStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (paper.NoBars, paper.NotSettled) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/orders")
async def orders() -> dict[str, Any]:
    """Turn tonight's plan into pending orders without waiting for the timer."""
    try:
        return await asyncio.to_thread(paper.orders_from_plan)
    except paper.PaperStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("")
async def reset() -> dict[str, str]:
    """Forget the book. The bars are untouched."""
    try:
        await asyncio.to_thread(paper.reset)
    except paper.PaperStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"state": "reset"}
