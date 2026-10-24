"""Shared persistent cache for computed payloads.

External data (OHLCV, TradingView, IDX) already has its own stale-while-
revalidate layer in `app.cache`. This module stores the *derived* payloads that
are expensive to compute but cheap to serve: the market dashboard snapshot, for
example.

The store is the app's existing SQLite WAL cache (`backend/data/cache/cache.db`).
Nothing here fetches upstream data; callers pass a compute function and get the
cached payload back.
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from app import db

PREFIX = "computed:"
STALE_SECONDS = int(os.getenv("COMPUTED_CACHE_STALE_DAYS", "7")) * 86400


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


def make_key(namespace: str, version: str, *parts: object) -> str:
    raw = "|".join(str(part) for part in parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]
    return f"{PREFIX}{namespace}:{version}:{digest}"


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


def read(key: str, ttl: int) -> tuple[dict[str, Any], CacheMeta] | None:
    payload, saved_at = _read(key)
    if payload is None or saved_at is None:
        return None
    age = max(0.0, time.time() - saved_at)
    fresh = age <= ttl
    if not fresh and age > STALE_SECONDS:
        return None
    return payload, _meta(key, hit=True, fresh=fresh, age=age, ttl=ttl)


def write(key: str, payload: dict[str, Any]) -> None:
    db.set(key, {"saved_at": time.time(), "payload": payload})


def delete(key: str) -> None:
    db.delete(key)


def get_or_compute(
    key: str,
    compute: Callable[[], dict[str, Any]],
    ttl: int,
    *,
    refresh: bool = False,
) -> tuple[dict[str, Any], CacheMeta]:
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
            return stale_payload, CacheMeta(
                hit=True,
                fresh=False,
                age_seconds=stale_meta.age_seconds,
                saved_at=stale_meta.saved_at,
                ttl_seconds=ttl,
                cache_key=key,
                warning=f"served stale cache after recompute failed: {exc}",
            )
        raise
    write(key, payload)
    return payload, _meta(key, hit=False, fresh=False, age=0.0, ttl=ttl)


def stats(namespace: str) -> dict[str, Any]:
    keys = db.keys(f"{PREFIX}{namespace}:")
    base = db.stats()
    return {
        "namespace": namespace,
        "path": base.get("path"),
        "entries": len(keys),
        "keys": keys[:20],
        "db_entries": base.get("entries"),
        "db_bytes": base.get("db_bytes"),
    }


def clear(namespace: str) -> int:
    removed = 0
    for key in db.keys(f"{PREFIX}{namespace}:"):
        db.delete(key)
        removed += 1
    return removed
