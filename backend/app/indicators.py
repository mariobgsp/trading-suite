"""Unified technical-indicator service.

The five source repos each reimplemented RSI/MACD/OBV/VWAP etc. (confirmed
duplication).  This service delegates to bot-trading-simulator's canonical
`core/indicators.py` (1041 LOC, the most complete set) as the single source
of truth, and exposes clean JSON-friendly results for the API layer.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from core.indicators import (
    ad_line,
    atr,
    cmf,
    ema,
    macd,
    mfi,
    obv,
    psar,
    rsi,
    sma,
    stochastic_oscillator,
    vwap,
)


def history_to_frame(history: list[dict[str, Any]]) -> pd.DataFrame:
    """Convert the market-service history records into a DataFrame.

    Uses the canonical uppercase column contract (Open/High/Low/Close/Volume)
    expected by core/indicators.py.
    """
    df = pd.DataFrame(history)
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"])
    rename = {
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
    }
    df = df.rename(columns=rename)
    for col in ("Open", "High", "Low", "Close", "Volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.set_index("date").sort_index()


def compute_indicators(history: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute the indicator bundle for a symbol's history.

    Returns per-date indicator columns for chart overlays plus the latest
    values for each indicator (used by screener/validator cards).
    """
    df = history_to_frame(history)
    if df.empty:
        return {"columns": {}, "latest": {}}

    out: dict[str, list[Any]] = {
        "date": [str(d) for d in df.index],
    }

    def _series(name: str, fn) -> None:
        try:
            s = fn(df)
            if isinstance(s, pd.Series):
                out[name] = [
                    None
                    if (v is None or (isinstance(v, float) and math.isnan(v)))
                    else round(float(v), 4)
                    for v in s
                ]
            elif isinstance(s, tuple):
                for i, part in enumerate(s):
                    if isinstance(part, pd.Series):
                        out[f"{name}_{i}"] = [
                            None
                            if (v is None or (isinstance(v, float) and math.isnan(v)))
                            else round(float(v), 4)
                            for v in part
                        ]
        except Exception:  # noqa: BLE001 - one indicator failing must not kill the bundle
            out[name] = [None] * len(df)

    _series("sma20", lambda d: sma(d["Close"], 20))
    _series("sma50", lambda d: sma(d["Close"], 50))
    _series("sma200", lambda d: sma(d["Close"], 200))
    _series("ema9", lambda d: ema(d["Close"], 9))
    _series("ema21", lambda d: ema(d["Close"], 21))
    _series("rsi", lambda d: rsi(d["Close"], 14))
    _series("atr", lambda d: atr(d, 14))
    _series("macd", lambda d: macd(d["Close"]))
    _series("stoch", lambda d: stochastic_oscillator(d, k_period=10))
    _series("obv", lambda d: obv(d))
    _series("vwap", lambda d: vwap(d))
    _series("vol_ma20", lambda d: sma(d["Volume"], 20))
    _series("cmf", lambda d: cmf(d, period=20))
    _series("mfi", lambda d: mfi(d, period=14))
    _series("psar", lambda d: psar(d))
    _series("ad_line", lambda d: ad_line(d))

    latest: dict[str, Any] = {}
    for name in (
        "sma20",
        "sma50",
        "sma200",
        "ema9",
        "ema21",
        "rsi",
        "atr",
        "macd_0",
        "macd_1",
        "macd_2",
        "stoch_0",
        "stoch_1",
        "obv",
        "vwap",
        "vol_ma20",
        "cmf",
        "mfi",
        "psar",
        "ad_line",
    ):
        col = out.get(name)
        if col is None:
            continue
        latest[name] = next((v for v in reversed(col) if v is not None), None)

    # Trend context helpers — guard against NaN reaching JSON (invalid JSON
    # token: browsers' res.json() would throw).
    closes = df["Close"].tolist()
    if len(closes) >= 2 and closes[-2]:
        raw = ((closes[-1] - closes[-2]) / closes[-2]) * 100
        latest["change_pct"] = round(raw, 2) if not math.isnan(raw) else None
    else:
        latest["change_pct"] = None

    return {"columns": out, "latest": latest}


def momentum_signal(latest: dict[str, Any]) -> dict[str, Any]:
    """Derive a compact BUY/HOLD/SELL read from the latest indicator bundle."""
    rsi_raw = latest.get("rsi")
    macd_line_raw = latest.get("macd_0")
    macd_sig_raw = latest.get("macd_1")
    if rsi_raw is None or macd_line_raw is None or macd_sig_raw is None:
        return {"signal": "UNKNOWN", "score": 0, "reasons": []}
    try:
        rsi_val = float(rsi_raw)
        macd_line = float(macd_line_raw)
        macd_signal = float(macd_sig_raw)
    except (TypeError, ValueError):
        return {"signal": "UNKNOWN", "score": 0, "reasons": []}

    reasons: list[str] = []
    score = 0

    if rsi_val < 30:
        score += 2
        reasons.append("RSI oversold (<30)")
    elif rsi_val < 45:
        score += 1
        reasons.append("RSI weak")
    elif rsi_val > 70:
        score -= 2
        reasons.append("RSI overbought (>70)")
    elif rsi_val > 55:
        score -= 1
        reasons.append("RSI strong")

    if macd_line > macd_signal and macd_line > 0:
        score += 1
        reasons.append("MACD bullish cross")
    elif macd_line < macd_signal and macd_line < 0:
        score -= 1
        reasons.append("MACD bearish cross")

    if score >= 2:
        signal = "BUY"
    elif score <= -2:
        signal = "SELL"
    elif score >= 1:
        signal = "ACCUMULATE"
    elif score <= -1:
        signal = "REDUCE"
    else:
        signal = "HOLD"

    return {"signal": signal, "score": score, "reasons": reasons}
