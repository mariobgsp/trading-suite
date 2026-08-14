"""Market regime + IDX flow context.

- Regime: wraps bot-trading-simulator's canonical MarketRegime
  (core/regime.py) — BULL / CAUTION / BEAR classification from ^JKSE.
- Flow context: per-ticker foreign flow served from IDX directly
  (app.idx) — the free replacement for the old Stockbit market detector.
"""

from __future__ import annotations

import logging
from typing import Any

from app import db
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


# ─── Bandarmology context (IDX, no Stockbit) ─────────────────────────────────


def stockbit_available() -> bool:
    """Deprecated gate — bandarmology now comes from IDX directly."""
    return True


def stockbit_market_detector(ticker: str) -> dict[str, Any]:
    """Per-ticker flow context from IDX (foreign flow + price).

    Replaces the old Stockbit market-detector: IDX does not publish per-stock
    broker attribution, so the free equivalent is the official per-stock
    foreign flow from GetStockSummary.
    """
    from app.idx import foreign_flow

    ff = foreign_flow(ticker)
    return {
        "ticker": ticker,
        "top_broker": {
            "bandar": "IDX",
            "barangBandar": round(ff.get("net_foreign_lots", 0) or 0),
            "rataRataBandar": ff.get("price") or 0,
        },
        "broker_summary": {
            "detector": {
                "top1": {"vol": 0, "percent": 0, "amount": 0, "accdist": "-"},
                "top3": {"vol": 0, "percent": 0, "amount": 0, "accdist": "-"},
                "top5": {"vol": 0, "percent": 0, "amount": 0, "accdist": "-"},
                "avg": {"vol": 0, "percent": 0, "amount": 0, "accdist": "-"},
                "total_buyer": 0,
                "total_seller": 0,
                "number_broker_buysell": 0,
                "broker_accdist": ff.get("net_foreign_idr", 0),
                "volume": 0,
                "value": 0,
                "average": ff.get("price") or 0,
            },
            "topBuyers": [
                {
                    "netbs_broker_code": "IDX-F",
                    "blot": ff.get("foreign_buy_lots", 0),
                    "netbs_buy_avg_price": ff.get("price") or 0,
                    "bval": ff.get("foreign_buy_idr", 0),
                }
            ],
            "topSellers": [
                {
                    "netbs_broker_code": "IDX-F",
                    "slot": ff.get("foreign_sell_lots", 0),
                    "netbs_buy_avg_price": ff.get("price") or 0,
                    "sval": ff.get("foreign_sell_idr", 0),
                }
            ],
        },
    }
