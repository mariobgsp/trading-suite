"""API router: D-Signal alert scanner."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query

from app.alerts import run_alert_scan

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
async def alerts(
    limit: int = Query(300, ge=10, le=900),
) -> dict[str, Any]:
    """Market-wide D-Signal scan (Premium / Breakout / Above-MA / Spike Pagi)."""
    return await asyncio.to_thread(run_alert_scan, limit)
