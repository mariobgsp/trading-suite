"""Market regime + Stockbit bandarmology service wrappers.

- Regime: wraps bot-trading-simulator's canonical MarketRegime
  (core/regime.py) — BULL / CAUTION / BEAR classification from ^JKSE.
- Stockbit: wraps the copied trading-simulator StockbitClient
  (app/services/stockbit.py) — bandarmology/market-detector feeds.
"""

from __future__ import annotations

import logging
from datetime import UTC
from typing import Any

from app import db
from app.config import STOCKBIT_JWT_TOKEN
from app.market import fetch_history

logger = logging.getLogger(__name__)


# ─── Regime ───────────────────────────────────────────────────────────────────


def regime_snapshot(force: bool = False) -> dict[str, Any]:
    """Current IHSG regime classification (BULL/CAUTION/BEAR)."""
    cache_key = "regime:snapshot"
    if not force:
        cached = db.get_fresh(cache_key, 3600)
        if cached is not None:
            return cached

    try:
        from core.regime import _ENGINE_PERMISSIONS, MarketRegime

        regime = MarketRegime(period="1y")
        snap = regime.get_snapshot()
        allowed = sorted(_ENGINE_PERMISSIONS.get(snap.regime, set()))
        payload = {
            "regime": snap.regime.value,
            "close": round(float(snap.close), 2),
            "sma_short": round(float(snap.sma_short), 2),
            "sma_long": round(float(snap.sma_long), 2),
            "atr_value": round(float(snap.atr_value), 2),
            "hurst_value": round(float(snap.hurst_value), 4),
            "as_of_date": snap.as_of_date,
            "allowed_engines": allowed,
        }
        db.set(cache_key, payload)
        return payload
    except Exception as exc:  # noqa: BLE001 - upstream/sk-learn may be missing
        logger.warning("regime snapshot failed: %s", exc)
        return {"error": str(exc)[:200], "regime": "UNKNOWN"}


def regime_history() -> dict[str, Any]:
    """IHSG index history for charting the regime."""
    history = fetch_history("^JKSE", period="1y", interval="1d")
    return {"symbol": "^JKSE", "history": history}


# ─── Stockbit (optional, needs STOCKBIT_JWT_TOKEN) ────────────────────────────


def _client():
    from app.services.stockbit import StockbitClient

    return StockbitClient(token=STOCKBIT_JWT_TOKEN)


def stockbit_available() -> bool:
    return bool(STOCKBIT_JWT_TOKEN)


def stockbit_market_detector(ticker: str) -> dict[str, Any]:
    """Bandarmology market-detector for a ticker (top broker + summary)."""
    cache_key = f"stockbit:detector:{ticker}"
    cached = db.get_fresh(cache_key, 1800)
    if cached is not None:
        return cached
    try:
        from datetime import datetime, timedelta

        client = _client()
        # Rolling 12-month window instead of a hardcoded 2025-2027 range.
        today = datetime.now(UTC).date()
        from_date = (today - timedelta(days=365)).isoformat()
        to_date = today.isoformat()
        data = client.fetch_market_detector(ticker, from_date, to_date)
        if data is None:
            return {"ticker": ticker, "error": "no data (token valid?)"}
        from app.services.stockbit import (
            get_broker_summary,
            get_top_broker,
        )

        payload = {
            "ticker": ticker,
            "top_broker": get_top_broker(data),
            "broker_summary": get_broker_summary(data),
        }
        db.set(cache_key, payload)
        return payload
    except Exception as exc:  # noqa: BLE001
        logger.warning("stockbit detector failed: %s", exc)
        return {"ticker": ticker, "error": str(exc)[:200]}
