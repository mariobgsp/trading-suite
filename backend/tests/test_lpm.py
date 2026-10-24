"""The Flow proxy is causal, finite, and honest about its source.

The old tests in this file pinned a formula that let future broker flow change
earlier LPM values. That is look-ahead; it cannot be used live and cannot be
validated against a forward return. The tests below replace it with the rule the
rest of the app depends on: at bar t, only bars <= t are read.
"""

from __future__ import annotations

import math
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from app.flow import lpm as L


def _frame(n: int = 120) -> pd.DataFrame:
    rng = np.random.default_rng(11)
    close = 100.0 * np.exp(np.cumsum(rng.normal(0.0004, 0.01, n)))
    index = pd.bdate_range("2025-01-01", periods=n)
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


def _broker(frame: pd.DataFrame, sign: float = 1.0) -> pd.Series:
    values = np.linspace(-1.0, 1.0, len(frame)) * 500_000.0 * sign
    return pd.Series(values, index=frame.index)


def test_proxy_is_causal_when_future_broker_flow_changes():
    frame = _frame()
    broker_a = _broker(frame, sign=1.0)
    broker_b = broker_a.copy()
    cutoff = 80
    broker_b.iloc[cutoff:] = broker_b.iloc[cutoff:] * -3.0

    scored_a, _ = L.score_frame(frame, broker_net_lots=broker_a)
    scored_b, _ = L.score_frame(frame, broker_net_lots=broker_b)

    a = scored_a["lpm_score"].iloc[:cutoff].to_numpy()
    b = scored_b["lpm_score"].iloc[:cutoff].to_numpy()
    assert np.allclose(a, b, equal_nan=True)


def test_proxy_reads_only_the_past_when_future_prices_change():
    frame = _frame()
    frame_b = frame.copy()
    cutoff = 70
    frame_b.iloc[cutoff:, frame_b.columns.get_loc("Close")] *= 2.0
    frame_b.iloc[cutoff:, frame_b.columns.get_loc("Volume")] *= 0.5

    scored_a, _ = L.score_frame(frame)
    scored_b, _ = L.score_frame(frame_b)
    assert np.allclose(
        scored_a["lpm_score"].iloc[:cutoff].to_numpy(),
        scored_b["lpm_score"].iloc[:cutoff].to_numpy(),
        equal_nan=True,
    )


def test_score_is_bounded_and_price_space_is_near_close():
    frame = _frame()
    scored, meta = L.score_frame(frame, broker_net_lots=_broker(frame))
    score = scored["lpm_score"].dropna()
    assert len(score) > 20
    assert float(score.min()) >= -1.0001
    assert float(score.max()) <= 1.0001
    assert meta["quality"] == "proxy"
    assert meta["has_broker"] is True

    price = scored["lpm_price_space"].dropna()
    close = scored["Close"].loc[price.index]
    ratio = (price / close - 1.0).abs()
    assert float(ratio.max()) <= L.PRICE_SPACE_SCALE + 1e-9


def test_direction_thresholds():
    assert L.direction(L.DIRECTION_THRESHOLD + 0.001) == "rising"
    assert L.direction(-L.DIRECTION_THRESHOLD - 0.001) == "falling"
    assert L.direction(0.0) == "flat"
    assert L.direction(None) == "unavailable"
    assert L.direction(float("nan")) == "unavailable"


def test_no_flow_falls_back_to_cmf_and_says_so():
    frame = _frame()
    scored, meta = L.score_frame(frame)
    assert meta["source"] == "ohlcv+cmf"
    assert meta["has_foreign"] is False
    assert meta["has_broker"] is False
    assert any("price/volume proxy" in warning for warning in meta["warnings"])
    assert scored["lpm_score"].notna().sum() > 0


def _per_day(n: int = 30, base_price: float = 1000.0, flip_after: int | None = None):
    rows = []
    for i in range(n):
        top3 = 1000.0 + 500.0 * math.sin(i / 5.0)
        if flip_after is not None and i >= flip_after:
            top3 *= -2.0
        rows.append(
            {
                "date": f"2026-01-{(i % 28) + 1:02d}",
                "price": base_price + i,
                "volume": 1_000_000.0,
                "available": True,
                "rows": [],
                "top3_net": top3,
            }
        )
    return rows


def test_legacy_endpoint_returns_causal_proxy_shape():
    from app import stockbit

    with patch.object(
        stockbit,
        "broker_history",
        return_value={
            "per_day": _per_day(30),
            "available": True,
            "dates": [],
            "as_of": "2026-01-01T00:00:00Z",
        },
    ), patch.object(stockbit, "orderbook_snapshot", return_value={"available": False}):
        out = stockbit.stockbit_lpm_intensity("BBCA", days=30, force=True)

    assert out["ticker"] == "BBCA"
    for key in ("lpm", "score", "direction", "intensity", "source", "quality"):
        assert key in out
    assert len(out["lpm"]) == 30
    assert len(out["score"]) == 30
    assert len(out["intensity"]) == 30
    assert out["quality"] == "proxy"
    assert "causal Flow proxy" in " ".join(out["warnings"])
    assert all(value is None or math.isfinite(value) for value in out["lpm"])


def test_legacy_endpoint_does_not_let_future_flow_change_past_values():
    from app import stockbit

    base = {"available": True, "dates": [], "as_of": "2026-01-01T00:00:00Z"}
    with patch.object(
        stockbit,
        "broker_history",
        side_effect=[
            {**base, "per_day": _per_day(30)},
            {**base, "per_day": _per_day(30, flip_after=20)},
        ],
    ), patch.object(stockbit, "orderbook_snapshot", return_value={"available": False}):
        first = stockbit.stockbit_lpm_intensity("BBRI", days=30, force=True)
        second = stockbit.stockbit_lpm_intensity("BBRI", days=30, force=True)

    # Bars before the changed window must be identical. The old formula failed
    # this exact test by construction.
    for i in range(18):
        assert first["lpm"][i] == pytest.approx(second["lpm"][i])
