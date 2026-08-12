"""API router: portfolio (FIFO journal), watchlist, pending orders."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter

from app import portfolio
from app.market import fetch_quotes

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("/state")
async def state() -> dict[str, Any]:
    """Full FIFO portfolio state (positions, cash, P&L)."""
    return await asyncio.to_thread(portfolio.portfolio_state)


@router.get("/watchlist")
async def watchlist() -> dict[str, Any]:
    """Watchlist tickers + live quotes."""
    tickers = portfolio.get_watchlist()
    quotes = await asyncio.to_thread(fetch_quotes, tickers)
    return {"tickers": tickers, "quotes": quotes}


@router.post("/watchlist")
async def set_watchlist(body: dict[str, Any]) -> dict[str, Any]:
    tickers = body.get("tickers", [])
    if not isinstance(tickers, list):
        return {"error": "tickers must be a list"}
    # Validate symbols: 1-6 alphanumerics, optional .JK suffix, dedupe, cap size
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in tickers:
        t = str(raw).strip().upper()
        if not t:
            continue
        if not t.replace(".JK", "").isalnum() or len(t.replace(".JK", "")) > 6:
            return {"error": f"invalid ticker '{raw}'"}
        if t not in seen:
            seen.add(t)
            cleaned.append(t)
    if len(cleaned) > 200:
        return {"error": "watchlist capped at 200 tickers"}
    saved = portfolio.update_watchlist(cleaned)
    return {"tickers": saved}


@router.get("/journal")
async def journal() -> dict[str, Any]:
    return {"entries": portfolio.get_journal(), "count": len(portfolio.get_journal())}


@router.post("/journal")
async def add_entry(body: dict[str, Any]) -> dict[str, Any]:
    """Add a trade to the journal.

    Required: action (BUY/SELL/DEPOSIT/WITHDRAW), ticker, qty, price, date.
    Optional: currency (IDR default), sl_price, tp_price, trailing_stop_pct.
    """
    required = ("action", "ticker", "qty", "price", "date")
    missing = [k for k in required if not body.get(k)]
    if missing:
        return {"error": f"missing fields: {', '.join(missing)}"}
    try:
        entry = portfolio.add_journal_entry(body)
    except ValueError as exc:
        # phantom SELL / invalid entry -> 400, not 500
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "entry": entry}


@router.get("/pending-orders")
async def pending_orders() -> dict[str, Any]:
    return {"orders": portfolio.get_pending_orders()}


@router.post("/pending-orders")
async def add_pending_order(body: dict[str, Any]) -> dict[str, Any]:
    required = ("ticker", "type", "trigger_price")
    missing = [k for k in required if not body.get(k)]
    if missing:
        return {"error": f"missing fields: {', '.join(missing)}"}
    order = portfolio.add_pending_order(body)
    return {"ok": True, "order": order}
