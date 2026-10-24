"""Cache-first daily market dashboard.

The public surface is intentionally small:

    latest()      cached snapshot (200-ish payload) or a building state
    refresh()     start/reuse the background build
    status()      job phase, timing and errors
    cache_stats() SQLite keys, path and bytes
    clear_cache() delete only overview payloads
    warm()        startup hook
"""

from __future__ import annotations

from app.overview.snapshot import (
    archive,
    cache_stats,
    clear_cache,
    current_session,
    latest,
    refresh,
    start_build,
    status,
    warm,
)

__all__ = [
    "archive",
    "cache_stats",
    "clear_cache",
    "current_session",
    "latest",
    "refresh",
    "start_build",
    "status",
    "warm",
]
