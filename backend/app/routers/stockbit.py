"""HTTP seam for the suite's Stockbit screen: a typed proxy to stockbitd.

The daemon owns the browser login, the cookie jar and the token refresh. This
router is deliberately thin: it forwards the request, keeps the daemon's status
code and JSON, and turns a dead daemon into one designed state
(`daemon_unavailable`) rather than a stack trace.

Codes passed through or produced here: daemon_unavailable, invalid_response,
invalid_token, invalid_cookie, invalid_request, invalid_ticker, invalid_date,
reauth_required, already_running, attempt_not_found, upstream_error, not_found,
method_not_allowed, credentials_missing, credentials_invalid, invalid_credentials,
login_form_not_found.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from app import stockbit_daemon

router = APIRouter(prefix="/api/stockbit", tags=["stockbit"])

# The Stockbit proxy gets its own workers. A first plan read can occupy the
# default executor for a long time; the session panel must not wait behind it.
_PROXY_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="stockbit-proxy")


async def _run(
    method: str,
    path: str,
    params: dict[str, Any] | None,
    payload: Any,
    timeout: float,
) -> tuple[int, dict[str, Any]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _PROXY_EXECUTOR,
        partial(stockbit_daemon.request_raw, method, path, params, payload, timeout),
    )


async def _proxy(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    payload: Any = None,
    timeout: float = 15.0,
) -> JSONResponse:
    """Forward one call to the daemon.

    `asyncio.to_thread` is the same seam the intel router uses for its blocking
    requests; the daemon's own timeouts are shorter than these outer ones.
    """
    status, body = await _run(method, path, params, payload, timeout)
    return JSONResponse(status_code=status, content=body)


def _unavailable_status() -> dict[str, Any]:
    url = stockbit_daemon.base_url()
    if not url:
        error = "STOCKBITD_URL is empty; the local Stockbit companion is disabled"
        warning = "Set STOCKBITD_URL (or unset it for the default port) and restart the backend, or use the legacy JWT."
    else:
        error = "stockbitd is not answering on its local port"
        warning = "Start the local daemon with ./trading-suite run or stockbitd serve --open."
    return {
        "state": "daemon_unavailable",
        "available": False,
        "daemon_url": url,
        "error": error,
        "error_code": "daemon_unavailable",
        "warnings": [warning],
        "access": {"present": False, "expired": False},
        "refresh": {"present": False, "expired": False},
        "cookies": {"count": 0, "domains": []},
        "session": {"path": ""},
    }


@router.get("/status")
async def status() -> JSONResponse:
    """The daemon's session status, or the one designed 'not running' state."""
    code, body = await _run("GET", "/api/status", None, None, 3.0)
    if code == 200 and isinstance(body, dict) and "state" in body:
        # The page names the daemon it is forwarding to, even when the daemon
        # itself does not repeat its own URL in the status body.
        body.setdefault("daemon_url", stockbit_daemon.base_url())
        return JSONResponse(status_code=200, content=body)
    payload = _unavailable_status()
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and error.get("message"):
            payload["error"] = str(error["message"])
            payload["error_code"] = str(error.get("code") or "daemon_unavailable")
    return JSONResponse(status_code=200, content=payload)


@router.post("/login")
async def login(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Start the browser login attempt. A 409 already_running carries the live attempt."""
    return await _proxy("POST", "/api/login/browser", payload=body or {}, timeout=5.0)


@router.get("/login/{attempt_id}")
async def login_poll(attempt_id: str) -> JSONResponse:
    """Poll one login attempt."""
    return await _proxy("GET", f"/api/login/browser/{attempt_id}", timeout=5.0)


@router.post("/login/{attempt_id}/cancel")
async def login_cancel(attempt_id: str, body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Cancel one login attempt."""
    return await _proxy(
        "POST",
        f"/api/login/browser/{attempt_id}/cancel",
        payload=body or {},
        timeout=8.0,
    )


@router.post("/session/token")
async def session_token(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Adopt a pasted access token (and optional refresh token)."""
    return await _proxy("POST", "/api/session/token", payload=body, timeout=10.0)


@router.post("/session/cookies")
async def session_cookies(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Adopt a Cookie header or a JSON cookie list."""
    return await _proxy("POST", "/api/session/cookies", payload=body, timeout=10.0)


@router.post("/session/refresh")
async def session_refresh(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Force a token refresh now."""
    return await _proxy("POST", "/api/session/refresh", payload=body or {}, timeout=40.0)


@router.post("/session/credentials")
async def session_credentials(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Save the one Stockbit sign-in the daemon may reuse automatically."""
    return await _proxy("POST", "/api/session/credentials", payload=body, timeout=10.0)


@router.post("/session/credentials/clear")
async def session_credentials_clear(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Forget the saved sign-in; the current cookies stay until disconnect."""
    return await _proxy(
        "POST",
        "/api/session/credentials/clear",
        payload=body or {},
        timeout=10.0,
    )


@router.post("/logout")
async def logout(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Delete the daemon session and its browser profile."""
    return await _proxy("POST", "/api/logout", payload=body or {}, timeout=10.0)


@router.get("/symbol/{ticker}")
async def symbol(ticker: str, refresh: bool = Query(False)) -> JSONResponse:
    """Quote, info, orderbook and broker rows for one ticker."""
    params = {"refresh": "1"} if refresh else None
    return await _proxy("GET", f"/api/data/symbol/{ticker}", params=params, timeout=40.0)


@router.get("/brokers/{ticker}")
async def brokers(
    ticker: str,
    date: str | None = Query(None),
    refresh: bool = Query(False),
) -> JSONResponse:
    """The per-broker net rows for one date."""
    params: dict[str, Any] = {}
    if date:
        params["date"] = date
    if refresh:
        params["refresh"] = "1"
    return await _proxy("GET", f"/api/data/brokers/{ticker}", params=params or None, timeout=30.0)


@router.get("/orderbook/{ticker}")
async def orderbook(ticker: str, refresh: bool = Query(False)) -> JSONResponse:
    """Depth and quote for one ticker."""
    params = {"refresh": "1"} if refresh else None
    return await _proxy("GET", f"/api/data/orderbook/{ticker}", params=params, timeout=25.0)


@router.get("/watchlist")
async def watchlist(refresh: bool = Query(False)) -> JSONResponse:
    """The personal watchlist groups and items."""
    params = {"refresh": "1"} if refresh else None
    return await _proxy("GET", "/api/data/watchlist", params=params, timeout=30.0)


@router.get("/cache")
async def cache() -> JSONResponse:
    """The daemon's read cache counters."""
    return await _proxy("GET", "/api/cache", timeout=5.0)


@router.post("/cache/clear")
async def cache_clear(body: dict[str, Any] = Body(default={})) -> JSONResponse:
    """Clear the daemon's read cache; the session file is untouched."""
    return await _proxy("POST", "/api/cache/clear", payload=body or {}, timeout=8.0)
