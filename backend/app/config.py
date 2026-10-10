"""Central configuration for the merged trading platform backend."""

from __future__ import annotations

import os
from pathlib import Path


def _env_int(name: str, default: int) -> int:
    """Read an integer env var, falling back to default on any parse failure."""
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# ─── Paths ────────────────────────────────────────────────────────────────────
BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
LOGS_DIR = BACKEND_ROOT / "logs"

DATA_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# ─── Data sources ─────────────────────────────────────────────────────────────
YFINANCE_CACHE_TTL_SECONDS = _env_int("YFINANCE_CACHE_TTL", 3600)
YFINANCE_HISTORY_CACHE_TTL_SECONDS = _env_int("YFINANCE_HISTORY_CACHE_TTL", 43200)  # 12h
FOREX_CACHE_TTL_SECONDS = _env_int("FOREX_CACHE_TTL", 3600)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# ─── API behaviour ────────────────────────────────────────────────────────────
# Allow both localhost AND 127.0.0.1 (dev server often bound to 127.0.0.1,
# browser origin is then http://127.0.0.1:3000 — missing that origin silently
# CORS-blocks every API call and the UI shows no data).
# 5173 is the Vite dev server, 4173 is `vite preview` (the production build).
# Both are in the default because a previewed build that cannot reach the API is
# a confusing failure: the page renders, then every request silently fails.
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:5173,"
    "http://localhost:4173,"
    "http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:5173,"
    "http://127.0.0.1:4173",
).split(",")

# ─── IHSG universe ────────────────────────────────────────────────────────────
# Only symbols verified live on Yahoo Finance. ^JKIDX30 / ^JKIDX80 / ^JKB27 /
# ^JKINFOBANK15 were tested 2026-08 and return 404/delisted upstream, which
# added 2-4s of yfinance retry per refresh on every /api/market/indices call.
IHSG_INDICES = {
    "IHSG": "^JKSE",
    "LQ45": "^JKLQ45",
}
