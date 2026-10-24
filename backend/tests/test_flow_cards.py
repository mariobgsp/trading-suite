"""The card scan is bounded, degrades visibly, and never invents a source."""

from __future__ import annotations

import importlib

import numpy as np
import pandas as pd
import pytest

from app.flow import cache as flow_cache
from app.flow import sources

cards = importlib.import_module("app.flow.cards")


@pytest.fixture(autouse=True)
def _clear_flow_cache():
    flow_cache.clear()


def _bars(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(5)
    close = 100.0 * np.exp(np.cumsum(rng.normal(0.0004, 0.01, n)))
    index = pd.bdate_range("2024-01-01", periods=n)
    return pd.DataFrame(
        {
            "Open": close * (1.0 + rng.normal(0.0, 0.002, n)),
            "High": close * (1.0 + np.abs(rng.normal(0.0, 0.006, n))),
            "Low": close * (1.0 - np.abs(rng.normal(0.0, 0.006, n))),
            "Close": close,
            "Volume": rng.integers(1_000_000, 5_000_000, n).astype(float),
        },
        index=index,
    )


def test_cards_screen_a_bounded_universe(monkeypatch):
    monkeypatch.setattr(sources, "name_map", lambda: {"AAA": "Alpha", "BBB": "Beta"})
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": _bars())
    monkeypatch.setattr(
        sources,
        "foreign_map",
        lambda: (
            {"AAA": 5_000_000_000.0},
            {"available": True, "as_of": _bars().index[-1].isoformat()},
        ),
    )

    out = cards.cards(universe="tickers", tickers="AAA,BBB", limit=2, source="auto")
    assert out["available"] is True
    assert out["count"] == 2
    assert out["source"]["quality"] == "proxy"
    by_ticker = {card["ticker"]: card for card in out["cards"]}
    assert by_ticker["AAA"]["name"] == "Alpha"
    assert by_ticker["AAA"]["technicals"]["rsi14"] is not None
    assert by_ticker["AAA"]["flow"]["direction"] in {"rising", "falling", "flat", "unavailable"}
    assert by_ticker["AAA"]["flow"]["quality"] == "proxy"
    assert "buy" not in by_ticker["AAA"]


def test_second_cards_call_is_served_from_cache(monkeypatch):
    calls = {"n": 0}
    monkeypatch.setattr(sources, "name_map", lambda: {})

    def _bars_once(code, period="1y"):
        calls["n"] += 1
        return _bars()

    monkeypatch.setattr(sources, "bars", _bars_once)
    monkeypatch.setattr(
        sources,
        "foreign_map",
        lambda: ({"AAA": 5_000_000_000.0}, {"available": True, "as_of": _bars().index[-1].isoformat()}),
    )

    first = cards.cards(universe="tickers", tickers="AAA", limit=1, source="auto")
    second = cards.cards(universe="tickers", tickers="AAA", limit=1, source="auto")
    assert first["cache"]["hit"] is False
    assert second["cache"]["hit"] is True
    assert calls["n"] == 1

    refreshed = cards.cards(
        universe="tickers", tickers="AAA", limit=1, source="auto", refresh=True
    )
    assert refreshed["cache"]["hit"] is False
    assert calls["n"] == 2


def test_cards_do_not_paint_stale_foreign_flow(monkeypatch):
    monkeypatch.setattr(sources, "name_map", lambda: {})
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": _bars())
    monkeypatch.setattr(
        sources,
        "foreign_map",
        lambda: ({"AAA": 5_000_000_000.0}, {"available": True, "as_of": "2020-01-01"}),
    )
    out = cards.cards(universe="tickers", tickers="AAA", limit=1, source="auto")
    card = out["cards"][0]
    assert card["source"]["flow"] == "ohlcv+cmf"
    assert any("stale" in warning for warning in card["warnings"])


def test_cards_skip_names_without_history_and_warn(monkeypatch):
    monkeypatch.setattr(sources, "name_map", lambda: {})
    monkeypatch.setattr(
        sources,
        "bars",
        lambda code, period="1y": _bars() if code == "AAA" else pd.DataFrame(),
    )
    monkeypatch.setattr(sources, "foreign_map", lambda: ({}, {"available": False}))

    out = cards.cards(universe="tickers", tickers="AAA,BAD", limit=2, source="auto")
    assert out["count"] == 1
    assert out["cards"][0]["ticker"] == "AAA"
    assert any("BAD" in warning for warning in out["warnings"])


def test_ohlcv_source_does_not_call_the_foreign_feed(monkeypatch):
    monkeypatch.setattr(sources, "name_map", lambda: {})
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": _bars())

    def _boom():
        raise AssertionError("foreign feed must not be called for source=ohlcv")

    monkeypatch.setattr(sources, "foreign_map", _boom)
    out = cards.cards(universe="tickers", tickers="AAA", limit=1, source="ohlcv")
    assert out["count"] == 1
    assert out["cards"][0]["source"]["flow"] == "ohlcv+cmf"


def test_limit_is_clamped_to_the_hard_cap(monkeypatch):
    monkeypatch.setattr(sources, "name_map", lambda: {})
    tickers = [f"A{i:03d}" for i in range(130)]
    codes, _, label, _ = cards.resolve_universe("tickers", tickers, limit=1000)
    assert label == "tickers"
    assert len(codes) == cards.MAX_UNIVERSE


def test_empty_universe_returns_a_warning_not_an_exception(monkeypatch):
    monkeypatch.setattr(sources, "name_map", lambda: {})
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": pd.DataFrame())
    monkeypatch.setattr(sources, "foreign_map", lambda: ({}, {"available": False}))
    out = cards.cards(universe="tickers", tickers="", limit=5, source="auto")
    assert out["available"] is False
    assert out["count"] == 0
    assert out["warnings"]
