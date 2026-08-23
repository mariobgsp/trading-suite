"""Integration contract tests for the trading-suite API.

These pin the response SHAPES of the features that must not be dismantled:
D-Signal alerts, Konglo map, sector rotation (+ valid accumulation),
ownership register, and backtest (incl. tsmom + walk-forward validation).

They run against a LIVE server (default http://localhost:8000) and are
skipped when it is unreachable, so offline CI stays green:

    .venv/bin/python -m pytest tests/test_api_contracts.py -v
"""

from __future__ import annotations

import json
import os
import urllib.request

BASE = os.environ.get("TS_API_BASE", "http://localhost:8000")


def _get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=120) as r:
        return json.loads(r.read())


def _server_up() -> bool:
    try:
        _get("/api/backtest/strategies")
        return True
    except Exception:
        return False


def _require(cond: bool, msg: str) -> None:
    assert cond, f"CONTRACT BROKEN: {msg}"


# ── D-Signal alerts ────────────────────────────────────────────────────


def test_alerts_contract():
    if not _server_up():
        raise SystemExit("backend not running on " + BASE)
    d = _get("/api/alerts?limit=50")
    _require(
        {"count", "scanned", "failed", "available", "counts", "items"} <= set(d),
        "/api/alerts missing keys: count/scanned/failed/available/counts/items",
    )
    _require(
        {"premium", "breakout", "spike_pagi", "full_ladder"} == set(d["counts"]),
        "/api/alerts counts keys changed",
    )
    for item in d["items"][:10]:
        _require(
            {
                "ticker",
                "price",
                "change_percent",
                "rsi",
                "above_ma",
                "ma_ladder",
                "d_signal",
                "spike_pagi",
            }
            <= set(item),
            "/api/alerts item keys changed",
        )
        _require(
            item["d_signal"] in ("PREMIUM", "BREAKOUT", None),
            f"d_signal values changed: {item['d_signal']!r}",
        )


# ── Konglo ─────────────────────────────────────────────────────────────


def test_konglo_contract():
    if not _server_up():
        raise SystemExit("backend not running on " + BASE)
    d = _get("/api/intel/konglo")
    _require(
        {"available", "groups_counted", "tickers_mapped", "groups"} <= set(d),
        "/api/intel/konglo missing top-level keys",
    )
    _require(len(d["groups"]) > 0, "konglo groups empty")
    g = d["groups"][0]
    _require(
        {"group", "count_saham", "avg_change_percent", "net_foreign_idr", "members"}
        <= set(g),
        "konglo group keys changed",
    )
    if g["members"]:
        m = g["members"][0]
        _require(
            {"ticker", "price", "change_percent", "net_foreign_idr"} <= set(m),
            "konglo member keys changed",
        )


# ── Sector rotation + valid accumulation ──────────────────────────────


def test_rotation_contract():
    if not _server_up():
        raise SystemExit("backend not running on " + BASE)
    d = _get("/api/intel/rotation?days=20")
    _require({"days_archived", "sectors"} <= set(d), "rotation missing keys")
    for s in d["sectors"][:5]:
        _require(
            {
                "sector",
                "count",
                "gainers",
                "losers",
                "avg_change_percent",
                "avg5",
                "avg20",
                "rank",
                "rank_delta",
            }
            <= set(s),
            f"rotation sector keys changed ({s.get('sector')})",
        )
        acc = s.get("valid_accumulation") or []
        for v in acc[:5]:
            _require(
                {"ticker", "days", "price_move", "buy_share", "stage"} <= set(v),
                "valid_accumulation item keys changed",
            )
        movers = s.get("movers")
        if movers:
            for side in ("gainers", "losers"):
                for m in movers.get(side, [])[:5]:
                    _require(
                        {"ticker", "change_percent"} <= set(m),
                        f"rotation mover keys changed ({side})",
                    )


# ── Ownership register ────────────────────────────────────────────────


def test_ownership_contract():
    if not _server_up():
        raise SystemExit("backend not running on " + BASE)
    d = _get("/api/intel/ownership/BBCA")
    _require(d.get("available") is not False, "ownership BBCA marked unavailable")
    _require("shareholders" in d, "ownership missing shareholders list")
    for sh in (d.get("shareholders") or [])[:10]:
        _require(
            {"name", "shares", "percent", "category", "controlling"} <= set(sh),
            "shareholder row keys changed",
        )
    h = _get("/api/intel/ownership/BBCA/history")
    _require(
        {"snapshots", "changes"} <= set(h),
        "ownership history missing snapshots/changes",
    )
    o = _get("/api/intel/owner/holdings?name=BOGAMAS%20KARYA")
    _require(
        {"issuers_scanned", "matches"} <= set(o),
        "owner holdings lookup keys changed",
    )


# ── Backtest: strategies incl. tsmom + walk-forward validation ────────


def test_backtest_strategies_include_tsmom():
    if not _server_up():
        raise SystemExit("backend not running on " + BASE)
    d = _get("/api/backtest/strategies")
    _require("tsmom" in d["strategies"], "tsmom strategy removed")


def test_backtest_result_shape_and_validation():
    if not _server_up():
        raise SystemExit("backend not running on " + BASE)
    d = _get("/api/backtest/BBCA?strategy=buyhold&period=6mo")
    _require(
        {"trades", "equity", "stats", "validation"} <= set(d),
        "backtest result missing trades/equity/stats/validation",
    )
    v = d["validation"]
    if v is not None:
        _require(
            {"is_return_pct", "oos_return_pct", "consistent"} <= set(v),
            "walk-forward validation keys changed",
        )
        _require(isinstance(v["consistent"], bool), "consistent must be bool")
