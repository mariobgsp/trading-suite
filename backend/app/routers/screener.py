"""API router: screener — single-ticker analysis, universe scan (SSE)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.market import fetch_history
from app.screener import (
    analyze_single,
    get_ticker_universe,
    ma_squeeze_score,
    run_universe_scan,
    vault_ma_score,
    vault_signal,
)

router = APIRouter(prefix="/api/screener", tags=["screener"])


@router.get("/tickers")
async def tickers() -> dict[str, Any]:
    """Canonical IDX ticker universe (900+)."""
    universe = get_ticker_universe()
    return {"count": len(universe), "tickers": universe}


@router.get("/analyze/{ticker}")
async def analyze(ticker: str, force: bool = False) -> dict[str, Any]:
    """Full behavior analysis for one ticker."""
    history = await asyncio.to_thread(
        fetch_history, ticker, period="2y", interval="1d", force=force
    )
    if not history:
        return {"ticker": ticker, "error": "no history"}
    avg_price = _avg_price(history)
    result = await asyncio.to_thread(analyze_single, history, ticker, avg_price)
    result["history_len"] = len(history)
    return result


@router.get("/squeeze/{ticker}")
async def squeeze(ticker: str, force: bool = False) -> dict[str, Any]:
    """MA-squeeze scoring for one ticker."""
    history = await asyncio.to_thread(
        fetch_history, ticker, period="2y", interval="1d", force=force
    )
    if not history:
        return {"ticker": ticker, "error": "no history"}
    return await asyncio.to_thread(ma_squeeze_score, history, ticker, _avg_price(history))


@router.get("/scan")
async def scan(
    mode: str = Query("behavior", description="behavior | squeeze | vault | bull_div"),
    limit: int = Query(30, ge=1, le=900),
    force: bool = Query(False),
) -> dict[str, Any]:
    """One-shot universe scan (blocking; use /scan/stream for progress)."""
    universe = get_ticker_universe()[:limit]
    outcome = await asyncio.to_thread(
        run_universe_scan, universe, None, max_tickers=limit, mode=mode
    )
    return {
        "mode": mode,
        "count": len(outcome["results"]),
        "results": outcome["results"],
        "errors": outcome["errors"],
        "scanned": outcome["scanned"],
    }


@router.get("/vault/{ticker}")
async def vault(ticker: str, force: bool = False) -> dict[str, Any]:
    """NYAHAM vault screener: MA-positioning score + swing signal."""
    history = await asyncio.to_thread(
        fetch_history, ticker, period="2y", interval="1d", force=force
    )
    if not history:
        return {"ticker": ticker, "error": "no history"}
    avg_price = _avg_price(history)
    score = await asyncio.to_thread(vault_ma_score, history, ticker, avg_price)
    signal = await asyncio.to_thread(vault_signal, history, ticker)
    return {"ticker": ticker, "ma_score": score, "signal": signal}


@router.get("/scan/stream")
async def scan_stream(
    mode: str = Query("behavior", description="behavior | squeeze | vault | bull_div"),
    limit: int = Query(30, ge=1, le=900),
    force: bool = Query(False),
) -> StreamingResponse:
    """SSE universe scan with per-ticker progress events.

    Events: `info` (start), `ticker` (per result), `done` (final summary).
    """
    return StreamingResponse(_event_source(mode, limit, force), media_type="text/event-stream")


async def _event_source(mode: str, limit: int, force: bool):
    universe = get_ticker_universe()[:limit]

    yield _emit({"event": "info", "mode": mode, "total": len(universe)})

    outcome = await asyncio.to_thread(
        run_universe_scan, universe, None, max_tickers=limit, mode=mode
    )

    for res in outcome["results"]:
        yield _emit({"event": "ticker", "result": res})

    yield _emit(
        {
            "event": "done",
            "count": len(outcome["results"]),
            "results": outcome["results"],
            "errors": outcome["errors"],
        }
    )


def _emit(obj: dict[str, Any]) -> str:
    """Serialize one SSE data frame."""
    return f"data: {json.dumps(obj, default=str)}\n\n"


def _avg_price(history: list[dict[str, Any]]) -> float | None:
    closes = [h["close"] for h in history[-20:] if h.get("close")]
    if not closes:
        return None
    try:
        return float(sum(closes) / len(closes))
    except (TypeError, ValueError, ZeroDivisionError):
        return None
