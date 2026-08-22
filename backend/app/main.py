"""FastAPI application: merged IDX trading platform backend.

Consolidates the six source repos' Python logic into one service:
market data, indicators, backtesting, screener, bandarmology validator,
sentiment news radar, FIFO portfolio, market regime, and Stockbit feeds.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS
from app.routers import (  # pyright: ignore[reportAttributeAccessIssue]
    alerts,
    analysis,
    backtest,
    intel,
    market,
    portfolio,
    regime,
    screener,
    sentiment,
    summary,
    validator,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


# ── Warm BBCA + popular tickers on startup so first user BBCA load is instant ──
# Without this, a cold cache (fresh deploy) makes BBCA.JK yfinance fetch block
# for 2-4s (throttle + network) and UI shows “fetching…” for seconds.
# We pre-warm the most common tickers in a daemon thread so by the time the
# frontend mounts, cache is already fresh or at worst a stale-serve is ready.
def _warm_bbca_cache() -> None:
    import threading

    def _run() -> None:
        try:
            # import inside thread to avoid circular import at module load
            from app.market import fetch_history, fetch_indices, fetch_quote

            popular = ["BBCA", "BBRI", "BMRI", "BBNI", "TLKM", "ASII", "ADRO", "ANTM"]
            # warm quotes (fast, will fill quote:* keys)
            for t in popular:
                try:
                    fetch_quote(t)
                except Exception as e:  # noqa: BLE001
                    logging.getLogger(__name__).warning("warm %s failed: %s", t, e)
            # BBCA histories — the one user reports as slow (1y is default on /markets)
            for period in ("3mo", "6mo", "1y", "2y"):
                try:
                    fetch_history("BBCA", period=period)
                except Exception as e:  # noqa: BLE001
                    logging.getLogger(__name__).warning("warm BBCA %s failed: %s", period, e)
            try:
                fetch_indices()
            except Exception as e:  # noqa: BLE001
                logging.getLogger(__name__).warning("warm indices failed: %s", e)
            logging.getLogger(__name__).info("BBCA warm complete")
        except Exception as e:  # noqa: BLE001
            logging.getLogger(__name__).warning("BBCA warm failed: %s", e)

    threading.Thread(target=_run, daemon=True).start()


app = FastAPI(
    title="Trading Suite API",
    description="Merged IDX trading platform: backtester, screener, validator, "
    "portfolio, sentiment radar, regime filter.",
    version="0.1.0",
    on_startup=[_warm_bbca_cache],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    analysis.router,
    alerts.router,
    intel.router,
    market.router,
    portfolio.router,
    backtest.router,
    screener.router,
    validator.router,
    sentiment.router,
    regime.router,
    summary.router,
):
    app.include_router(router)


@app.get("/")
async def root() -> dict:
    return {"app": "trading-suite", "status": "ok"}


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "services": [
            "market",
            "portfolio",
            "backtest",
            "screener",
            "validator",
            "sentiment",
            "regime",
            "summary",
            "analysis",
            "intel",
            "alerts",
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
