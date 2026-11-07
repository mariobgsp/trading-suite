"""The stockbitd adapter is thin, typed and never raises.

These tests pin the transport and mapping: the daemon owns cookies, refresh and
caching. The Python backend must show a clean unavailable state when the daemon
is down, and must not fall through to the legacy JWT path when the daemon is
configured and healthy.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
import requests

from app import stockbit_daemon as daemon


class FakeResponse:
    def __init__(self, status_code: int = 200, body: object | None = None) -> None:
        self.status_code = status_code
        self._body = body
        self.reason = "OK" if status_code < 400 else "Error"
        self.text = json.dumps(body) if body is not None else ""

    def json(self) -> object:
        if self._body is None:
            raise ValueError("no json")
        return self._body


@pytest.fixture(autouse=True)
def daemon_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STOCKBITD_URL", "http://127.0.0.1:8787")
    monkeypatch.setenv("STOCKBITD_TIMEOUT", "1")
    daemon._reset_health_cache()
    yield
    daemon._reset_health_cache()


def test_default_url_when_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("STOCKBITD_URL")
    assert daemon.base_url() == daemon.DEFAULT_URL
    assert daemon.configured() is True


def test_explicit_empty_disables_the_daemon(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STOCKBITD_URL", "")
    assert daemon.base_url() == ""
    assert daemon.configured() is False
    assert daemon.use_daemon() is False
    assert daemon.status()["code"] == "daemon_unavailable"


def test_request_raw_maps_connection_error():
    with patch.object(
        daemon.requests,
        "request",
        side_effect=requests.exceptions.ConnectionError("connection refused"),
    ):
        status, body = daemon.request_raw("GET", "/api/status")
    assert status == 503
    assert body["error"]["code"] == "daemon_unavailable"
    assert "not answering" in body["error"]["message"]


def test_request_raw_preserves_status_and_body():
    response = FakeResponse(409, {"error": {"code": "already_running", "message": "live"}})
    with patch.object(daemon.requests, "request", return_value=response):
        status, body = daemon.request_raw("POST", "/api/login/browser", payload={})
    assert status == 409
    assert body["error"]["code"] == "already_running"


def test_health_probe_is_cached():
    calls = []

    def fake_get(url, *args, **kwargs):
        calls.append(url)
        return FakeResponse(200, {"status": "ok"})

    with patch.object(daemon.requests, "get", side_effect=fake_get):
        assert daemon.healthy() is True
        assert daemon.healthy() is True
    assert len(calls) == 1


def test_use_daemon_requires_health():
    with patch.object(daemon, "configured", return_value=True), patch.object(
        daemon, "healthy", return_value=False
    ):
        assert daemon.use_daemon() is False
    with patch.object(daemon, "configured", return_value=True), patch.object(
        daemon, "healthy", return_value=True
    ):
        assert daemon.use_daemon() is True


def test_status_maps_a_connected_session():
    body = {
        "state": "connected",
        "available": True,
        "user": {"username": "trader"},
        "access": {"present": True, "expires_in_seconds": 3600, "expires_at": "2026-11-07T08:00:00Z"},
        "refresh": {"present": True, "expires_at": "2026-12-07T08:00:00Z"},
        "cookies": {"count": 7, "domains": ["stockbit.com"]},
        "session": {"path": "/tmp/session.json", "source": "browser"},
        "warnings": [],
    }
    with patch.object(daemon, "request_raw", return_value=(200, body)):
        status = daemon.status()
    assert status["available"] is True
    assert status["state"] == "connected"
    assert status["hours_left"] == 1.0
    assert status["cookies"] == 7
    assert status["source"] == "stockbitd"


def test_status_maps_daemon_down():
    body = {"error": {"code": "daemon_unavailable", "message": "not answering"}}
    with patch.object(daemon, "request_raw", return_value=(503, body)):
        status = daemon.status()
    assert status["available"] is False
    assert status["code"] == "daemon_unavailable"
    assert "not answering" in status["reason"]


def test_status_maps_reauth_error():
    body = {"error": {"code": "reauth_required", "message": "refresh token rejected"}}
    with patch.object(daemon, "request_raw", return_value=(401, body)):
        status = daemon.status()
    assert status["available"] is False
    assert status["code"] == "reauth_required"
    assert "rejected" in status["reason"]


def test_broker_summary_maps_rows():
    body = {
        "ticker": "BBCA",
        "date": "2026-11-06",
        "available": True,
        "as_of": "2026-11-07T01:00:00Z",
        "rows": [
            {
                "broker": "DH",
                "side": "buy",
                "buy_lots": 1200,
                "sell_lots": 0,
                "net_lots": 1200,
                "buy_value": 9_000_000,
                "sell_value": 0,
                "net_value": 9_000_000,
                "avg_buy_price": 9800,
            }
        ],
        "top3_concentration_pct": 44.2,
    }
    with patch.object(daemon, "request_raw", return_value=(200, body)):
        payload = daemon.broker_summary("bbca", "2026-11-06")
    assert payload["available"] is True
    assert payload["ticker"] == "BBCA"
    assert payload["count"] == 1
    assert payload["rows"][0]["broker"] == "DH"
    assert payload["rows"][0]["net_lots"] == 1200
    assert payload["source"] == "stockbitd"


def test_orderbook_snapshot_maps():
    body = {
        "ticker": "BBCA",
        "available": True,
        "bid_lots": 1000,
        "offer_lots": 500,
        "imbalance": 0.333,
        "spread_pct": 0.1,
        "levels": {"bid": 10, "offer": 10},
        "quote": {"last": 9800},
        "as_of": "2026-11-07T01:00:00Z",
    }
    with patch.object(daemon, "request_raw", return_value=(200, body)):
        payload = daemon.orderbook_snapshot("bbca")
    assert payload["available"] is True
    assert payload["bid_lots"] == 1000
    assert payload["offer_lots"] == 500
    assert payload["imbalance"] == 0.333
    assert payload["source"] == "stockbitd"


def test_broker_summary_maps_a_typed_error():
    body = {"error": {"code": "rate_limited", "message": "wait"}}
    with patch.object(daemon, "request_raw", return_value=(429, body)):
        payload = daemon.broker_summary("BBCA")
    assert payload["available"] is False
    assert payload["code"] == "rate_limited"


def test_adopt_token_posts_to_the_daemon():
    with patch.object(
        daemon,
        "request_raw",
        return_value=(200, {"state": "connected", "available": True}),
    ) as raw:
        payload = daemon.adopt_token("access", "refresh")
    assert payload["available"] is True
    raw.assert_called_once()
    args = raw.call_args.args
    assert args[0] == "POST"
    assert args[1] == "/api/session/token"
    assert raw.call_args.kwargs["payload"] == {"access_token": "access", "refresh_token": "refresh"}


def test_adopt_token_maps_an_error():
    body = {"error": {"code": "invalid_token", "message": "not a JWT"}}
    with patch.object(daemon, "request_raw", return_value=(400, body)):
        payload = daemon.adopt_token("bad")
    assert payload["available"] is False
    assert payload["code"] == "invalid_token"


def test_adopt_env_credentials(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STOCKBIT_USERNAME", "trader@example.com")
    monkeypatch.setenv("STOCKBIT_PASSWORD", "secret")
    calls = []

    def fake_raw(method, path, params=None, payload=None, timeout=None):
        calls.append((method, path, payload))
        if method == "GET":
            return 200, {"credentials": {"configured": False}}
        return 200, {"credentials": {"configured": True, "username": "trader@example.com"}}

    with patch.object(daemon, "request_raw", side_effect=fake_raw):
        result = daemon.adopt_env_credentials()
    assert result["adopted"] is True
    assert calls[1] == (
        "POST",
        "/api/session/credentials",
        {"username": "trader@example.com", "password": "secret"},
    )


def test_adopt_env_credentials_skips_an_existing_save(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STOCKBIT_USERNAME", "trader@example.com")
    monkeypatch.setenv("STOCKBIT_PASSWORD", "secret")
    with patch.object(daemon, "request_raw", return_value=(200, {"credentials": {"configured": True}})) as raw:
        result = daemon.adopt_env_credentials()
    assert result["adopted"] is False
    assert raw.call_count == 1


def test_app_stockbit_delegates_when_healthy():
    from app import stockbit

    with patch.object(stockbit.daemon, "use_daemon", return_value=True), patch.object(
        stockbit.daemon, "status", return_value={"available": True, "state": "connected"}
    ), patch.object(
        stockbit.daemon, "broker_summary", return_value={"available": True, "rows": []}
    ) as broker, patch.object(
        stockbit.daemon, "orderbook_snapshot", return_value={"available": True, "bid_lots": 1}
    ) as orderbook:
        assert stockbit.stockbit_available() is True
        assert stockbit.stockbit_status()["state"] == "connected"
        assert stockbit.broker_summary("bbca")["available"] is True
        assert stockbit.orderbook_snapshot("bbca")["available"] is True
        broker.assert_called_once()
        orderbook.assert_called_once_with("BBCA", False)


def test_app_save_jwt_delegates_to_the_daemon():
    from app import stockbit

    with patch.object(stockbit.daemon, "use_daemon", return_value=True), patch.object(
        stockbit.daemon, "adopt_token", return_value={"available": True}
    ) as adopt:
        stockbit.save_jwt("token")
        adopt.assert_called_once_with("token")


def test_app_stockbit_falls_back_when_unhealthy():
    from app import stockbit

    with patch.object(stockbit.daemon, "use_daemon", return_value=False), patch.object(
        stockbit, "load_jwt", return_value=None
    ):
        assert stockbit.stockbit_available() is False
