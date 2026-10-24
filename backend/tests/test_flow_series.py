"""The detail series is aligned, bounded and explicit about the proxy."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.flow import cache as flow_cache
from app.flow import series as series_fn
from app.flow import sources


@pytest.fixture(autouse=True)
def _clear_flow_cache():
    flow_cache.clear()


def _bars(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(9)
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


def test_series_lengths_align(monkeypatch):
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": _bars())
    monkeypatch.setattr(
        sources,
        "foreign_map",
        lambda: (
            {"AAA": 2_000_000_000.0},
            {"available": True, "as_of": _bars().index[-1].isoformat()},
        ),
    )
    out = series_fn("AAA", days=60, source="auto")
    assert out["ticker"] == "AAA"
    assert len(out["dates"]) == 60
    assert len(out["price"]) == 60
    assert len(out["lpm_score"]) == 60
    assert len(out["lpm_price_space"]) == 60
    assert len(out["intensity"]) == 60
    assert len(out["foreign_net_idr"]) == 60
    assert out["quality"] == "proxy"
    assert out["source"]["quality"] == "proxy"
    assert out["parameters"]["window"] == 60
    assert any("current-day only" in warning for warning in out["warnings"])


def test_second_series_call_is_served_from_cache(monkeypatch):
    calls = {"n": 0}

    def _bars_once(code, period="1y"):
        calls["n"] += 1
        return _bars()

    monkeypatch.setattr(sources, "bars", _bars_once)
    monkeypatch.setattr(
        sources,
        "foreign_map",
        lambda: ({}, {"available": False}),
    )
    first = series_fn("AAA", days=30, source="ohlcv")
    second = series_fn("AAA", days=30, source="ohlcv")
    assert first["cache"]["hit"] is False
    assert second["cache"]["hit"] is True
    assert calls["n"] == 1

    refreshed = series_fn("AAA", days=30, source="ohlcv", refresh=True)
    assert refreshed["cache"]["hit"] is False
    assert calls["n"] == 2


def test_series_ignores_stale_foreign_flow(monkeypatch):
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": _bars())
    monkeypatch.setattr(
        sources,
        "foreign_map",
        lambda: ({"AAA": 2_000_000_000.0}, {"available": True, "as_of": "2020-01-01"}),
    )
    out = series_fn("AAA", days=30, source="auto")
    assert out["source"]["flow"] == "ohlcv+cmf"
    assert any("stale" in warning for warning in out["warnings"])


def test_series_ohlcv_source_skips_foreign(monkeypatch):
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": _bars())

    def _boom():
        raise AssertionError("foreign feed must not be called for source=ohlcv")

    monkeypatch.setattr(sources, "foreign_map", _boom)
    out = series_fn("AAA", days=30, source="ohlcv")
    assert out["source"]["flow"] == "ohlcv+cmf"
    assert all(value is None for value in out["foreign_net_idr"])


def test_series_raises_lookup_for_unknown_name(monkeypatch):
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": pd.DataFrame())
    with pytest.raises(LookupError):
        series_fn("NOPE", days=60)
