"""HTTP seam for the scanner: every tradable name, with its measured filters."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from fastapi import APIRouter, Query

from app import plan as planner

router = APIRouter(prefix="/api/scanner", tags=["scanner"])


@router.get("")
async def scan(as_of: str | None = Query(None)) -> dict[str, Any]:
    """One session's scanner payload.

    The scanner is the front page, so it uses the same persisted-universe path
    as the plan: one full pass, cached by data stamp and session. `as_of` exists
    for replaying a session the study already knows the answer for.
    """
    when = date.fromisoformat(as_of) if as_of else None
    return await asyncio.to_thread(planner.scan_payload, when)
