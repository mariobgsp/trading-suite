"""HTTP seam for the plan. A thin adapter: validate, offload, return."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

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


class SizeRequest(BaseModel):
    """A ticket re-size: what the calculator needs and nothing more."""

    price: float = Field(gt=0, description="the price to size at, in IDR")
    median_turnover_60: float | None = Field(
        default=None, description="median 60-session turnover in IDR, if known"
    )
    risk_budget_idr: float | None = Field(
        default=None, gt=0, description="loss the user will book on this name"
    )
    exit_method: str | None = Field(
        default=None, description="a measured exit name; the shipped one by default"
    )


@router.post("/size")
async def size(body: SizeRequest) -> dict[str, Any]:
    """Size one order, price its friction, and show the AR limits around it.

    The ticket re-sizes as the price or the budget changes, and a universe pass
    for arithmetic would be absurd. Same code path as the plan, so the two cannot
    disagree.
    """
    return await asyncio.to_thread(
        planner.size_ticket,
        body.price,
        body.median_turnover_60,
        body.risk_budget_idr,
        body.exit_method,
    )


@router.post("/refresh")
async def refresh(wait: bool = Query(False)) -> dict[str, Any]:
    """Pull the latest daily bars and re-run the analysis on them.

    Returns a job immediately; poll `GET /api/plan/refresh/{id}` for progress and
    the finished plan. `wait=true` runs it inline for a caller that would rather
    block (a script, a cron job).

    Two rules live in that job, and both exist because a refresh is the only way
    this screen can be wrong in a *new* way: today's bar is refused until the
    session is over, and every failed name is counted so that a partial pull
    cannot quietly move breadth.
    """
    return await asyncio.to_thread(planner.start_refresh, wait)


@router.get("/refresh/{job_id}")
async def refresh_report(job_id: str) -> dict[str, Any]:
    """One refresh job: progress while it runs, the plan when it lands."""
    found = planner.refresh_status(job_id)
    if found is None:
        raise HTTPException(status_code=404, detail="no such refresh job")
    return found


@router.post("/refresh/{job_id}/cancel")
async def refresh_cancel(job_id: str) -> dict[str, Any]:
    """Ask a running refresh to stop between names."""
    return {"cancelled": planner.cancel_refresh(job_id)}