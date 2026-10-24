"""HTTP seam for the cache-first market dashboard."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import overview

router = APIRouter(prefix="/api/overview", tags=["overview"])


@router.get("")
async def latest() -> Any:
    """Return the cached snapshot; 202 while the first build is running.

    This route must never scan the universe. The build is a background job.
    """
    payload, status_code = await asyncio.to_thread(overview.latest)
    return JSONResponse(status_code=status_code, content=payload)


@router.get("/status")
async def status() -> dict[str, Any]:
    return await asyncio.to_thread(overview.status)


@router.post("/refresh")
async def refresh() -> dict[str, Any]:
    return await asyncio.to_thread(overview.refresh)


@router.get("/cache")
async def cache() -> dict[str, Any]:
    return await asyncio.to_thread(overview.cache_stats)


@router.post("/cache/clear")
async def cache_clear() -> dict[str, Any]:
    return {"cleared": await asyncio.to_thread(overview.clear_cache)}


@router.get("/archive/{session}")
async def archive(session: str) -> dict[str, Any]:
    found = await asyncio.to_thread(overview.archive, session)
    if found is None:
        raise HTTPException(status_code=404, detail="no snapshot for that session")
    return found
