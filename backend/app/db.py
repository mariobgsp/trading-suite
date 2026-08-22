"""SQLite-backed cache for market data, quotes, forex, and news.

Everything fetched from external providers is cached here with a TTL, so a
yfinance/Stockbit outage never zeroes out the platform.  SQLite is the
pragmatic solo-developer store (research consensus 2026) and this runs on a
persistent host, so file-based SQLite is safe.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
import threading
import time
from datetime import UTC, datetime
from typing import Any

from app.config import CACHE_DIR

_DB_PATH = CACHE_DIR / "cache.db"
_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv_cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    fetched_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_fetched ON kv_cache(fetched_at);
"""

# One connection per thread: FastAPI runs cache calls inside
# asyncio.to_thread (real OS threads), so a single shared connection
# is a data-corruption hazard. `threading.local` gives each thread its
# own sqlite connection; WAL mode keeps concurrent readers safe.
_thread_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    conn = getattr(_thread_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(str(_DB_PATH))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        _thread_local.conn = conn
    return conn


def _now() -> float:
    return time.time()


def get(key: str) -> Any | None:
    """Return cached JSON value if present (no TTL check here)."""
    try:
        row = _get_conn().execute("SELECT value FROM kv_cache WHERE key = ?", (key,)).fetchone()
    except (sqlite3.Error, ValueError, TypeError):
        return None
    if not row:
        return None
    try:
        return json.loads(row[0])
    except (ValueError, TypeError):
        return None


def keys(prefix: str) -> list[str]:
    """All cached keys starting with prefix, ordered. Plain prefix match —
    no LIKE wildcards, so % and _ in the prefix are literal."""
    try:
        rows = (
            _get_conn()
            .execute(
                "SELECT key FROM kv_cache WHERE substr(key, 1, ?) = ? ORDER BY key",
                (len(prefix), prefix),
            )
            .fetchall()
        )
        return [r[0] for r in rows]
    except sqlite3.Error:
        return []


def get_fresh(key: str, ttl_seconds: int) -> Any | None:
    """Return cached value only if fetched within ttl_seconds."""
    try:
        row = (
            _get_conn()
            .execute("SELECT value, fetched_at FROM kv_cache WHERE key = ?", (key,))
            .fetchone()
        )
    except (sqlite3.Error, ValueError, TypeError):
        return None
    if not row:
        return None
    value, fetched_at = row
    if _now() - fetched_at > ttl_seconds:
        return None
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return None


def set(key: str, value: Any) -> None:
    """Store JSON-serializable value under key with current timestamp."""
    payload = json.dumps(value, default=str)
    with contextlib.suppress(sqlite3.Error):
        _get_conn().execute(
            "INSERT OR REPLACE INTO kv_cache (key, value, fetched_at) VALUES (?, ?, ?)",
            (key, payload, _now()),
        )
        _get_conn().commit()


def delete(key: str) -> None:
    with contextlib.suppress(sqlite3.Error):
        _get_conn().execute("DELETE FROM kv_cache WHERE key = ?", (key,))
        _get_conn().commit()


def clear() -> int:
    try:
        cur = _get_conn().execute("DELETE FROM kv_cache")
        _get_conn().commit()
        return cur.rowcount
    except (sqlite3.Error, ValueError, TypeError):
        return 0


def stats() -> dict[str, Any]:
    try:
        row = (
            _get_conn()
            .execute("SELECT COUNT(*), MIN(fetched_at), MAX(fetched_at) FROM kv_cache")
            .fetchone()
        )
        size = _DB_PATH.stat().st_size if _DB_PATH.exists() else 0
    except (sqlite3.Error, ValueError, TypeError, OSError):
        row, size = (0, None, None), 0
    return {
        "entries": row[0],
        "oldest": row[1],
        "newest": row[2],
        "db_bytes": size,
        "path": str(_DB_PATH),
    }


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def compact() -> None:
    with contextlib.suppress(sqlite3.Error):
        _get_conn().execute("VACUUM")
