"""The suite's Stockbit proxy is a thin, typed pass-through.

The daemon owns the session and its status codes; this router must preserve
them and turn a dead daemon into one designed state, not a 500. The React page
depends on both behaviours.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import pytest

from app.main import app
from app.routers import stockbit as router_mod


@pytest.fixture(autouse=True)
def daemon_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STOCKBITD_URL", "http://127.0.0.1:8787")


def call(coro):
    return asyncio.run(coro)


def body(response) -> dict:
    return json.loads(response.body)


def test_stockbit_paths_are_mounted():
    paths = app.openapi()["paths"]
    for path in (
        "/api/stockbit/status",
        "/api/stockbit/login",
        "/api/stockbit/login/{attempt_id}",
        "/api/stockbit/login/{attempt_id}/cancel",
        "/api/stockbit/session/token",
        "/api/stockbit/session/cookies",
        "/api/stockbit/session/refresh",
        "/api/stockbit/session/credentials",
        "/api/stockbit/session/credentials/clear",
        "/api/stockbit/logout",
        "/api/stockbit/symbol/{ticker}",
        "/api/stockbit/brokers/{ticker}",
        "/api/stockbit/orderbook/{ticker}",
        "/api/stockbit/watchlist",
        "/api/stockbit/cache",
        "/api/stockbit/cache/clear",
    ):
        assert path in paths, path


def test_status_passes_through_connected():
    payload = {"state": "connected", "available": True, "cookies": {"count": 4, "domains": ["stockbit.com"]}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(200, payload)) as raw:
        response = call(router_mod.status())
    assert response.status_code == 200
    assert body(response)["state"] == "connected"
    assert raw.call_args.args[1] == "/api/status"


def test_status_turns_a_dead_daemon_into_the_designed_state():
    error = {"error": {"code": "daemon_unavailable", "message": "connection refused"}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(503, error)):
        response = call(router_mod.status())
    payload = body(response)
    assert response.status_code == 200
    assert payload["state"] == "daemon_unavailable"
    assert payload["available"] is False
    assert payload["error_code"] == "daemon_unavailable"
    assert "connection refused" in payload["error"]
    assert payload["daemon_url"].startswith("http")


def test_login_start_keeps_the_202_and_the_attempt():
    payload = {"attempt": {"id": "abc", "state": "starting"}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(202, payload)) as raw:
        response = call(router_mod.login({}))
    assert response.status_code == 202
    assert body(response)["attempt"]["id"] == "abc"
    assert raw.call_args.args[1] == "/api/login/browser"


def test_login_forwards_the_manual_flag():
    payload = {"attempt": {"id": "abc", "state": "starting", "auto": False}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(202, payload)) as raw:
        response = call(router_mod.login({"manual": True}))
    assert response.status_code == 202
    assert raw.call_args.args[3] == {"manual": True}


def test_credentials_save_proxies():
    payload = {"credentials": {"configured": True, "username": "trader", "source": "file"}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(200, payload)) as raw:
        response = call(router_mod.session_credentials({"username": "trader", "password": "secret"}))
    assert response.status_code == 200
    assert body(response)["credentials"]["configured"] is True
    assert raw.call_args.args[1] == "/api/session/credentials"
    assert raw.call_args.args[3] == {"username": "trader", "password": "secret"}


def test_credentials_clear_proxies():
    payload = {"credentials": {"configured": False}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(200, payload)) as raw:
        response = call(router_mod.session_credentials_clear({}))
    assert response.status_code == 200
    assert body(response)["credentials"]["configured"] is False
    assert raw.call_args.args[1] == "/api/session/credentials/clear"


def test_login_start_keeps_409_already_running():
    payload = {"error": {"code": "already_running", "message": "live"}, "attempt": {"id": "abc"}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(409, payload)):
        response = call(router_mod.login({}))
    assert response.status_code == 409
    assert body(response)["error"]["code"] == "already_running"


def test_login_poll_keeps_404():
    payload = {"error": {"code": "attempt_not_found", "message": "gone"}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(404, payload)) as raw:
        response = call(router_mod.login_poll("missing"))
    assert response.status_code == 404
    assert body(response)["error"]["code"] == "attempt_not_found"
    assert raw.call_args.args[1] == "/api/login/browser/missing"


def test_login_cancel_proxies():
    payload = {"attempt": {"id": "abc", "state": "cancelled"}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(200, payload)) as raw:
        response = call(router_mod.login_cancel("abc", {}))
    assert response.status_code == 200
    assert body(response)["attempt"]["state"] == "cancelled"
    assert raw.call_args.args[1] == "/api/login/browser/abc/cancel"


def test_token_proxy_keeps_the_validation_error():
    payload = {"error": {"code": "invalid_token", "message": "not a JWT"}}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(400, payload)) as raw:
        response = call(router_mod.session_token({"access_token": "bad"}))
    assert response.status_code == 400
    assert body(response)["error"]["code"] == "invalid_token"
    assert raw.call_args.args[3] == {"access_token": "bad"}


def test_cookies_proxy_forwards_the_body():
    payload = {"state": "connected", "available": True}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(200, payload)) as raw:
        response = call(router_mod.session_cookies({"cookie": "credentialStorage=x"}))
    assert response.status_code == 200
    assert raw.call_args.args[1] == "/api/session/cookies"
    assert raw.call_args.args[3] == {"cookie": "credentialStorage=x"}


def test_symbol_forwards_refresh():
    payload = {"ticker": "BBCA", "available": True}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(200, payload)) as raw:
        response = call(router_mod.symbol("BBCA", True))
    assert response.status_code == 200
    assert raw.call_args.args[1] == "/api/data/symbol/BBCA"
    assert raw.call_args.args[2] == {"refresh": "1"}


def test_brokers_forwards_the_date():
    payload = {"ticker": "BBCA", "date": "2026-11-06", "available": True}
    with patch.object(router_mod.stockbit_daemon, "request_raw", return_value=(200, payload)) as raw:
        response = call(router_mod.brokers("BBCA", "2026-11-06", False))
    assert response.status_code == 200
    assert raw.call_args.args[1] == "/api/data/brokers/BBCA"
    assert raw.call_args.args[2] == {"date": "2026-11-06"}


def test_watchlist_and_cache_proxies():
    with patch.object(
        router_mod.stockbit_daemon, "request_raw", return_value=(200, {"available": True, "items": []})
    ) as raw:
        response = call(router_mod.watchlist(False))
    assert response.status_code == 200
    assert raw.call_args.args[1] == "/api/data/watchlist"

    with patch.object(
        router_mod.stockbit_daemon, "request_raw", return_value=(200, {"entries": 0})
    ) as raw:
        response = call(router_mod.cache())
    assert response.status_code == 200
    assert raw.call_args.args[1] == "/api/cache"

    with patch.object(
        router_mod.stockbit_daemon, "request_raw", return_value=(200, {"cleared": 2})
    ) as raw:
        response = call(router_mod.cache_clear({}))
    assert response.status_code == 200
    assert body(response)["cleared"] == 2
    assert raw.call_args.args[1] == "/api/cache/clear"


def test_session_refresh_and_logout_proxies():
    with patch.object(
        router_mod.stockbit_daemon, "request_raw", return_value=(200, {"state": "connected"})
    ) as raw:
        response = call(router_mod.session_refresh({}))
    assert response.status_code == 200
    assert raw.call_args.args[1] == "/api/session/refresh"

    with patch.object(
        router_mod.stockbit_daemon, "request_raw", return_value=(200, {"state": "unconfigured"})
    ) as raw:
        response = call(router_mod.logout({}))
    assert response.status_code == 200
    assert raw.call_args.args[1] == "/api/logout"
