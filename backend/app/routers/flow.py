"""HTTP seam for the Flow research surface.

Thin by design: validate, offload to a thread, return. The heavy lifting is in
`app.flow`; the router does not compute indicators or fabricate missing data.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import flow
from app.flow import cache as flow_cache

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flow", tags=["flow"])

Source = Literal["auto", "idx", "stockbit", "ohlcv"]
Universe = Literal["watchlist", "movers", "plan", "tickers"]


@router.get("/health")
async def health() -> dict[str, Any]:
    """Which sources are configured, and what this surface is not."""
    return flow.health()


@router.get("/cards")
async def cards(
    universe: Universe = Query("watchlist"),
    tickers: str | None = Query(
        None, description="comma-separated tickers; requires universe=tickers"
    ),
    limit: int = Query(30, ge=1, le=100),
    source: Source = Query("auto"),
    days: int = Query(120, ge=30, le=250),
    refresh: bool = Query(False, description="bypass the SQLite Flow cache"),
) -> dict[str, Any]:
    """The Flow cards for a bounded universe.

    The default source is the free proxy. `stockbit` is accepted for parity with
    the detail endpoint, but cards stay on the free path because broker history
    is one request per ticker-day.
    """
    return await asyncio.to_thread(
        flow.cards,
        universe,
        tickers,
        limit,
        source,
        days,
        refresh,
    )


@router.get("/validate/{ticker}")
async def validate_one(
    ticker: str,
    horizon: int = Query(5, ge=1, le=20),
    days: int = Query(250, ge=60, le=250),
    source: Source = Query("auto"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    """Forward-return report for one name. Not a parity claim."""
    report = await asyncio.to_thread(
        flow.validate, [ticker], horizon, days, source, refresh
    )
    if not report.get("available"):
        raise HTTPException(status_code=404, detail=report.get("error", "no data"))
    return report


class ValidateRequest(BaseModel):
    tickers: list[str] = Field(default_factory=list, min_length=1, max_length=30)
    horizon: int = Field(5, ge=1, le=20)
    days: int = Field(250, ge=60, le=250)
    source: Source = "auto"
    refresh: bool = False


@router.post("/validate")
async def validate(body: ValidateRequest) -> dict[str, Any]:
    """Forward-return report for a bounded list of names."""
    report = await asyncio.to_thread(
        flow.validate,
        body.tickers,
        body.horizon,
        body.days,
        body.source,
        body.refresh,
    )
    if not report.get("available"):
        raise HTTPException(status_code=422, detail=report.get("error", "no data"))
    return report


@router.get("/cache")
async def cache_stats() -> dict[str, Any]:
    """Where the computed Flow payloads are stored and how many exist."""
    return flow_cache.stats()


@router.post("/cache/clear")
async def cache_clear() -> dict[str, Any]:
    """Delete only Flow payloads; market/IDX/Stockbit caches stay warm."""
    return {"cleared": flow_cache.clear()}


@router.get("/{ticker}")
async def detail(
    ticker: str,
    days: int = Query(120, ge=30, le=250),
    source: Source = Query("auto"),
    refresh: bool = Query(False),
) -> dict[str, Any]:
    """One name: price, proxy flow and intensity series."""
    try:
        return await asyncio.to_thread(flow.series, ticker, days, source, refresh)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("flow series %s failed", ticker)
        raise HTTPException(status_code=503, detail=f"flow source unavailable: {exc}") from exc
