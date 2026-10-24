"""Market summary arithmetic for the dashboard.

Everything here is a pure function of the joined universe and the benchmark
series. No network, no database, easy to unit-test.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

NEAR_52W_PCT = 5.0
FLAT_BAND = 0.05


def _as_series(value: object) -> pd.Series:
    return value if isinstance(value, pd.Series) else pd.Series(dtype=float)


def _valid(value: object) -> pd.Series:
    return pd.to_numeric(_as_series(value), errors="coerce").dropna()


def _benchmark_metrics(
    benchmark: pd.Series, quote: dict[str, Any] | None = None
) -> dict[str, Any]:
    series = _valid(benchmark)
    quote = quote or {}
    quote_close = quote.get("close")
    quote_change = quote.get("change_pct")
    if series.empty and quote_close is None:
        return {
            "close": None,
            "change_pct": None,
            "ma50": None,
            "ma100": None,
            "momentum_vs_ma100_pct": None,
            "volatility_20d_pct": None,
        }
    close = float(quote_close) if quote_close is not None else float(series.iloc[-1])
    prev = float(series.iloc[-2]) if len(series) >= 2 else None
    ma50 = float(series.tail(50).mean()) if len(series) >= 50 else None
    ma100 = float(series.tail(100).mean()) if len(series) >= 100 else None
    momentum = ((close / ma100 - 1.0) * 100.0) if ma100 else None
    returns = series.pct_change().dropna()
    volatility = (
        float(returns.tail(20).std(ddof=0) * math.sqrt(252.0) * 100.0)
        if len(returns) >= 5
        else None
    )
    return {
        "close": round(close, 2),
        "change_pct": (
            round(float(quote_change), 2)
            if quote_change is not None
            else round((close / prev - 1.0) * 100.0, 2)
            if prev
            else None
        ),
        "ma50": round(ma50, 2) if ma50 else None,
        "ma100": round(ma100, 2) if ma100 else None,
        "momentum_vs_ma100_pct": round(momentum, 2) if momentum is not None else None,
        "volatility_20d_pct": round(volatility, 2) if volatility is not None else None,
    }


def build(inputs: dict[str, Any]) -> dict[str, Any]:
    """The screenshot's market-summary block, adapted to our universe."""
    joined = inputs.get("joined") or []
    changes = [
        float(row["change_pct"])
        for row in joined
        if row.get("change_pct") is not None
    ]
    up = sum(1 for value in changes if value > FLAT_BAND)
    down = sum(1 for value in changes if value < -FLAT_BAND)
    flat = sum(1 for value in changes if -FLAT_BAND <= value <= FLAT_BAND)
    up5 = sum(1 for value in changes if value >= 5.0)
    down5 = sum(1 for value in changes if value <= -5.0)
    total = len(changes)
    average = sum(changes) / total if total else None

    with_ma50 = 0
    above_ma50 = 0
    near_high = 0
    near_low = 0
    with_52w = 0
    for row in joined:
        closes = _valid(row.get("closes"))
        price = row.get("price")
        if price is None:
            continue
        if len(closes) >= 50:
            with_ma50 += 1
            if float(price) > float(closes.tail(50).mean()):
                above_ma50 += 1
        if len(closes) >= 200:
            with_52w += 1
            highs = _valid(row.get("highs"))
            lows = _valid(row.get("lows"))
            high = float(highs.tail(252).max()) if len(highs) else float(closes.tail(252).max())
            low = float(lows.tail(252).min()) if len(lows) else float(closes.tail(252).min())
            if high > 0 and float(price) >= high * (1.0 - NEAR_52W_PCT / 100.0):
                near_high += 1
            if low > 0 and float(price) <= low * (1.0 + NEAR_52W_PCT / 100.0):
                near_low += 1

    breadth_pct = (up / (up + down) * 100.0) if (up + down) else 0.0
    above_ma50_pct = (above_ma50 / with_ma50 * 100.0) if with_ma50 else 0.0
    down5_pct = (down5 / total * 100.0) if total else 0.0
    bench = _benchmark_metrics(
        _as_series(inputs.get("benchmark")),
        inputs.get("benchmark_quote") if isinstance(inputs.get("benchmark_quote"), dict) else None,
    )

    return {
        "as_of": inputs.get("as_of"),
        "history_as_of": inputs.get("history_as_of").isoformat()
        if inputs.get("history_as_of")
        else None,
        "universe": {
            "total": total,
            "with_ma50": with_ma50,
            "with_52w": with_52w,
            "above_ma50": above_ma50,
            "near_52w_high": near_high,
            "near_52w_low": near_low,
            "near_52w_pct": NEAR_52W_PCT,
        },
        "ihsg": bench,
        "average_change_pct": round(average, 2) if average is not None else None,
        "up": up,
        "flat": flat,
        "down": down,
        "up5": up5,
        "down5": down5,
        "breadth_pct": round(breadth_pct, 2),
        "above_ma50_pct": round(above_ma50_pct, 2),
        "down5_pct": round(down5_pct, 2),
        "near_52w_high": near_high,
        "near_52w_low": near_low,
    }
