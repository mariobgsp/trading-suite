"""DISMANTLED — AI summaries removed.

User request: dismantle AI section. This router now returns 410 Gone
instantly and performs NO live-data gathering and NO model calls, so it
cannot contribute to long load times.

Kept as a stub so `from app.routers import summary` does not break
and so existing frontend calls get a clear, fast error instead of
hanging. Remove the router import from `app.main` to fully delete
the route.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/summary", tags=["ai-summary"])


@router.get("/{page}")
async def summary(page: str, ticker: str | None = None):  # noqa: ARG001
    raise HTTPException(status_code=410, detail="AI summaries dismantled — endpoint disabled")
