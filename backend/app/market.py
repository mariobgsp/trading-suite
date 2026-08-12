"""Market data service: yfinance fetch wrapper with SQLite caching.

Consolidates the five different yfinance fetch wrappers found across the
source repos (trading-simulator/engine.py:111, stock-backtester/main.py:27,
bot-trading-simulator/core/ingestion.py, ihsg-stock-validator/main.py:270,
stock-screener/main.py) into one rate-limited, cached, .JK-normalized service.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from typing import Any

import pandas as pd
import yfinance as yf

from app import db
from app.config import (
    FOREX_CACHE_TTL_SECONDS,
    YFINANCE_CACHE_TTL_SECONDS,
    YFINANCE_HISTORY_CACHE_TTL_SECONDS,
)

logger = logging.getLogger(__name__)

# Known upstream failure modes (yfinance rate-limits, network, schema drift).
_UPSTREAM_ERROR_TYPES = (
    ConnectionError,
    TimeoutError,
    ValueError,
    KeyError,
    AttributeError,
    IndexError,
)


class UpstreamDataError(Exception):
    """Raised when a known upstream/data failure occurs.

    The fetch wrappers catch this exact class to serve a stale-cache
    fallback; any OTHER exception type propagates as a real bug instead
    of being silently swallowed.
    """


# Global throttle: yfinance rate-limits aggressively (2024-2026 issue #2128/#2480)
_MIN_REQUEST_INTERVAL = 1.0  # seconds between upstream calls
_lock = threading.Lock()
_last_request_ts = 0.0


def _throttle() -> None:
    """Rate-limit upstream calls without holding the lock during sleep.

    Computes the wait inside the lock, releases it, then sleeps — so
    concurrent fetch threads don't serialize on one another.
    """
    global _last_request_ts
    with _lock:
        now = time.time()
        wait = _MIN_REQUEST_INTERVAL - (now - _last_request_ts)
        _last_request_ts = now
    if wait > 0:
        time.sleep(wait)


# Symbols that must NEVER get the .JK suffix (US stocks, crypto, FX).
_NON_IDX_TICKERS = {
    # US large caps commonly watched by Indonesian traders
    "AAPL",
    "MSFT",
    "GOOGL",
    "GOOG",
    "AMZN",
    "NVDA",
    "TSLA",
    "META",
    "NFLX",
    "AMD",
    "INTC",
    "PLTR",
    "COIN",
    "MSTR",
    "SQQQ",
    "TQQQ",
    # crypto / FX
    "BTC",
    "ETH",
    "USD",
    "EUR",
    "SGD",
    "AUD",
}


def normalize_ticker(ticker: str) -> str:
    """Normalize an IDX ticker to Yahoo format.

    - 'BBCA' -> 'BBCA.JK' (IDX 3-4 letter codes)
    - 'BBCA.JK' stays; indices '^JKSE' pass through
    - crypto/FX ('BTC-USD', 'USDIDR=X') and known US symbols ('AAPL')
      pass through untouched — never blindly append .JK
    """
    t = ticker.strip().upper()
    if not t:
        return t
    if t.startswith("^") or "." in t or "=" in t or "-" in t:
        return t
    if t in _NON_IDX_TICKERS:
        return t
    # IDX convention: 3-4 letter codes are Indonesian
    if len(t) <= 4:
        return f"{t}.JK"
    # Longer symbols: ambiguous. If it looks like a known US name, pass
    # through; otherwise treat as IDX (defensive default).
    if len(t) == 5 and t[-1] == "F":
        return t  # e.g. BRK-B style suffix variants
    return f"{t}.JK"


def fetch_quote(ticker: str, force: bool = False) -> dict[str, Any] | None:
    """Fetch a single quote with caching. Returns None on upstream failure."""
    normalized = normalize_ticker(ticker)
    cache_key = f"quote:{normalized}"
    if not force:
        cached = db.get_fresh(cache_key, YFINANCE_CACHE_TTL_SECONDS)
        if cached is not None:
            return cached

    try:
        _throttle()
        tick = yf.Ticker(normalized)
        try:
            info = tick.fast_info
        except _UPSTREAM_ERROR_TYPES as exc:
            raise UpstreamDataError(str(exc)) from exc
        quote = {
            "symbol": normalized,
            "price": _safe(info, "last_price"),
            "previous_close": _safe(info, "previous_close"),
            "open": _safe(info, "open"),
            "day_high": _safe(info, "day_high"),
            "day_low": _safe(info, "day_low"),
            "volume": _safe(info, "last_volume"),
            "change": None,
            "change_percent": None,
        }
        if quote["price"] is not None and quote["previous_close"]:
            quote["change"] = round(quote["price"] - quote["previous_close"], 4)
            quote["change_percent"] = round((quote["change"] / quote["previous_close"]) * 100, 2)
        db.set(cache_key, quote)
        return quote
    except UpstreamDataError as exc:
        logger.warning("quote fetch failed for %s: %s", normalized, exc)
        return db.get(cache_key)  # stale fallback


def fetch_quotes(tickers: list[str], force: bool = False) -> dict[str, dict[str, Any]]:
    """Fetch multiple quotes sequentially (throttled), deduped."""
    out: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    for t in tickers:
        normalized = normalize_ticker(t)
        if normalized in seen:
            continue  # avoid duplicate upstream calls for repeated symbols
        seen.add(normalized)
        q = fetch_quote(t, force=force)
        if q:
            out[normalized] = q
    return out


def fetch_history(
    ticker: str,
    period: str = "1y",
    interval: str = "1d",
    force: bool = False,
) -> list[dict[str, Any]]:
    """Fetch OHLCV history as a list of records (oldest -> newest)."""
    normalized = normalize_ticker(ticker)
    cache_key = f"hist:{normalized}:{period}:{interval}"
    if not force:
        cached = db.get_fresh(cache_key, YFINANCE_HISTORY_CACHE_TTL_SECONDS)
        if cached is not None:
            return cached

    try:
        _throttle()
        try:
            raw = yf.download(
                normalized,
                period=period,
                interval=interval,
                auto_adjust=True,
                progress=False,
                threads=False,
            )
        except _UPSTREAM_ERROR_TYPES as exc:
            raise UpstreamDataError(str(exc)) from exc
        if raw is None or raw.empty:
            return db.get(cache_key) or []
        df = raw
        # Flatten MultiIndex columns if present (yfinance quirk)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.reset_index()
        df = df.dropna(subset=["Open", "High", "Low", "Close"])
        records = [
            {
                "date": _fmt_date(row.iloc[0]),
                "open": _round(row.get("Open")),
                "high": _round(row.get("High")),
                "low": _round(row.get("Low")),
                "close": _round(row.get("Close")),
                "volume": _round(row.get("Volume")) or 0,
            }
            for _, row in df.iterrows()
        ]
        db.set(cache_key, records)
        return records
    except UpstreamDataError as exc:
        logger.warning("history fetch failed for %s: %s", normalized, exc)
        return db.get(cache_key) or []


def fetch_forex(force: bool = False) -> float | None:
    """USD/IDR rate via yfinance, cached (trading-simulator engine.py:76)."""
    cache_key = "forex:USDIDR"
    if not force:
        cached = db.get_fresh(cache_key, FOREX_CACHE_TTL_SECONDS)
        if cached is not None:
            return cached
    try:
        _throttle()
        tick = yf.Ticker("USDIDR=X")
        try:
            rate = _safe(tick.fast_info, "last_price")
        except _UPSTREAM_ERROR_TYPES as exc:
            raise UpstreamDataError(str(exc)) from exc
        if rate:
            db.set(cache_key, rate)
            return rate
    except UpstreamDataError as exc:
        logger.warning("forex fetch failed: %s", exc)
    return db.get(cache_key)


def fetch_indices() -> list[dict[str, Any]]:
    """Fetch configured IHSG index quotes."""
    from app.config import IHSG_INDICES

    out = []
    for name, symbol in IHSG_INDICES.items():
        q = fetch_quote(symbol)
        if q:
            q["name"] = name
            out.append(q)
    return out


# ─── helpers ──────────────────────────────────────────────────────────────────


def _safe(obj: Any, attr: str) -> Any:
    if obj is None:
        return None
    try:
        val = getattr(obj, attr, None)
        if val is None:
            return None
        if isinstance(val, pd.Series):
            if len(val) > 0:
                val = val.iloc[-1]
            else:
                return None
        try:
            f = float(val)
            return None if math.isnan(f) else f
        except (TypeError, ValueError):
            return val
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


def _round(val: Any) -> float | None:
    try:
        if val is None:
            return None
        v = float(val)
        return None if math.isnan(v) else round(v, 4)
    except (TypeError, ValueError):
        return None


def _fmt_date(val: Any) -> str:
    if hasattr(val, "isoformat"):
        return str(val.date())
    return str(val)
