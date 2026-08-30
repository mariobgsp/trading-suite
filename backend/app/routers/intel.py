"""API router: free market-intelligence feeds (foreign flow, broker radar, announcements).

All feeds are sourced from IDX directly (app.idx) plus the TradingView
scanner; no Stockbit dependency. When IDX is unreachable the endpoints
degrade to `{"available": false, "error": ...}` so the pilot UI can show
a clear state instead of an error page.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, Query

from app import idx, intel, msci, ownership, rotation
import app.stockbit as stockbit  # type: ignore[import-untyped]
from app.konglo import konglo_overview

router = APIRouter(prefix="/api/intel", tags=["intel"])


@router.get("/status")
async def status() -> dict[str, Any]:
    """Whether the IDX-backed feeds are configured and reachable."""
    return {
        "stockbit_available": intel.stockbit_available(),
        "idx_available": True,
        "sources": ["idx", "tradingview", "stockbit"],
        "stockbit": await asyncio.to_thread(stockbit.stockbit_status),
    }


@router.post("/stockbit/login")
async def stockbit_login(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Trigger Stockbit login using .env username/password or provided token.

    Body may contain {username,email,password} or {token,jwt}. If empty, uses
    STOCKBIT_USERNAME/PASSWORD from .env. Saves JWT to persistent cache.
    """
    token = (body.get("token") or body.get("jwt") or body.get("STOCKBIT_JWT_TOKEN") or "").strip() if isinstance(body, dict) else ""
    if token:
        tok = token.replace("Bearer", "").strip().strip('"').strip("'")
        if tok.count(".") != 2:
            return {"ok": False, "error": "invalid JWT format"}
        try:
            await asyncio.to_thread(stockbit.save_jwt, tok)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)[:300]}
        return {"ok": True, "status": await asyncio.to_thread(stockbit.stockbit_status)}
    # try username/password from body or env
    username = (body.get("username") or body.get("email") or body.get("STOCKBIT_USERNAME") or "").strip() if isinstance(body, dict) else ""
    password = (body.get("password") or body.get("STOCKBIT_PASSWORD") or "").strip() if isinstance(body, dict) else ""
    if not username or not password:
        # fallback to env via stockbit module (already handles .env)
        import os
        username = (os.getenv("STOCKBIT_USERNAME") or os.getenv("STOCKBIT_EMAIL") or "").strip()
        password = (os.getenv("STOCKBIT_PASSWORD") or "").strip()
    if not username or not password:
        return {"ok": False, "error": "no credentials — set STOCKBIT_USERNAME/PASSWORD in .env or POST {username,password} or {token}"}
    try:
        jwt = await asyncio.to_thread(stockbit.login, username, password)
        return {"ok": True, "jwt_len": len(jwt) if jwt else 0, "status": await asyncio.to_thread(stockbit.stockbit_status)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)[:500], "status": await asyncio.to_thread(stockbit.stockbit_status)}


@router.get("/stockbit/status")
async def stockbit_status_route() -> dict[str, Any]:
    """Stockbit JWT status (expiry, hours left)."""
    return await asyncio.to_thread(stockbit.stockbit_status)


@router.get("/stockbit/broker/{ticker}")
async def stockbit_broker(
    ticker: str,
    date: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Per-ticker broker buy/sell attribution from Stockbit marketdetector.

    Requires STOCKBIT_JWT_TOKEN. Cached 12h. Falls back to IDX foreign flow
    when JWT missing — never 500s.
    """
    return await asyncio.to_thread(stockbit.broker_summary, ticker.upper(), date, force)


@router.get("/stockbit/institutional/{ticker}")
async def stockbit_institutional(
    ticker: str,
    date: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Institutional flow: Stockbit broker detail + IDX foreign flow combined."""
    sb = await asyncio.to_thread(stockbit.broker_summary, ticker.upper(), date, force)
    ff = await asyncio.to_thread(intel.broker_analysis, ticker.upper(), force)
    return {"ticker": ticker.upper(), "stockbit": sb, "idx_foreign": ff}


@router.get("/stockbit/broker/{ticker}/history")
async def stockbit_broker_history(
    ticker: str,
    days: int = Query(20, ge=5, le=90),
    force: bool = False,
) -> dict[str, Any]:
    """Per-ticker broker time-series (1W-3M) + price overlay for charting."""
    return await asyncio.to_thread(stockbit.broker_history, ticker.upper(), days, force)


@router.get("/stockbit/accumulation")
async def stockbit_accumulation(
    days: int = Query(20, ge=5, le=90),
    limit: int = Query(20, ge=5, le=50),
    force: bool = False,  # noqa: ARG001 - kept for parity, cache TTL handles it
) -> dict[str, Any]:
    """Ranked accumulation vs distribution over window. Silent = price <=3% + top-quartile buying."""
    return await asyncio.to_thread(stockbit.accumulation_scan, days, limit, None)


@router.get("/stockbit/orderbook/{ticker}")
async def stockbit_orderbook(ticker: str, force: bool = False) -> dict[str, Any]:
    """Live orderbook snapshot (bid/offer imbalance). Cached 60s."""
    return await asyncio.to_thread(stockbit.orderbook_snapshot, ticker.upper(), force)


@router.get("/stockbit/lpm/{ticker}")
async def stockbit_lpm(ticker: str, days: int = Query(60, ge=20, le=90), force: bool = False) -> dict[str, Any]:
    """Enhanced LPM + Intensity blending broker summary + orderbook + CMF."""
    return await asyncio.to_thread(stockbit.stockbit_lpm_intensity, ticker.upper(), days, force)


@router.get("/stockbit/scanner/stealth")
async def stockbit_stealth_scanner(
    days: int = Query(20, ge=10, le=60),
    price_threshold: float = Query(3.0, ge=0.5, le=10.0),
    lpm_min_rise: float = Query(1.0, ge=0.0, le=10.0),
    intensity_min_rise: float = Query(5.0, ge=0.0, le=50.0),
    limit: int = Query(30, ge=5, le=50),
    force: bool = False,
) -> dict[str, Any]:
    """Stealth scanner: rising LPM + rising Intensity while price flat."""
    return await asyncio.to_thread(
        stockbit.lpm_stealth_scan, days, price_threshold, lpm_min_rise, intensity_min_rise, limit, force
    )


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

@router.get("/owner/holdings")
async def owner_holdings_route(name: str) -> dict[str, Any]:
    """Cross-issuer search: every archived company where this holder appears."""
    return await asyncio.to_thread(ownership.owner_holdings, name)


@router.get("/konglo")
async def konglo() -> dict[str, Any]:
    """Broker-flow aggregated per konglomerat / taipan group."""
    return await asyncio.to_thread(konglo_overview)


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


@router.get("/suspended")
async def suspended(force: bool = False) -> dict[str, Any]:
    """Suspended / special-monitoring board stocks (IDX Remarks X-marker)."""
    return await asyncio.to_thread(idx.suspended_stocks, force)
