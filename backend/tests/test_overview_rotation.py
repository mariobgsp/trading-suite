"""Relative-rotation math and group filtering."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.overview import rotation


def _series(values: list[float]) -> pd.Series:
    return pd.Series(values, index=pd.bdate_range("2024-01-01", periods=len(values)))


def _row(ticker: str, sector: str, industry: str, values: list[float]) -> dict:
    return {
        "ticker": ticker,
        "sector": sector,
        "industry": industry,
        "price": values[-1],
        "change_pct": (values[-1] / values[-2] - 1.0) * 100.0,
        "closes": _series(values),
        "highs": _series(values) * 1.01,
        "lows": _series(values) * 0.99,
    }


def test_build_kind_produces_points_and_tails():
    up = np.linspace(100.0, 160.0, 320)
    down = np.linspace(160.0, 100.0, 320)
    benchmark = np.linspace(100.0, 120.0, 320)
    joined = [
        _row("A", "Alpha", "Alpha Industry", up.tolist()),
        _row("B", "Alpha", "Alpha Industry", up.tolist()),
        _row("C", "Beta", "Beta Industry", down.tolist()),
        _row("D", "Beta", "Beta Industry", down.tolist()),
    ]
    out = rotation.build_kind(joined, _series(benchmark.tolist()), "sector")
    assert out["available"] is True
    assert out["count"] == 2
    assert all(point["tail"] for point in out["points"])
    assert {row["group"] for row in out["groups"]} == {"Alpha", "Beta"}


def test_industry_needs_at_least_five_members():
    values = np.linspace(100.0, 130.0, 320).tolist()
    joined = [
        _row("A", "S", "Small Industry", values),
        _row("B", "S", "Small Industry", values),
        _row("C", "S", "Large Industry", values),
        _row("D", "S", "Large Industry", values),
        _row("E", "S", "Large Industry", values),
        _row("F", "S", "Large Industry", values),
        _row("G", "S", "Large Industry", values),
    ]
    out = rotation.build_kind(joined, _series(values), "industry")
    names = {point["group"] for point in out["points"]}
    assert "Small Industry" not in names
    assert "Large Industry" in names


def test_quadrants_are_one_of_four():
    values = np.linspace(100.0, 130.0, 320).tolist()
    joined = [_row("A", "S", "I", values), _row("B", "S", "I", values)]
    out = rotation.build_kind(joined, _series(np.linspace(100.0, 110.0, 320).tolist()), "sector")
    assert out["points"][0]["quadrant"] in {"leading", "weakening", "improving", "lagging"}
