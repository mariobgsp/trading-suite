"""Signal-quality harness for the bandarmology flow signal.

Not a strategy backtester — measures *classification accuracy* of the
NET BUY / NET SELL label against the sign of the next N-day return.

Walks the same frame the validator builds, picks the sign of the chosen
flow column at bar t, compares it to sign(Close[t+horizon] - Close[t]).
Reports overall hit rate plus breakdown by liquidity tier and year, so we
can tell whether a refactor helped on blue-chips but hurt on small caps
(or vice versa).

Usage:
    from app.flow_accuracy import baseline_signal_accuracy
    baseline_signal_accuracy(history)                     # current inst_flow_ma
    baseline_signal_accuracy(history, flow_col="cvd_ma5") # refactored column
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from app.indicators import history_to_frame

DEFAULT_HORIZON = 5
DEFAULT_FLOW_COL = "inst_flow_ma"
MIN_BARS = 60  # need 30 for indicators + 30 to score at least one prediction

# Mirror validator's check_liquidity thresholds so tier bucketing matches
# what the UI already shows.
def _tier(avg_value_idr: float) -> str:
    if avg_value_idr > 10_000_000_000:
        return "high"
    if avg_value_idr > 1_000_000_000:
        return "liquid"
    if avg_value_idr > 200_000_000:
        return "small"
    return "illiquid"


def _safe_sign(x: float) -> int | None:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    if x > 0:
        return 1
    if x < 0:
        return -1
    return 0  # flat — excluded from hit rate by convention


def _safe_int(x: Any) -> int:
    try:
        return int(x)
    except (TypeError, ValueError):
        return 0


def _hit_rate(preds: list[int], acts: list[int]) -> dict[str, Any] | None:
    """Fraction of (pred, act) pairs where signs agree.

    Excludes bars where either side is NaN or exactly zero — we only
    score cases where the model actually made a directional call.
    """
    pairs = [(p, a) for p, a in zip(preds, acts) if p in (1, -1) and a in (1, -1)]
    if not pairs:
        return None
    correct = sum(1 for p, a in pairs if p == a)
    return {
        "n": len(pairs),
        "correct": correct,
        "hit_rate_pct": round(correct / len(pairs) * 100, 2),
    }


def baseline_signal_accuracy(
    history: list[dict[str, Any]],
    horizon: int = DEFAULT_HORIZON,
    flow_col: str = DEFAULT_FLOW_COL,
    compute_flows: Any = None,
) -> dict[str, Any]:
    """Measure directional hit rate of the flow signal.

    Args:
        history: OHLCV history records (same shape as app.market.fetch_history).
        horizon: forward-return horizon in bars (default 5 trading days).
        flow_col: column name to read the flow signal from. For the current
            validator this is "inst_flow_ma". After the CVD refactor it is
            "cvd_ma5". Any other column the caller has added also works.
        compute_flows: optional callable(df) that mutates df to add the
            desired flow columns (e.g. compute_advanced_metrics). If
            None, the frame is expected to already contain flow_col.

    Returns:
        Dict with ``overall``, ``by_tier``, ``by_year``, ``n_bars``,
        ``flow_col``, ``horizon``. Empty tiers are omitted.
    """
    df = history_to_frame(history)
    if len(df) < MIN_BARS:
        return {
            "error": f"Not enough data (need >= {MIN_BARS} bars, got {len(df)})",
            "flow_col": flow_col,
            "horizon": horizon,
        }

    if compute_flows is not None:
        df = compute_flows(df)

    if flow_col not in df.columns:
        return {
            "error": f"flow_col '{flow_col}' not in frame; "
            f"available: {list(df.columns)}",
            "flow_col": flow_col,
            "horizon": horizon,
        }

    # Forward return (horizon bars ahead). NaN for the last `horizon` rows.
    fwd = df["Close"].shift(-horizon) - df["Close"]
    pred = df[flow_col]
    actual = fwd.apply(_safe_sign)
    predicted = pred.apply(_safe_sign)

    # Per-bar rows: only score where we have a prediction AND a future return.
    valid_mask = (
        df[flow_col].notna()
        & fwd.notna()
    )
    if not valid_mask.any():
        return {
            "error": "No bars with both a flow value and a forward return",
            "flow_col": flow_col,
            "horizon": horizon,
        }

    preds_valid = predicted[valid_mask].tolist()
    acts_valid = actual[valid_mask].tolist()
    overall = _hit_rate(preds_valid, acts_valid)

    # Per-tier breakdown: tier is a property of the ticker, not the bar,
    # but we only have one ticker per call. Tier comes from the 20-bar
    # average daily value (same definition as validator.check_liquidity).
    last_avg = (df["Close"] * df["Volume"]).rolling(20).mean().iloc[-1]
    try:
        avg_value_idr = float(last_avg) if pd.notna(last_avg) else 0.0
    except (TypeError, ValueError):  # noqa: BLE001
        avg_value_idr = 0.0
    tier = _tier(avg_value_idr)
    by_tier = {tier: _hit_rate(preds_valid, acts_valid)} if overall else {}

    # Per-year breakdown: iterate years, slice preds/acts. The history
    # index is a DatetimeIndex (set in history_to_frame); assert it so
    # pyright can see .year.
    if not isinstance(df.index, pd.DatetimeIndex):
        return {
            "error": "history_to_frame did not return a DatetimeIndex; "
            f"got {type(df.index).__name__}",
            "flow_col": flow_col,
            "horizon": horizon,
        }
    years_in_scope: list[int] = []
    for ts in df.index[valid_mask]:
        try:
            years_in_scope.append(int(ts.year))
        except AttributeError:
            continue
    years = sorted(set(years_in_scope))
    by_year: dict[str, dict[str, Any]] = {}
    for y in years:
        # Compare via int (DatetimeIndex.year is a property on the values
        # array, not the index — pyright can't see it through the
        # generic Index type).
        year_mask = valid_mask & (df.index.to_series().dt.year == y)
        if not year_mask.any():
            continue
        yr_pred = predicted[year_mask].tolist()
        yr_act = actual[year_mask].tolist()
        hit = _hit_rate(yr_pred, yr_act)
        if hit is not None:
            by_year[str(y)] = hit

    return {
        "flow_col": flow_col,
        "horizon": horizon,
        "n_bars": _safe_int(len(df)),
        "n_scored": _safe_int(
            sum(1 for p in preds_valid if p in (1, -1))
        ),
        "tier": tier,
        "avg_value_idr": round(avg_value_idr, 0),
        "overall": overall,
        "by_tier": by_tier,
        "by_year": by_year,
    }
