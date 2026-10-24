"""The accuracy report reports what it measured, not what we hoped."""

from __future__ import annotations

import importlib

import numpy as np
import pandas as pd
import pytest

from app.flow import cache as flow_cache
from app.flow import sources
from app.flow import validate as validate_fn

V = importlib.import_module("app.flow.validate")


@pytest.fixture(autouse=True)
def _clear_flow_cache():
    flow_cache.clear()


def _bars(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(13)
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


def test_hit_rate_and_auc_are_plain_arithmetic():
    hit = V._hit([1.0, -1.0, 1.0, 1.0], [1.0, -1.0, -1.0, 1.0])
    assert hit["n"] == 4
    assert hit["correct"] == 3
    assert hit["hit_rate_pct"] == 75.0

    auc = V._auc([1.0, 2.0, 3.0, 4.0], [0, 0, 1, 1])
    assert auc == 1.0


def test_wilson_interval_contains_the_point_estimate():
    low, high = V._wilson(60, 100)
    assert low is not None and high is not None
    assert low < 60.0 < high


def test_validate_reports_a_proxy_record(monkeypatch, tmp_path):
    monkeypatch.setattr(sources, "bars", lambda code, period="1y": _bars())
    monkeypatch.setenv("FLOW_VENDOR_CSV", str(tmp_path / "missing.csv"))
    report = validate_fn(["AAA"], horizon=5, days=250, source="ohlcv")
    assert report["available"] is True
    assert report["quality"] == "proxy"
    assert report["n"] > 0
    assert report["hit_rate_pct"] is not None
    assert report["baseline_hit_rate_pct"] is not None
    assert report["vendor_parity"]["available"] is False
    assert any("not the vendor LPM" in warning for warning in report["warnings"])


def test_validate_without_tickers_is_not_a_crash():
    report = validate_fn([], horizon=5, days=250)
    assert report["available"] is False
    assert "no tickers" in report["error"]


def test_evaluate_frame_leaves_a_forward_return_tail():
    frame = pd.DataFrame(
        {
            "Close": np.linspace(100.0, 130.0, 30),
            "lpm_score": np.linspace(-0.5, 0.5, 30),
        },
        index=pd.bdate_range("2026-01-01", periods=30),
    )
    obs = V.evaluate_frame(frame, horizon=5)
    assert len(obs) == 30
    assert obs["fwd"].iloc[-1] != obs["fwd"].iloc[-1]  # NaN
    assert obs["fwd"].iloc[0] == obs["fwd"].iloc[0]
