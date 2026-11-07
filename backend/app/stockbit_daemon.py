"""Adapter and HTTP client for the local stockbitd session keeper.

The daemon owns the Stockbit cookie jar, token refresh and browser login. This
module is the suite's only client of it:

  * `request_raw` is the transport seam used by `app/routers/stockbit.py` to
    proxy the daemon's JSON to the React Stockbit screen.
  * `status`, `available`, `broker_summary` and `orderbook_snapshot` map the
    daemon payload back to the shapes Flow and the intel surfaces already use.
  * `healthy` / `use_daemon` decide whether the Python data paths should use
    the daemon at all; when it is down they fall back to the legacy JWT path.

Every function returns a dict (or a status tuple) and never raises. A daemon
outage is a typed unavailable payload, exactly like an upstream Stockbit outage.

Codes and states surfaced here: daemon_unavailable, unconfigured, connected,
reauth_required, invalid_response.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

import requests

DEFAULT_URL = "http://127.0.0.1:8787"
DEFAULT_TIMEOUT = 8.0
HEALTH_TTL_SECONDS = 3.0

_HEALTH_LOCK = threading.Lock()
_HEALTH_AT = 0.0
_HEALTH_OK = False


def base_url() -> str:
    """The daemon URL: default local port unless explicitly disabled.

    An unset STOCKBITD_URL means "use the local daemon"; an explicitly empty
    value is the documented switch that turns the daemon off and leaves the
    legacy JWT path in charge.
    """
    raw = os.getenv("STOCKBITD_URL")
    if raw is None:
        return DEFAULT_URL
    return raw.strip().rstrip("/")


def configured() -> bool:
    return bool(base_url())


def _timeout() -> float:
    try:
        return max(1.0, float(os.getenv("STOCKBITD_TIMEOUT", str(DEFAULT_TIMEOUT))))
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT


def _json(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _reset_health_cache() -> None:
    """Tests and an explicit reconnect can force a fresh probe."""
    global _HEALTH_AT, _HEALTH_OK
    with _HEALTH_LOCK:
        _HEALTH_AT = 0.0
        _HEALTH_OK = False


def _remember_health(ok: bool) -> None:
    global _HEALTH_AT, _HEALTH_OK
    with _HEALTH_LOCK:
        _HEALTH_AT = time.monotonic()
        _HEALTH_OK = ok


def healthy() -> bool:
    """Whether the daemon answers /api/health, cached for a few seconds.

    This is deliberately not the session state: a healthy daemon with an
    expired Stockbit login is still the right data source, because its typed
    reauth_required payload must reach the caller instead of silently falling
    back to a stale JWT.
    """
    if not configured():
        return False
    with _HEALTH_LOCK:
        if time.monotonic() - _HEALTH_AT < HEALTH_TTL_SECONDS:
            return _HEALTH_OK
    ok = False
    try:
        response = requests.get(base_url() + "/api/health", timeout=1.5)
        ok = response.status_code == 200 and isinstance(_json(response), dict)
    except requests.RequestException:
        ok = False
    _remember_health(ok)
    return ok


def use_daemon() -> bool:
    """True when the configured daemon is reachable right now."""
    return configured() and healthy()


def _error_payload(code: str, message: str) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message[:300]},
        "daemon_url": base_url(),
    }


def request_raw(
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
    payload: Any = None,
    timeout: float | None = None,
) -> tuple[int, dict[str, Any]]:
    """Send one request to the daemon and return (HTTP status, JSON body).

    The proxy keeps the daemon's status code so the browser sees the same
    typed error (already_running, reauth_required, rate_limited, ...) the
    daemon produced.
    """
    if not configured():
        return 503, _error_payload("daemon_unavailable", "STOCKBITD_URL is empty; start stockbitd or set the URL")
    url = base_url() + path
    try:
        response = requests.request(
            method,
            url,
            params=params or None,
            json=payload,
            timeout=timeout or _timeout(),
        )
    except requests.RequestException as exc:
        _remember_health(False)
        return 503, _error_payload("daemon_unavailable", f"stockbitd is not answering: {exc}")
    body = _json(response)
    if not isinstance(body, dict):
        return 502, _error_payload("invalid_response", "stockbitd returned a non-object body")
    if response.status_code < 400:
        _remember_health(True)
    return response.status_code, body


def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """GET one daemon endpoint, mapping every failure to a dict."""
    status, body = request_raw("GET", path, params=params)
    if status >= 400:
        error = body.get("error") if isinstance(body, dict) else {}
        if not isinstance(error, dict):
            error = {}
        return {
            "available": False,
            "error": str(error.get("message") or f"stockbitd returned HTTP {status}")[:300],
            "code": str(error.get("code") or "daemon_unavailable"),
            "daemon_url": base_url(),
        }
    return body


def status() -> dict[str, Any]:
    """Legacy-shaped Stockbit status backed by the daemon."""
    body = _get("/api/status")
    if "state" not in body:
        return {
            "available": False,
            "state": "unavailable",
            "reason": body.get("error") or "stockbitd is unavailable",
            "code": body.get("code") or "daemon_unavailable",
            "source": "stockbitd",
            "daemon_url": base_url(),
        }
    access = body.get("access") or {}
    refresh = body.get("refresh") or {}
    state = str(body.get("state") or "unconfigured")
    available = state == "connected" and bool(body.get("available"))
    seconds = access.get("expires_in_seconds") if isinstance(access, dict) else None
    try:
        hours = round(float(seconds) / 3600, 1) if seconds is not None else None
    except (TypeError, ValueError):
        hours = None
    reason: str | None = None
    if not available:
        reason = str(body.get("reauth_reason") or body.get("error") or f"stockbitd state: {state}")
    return {
        "available": available,
        "state": state,
        "reason": reason,
        "source": "stockbitd",
        "daemon_url": base_url(),
        "hours_left": hours,
        "exp": access.get("expires_at") if isinstance(access, dict) else None,
        "refresh_expires_at": refresh.get("expires_at") if isinstance(refresh, dict) else None,
        "cookies": (body.get("cookies") or {}).get("count") if isinstance(body.get("cookies"), dict) else None,
        "user": body.get("user"),
        "warnings": body.get("warnings") or [],
    }


def available() -> bool:
    return bool(status().get("available"))


def adopt_token(access: str, refresh: str = "") -> dict[str, Any]:
    """Hand a pasted access token to the daemon, so one login path works."""
    status_code, body = request_raw(
        "POST",
        "/api/session/token",
        payload={"access_token": access, "refresh_token": refresh},
    )
    if status_code >= 400:
        error = body.get("error") if isinstance(body, dict) else {}
        if not isinstance(error, dict):
            error = {}
        return {
            "available": False,
            "error": str(error.get("message") or f"stockbitd returned HTTP {status_code}"),
            "code": str(error.get("code") or "invalid_response"),
        }
    body["available"] = str(body.get("state") or "") == "connected"
    return body


def adopt_env_credentials() -> dict[str, Any]:
    """Copy STOCKBIT_USERNAME/PASSWORD into the daemon once.

    The suite's .env is read by this Python process, not by the Go daemon the
    runner starts. This bridge makes a legacy .env sign-in available to the
    automatic login without asking the user to type it again. An existing saved
    sign-in always wins; the values are sent only over the loopback proxy and
    are never logged or returned.

    Codes this can surface: credentials_invalid, daemon_unavailable.
    """
    username = (os.getenv("STOCKBIT_USERNAME") or os.getenv("STOCKBIT_EMAIL") or "").strip()
    password = os.getenv("STOCKBIT_PASSWORD") or ""
    if not username or not password:
        return {"adopted": False, "reason": "STOCKBIT_USERNAME/PASSWORD are not set"}
    status_code, body = request_raw("GET", "/api/status", timeout=2.0)
    if status_code == 200 and isinstance(body, dict):
        existing = body.get("credentials") or {}
        if isinstance(existing, dict) and existing.get("configured"):
            return {"adopted": False, "reason": "the daemon already has a saved sign-in"}
    status_code, body = request_raw(
        "POST",
        "/api/session/credentials",
        payload={"username": username, "password": password},
        timeout=8.0,
    )
    if status_code >= 400:
        error = body.get("error") if isinstance(body, dict) else {}
        if not isinstance(error, dict):
            error = {}
        return {
            "adopted": False,
            "code": str(error.get("code") or "daemon_unavailable"),
            "reason": str(error.get("message") or "the daemon rejected the sign-in"),
        }
    return {"adopted": True}


def broker_summary(ticker: str, date: str | None = None, force: bool = False) -> dict[str, Any]:
    """Per-ticker broker rows in the shape app.stockbit already returns."""
    params: dict[str, Any] = {}
    if date:
        params["date"] = date
    if force:
        params["refresh"] = "1"
    body = _get(f"/api/data/brokers/{ticker.upper().strip()}", params or None)
    if "rows" not in body:
        return {
            "ticker": ticker.upper().strip(),
            "date": date,
            "available": False,
            "error": body.get("error") or "stockbitd returned no broker payload",
            "code": body.get("code") or "invalid_response",
            "source": "stockbitd",
        }
    rows: list[dict[str, Any]] = []
    for row in body.get("rows") or []:
        if not isinstance(row, dict):
            continue
        rows.append(
            {
                "broker": row.get("broker"),
                "buy_lots": row.get("buy_lots") or 0,
                "sell_lots": row.get("sell_lots") or 0,
                "net_lots": row.get("net_lots") or 0,
                "buy_value": row.get("buy_value") or 0,
                "sell_value": row.get("sell_value") or 0,
                "net_value": row.get("net_value") or 0,
                "type": row.get("type") or row.get("side") or "",
            }
        )
    return {
        "ticker": body.get("ticker") or ticker.upper().strip(),
        "date": body.get("date") or date,
        "available": bool(body.get("available")),
        "as_of": body.get("as_of"),
        "count": len(rows),
        "rows": rows,
        "top3_concentration_pct": body.get("top3_concentration_pct"),
        "detector": body.get("detector"),
        "warnings": body.get("warnings") or [],
        "source": "stockbitd",
        "note": "Broker rows from the local stockbitd session keeper.",
    }


def orderbook_snapshot(ticker: str, force: bool = False) -> dict[str, Any]:
    """Bid/offer imbalance in the shape app.stockbit already returns."""
    params = {"refresh": "1"} if force else None
    body = _get(f"/api/data/orderbook/{ticker.upper().strip()}", params)
    if "bid_lots" not in body:
        return {
            "ticker": ticker.upper().strip(),
            "available": False,
            "error": body.get("error") or "stockbitd returned no orderbook payload",
            "code": body.get("code") or "invalid_response",
            "source": "stockbitd",
        }
    return {
        "ticker": body.get("ticker") or ticker.upper().strip(),
        "available": bool(body.get("available")),
        "bid_lots": body.get("bid_lots") or 0,
        "offer_lots": body.get("offer_lots") or 0,
        "imbalance": body.get("imbalance"),
        "spread_pct": body.get("spread_pct"),
        "levels": body.get("levels") or {"bid": 0, "offer": 0},
        "quote": body.get("quote"),
        "as_of": body.get("as_of"),
        "source": "stockbitd",
    }
