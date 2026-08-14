"""API router: free market-intelligence feeds (foreign flow, broker radar, announcements).

All feeds are sourced from IDX directly (app.idx) plus the TradingView
scanner; no Stockbit dependency. When IDX is unreachable the endpoints
degrade to `{"available": false, "error": ...}` so the pilot UI can show
a clear state instead of an error page.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query

from app import idx, intel, msci, ownership, rotation

router = APIRouter(prefix="/api/intel", tags=["intel"])


@router.get("/status")
async def status() -> dict[str, Any]:
    """Whether the IDX-backed feeds are configured and reachable."""
    return {
        "stockbit_available": intel.stockbit_available(),
        "idx_available": True,
        "sources": ["idx", "tradingview"],
    }


@router.get("/foreign/universe")
async def foreign_universe(force: bool = False) -> dict[str, Any]:
    """Net foreign flow across the whole IDX universe, ranked (one IDX call)."""
    return await asyncio.to_thread(intel.foreign_flow_universe, force)


@router.get("/foreign/{ticker}")
async def foreign(ticker: str, force: bool = False) -> dict[str, Any]:
    """Net foreign flow for one ticker (IDX daily summary)."""
    return await asyncio.to_thread(intel.foreign_flow, ticker.upper(), force)


@router.get("/broker/radar")
async def broker_radar(force: bool = False) -> dict[str, Any]:
    """Exchange-level broker volume/value ranking (whole IDX, one call)."""
    return await asyncio.to_thread(intel.broker_radar, force)


@router.get("/broker/{ticker}")
async def broker(ticker: str, force: bool = False) -> dict[str, Any]:
    """Per-ticker flow context: foreign flow + price (IDX has no per-stock
    broker attribution; this is the honest free equivalent)."""
    return await asyncio.to_thread(intel.broker_analysis, ticker.upper(), force)


@router.get("/announcements")
async def announcements(
    limit: int = Query(30, ge=1, le=100),
    force: bool = False,
) -> dict[str, Any]:
    """Official IDX announcements with attachment PDF links."""
    return await asyncio.to_thread(intel.announcements, limit, force)


@router.get("/rotation")
async def sector_rotation(
    days: int = Query(20, ge=5, le=60),
    force: bool = False,
) -> dict[str, Any]:
    """Sector rotation history: current snapshot + N-day rank-change deltas."""
    return await asyncio.to_thread(rotation.rotation_history, days, force)


@router.get("/msci")
async def msci_watch(force: bool = False) -> dict[str, Any]:
    """MSCI Indonesia constituents enriched with live TradingView data."""
    return await asyncio.to_thread(msci.msci_watch, force)


@router.get("/ownership/{ticker}")
async def ownership_structure_route(ticker: str, force: bool = False) -> dict[str, Any]:
    """Shareholder / board structure from IDX company profiles."""
    return await asyncio.to_thread(ownership.ownership_structure, ticker.upper(), force)


@router.get("/ownership/{ticker}/history")
async def ownership_history_route(ticker: str) -> dict[str, Any]:
    """Ownership-change history: snapshots + latest period-over-period diff."""
    return await asyncio.to_thread(ownership.ownership_history, ticker.upper())


@router.get("/heatmap")
async def heatmap(force: bool = False) -> dict[str, Any]:
    """Whole-IDX-universe treemap data: market cap (size) + % change (color)."""
    return await asyncio.to_thread(idx.market_heatmap, force)


@router.get("/movers")
async def movers(
    range_days: int = Query(1, ge=1, le=5),
    limit: int = Query(50, ge=5, le=100),
    force: bool = False,
) -> dict[str, Any]:
    """Leaders/laggards ranked by JCI point contribution (1D or 5D)."""
    return await asyncio.to_thread(idx.movers, range_days, limit, force)
