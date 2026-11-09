"""The invest case: two pillars, a count as verdict, and honest absences."""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException

from app import case, computed_cache
from app.main import app
from app.routers import case as case_router


@pytest.fixture(autouse=True)
def _clear_case_cache():
    computed_cache.clear("case")
    yield
    computed_cache.clear("case")


def _structure_raw(controlling=60.0, public=10.0, shares=1e11) -> dict:
    return {
        "structure": {
            "available": True,
            "shareholders": [
                {
                    "name": "PT Owner",
                    "shares": shares * controlling / 100.0,
                    "percent": controlling,
                    "controlling": True,
                },
                {
                    "name": "Public Fund",
                    "shares": shares * public / 100.0,
                    "percent": public,
                    "controlling": False,
                },
            ],
        },
        "history": {
            "available": True,
            "snapshots": [
                {
                    "date": "2026-03-14",
                    "holders": [{"name": "PT Owner", "percent": 58.0, "controlling": True}],
                },
                {
                    "date": "2026-11-09",
                    "holders": [{"name": "PT Owner", "percent": 60.0, "controlling": True}],
                },
            ],
            "changes": {"entered": [{"name": "A"}], "exited": []},
        },
    }


def _bars(n: int = 300) -> pd.DataFrame:
    close = np.linspace(100.0, 180.0, n)
    return pd.DataFrame({"Close": close}, index=pd.bdate_range("2024-01-01", periods=n))


def _empty_feed() -> dict:
    return {"available": True, "items": [], "warnings": []}


# ── verdict ─────────────────────────────────────────────────────────────────


def test_verdict_is_a_count_not_a_prediction():
    def criterion(state: str) -> dict:
        return {"key": state, "label": state, "display": "", "state": state, "detail": ""}

    assert case.verdict([criterion("unknown")])["state"] == "unknown"
    assert (
        case.verdict([criterion("supportive")] * 4 + [criterion("caution")])["state"]
        == "supportive"
    )
    assert (
        case.verdict([criterion("supportive")] * 3 + [criterion("against")] * 2)["state"] == "weak"
    )
    assert case.verdict([criterion("supportive")] * 3 + [criterion("caution")])["state"] == "mixed"


# ── fundamentals ────────────────────────────────────────────────────────────


def test_fundamental_pillar_reads_the_company_and_the_stake_trend():
    info = {
        "trailingPE": 18.0,
        "priceToBook": 2.5,
        "returnOnEquity": 0.18,
        "profitMargins": 0.22,
        "debtToEquity": 45.6,
        "revenueGrowth": 0.11,
        "sharesOutstanding": 1e11,
    }
    structure = case._share_structure(_structure_raw(), info)
    pillar = case._fundamental_pillar(info, structure)
    by_key = {criterion["key"]: criterion for criterion in pillar["criteria"]}

    assert pillar["available"] is True
    assert by_key["pe"]["state"] == "supportive"
    assert by_key["leverage"]["display"] == "0.46×"  # percent units normalised once
    assert by_key["stake_trend"]["state"] == "supportive"
    assert by_key["stake_trend"]["display"].startswith("rising +2.00 pp")
    assert pillar["verdict"]["measured"] == 7


def test_fundamental_pillar_without_company_info_stays_unknown():
    structure = case._empty_structure(["no register"])
    pillar = case._fundamental_pillar({}, structure)
    assert pillar["available"] is False
    assert pillar["verdict"]["state"] == "unknown"
    assert any("yfinance" in warning for warning in pillar["warnings"])


# ── ownership ───────────────────────────────────────────────────────────────


def test_share_structure_splits_owner_and_public():
    info = {"sharesOutstanding": 1e11}
    structure = case._share_structure(_structure_raw(), info)

    assert structure["available"] is True
    assert structure["shares_outstanding"] == 1e11
    assert structure["owner_pct"] == 60.0
    assert structure["owner_shares"] == 6e10
    assert structure["public_pct"] == 40.0
    assert structure["public_shares"] == 4e10
    assert structure["trend"] == "rising"
    assert structure["delta_pp"] == 2.0
    assert structure["holders_entered"] == 1


def test_share_structure_derives_total_from_a_published_holder():
    structure = case._share_structure(_structure_raw(), {})
    assert structure["shares_outstanding"] == 1e11
    assert structure["total_source"] == "derived from PT Owner"


def test_share_structure_trend_needs_two_snapshots():
    raw = _structure_raw()
    raw["history"]["snapshots"] = raw["history"]["snapshots"][:1]
    structure = case._share_structure(raw, {"sharesOutstanding": 1e11})
    assert structure["trend"] == "unknown"
    assert structure["delta_pp"] is None
    assert any("second visit" in warning for warning in structure["warnings"])


def test_share_structure_reports_an_unreachable_register():
    structure = case._share_structure(
        {"structure": {"available": False, "error": "IDX unavailable"}, "history": {}},
        {"sharesOutstanding": 1e11},
    )
    assert structure["available"] is False
    assert "IDX ownership did not answer" in structure["warnings"][0]
    # The register is down but the share count is still knowable.
    assert structure["shares_outstanding"] == 1e11
    assert structure["total_source"] == "yfinance"


# ── technicals ──────────────────────────────────────────────────────────────


def test_technical_pillar_reads_the_flow_card(monkeypatch):
    card = SimpleNamespace(
        price=180.0,
        as_of="2026-11-09",
        value_5d_idr=8_000_000_000.0,
        technicals={
            "supertrend": "bull",
            "kumo": "above",
            "rsi14": 58.0,
            "above_ma50": True,
            "from_52w_high_pct": -4.0,
        },
        flow={"direction": "rising"},
        warnings=(),
    )
    monkeypatch.setattr(case, "build_card", lambda code: card)
    monkeypatch.setattr(case.flow_sources, "bars", lambda code: _bars())

    pillar = case._technical_pillar("BBCA")
    by_key = {criterion["key"]: criterion for criterion in pillar["criteria"]}

    assert pillar["available"] is True
    assert pillar["as_of"] == "2026-11-09"
    assert by_key["trend_long"]["state"] == "supportive"
    assert by_key["structure"]["display"] == "bull / above"
    assert by_key["liquidity"]["display"] == "Rp 8.0 M"
    assert pillar["verdict"]["state"] == "supportive"


def test_technical_pillar_without_history_says_so(monkeypatch):
    monkeypatch.setattr(case, "build_card", lambda code: None)
    pillar = case._technical_pillar("NOPE")
    assert pillar["available"] is False
    assert pillar["criteria"] == []
    assert "not enough price history" in pillar["warnings"][0]


# ── disclosures and news ────────────────────────────────────────────────────


def test_disclosures_map_the_idx_feed(monkeypatch):
    monkeypatch.setattr(
        case.idx_service,
        "announcements",
        lambda **kwargs: {
            "available": True,
            "items": [
                {
                    "title": "RUPST 2026",
                    "category": "Rapat Umum Pemegang Saham",
                    "date": "2026-11-07 10:00:00",
                    "link": "https://idx.co.id/a.pdf",
                    "ticker": "BBCA",
                }
            ],
        },
    )
    feed = case._disclosures("BBCA")
    assert feed["available"] is True
    assert feed["items"][0]["title"] == "RUPST 2026"
    assert feed["items"][0]["link"] == "https://idx.co.id/a.pdf"


def test_disclosures_are_unavailable_when_idx_is(monkeypatch):
    monkeypatch.setattr(
        case.idx_service,
        "announcements",
        lambda **kwargs: {"available": True, "items": [], "error": "IDX unavailable"},
    )
    feed = case._disclosures("BBCA")
    assert feed["available"] is False
    assert feed["warnings"] == ["IDX KI did not answer: IDX unavailable"]


def test_news_maps_the_ticker_feed(monkeypatch):
    monkeypatch.setattr(
        case.sentiment,
        "fetch_ticker_news",
        lambda code, name, force=False: {
            "available": True,
            "items": [
                {
                    "title": "BBCA cetak laba",
                    "source": "Kontan",
                    "date": "2026-11-08T10:00:00+00:00",
                    "date_str": "08 Nov 10:00",
                    "link": "https://kontan.co.id/x",
                }
            ],
            "warnings": [],
        },
    )
    feed = case._news("BBCA", "Bank Central Asia")
    assert feed["available"] is True
    assert feed["items"][0]["source"] == "Kontan"


# ── assembly ────────────────────────────────────────────────────────────────


def test_assess_caches_one_computation(monkeypatch):
    calls = {"n": 0}

    def info(code, refresh=False):
        calls["n"] += 1
        return {"sharesOutstanding": 1e11, "trailingPE": 18.0}

    monkeypatch.setattr(case, "_info", info)
    monkeypatch.setattr(case, "_ownership_raw", lambda code, refresh=False: _structure_raw())
    monkeypatch.setattr(
        case,
        "_technical_pillar",
        lambda code: case._unavailable_pillar("technical", "stubbed out"),
    )
    monkeypatch.setattr(case, "_disclosures", lambda code, refresh=False: _empty_feed())
    monkeypatch.setattr(case, "_news", lambda code, name, refresh=False: _empty_feed())

    first = case.assess("ZZZZ")
    second = case.assess("ZZZZ")

    assert calls["n"] == 1
    assert first["ticker"] == "ZZZZ"
    assert first["fundamental"]["available"] is True
    assert second["cache"]["hit"] is True


def test_assess_degrades_when_every_source_is_down(monkeypatch):
    monkeypatch.setattr(case, "_info", lambda code, refresh=False: {})
    monkeypatch.setattr(
        case,
        "_ownership_raw",
        lambda code, refresh=False: {"structure": {"available": False}, "history": {}},
    )
    monkeypatch.setattr(
        case,
        "_technical_pillar",
        lambda code: case._unavailable_pillar("technical", "no bars"),
    )
    monkeypatch.setattr(case, "_disclosures", lambda code, refresh=False: _empty_feed())
    monkeypatch.setattr(case, "_news", lambda code, name, refresh=False: _empty_feed())

    report = case.assess("ZZZZ")

    assert report["available"] is False
    assert report["fundamental"]["verdict"]["state"] == "unknown"
    assert report["technical"]["available"] is False
    assert report["ownership"]["available"] is False
    assert report["disclosures"]["available"] is True
    assert report["news"]["available"] is True


def test_assess_rejects_a_non_ticker():
    with pytest.raises(ValueError):
        case.assess("BAD")


def test_news_with_deadline_gives_up(monkeypatch):
    monkeypatch.setattr(case, "NEWS_DEADLINE", 0.05)
    gate = threading.Event()
    monkeypatch.setattr(case, "_news", lambda code, name, refresh=False: gate.wait(2) or {})
    try:
        feed = case._news_with_deadline("BBCA", "", False)
    finally:
        gate.set()
    assert feed["available"] is False
    assert "did not answer" in feed["warnings"][0]


# ── HTTP seam ───────────────────────────────────────────────────────────────


def test_case_path_is_mounted():
    assert "/api/case/{ticker}" in app.openapi()["paths"]


def test_case_route_rejects_a_bad_ticker():
    with pytest.raises(HTTPException) as caught:
        asyncio.run(case_router.assess_case("BAD!", False))
    assert caught.value.status_code == 422


def test_case_route_delegates(monkeypatch):
    expected = {"ticker": "BBCA", "available": True}
    monkeypatch.setattr(case, "assess", lambda code, refresh: expected)
    assert asyncio.run(case_router.assess_case("bbca", False)) == expected
