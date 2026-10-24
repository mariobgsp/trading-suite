"""Flow research surface: a transparent LPM-style proxy, never the vendor model.

Public seam:

    cards(...)       bounded universe, card readouts
    series(...)      one name, chart series
    validate(...)    forward-return accuracy report
    health()         source availability

Nothing here is imported by `app.plan`. The nightly plan's evidence and verdict
must remain independent of this research panel.
"""

from __future__ import annotations

import os
from typing import Any

from app.flow import cache as _cache
from app.flow import cards as _cards
from app.flow import series as _series
from app.flow import validate as _validate


def cards(
    universe: str = "watchlist",
    tickers: list[str] | str | None = None,
    limit: int = 30,
    source: str = "auto",
    days: int = 120,
    refresh: bool = False,
) -> dict[str, Any]:
    """Screen a bounded universe for the Flow cards."""
    return _cards.cards(
        universe=universe,
        tickers=tickers,
        limit=limit,
        source=source,
        days=days,
        refresh=refresh,
    )


def series(
    ticker: str,
    days: int = 120,
    source: str = "auto",
    refresh: bool = False,
) -> dict[str, Any]:
    """One name's price and proxy-flow series."""
    return _series.series(ticker, days=days, source=source, refresh=refresh)


def validate(
    tickers: list[str] | str,
    horizon: int = 5,
    days: int = 250,
    source: str = "auto",
    refresh: bool = False,
) -> dict[str, Any]:
    """Measure the proxy's own forward-return record.

    This is not a parity claim. Vendor parity needs a licensed sample via
    `FLOW_VENDOR_CSV`.
    """
    return _validate.validate(
        tickers=tickers,
        horizon=horizon,
        days=days,
        source=source,
        refresh=refresh,
    )


def health() -> dict[str, Any]:
    """Report which optional sources are configured without fetching them."""
    stockbit: dict[str, Any] = {"available": False, "reason": "not checked"}
    try:
        from app import stockbit as sb

        stockbit = sb.stockbit_status()
    except Exception as exc:  # noqa: BLE001
        stockbit = {"available": False, "reason": str(exc)[:200]}
    vendor = os.getenv("FLOW_VENDOR_CSV", "").strip()
    return {
        "status": "ok",
        "surface": "flow",
        "proxy": True,
        "vendor_model": False,
        "plan_integration": False,
        "sources": {
            "bars": "yfinance",
            "foreign": "IDX daily summary (current day only)",
            "broker": stockbit,
            "vendor_csv": bool(vendor),
        },
        "cache": _cache.stats(),
        "note": (
            "LPM-style proxy only. It is not Bandarmetrics LPM and is not used "
            "by tonight's plan."
        ),
    }


__all__ = ["cards", "health", "series", "validate"]
