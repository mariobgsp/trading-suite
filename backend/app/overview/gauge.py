"""A transparent market-stress gauge.

The six components are the vocabulary the dashboard needs: breadth, the share
above MA50, the 52-week high/low balance, momentum versus MA100, 20-day
volatility, and the share falling at least 5%. The weights are ours, published
in the payload, and the page labels the result as a composite rather than an
official index.
"""

from __future__ import annotations

from typing import Any

WEIGHTS = {
    "breadth": 0.25,
    "above_ma50": 0.20,
    "high_low": 0.15,
    "momentum": 0.15,
    "volatility": 0.15,
    "down5": 0.10,
}

BANDS = (
    (25.0, "panic", "Panic"),
    (50.0, "fear", "Fear"),
    (65.0, "neutral", "Neutral"),
    (85.0, "greed", "Greed"),
    (100.1, "extreme_greed", "Extreme greed"),
)


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _linear(value: float | None, low: float, high: float) -> float:
    if value is None or high == low:
        return 50.0
    return _clamp((value - low) / (high - low) * 100.0)


def _inverse(value: float | None, low: float, high: float) -> float:
    return 100.0 - _linear(value, low, high)


def _band(value: float) -> tuple[str, str]:
    for ceiling, key, label in BANDS:
        if value < ceiling or ceiling >= 100.0:
            return key, label
    return "neutral", "Neutral"


def build(summary: dict[str, Any]) -> dict[str, Any]:
    high = float(summary.get("near_52w_high") or 0)
    low = float(summary.get("near_52w_low") or 0)
    balance = ((high - low) / (high + low)) if (high + low) else 0.0
    momentum = summary.get("ihsg", {}).get("momentum_vs_ma100_pct")
    volatility = summary.get("ihsg", {}).get("volatility_20d_pct")

    components = [
        {
            "key": "breadth",
            "label": "Breadth hari ini",
            "raw": summary.get("breadth_pct"),
            "score": _clamp(float(summary.get("breadth_pct") or 0.0)),
            "unit": "%",
            "greed_direction": "up",
        },
        {
            "key": "above_ma50",
            "label": "Di atas MA50",
            "raw": summary.get("above_ma50_pct"),
            "score": _clamp(float(summary.get("above_ma50_pct") or 0.0)),
            "unit": "%",
            "greed_direction": "up",
        },
        {
            "key": "high_low",
            "label": "Net high / low 52 minggu",
            "raw": [int(high), int(low)],
            "score": _clamp((balance + 1.0) / 2.0 * 100.0),
            "unit": "H/L",
            "greed_direction": "up",
        },
        {
            "key": "momentum",
            "label": "Momentum vs MA100",
            "raw": momentum,
            "score": _linear(momentum, -10.0, 10.0),
            "unit": "%",
            "greed_direction": "up",
        },
        {
            "key": "volatility",
            "label": "Volatilitas 20 hari",
            "raw": volatility,
            "score": _inverse(volatility, 10.0, 70.0),
            "unit": "% p.a.",
            "greed_direction": "down",
        },
        {
            "key": "down5",
            "label": "Saham jatuh ≥ 5%",
            "raw": summary.get("down5_pct"),
            "score": _inverse(summary.get("down5_pct"), 0.0, 20.0),
            "unit": "%",
            "greed_direction": "down",
        },
    ]
    for component in components:
        component["weight"] = WEIGHTS[component["key"]]
        component["score"] = round(float(component["score"]), 1)
    value = round(sum(component["score"] * component["weight"] for component in components), 1)
    band_key, band_label = _band(value)
    return {
        "value": value,
        "band": band_key,
        "band_label": band_label,
        "components": components,
        "weights": dict(WEIGHTS),
        "note": (
            "Our composite of six market-breadth and risk components. "
            "It is not an official index and has no external parity claim."
        ),
    }
