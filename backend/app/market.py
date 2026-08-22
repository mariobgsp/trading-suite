"""Market data service: yfinance fetch wrapper with SQLite caching.

Consolidates the five different yfinance fetch wrappers found across the
source repos (trading-simulator/engine.py:111, stock-backtester/main.py:27,
bot-trading-simulator/core/ingestion.py, ihsg-stock-validator/main.py:270,
stock-screener/main.py) into one rate-limited, cached, .JK-normalized service.
"""

from __future__ import annotations

import concurrent.futures
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
# YFDataException/YFRateLimitError are yfinance's own exceptions for
# delisted symbols / HTTP 404 / rate-limit — without them a dead ticker
# blocks for ~3s of internal retries and can 500 the route.
try:
    from yfinance.exceptions import YFDataException, YFRateLimitError

    _UPSTREAM_ERROR_TYPES = (
        ConnectionError,
        TimeoutError,
        ValueError,
        KeyError,
        AttributeError,
        IndexError,
        YFDataException,
        YFRateLimitError,
    )
except ImportError:  # pragma: no cover - yfinance always present in venv
    _UPSTREAM_ERROR_TYPES = (
        ConnectionError,
        TimeoutError,
        ValueError,
        KeyError,
        AttributeError,
        IndexError,
    )

# Short negative cache: a dead/invalid ticker costs ~3s of yfinance retries.
# Remember "no data" for this long so repeated lookups return instantly.
NEGATIVE_CACHE_TTL = 300  # 5 min


class UpstreamDataError(Exception):
    """Raised when a known upstream/data failure occurs.

    The fetch wrappers catch this exact class to serve a stale-cache
    fallback; any OTHER exception type propagates as a real bug instead
    of being silently swallowed.
    """


# Global throttle: 1s was too conservative and made BBCA cold load 4s+.
# yfinance tolerates bursts of ~5 req/s from a single IP when using
# fast_info (small payload). 0.22s cuts BBCA 8-ticker watchlist from 2.8s
# to ~0.5s cold, and warm loads are 0s (SWR stale-serve). Keep background
# refresh deduped so we never hammer even at 0.22s.
_MIN_REQUEST_INTERVAL = 0.22  # seconds between upstream calls
_lock = threading.Lock()
_last_request_ts = 0.0
_refreshing: set[str] = set()
_refresh_lock = threading.Lock()


def _throttle() -> None:
    """Rate-limit upstream calls without holding the lock during sleep."""
    global _last_request_ts
    with _lock:
        now = time.time()
        wait = _MIN_REQUEST_INTERVAL - (now - _last_request_ts)
        _last_request_ts = now
    if wait > 0:
        time.sleep(wait)


def _spawn_refresh(key: str, fn) -> None:
    """Run fn() in a daemon thread once per key — deduplicates concurrent refreshes."""
    with _refresh_lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def _run() -> None:
        try:
            fn()
        finally:
            with _refresh_lock:
                _refreshing.discard(key)

    threading.Thread(target=_run, daemon=True).start()


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
    """Fetch a single quote with SWR caching: stale served instantly, refresh in background."""
    normalized = normalize_ticker(ticker)
    cache_key = f"quote:{normalized}"
    if not force:
        # Dead-ticker fast path: previously failed upstream → return instantly
        if db.get_fresh(f"neg:{cache_key}", NEGATIVE_CACHE_TTL) is not None:
            return None
        fresh = db.get_fresh(cache_key, YFINANCE_CACHE_TTL_SECONDS)
        if fresh is not None:
            return fresh
        # Stale exists → serve instantly and refresh in background (no blocking)
        stale = db.get(cache_key)
        if stale is not None:
            _spawn_refresh(cache_key, lambda: _fetch_quote_upstream(normalized, cache_key))
            return stale

    return _fetch_quote_upstream(normalized, cache_key)


def _fetch_quote_upstream(normalized: str, cache_key: str) -> dict[str, Any] | None:
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
        # remember failure so repeated lookups of dead symbols are instant
        try:
            db.set(f"neg:{cache_key}", True)
        except Exception:  # noqa: BLE001 - negative-cache write must never break
            pass
        return db.get(cache_key)  # stale fallback


def fetch_quotes(tickers: list[str], force: bool = False) -> dict[str, dict[str, Any]]:
    """Fetch multiple quotes in parallel (throttled), deduped — cold start ~0.5s not 2-3s."""
    # Deduplicate to normalized form, preserve first original for fetch_quote call
    dedup: dict[str, str] = {}
    for t in tickers:
        n = normalize_ticker(t)
        if n not in dedup:
            dedup[n] = t

    if not dedup:
        return {}

    # Fast path: all fresh → sequential is fine and avoids thread overhead
    # But for cold/parallel we use a small pool (IO-bound, yfinance)
    out: dict[str, dict[str, Any]] = {}
    # Use up to 8 workers; yfinance threads=False so we control concurrency
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(dedup))) as pool:
        fut_to_norm = {pool.submit(fetch_quote, orig, force): norm for norm, orig in dedup.items()}
        for fut in concurrent.futures.as_completed(fut_to_norm):
            norm = fut_to_norm[fut]
            try:
                q = fut.result()
            except Exception:  # noqa: BLE001
                q = None
            if q:
                out[norm] = q
    return out


def fetch_history(
    ticker: str,
    period: str = "1y",
    interval: str = "1d",
    force: bool = False,
) -> list[dict[str, Any]]:
    """Fetch OHLCV history with SWR: stale served instantly, refresh in background."""
    normalized = normalize_ticker(ticker)
    cache_key = f"hist:{normalized}:{period}:{interval}"
    if not force:
        # Dead-ticker fast path (yfinance retries cost ~3s each)
        if db.get_fresh(f"neg:{cache_key}", NEGATIVE_CACHE_TTL) is not None:
            return []
        fresh = db.get_fresh(cache_key, YFINANCE_HISTORY_CACHE_TTL_SECONDS)
        if fresh is not None:
            return fresh
        stale = db.get(cache_key)
        if stale is not None:
            _spawn_refresh(cache_key, lambda: _fetch_history_upstream(normalized, period, interval, cache_key))
            return stale

    return _fetch_history_upstream(normalized, period, interval, cache_key)


def _fetch_history_upstream(
    normalized: str, period: str, interval: str, cache_key: str
) -> list[dict[str, Any]]:
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
            try:
                db.set(f"neg:{cache_key}", True)
            except Exception:  # noqa: BLE001
                pass
            return db.get(cache_key) or []
        df = raw
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
        try:
            db.set(f"neg:{cache_key}", True)
        except Exception:  # noqa: BLE001
            pass
        return db.get(cache_key) or []


def fetch_forex(force: bool = False) -> float | None:
    """USD/IDR rate with SWR — stale served instantly."""
    cache_key = "forex:USDIDR"
    if not force:
        fresh = db.get_fresh(cache_key, FOREX_CACHE_TTL_SECONDS)
        if fresh is not None:
            return fresh
        stale = db.get(cache_key)
        if stale is not None:
            _spawn_refresh(cache_key, lambda: _fetch_forex_upstream(cache_key))
            return stale
    return _fetch_forex_upstream(cache_key)


def _fetch_forex_upstream(cache_key: str) -> float | None:
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
    """Fetch configured IHSG index quotes — parallel, SWR-cached."""
    from app.config import IHSG_INDICES

    items = list(IHSG_INDICES.items())  # (name, symbol)

    # fetch in parallel via fetch_quotes helper (already deduped + SWR)
    symbols = [s for _, s in items]
    # fetch_quotes returns dict keyed by normalized, we need to map back to name
    quotes = fetch_quotes(symbols)

    out: list[dict[str, Any]] = []
    for name, symbol in items:
        norm = normalize_ticker(symbol)
        q = quotes.get(norm) or quotes.get(symbol)
        if q:
            # copy to avoid mutating cached object
            qq = dict(q)
            qq["name"] = name
            out.append(qq)
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
