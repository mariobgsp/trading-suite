"""The Flow cards must quote the same arithmetic they document.

These tests pin the parameter set and the shape of the readout. They are not a
vendor-parity test: the proxy's LPM is explicitly not Bandarmetrics' model.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.flow import technicals as T


def _frame(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(3)
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


def test_compute_has_every_card_column():
    frame = T.compute(_frame())
    for col in (
        "rsi14",
        "stoch_k",
        "stoch_d",
        "supertrend",
        "kumo_top",
        "kumo_bottom",
        "vwap20",
        "ma20",
        "ma50",
        "high_52w",
        "from_52w_high_pct",
        "change_5d_pct",
        "value_5d_idr",
        "cmf20",
        "intensity",
    ):
        assert col in frame.columns, col


def test_latest_values_are_in_their_documented_ranges():
    frame = T.compute(_frame())
    latest = T.latest(frame)
    assert latest["rsi14"] is not None
    assert 0.0 <= latest["rsi14"] <= 100.0
    assert 0.0 <= latest["stoch_k"] <= 100.0
    assert latest["supertrend"] in {"bull", "bear"}
    assert latest["kumo"] in {"above", "below", "inside"}
    assert latest["vwap_pct"] is not None
    assert latest["from_52w_high_pct"] is not None
    assert latest["from_52w_high_pct"] <= 0.0
    assert latest["value_5d_idr"] is not None
    assert latest["value_5d_idr"] > 0.0
    assert latest["price"] is not None


def test_supertrend_turns_bullish_after_a_reversal():
    n = 120
    down = np.linspace(200.0, 100.0, n // 2)
    up = np.linspace(100.0, 220.0, n // 2)
    close = np.concatenate([down, up])
    index = pd.bdate_range("2025-01-01", periods=n)
    frame = pd.DataFrame(
        {
            "Open": close,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": np.full(n, 1_000_000.0),
        },
        index=index,
    )
    out = T.compute(frame)
    assert out["supertrend"].iloc[-1] == 1
    assert T.latest(out)["supertrend"] == "bull"


def test_kumo_is_above_in_a_rising_market():
    n = 120
    close = np.linspace(100.0, 220.0, n)
    index = pd.bdate_range("2025-01-01", periods=n)
    frame = pd.DataFrame(
        {
            "Open": close,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": np.full(n, 1_000_000.0),
        },
        index=index,
    )
    assert T.kumo_state(frame) == "above"


def test_short_history_does_not_crash_and_marks_partial_52w():
    out = T.compute(_frame(20))
    latest = T.latest(out)
    assert latest["from_52w_high_pct"] is None or latest["from_52w_high_pct"] <= 0.0
    assert latest["rsi14"] is None or 0.0 <= latest["rsi14"] <= 100.0
