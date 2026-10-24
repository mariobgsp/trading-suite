"""A transparent, causal flow-pressure proxy.

This is **not** Bandarmetrics' Liquidity Pressure Model. The vendor formula and
data are proprietary; the repo has no licensed copy. What lives here is a
documented proxy built only from data available at each bar:

    broker pressure   top-3 net broker lots / average volume
    foreign pressure  net foreign IDR / turnover
    money flow        Chaikin Money Flow (20)

The weights are design constants, not measured claims. The output is
dimensionless and must be labelled "proxy" wherever it is shown.

Causality is a hard rule: at bar t, only bars <= t are read. A mutation of a
future bar must not move an earlier score; `test_flow_lpm.py` proves it.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from app.indicators import cmf

EMA_SPAN = 5
DIRECTION_LOOKBACK = 5
DIRECTION_THRESHOLD = 0.02
PRICE_SPACE_SCALE = 0.12

WEIGHTS = {
    "broker": 0.5,
    "foreign": 0.3,
    "cmf": 0.2,
}
WEIGHTS_FOREIGN_ONLY = {
    "foreign": 0.6,
    "cmf": 0.4,
}


def align(series: pd.Series | dict[str, float] | None, index: pd.DatetimeIndex) -> pd.Series | None:
    """Align a date-keyed flow series to the bar index.

    A `None` input stays `None`; missing dates become NaN rather than zero so a
    partial source is visible in the metadata.
    """
    if series is None:
        return None
    if isinstance(series, dict):
        series = pd.Series(series)
    if not isinstance(series, pd.Series) or series.empty:
        return None
    out = pd.Series(series).copy()
    out.index = pd.to_datetime(out.index, errors="coerce")
    out = out[~out.index.isna()]
    out = pd.to_numeric(out, errors="coerce")
    out = out[~out.index.duplicated(keep="last")]
    return out.reindex(index)


def _has_signal(series: pd.Series | None) -> bool:
    if series is None or series.empty:
        return False
    return bool(series.notna().any() and float(series.abs().sum()) > 0)


def score_frame(
    df: pd.DataFrame,
    *,
    foreign_net_idr: pd.Series | dict[str, float] | None = None,
    broker_net_lots: pd.Series | dict[str, float] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Add the proxy columns to a frame that already carries OHLCV.

    Returns the frame and a metadata dict with the chosen source, weights and
    warnings. The caller decides how to present it.
    """
    out = df.copy()
    if out.empty:
        return out, {
            "source": "unavailable",
            "quality": "unavailable",
            "weights": {},
            "warnings": ["no bars"],
        }

    close = pd.to_numeric(out["Close"], errors="coerce")
    volume = pd.to_numeric(out["Volume"], errors="coerce").fillna(0.0)
    turnover = (close * volume).replace(0, np.nan)
    avg_volume = volume.rolling(20, min_periods=5).mean()
    cmf20 = (
        pd.to_numeric(out["cmf20"], errors="coerce")
        if "cmf20" in out.columns
        else cmf(out, 20)
    )

    foreign = align(foreign_net_idr, out.index)
    broker = align(broker_net_lots, out.index)
    has_foreign = _has_signal(foreign)
    has_broker = _has_signal(broker)

    foreign_pressure = (
        np.tanh(3.0 * foreign / turnover) if has_foreign and foreign is not None else None
    )
    broker_pressure = (
        np.tanh(3.0 * broker / avg_volume)
        if has_broker and broker is not None
        else None
    )

    warnings: list[str] = []
    if has_broker:
        raw = (
            WEIGHTS["broker"] * broker_pressure.fillna(0.0)
            + WEIGHTS["foreign"] * (foreign_pressure.fillna(0.0) if has_foreign and foreign_pressure is not None else 0.0)
            + WEIGHTS["cmf"] * cmf20.fillna(0.0)
        )
        weights = dict(WEIGHTS)
        if has_foreign:
            source = "stockbit_broker+idx_foreign+cmf"
        else:
            source = "stockbit_broker+cmf"
            warnings.append("stockbit broker flow only; IDX foreign flow unavailable")
    elif has_foreign:
        raw = (
            WEIGHTS_FOREIGN_ONLY["foreign"] * foreign_pressure.fillna(0.0)
            + WEIGHTS_FOREIGN_ONLY["cmf"] * cmf20.fillna(0.0)
        )
        weights = dict(WEIGHTS_FOREIGN_ONLY)
        source = "idx_foreign+cmf"
    else:
        raw = cmf20.fillna(0.0)
        weights = {"cmf": 1.0}
        source = "ohlcv+cmf"
        warnings.append("no foreign or broker flow available; price/volume proxy only")

    # The first few CMF values are undefined; do not present a smoothed zero as
    # a measured reading. EWM is causal: each value only sees the past.
    raw = raw.where(cmf20.notna() | (raw != 0))
    score = raw.ewm(span=EMA_SPAN, adjust=False, min_periods=EMA_SPAN).mean()
    score = score.clip(-1.0, 1.0)

    out["lpm_score"] = score
    out["lpm_price_space"] = close * (1.0 + PRICE_SPACE_SCALE * score)
    out["lpm_slope_5d"] = score - score.shift(DIRECTION_LOOKBACK)
    out["lpm_direction"] = np.where(
        out["lpm_slope_5d"] > DIRECTION_THRESHOLD,
        "rising",
        np.where(out["lpm_slope_5d"] < -DIRECTION_THRESHOLD, "falling", "flat"),
    )
    out.loc[out["lpm_slope_5d"].isna(), "lpm_direction"] = "unavailable"

    return out, {
        "source": source,
        "quality": "proxy",
        "weights": weights,
        "warnings": warnings,
        "has_foreign": has_foreign,
        "has_broker": has_broker,
        "ema_span": EMA_SPAN,
        "direction_lookback": DIRECTION_LOOKBACK,
        "direction_threshold": DIRECTION_THRESHOLD,
    }


def direction(slope: float | None) -> str:
    """Classify one slope value, matching the frame's rule."""
    if slope is None:
        return "unavailable"
    try:
        value = float(slope)
    except (TypeError, ValueError):
        return "unavailable"
    if not math.isfinite(value):
        return "unavailable"
    if value > DIRECTION_THRESHOLD:
        return "rising"
    if value < -DIRECTION_THRESHOLD:
        return "falling"
    return "flat"


def latest(frame: pd.DataFrame) -> dict[str, Any]:
    """The latest proxy reading, safe for JSON."""
    if frame is None or frame.empty:
        return {
            "direction": "unavailable",
            "slope_5d": None,
            "score": None,
            "available": False,
        }
    last = frame.iloc[-1]
    slope = _finite(last.get("lpm_slope_5d"))
    score = _finite(last.get("lpm_score"))
    return {
        "direction": direction(slope),
        "slope_5d": round(slope, 4) if slope is not None else None,
        "score": round(score, 4) if score is not None else None,
        "available": score is not None,
    }


def _finite(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None
