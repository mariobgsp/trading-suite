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
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:5173",
).split(",")

# ─── IHSG universe ────────────────────────────────────────────────────────────
# Only symbols verified live on Yahoo Finance (^JKSRI / ^JKK100 do not exist
# upstream and produced 404 spam on every indices call).
IHSG_INDICES = {
    "IHSG": "^JKSE",
    "LQ45": "^JKLQ45",
    "IDX30": "^JKIDX30",
    "IDX80": "^JKIDX80",
    "BISNIS-27": "^JKB27",
    "INFOBANK15": "^JKINFOBANK15",
}
