"""Canonical fundamentals snapshot — one fixed object, TradingView field list.

Adopts TV's fundamentals vocabulary (PE, PBV, ROE, DER, market cap, dividend
yield) so intel/sentiment/case stop growing one-off scrapers. All fields are
None-tolerant: missing IDX coverage reads as absent, never invented.
"""

from __future__ import annotations

import math
from typing import Any, TypedDict


class FundamentalsSnapshot(TypedDict, total=False):
    ticker: str
    pe: float | None
    pbv: float | None
    roe_pct: float | None
    der: float | None
    market_cap_idr: float | None
    dividend_yield_pct: float | None
    sector: str | None
    source: str


def _finfo(info: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        try:
            val = info.get(key)
            if val is None:
                continue
            out = float(val)  # type: ignore[arg-type]
        except (AttributeError, TypeError, ValueError):
            continue
        if math.isfinite(out):
            return out
    return None


def from_yfinance_info(ticker: str, info: dict[str, Any]) -> FundamentalsSnapshot:
    """Build a snapshot from a yfinance Ticker.info dict (best-effort)."""
    sector = info.get("sector") or info.get("industry")
    return {
        "ticker": ticker,
        "pe": _finfo(info, "trailingPE", "forwardPE"),
        "pbv": _finfo(info, "priceToBook"),
        "roe_pct": (_finfo(info, "returnOnEquity") or 0.0) * 100.0
        if _finfo(info, "returnOnEquity") is not None
        else None,
        "der": _finfo(info, "debtToEquity"),
        "market_cap_idr": _finfo(info, "marketCap"),
        "dividend_yield_pct": (_finfo(info, "dividendYield") or 0.0) * 100.0
        if _finfo(info, "dividendYield") is not None
        else None,
        "sector": str(sector) if sector else None,
        "source": "yfinance",
    }


def empty(ticker: str, source: str = "unknown") -> FundamentalsSnapshot:
    """Blank snapshot — keeps callers total without inventing numbers."""
    return {
        "ticker": ticker,
        "pe": None,
        "pbv": None,
        "roe_pct": None,
        "der": None,
        "market_cap_idr": None,
        "dividend_yield_pct": None,
        "sector": None,
        "source": source,
    }
