"""API router: one name's invest case — fundamental and technical, separately.

Codes: invalid_ticker.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app import case

router = APIRouter(prefix="/api/case", tags=["case"])


@router.get("/{ticker}")
async def assess_case(ticker: str, refresh: bool = Query(False)) -> dict[str, Any]:
    """Validity for one name, asked twice: the company and the tape.

    A four-letter code that is not one is the only hard failure (422). A real
    code whose sources are down comes back with `available: false` and the
    reason, so the two sections can say why instead of vanishing.
    """
    code = ticker.upper().strip()
    if not case.TICKER_RE.fullmatch(code):
        raise HTTPException(status_code=422, detail="ticker must be four letters")
    return await asyncio.to_thread(case.assess, code, refresh)
