"""Persistent Flow cache.

The expensive parts of this surface are the universe scan and the per-ticker
proxy series. Recomputing them on every page load is wasteful, and a feed outage
should not erase a card that was correct a minute ago.

The cache is the app's existing SQLite WAL store (`backend/data/cache/cache.db`), not a
new database: the raw bars, IDX foreign flow and Stockbit broker rows already
live there through their own caches. The Flow layer adds the *computed* payloads
on top.

Freshness is controlled by `FLOW_CACHE_TTL` (seconds, default 300). A stale
entry is kept for `FLOW_CACHE_STALE_DAYS` (default 7) and served with a warning
if recomputation fails.
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from app import db

ROOT = "flow:"
PREFIX = "flow:v2:"
DEFAULT_TTL = int(os.getenv("FLOW_CACHE_TTL", "300"))
VALIDATE_TTL = int(os.getenv("FLOW_CACHE_TTL_VALIDATE", "3600"))
STALE_SECONDS = int(os.getenv("FLOW_CACHE_STALE_DAYS", "7")) * 86400


@dataclass(frozen=True)
class CacheMeta:
    hit: bool
    fresh: bool
    age_seconds: int
    saved_at: str | None
    ttl_seconds: int
    cache_key: str
    warning: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "hit": self.hit,
            "fresh": self.fresh,
            "age_seconds": self.age_seconds,
            "saved_at": self.saved_at,
            "ttl_seconds": self.ttl_seconds,
            "cache_key": self.cache_key,
            "warning": self.warning,
        }


def make_key(kind: str, *parts: object) -> str:
    """Stable, readable-ish key: kind + short digest of the exact inputs."""
    raw = "|".join(str(part) for part in parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]
    return f"{PREFIX}{kind}:{digest}"


def _read(key: str) -> tuple[dict[str, Any] | None, float | None]:
    raw = db.get(key)
    if not isinstance(raw, dict) or "payload" not in raw or "saved_at" not in raw:
        return None, None
    try:
        saved_at = float(raw["saved_at"])
    except (TypeError, ValueError):
        return None, None
    payload = raw.get("payload")
    if not isinstance(payload, dict):
        return None, None
    return payload, saved_at


def _meta(
    key: str,
    *,
    hit: bool,
    fresh: bool,
    age: float | None,
    ttl: int,
    warning: str | None = None,
) -> CacheMeta:
    return CacheMeta(
        hit=hit,
        fresh=fresh,
        age_seconds=int(age) if age is not None else 0,
        saved_at=(
            datetime.fromtimestamp(time.time() - age, UTC).isoformat()
            if age is not None
            else None
        ),
        ttl_seconds=ttl,
        cache_key=key,
        warning=warning,
    )


def read(key: str, ttl: int = DEFAULT_TTL) -> tuple[dict[str, Any], CacheMeta] | None:
    """Read a cached payload, fresh or stale."""
    payload, saved_at = _read(key)
    if payload is None or saved_at is None:
        return None
    age = max(0.0, time.time() - saved_at)
    fresh = age <= ttl
    if not fresh and age > STALE_SECONDS:
        return None
    return payload, _meta(key, hit=True, fresh=fresh, age=age, ttl=ttl)


def write(key: str, payload: dict[str, Any]) -> None:
    db.set(
        key,
        {
            "saved_at": time.time(),
            "payload": payload,
        },
    )


def delete(key: str) -> None:
    db.delete(key)


def get_or_compute(
    key: str,
    compute: Callable[[], dict[str, Any]],
    ttl: int = DEFAULT_TTL,
    *,
    refresh: bool = False,
) -> tuple[dict[str, Any], CacheMeta]:
    """Return a fresh cached payload, or compute and store it.

    If recomputation fails and a stale entry exists, the stale entry is returned
    with a warning instead of failing the page. That is the same
    stale-on-outage behaviour the market cache uses.
    """
    if refresh:
        delete(key)
    cached = read(key, ttl)
    if cached is not None and cached[1].fresh:
        return cached

    try:
        payload = compute()
    except Exception as exc:  # noqa: BLE001
        if cached is not None:
            stale_payload, stale_meta = cached
            warning = f"served stale cache after recompute failed: {exc}"
            return stale_payload, CacheMeta(
                hit=True,
                fresh=False,
                age_seconds=stale_meta.age_seconds,
                saved_at=stale_meta.saved_at,
                ttl_seconds=ttl,
                cache_key=key,
                warning=warning,
            )
        raise

    write(key, payload)
    return payload, _meta(key, hit=False, fresh=False, age=0.0, ttl=ttl)


def clear() -> int:
    """Delete only this version's Flow keys, leaving the market/IDX/Stockbit caches intact."""
    removed = 0
    for key in db.keys(ROOT):
        db.delete(key)
        removed += 1
    return removed


def stats() -> dict[str, Any]:
    keys = db.keys(PREFIX)
    return {
        "path": str(db.stats().get("path")),
        "entries": len(keys),
        "keys": keys[:20],
        "ttl_seconds": DEFAULT_TTL,
        "validate_ttl_seconds": VALIDATE_TTL,
        "stale_days": STALE_SECONDS // 86400,
        "db_entries": db.stats().get("entries"),
        "db_bytes": db.stats().get("db_bytes"),
    }
