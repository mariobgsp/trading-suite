"""Canonical technical readouts for the Flow cards.

The same indicator math the rest of the app uses, with one parameter set written
down. The card is only useful if a number means the same thing every time: the
RSI here is Wilder 14, the VWAP is a 20-session rolling typical-price VWAP, and
the 52-week distance is measured from the rolling 252-session high.

Nothing in this module predicts anything. It is measurement, not a signal.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from app.indicators import atr, cmf, mfi, rsi, sma, stochastic_oscillator, vwap

RSI_PERIOD = 14
STOCH_K = 14
STOCH_D = 3
SUPERTREND_ATR = 14
SUPERTREND_MULT = 3.0
ICHIMOKU_TENKAN = 9
ICHIMOKU_KIJUN = 26
ICHIMOKU_SENKOU = 52
ICHIMOKU_DISPLACEMENT = 26
VWAP_WINDOW = 20
MA_FAST = 20
MA_SLOW = 50
HIGH_52W = 252
INTENSITY_WINDOW = 20


def _finite(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _series_tail(series: pd.Series) -> float | None:
    """Last finite value in a series, or None when the series has no value."""
    if series is None or len(series) == 0:
        return None
    for value in reversed(series.tolist()):
        out = _finite(value)
        if out is not None:
            return out
    return None


def _ensure_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Accept the market adapter's lowercase columns or the canonical uppercase ones."""
    if df is None or len(df) == 0:
        return pd.DataFrame()
    out = df.copy()
    rename = {
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
    }
    out = out.rename(columns={k: v for k, v in rename.items() if k in out.columns})
    for col in ("Open", "High", "Low", "Close", "Volume"):
        if col not in out.columns:
            if col == "Volume":
                out[col] = 0.0
            elif col == "Open":
                out[col] = out.get("Close", 0.0)
            else:
                out[col] = out.get("Close", 0.0)
        out[col] = pd.to_numeric(out[col], errors="coerce")
    if not isinstance(out.index, pd.DatetimeIndex):
        if "date" in out.columns:
            out["date"] = pd.to_datetime(out["date"], errors="coerce")
            out = out.set_index("date")
        else:
            out.index = pd.to_datetime(out.index, errors="coerce")
    return out.sort_index()


def supertrend(
    df: pd.DataFrame,
    period: int = SUPERTREND_ATR,
    multiplier: float = SUPERTREND_MULT,
) -> tuple[pd.Series, pd.Series]:
    """Supertrend direction and line.

    Returns `(trend, line)`, where trend is +1 for bull and -1 for bear and line
    is the trailing stop the direction is read from. The first `period` bars are
    NaN because ATR is not defined yet.
    """
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    close = df["Close"].astype(float)
    atr_s = atr(df, period)
    hl2 = (high + low) / 2.0
    upper = hl2 + multiplier * atr_s
    lower = hl2 - multiplier * atr_s

    n = len(df)
    trend = np.full(n, 0, dtype=int)
    final_upper = np.full(n, np.nan, dtype=float)
    final_lower = np.full(n, np.nan, dtype=float)

    for i in range(n):
        if not math.isfinite(float(atr_s.iloc[i])):
            continue
        if i == 0 or not math.isfinite(float(final_upper[i - 1])):
            final_upper[i] = float(upper.iloc[i])
            final_lower[i] = float(lower.iloc[i])
            trend[i] = 1 if float(close.iloc[i]) >= final_lower[i] else -1
            continue

        prev_u = final_upper[i - 1]
        prev_l = final_lower[i - 1]
        final_upper[i] = (
            float(upper.iloc[i])
            if (float(upper.iloc[i]) < prev_u or float(close.iloc[i - 1]) > prev_u)
            else prev_u
        )
        final_lower[i] = (
            float(lower.iloc[i])
            if (float(lower.iloc[i]) > prev_l or float(close.iloc[i - 1]) < prev_l)
            else prev_l
        )
        if float(close.iloc[i]) > prev_u:
            trend[i] = 1
        elif float(close.iloc[i]) < prev_l:
            trend[i] = -1
        else:
            trend[i] = trend[i - 1] if trend[i - 1] != 0 else 1

    line = np.where(trend >= 0, final_lower, final_upper)
    return (
        pd.Series(trend, index=df.index, name="supertrend"),
        pd.Series(line, index=df.index, name="supertrend_line"),
    )


def ichimoku(
    df: pd.DataFrame,
    tenkan: int = ICHIMOKU_TENKAN,
    kijun: int = ICHIMOKU_KIJUN,
    senkou: int = ICHIMOKU_SENKOU,
    displacement: int = ICHIMOKU_DISPLACEMENT,
) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    """Ichimoku cloud boundaries at the current bar.

    Span A and Span B are displaced forward by `displacement` in the usual
    chart convention. To read the cloud *at* the current bar, that is a
    `shift(displacement)` of the raw spans.
    """
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    tenkan_line = (high.rolling(tenkan).max() + low.rolling(tenkan).min()) / 2.0
    kijun_line = (high.rolling(kijun).max() + low.rolling(kijun).min()) / 2.0
    span_a = ((tenkan_line + kijun_line) / 2.0).shift(displacement)
    span_b = (
        (high.rolling(senkou).max() + low.rolling(senkou).min()) / 2.0
    ).shift(displacement)
    top = pd.concat([span_a, span_b], axis=1).max(axis=1)
    bottom = pd.concat([span_a, span_b], axis=1).min(axis=1)
    return tenkan_line, kijun_line, top, bottom


def kumo_state(df: pd.DataFrame) -> str | None:
    """Where the close sits relative to the cloud: above, below or inside."""
    _, _, top, bottom = ichimoku(df)
    if len(df) == 0:
        return None
    close = _finite(df["Close"].iloc[-1])
    high = _finite(top.iloc[-1])
    low = _finite(bottom.iloc[-1])
    if close is None or high is None or low is None:
        return None
    if close > high:
        return "above"
    if close < low:
        return "below"
    return "inside"


def compute(df: pd.DataFrame) -> pd.DataFrame:
    """Add every Flow column to a copy of the OHLCV frame."""
    out = _ensure_frame(df)
    if out.empty:
        return out

    out["rsi14"] = rsi(out["Close"], RSI_PERIOD)
    stoch_k, stoch_d = stochastic_oscillator(
        out, k_period=STOCH_K, d_period=STOCH_D, smooth_k=1
    )
    out["stoch_k"] = stoch_k
    out["stoch_d"] = stoch_d

    st_trend, st_line = supertrend(out)
    out["supertrend"] = st_trend
    out["supertrend_line"] = st_line

    _, _, kumo_top, kumo_bottom = ichimoku(out)
    out["kumo_top"] = kumo_top
    out["kumo_bottom"] = kumo_bottom

    out["vwap20"] = vwap(out, VWAP_WINDOW)
    out["ma20"] = sma(out["Close"], MA_FAST)
    out["ma50"] = sma(out["Close"], MA_SLOW)
    out["high_52w"] = out["High"].rolling(HIGH_52W, min_periods=20).max()
    out["from_52w_high_pct"] = (out["Close"] / out["high_52w"] - 1.0) * 100.0
    out["change_5d_pct"] = (out["Close"] / out["Close"].shift(5) - 1.0) * 100.0
    out["value_5d_idr"] = (out["Close"] * out["Volume"]).rolling(5).sum()
    out["previous_close"] = out["Close"].shift(1)
    out["change_pct"] = (out["Close"] / out["previous_close"] - 1.0) * 100.0

    out["cmf20"] = cmf(out, 20)
    out["mfi14"] = mfi(out, 14)

    avg_volume = out["Volume"].rolling(INTENSITY_WINDOW).mean()
    body = (out["Close"] - out["Open"]).abs()
    candle_range = (out["High"] - out["Low"]).replace(0, np.nan)
    body_share = (body / candle_range).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    ratio = (out["Volume"] / avg_volume).replace([np.inf, -np.inf], np.nan)
    out["intensity"] = ratio * (0.5 + body_share)
    return out


def latest(frame: pd.DataFrame) -> dict[str, Any]:
    """The card readout for the last completed bar."""
    if frame is None or frame.empty:
        return {}

    last = frame.iloc[-1]
    close = _finite(last.get("Close"))
    vwap_value = _finite(last.get("vwap20"))
    high_52 = _finite(last.get("high_52w"))
    st_trend = _finite(last.get("supertrend"))
    kumo_top = _finite(last.get("kumo_top"))
    kumo_bottom = _finite(last.get("kumo_bottom"))

    if close is None or kumo_top is None or kumo_bottom is None:
        kumo = None
    elif close > kumo_top:
        kumo = "above"
    elif close < kumo_bottom:
        kumo = "below"
    else:
        kumo = "inside"

    if st_trend is None or st_trend == 0:
        supertrend_state = None
    else:
        supertrend_state = "bull" if st_trend > 0 else "bear"

    return {
        "rsi14": _round(_finite(last.get("rsi14")), 2),
        "stoch_k": _round(_finite(last.get("stoch_k")), 2),
        "stoch_d": _round(_finite(last.get("stoch_d")), 2),
        "supertrend": supertrend_state,
        "kumo": kumo,
        "vwap_pct": (
            _round((close / vwap_value - 1.0) * 100.0, 2)
            if close is not None and vwap_value not in (None, 0)
            else None
        ),
        "above_ma20": (
            bool(close > float(last["ma20"]))
            if close is not None and _finite(last.get("ma20")) is not None
            else None
        ),
        "above_ma50": (
            bool(close > float(last["ma50"]))
            if close is not None and _finite(last.get("ma50")) is not None
            else None
        ),
        "from_52w_high_pct": _round(
            (close / high_52 - 1.0) * 100.0
            if close is not None and high_52 not in (None, 0)
            else None,
            2,
        ),
        "change_5d_pct": _round(_finite(last.get("change_5d_pct")), 2),
        "value_5d_idr": _finite(last.get("value_5d_idr")),
        "price": close,
        "previous_close": _finite(last.get("previous_close")),
        "change_pct": _round(_finite(last.get("change_pct")), 2),
        "cmf20": _round(_finite(last.get("cmf20")), 4),
        "mfi14": _round(_finite(last.get("mfi14")), 2),
        "intensity": _round(_finite(last.get("intensity")), 3),
    }


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)
