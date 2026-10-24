"""Market summary and stress gauge arithmetic."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from app.overview import gauge, summary


def _series(values: list[float], start: str = "2025-01-01") -> pd.Series:
    return pd.Series(
        values,
        index=pd.bdate_range(start, periods=len(values)),
    )


def test_summary_counts_breadth_and_thresholds():
    closes = _series(np.linspace(80.0, 120.0, 300).tolist())
    joined = [
        {
            "ticker": "UP",
            "price": 120.0,
            "change_pct": 6.0,
            "closes": closes,
            "highs": closes * 1.01,
            "lows": closes * 0.99,
        },
        {
            "ticker": "DOWN",
            "price": 80.0,
            "change_pct": -6.0,
            "closes": closes[::-1].reset_index(drop=True).set_axis(closes.index),
            "highs": closes * 1.01,
            "lows": closes * 0.99,
        },
        {
            "ticker": "FLAT",
            "price": 100.0,
            "change_pct": 0.0,
            "closes": closes,
            "highs": closes * 1.01,
            "lows": closes * 0.99,
        },
    ]
    out = summary.build(
        {
            "joined": joined,
            "benchmark": closes,
            "as_of": date(2026, 10, 22),
            "history_as_of": date(2026, 10, 22),
        }
    )
    assert out["up"] == 1
    assert out["down"] == 1
    assert out["flat"] == 1
    assert out["up5"] == 1
    assert out["down5"] == 1
    assert out["breadth_pct"] == 50.0
    assert out["universe"]["total"] == 3
    assert out["ihsg"]["close"] == 120.0


def test_gauge_is_bounded_and_published_weights_sum_to_one():
    greed = gauge.build(
        {
            "breadth_pct": 100.0,
            "above_ma50_pct": 100.0,
            "near_52w_high": 100,
            "near_52w_low": 0,
            "down5_pct": 0.0,
            "ihsg": {"momentum_vs_ma100_pct": 10.0, "volatility_20d_pct": 10.0},
        }
    )
    panic = gauge.build(
        {
            "breadth_pct": 0.0,
            "above_ma50_pct": 0.0,
            "near_52w_high": 0,
            "near_52w_low": 100,
            "down5_pct": 20.0,
            "ihsg": {"momentum_vs_ma100_pct": -10.0, "volatility_20d_pct": 70.0},
        }
    )
    assert greed["value"] > 90
    assert panic["value"] < 10
    assert abs(sum(greed["weights"].values()) - 1.0) < 1e-9
    assert len(greed["components"]) == 6
    assert all(0 <= c["score"] <= 100 for c in greed["components"])
    assert greed["band_label"]
