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
    analysis,
    backtest,
    market,
    portfolio,
    regime,
    screener,
    sentiment,
    summary,
    validator,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(
    title="Trading Suite API",
    description="Merged IDX trading platform: backtester, screener, validator, "
    "portfolio, sentiment radar, regime filter.",
    version="0.1.0",
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
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
