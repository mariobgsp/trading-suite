"""Deep Cache seam — single TTL policy + stale-while-revalidate + dedupe.

Replaces 12 copy-pasted `get_fresh → fetch → set → stale fallback` blocks
across market.py / idx.py / beta.py with one testable interface.

Deletion test: deleting this concentrates all TTL/miss/stale policy
here; no caller reimplements it.

Policy table is the single source for frontend `src/lib/cache.ts:getDefaultTTL`
— keep them aligned (same numbers, same prefix semantics).
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from app import db

logger = logging.getLogger(__name__)

# ── TTL policy table (seconds) — prefix → ttl ───────────────────────────────
# Longest-prefix match via ttl_for(). Single source; frontend mirrors it.
TTL_POLICY: dict[str, int] = {
    # IDX EOD data — daily-ish
    "intel:foreign": 3600,
    "intel:broker": 3600,
    "intel:heatmap": 3600,
    "intel:movers": 3600,
    "intel:ownership": 86400,
    "intel:ownership:hist": 86400 * 7,  # archive, rarely read fresh
    "intel:announcements": 600,
    "intel:announcement": 600,
    "intel:rotation": 3600,
    "intel:konglo": 3600,
    "idx:summary": 3600,
    "idx:broker": 3600,
    # Market / yfinance
    "market:quote": 30,
    "market:quotes": 30,
    "market:indices": 20,
    "hist:": 43200,  # OHLCV history — screener/validator/entry all share this key
    "market:history": 43200,
    "market:forex": 3600,
    "beta:": 43200,
    "regime:": 45,
    "screener:": 30,
    "portfolio:": 15,
    "sentiment:": 180,
    "stockbit:": 43200,
    "stockbit:discovery": 86400,
}

DEFAULT_TTL = 30


def ttl_for(key: str) -> int:
    """Longest-prefix TTL lookup."""
    best = DEFAULT_TTL
    best_len = -1
    for prefix, ttl in TTL_POLICY.items():
        if key == prefix or key.startswith(prefix):
            if len(prefix) > best_len:
                best = ttl
                best_len = len(prefix)
    return best


# ── Dedupe: one inflight refresh per key ────────────────────────────────────
# ponytail: global _pending dict + _pending_lock; per-key locks if contention matters
_pending: dict[str, threading.Event] = {}
_pending_lock = threading.Lock()


def _spawn_refresh(key: str, fetcher: Callable[[], Any | None]) -> None:
    """Run fetcher in daemon thread, deduped per key. Stores result via db.set."""
    with _pending_lock:
        if key in _pending:
            return
        ev = threading.Event()
        _pending[key] = ev

    def _run() -> None:
        try:
            result = fetcher()
            if result is not None:
                db.set(key, result)
        except Exception as exc:  # noqa: BLE001
            logger.warning("cache refresh %s failed: %s", key, exc)
        finally:
            with _pending_lock:
                _pending.pop(key, None)
                ev.set()

    threading.Thread(target=_run, daemon=True, name=f"cache:{key}").start()


def serve(
    key: str,
    fetcher: Callable[[], Any],
    ttl: int | None = None,
    force: bool = False,
) -> Any:
    """SWR serve: fresh → return; stale → return stale + background refresh; miss → fetch blocking.

    - ttl=None → resolved via ttl_for(key)
    - force=True → bypass cache entirely, fetch blocking and store
    - On fetch failure with stale available → return stale (never hard-fail)
    - On fetch failure with no stale → propagate fetcher result/error (caller decides)
    - Background refreshes are deduped per key
    """
    resolved_ttl = ttl if ttl is not None else ttl_for(key)

    if not force:
        fresh = db.get_fresh(key, resolved_ttl)
        if fresh is not None:
            return fresh
        stale = db.get(key)
        if stale is not None:
            # stale-serve + background refresh (dedupe)
            _spawn_refresh(key, fetcher)
            return stale

    # No cache or forced: blocking fetch
    try:
        result = fetcher()
    except Exception as exc:  # noqa: BLE001
        stale = db.get(key)
        if stale is not None:
            logger.warning("cache serve %s fetch failed, serving stale: %s", key, exc)
            return stale
        raise
    if result is not None:
        db.set(key, result)
    return result


def invalidate(prefix: str | None = None) -> None:
    """Invalidate by prefix (delegates to db). Kept here so callers have one seam."""
    if prefix is None:
        db.clear()
        return
    for k in db.keys(prefix):
        db.delete(k)


# ── Universe warm daemon ─────────────────────────────────────────────────────
# Startup + daily background preload of every ticker's 2y history so the first
# screener scan of a 900+ universe is instant (cache hits, no yfinance waits).
_WARMING: set[str] = set()
_WARM_LOCK = threading.Lock()
_WARM_STARTED = False


def warm_universe(
    tickers: list[str],
    period: str = "2y",
    interval: str = "1d",
    workers: int = 8,
) -> None:
    """Background-warm the universe history cache in parallel, deduped.

    Fetches only what's stale/missing (cache.serve semantics). Fire-and-forget
    daemon thread; idempotent (re-entry while running is a no-op).
    """
    global _WARM_STARTED
    if _WARM_STARTED:
        return
    with _WARM_LOCK:
        if _WARM_STARTED:
            return
        _WARM_STARTED = True

    def _run() -> None:
        try:
            from app.market import fetch_history

            done = skipped = failed = 0
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futs = {}
                for t in tickers:
                    key = f"hist:{t}.JK:{period}:{interval}" if not t.startswith("^") and ".JK" not in t else f"hist:{t}:{period}:{interval}"
                    if db.get_fresh(key, ttl_for(key)) is not None:
                        skipped += 1
                        continue
                    futs[pool.submit(fetch_history, t, period, interval, False)] = t
                for fut in as_completed(futs):
                    try:
                        fut.result()
                        done += 1
                    except Exception as exc:  # noqa: BLE001
                        failed += 1
                        logger.warning("warm %s failed: %s", futs[fut], exc)
            logger.info(
                "universe warm: %d fetched, %d skipped, %d failed",
                done,
                skipped,
                failed,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("universe warm crashed: %s", exc)

    threading.Thread(target=_run, daemon=True, name="cache:warm-universe").start()


def prune(max_entries: int = 5000, max_age_days: int = 30) -> int:
    """LRU-ish cap: drop oldest entries beyond max_entries or older than max_age_days."""
    return db.prune(max_entries, max_age_days)
