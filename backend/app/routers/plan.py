"""HTTP seam for the plan. A thin adapter: validate, offload, return."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from fastapi import APIRouter, Query

from app import plan as planner

router = APIRouter(prefix="/api/plan", tags=["plan"])


@router.get("")
async def tonight(
    exit_method: str | None = Query(None),
    as_of: str | None = Query(None),
) -> dict[str, Any]:
    """The plan for the next session.

    `as_of` replays the screen on an earlier session, which is how the screen
    itself gets checked against dates the study already knows the answer for.
    """
    when = date.fromisoformat(as_of) if as_of else None
    current = await asyncio.to_thread(planner.plan, when, exit_method)
    return current.as_dict()


@router.get("/method")
async def method() -> dict[str, Any]:
    """The rule chain and its measured proof."""
    return await asyncio.to_thread(planner.method_card)


@router.get("/{ticker}")
async def name(ticker: str) -> dict[str, Any]:
    """One name, with every gate's measured value."""
    return await asyncio.to_thread(planner.detail, ticker)


@router.post("/refresh")
async def refresh() -> dict[str, Any]:
    """Drop cached bars and results, so the next read is fresh.

    Used after the study finishes a round: its new rows become the numbers the
    plan quotes without a restart.
    """
    planner.invalidate()
    current = await asyncio.to_thread(planner.plan)
    return {"refreshed": True, "as_of": current.as_of.isoformat(), "open": current.open}