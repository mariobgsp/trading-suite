"""Session movers, the daily sector table, and the IHSG contribution split.

Everything here is a pure function of the dashboard's joined universe plus the
summary that the snapshot build computes first. No network, no database, easy to
unit-test.

The contribution split is explicitly a proxy: IHSG publishes float-adjusted
weights that this store does not carry, so each name's weight is its share of
the reported market capitalisation, and the model is rescaled by one published
factor so the parts sum to the index's own daily change. The UI repeats that in
plain language; nothing here claims official weighting.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

TOP_MOVERS = 8
TOP_CONTRIBUTORS = 5
# Below this the rescale factor would multiply noise (a sum of ±0.01`pp` on a
# flat index), so the model ships uncalibrated and says so.
MIN_CONTRIBUTION_MODEL = 0.02
TAIL_SESSIONS = 120


def _num(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _lite(row: dict[str, Any], value: float | None = None) -> dict[str, Any]:
    """The bounded row the API ships: ticker, name, price, change, value."""
    return {
        "ticker": row["ticker"],
        "name": row.get("name") or row["ticker"],
        "price": _round(_num(row.get("price"))),
        "change_pct": _round(_num(row.get("change_pct"))),
        "value": _round(value, 0),
    }


# ── movers ──────────────────────────────────────────────────────────────────


def build_movers(joined: list[dict[str, Any]]) -> dict[str, Any]:
    """Top gainers, losers, and most active.

    The headline that belongs in this block: `value` is an estimate
    (price × volume, in rupiah) because the scan carries shares, not turnover.
    The UI labels it an estimate wherever the column shows.
    """
    rows = [
        row
        for row in joined
        if _num(row.get("price")) is not None and _num(row.get("change_pct")) is not None
    ]
    ordered = sorted(rows, key=lambda row: _num(row["change_pct"]) or 0.0, reverse=True)
    gainers = [row for row in ordered if (_num(row["change_pct"]) or 0.0) > 0][:TOP_MOVERS]
    losers = [
        row for row in reversed(ordered) if (_num(row["change_pct"]) or 0.0) < 0
    ][:TOP_MOVERS]

    valued = [
        _lite(row, (_num(row["price"]) or 0.0) * (_num(row.get("volume")) or 0.0))
        for row in rows
        if (_num(row.get("volume")) or 0.0) > 0
    ]
    most_active = sorted(valued, key=lambda row: row["value"] or 0.0, reverse=True)[
        :TOP_MOVERS
    ]

    return {
        "available": bool(rows),
        "reason": None if rows else "no_priced_rows",
        "gainers": [_lite(row) for row in gainers],
        "losers": [_lite(row) for row in losers],
        "most_active": most_active,
        "value_note": "perkiraan nilai transaksi = harga × volume (lembar)",
    }


# ── sector day ──────────────────────────────────────────────────────────────


def build_sector_day(joined: list[dict[str, Any]]) -> dict[str, Any]:
    """One row per sector for the day: average change, internal breadth, leaders."""
    sectors: dict[str, list[tuple[dict[str, Any], float]]] = {}
    for row in joined:
        change = _num(row.get("change_pct"))
        if change is None:
            continue
        key = (row.get("sector") or "").strip() or "Unsectored"
        sectors.setdefault(key, []).append((row, change))

    out = []
    for sector, members in sectors.items():
        members.sort(key=lambda pair: pair[1], reverse=True)
        up = sum(1 for _, change in members if change > 0)
        down = sum(1 for _, change in members if change < 0)
        best, best_change = members[0]
        worst, worst_change = members[-1]
        out.append(
            {
                "sector": sector,
                "members": len(members),
                "avg_change_pct": _round(
                    sum(change for _, change in members) / len(members)
                ),
                "up": up,
                "down": down,
                "flat": len(members) - up - down,
                "best": {"ticker": best["ticker"], "change_pct": _round(best_change)}
                if best_change > 0
                else None,
                "worst": {"ticker": worst["ticker"], "change_pct": _round(worst_change)}
                if worst_change < 0
                else None,
            }
        )

    out.sort(
        key=lambda row: (
            row["avg_change_pct"] if row["avg_change_pct"] is not None else -999.0
        ),
        reverse=True,
    )
    return {"available": bool(out), "reason": None if out else "no_sector_rows", "sectors": out}


# ── index contribution ──────────────────────────────────────────────────────


def build_index_contribution(
    joined: list[dict[str, Any]], market: dict[str, Any] | None
) -> dict[str, Any]:
    """Who moved IHSG, as a cap-weight proxy rescaled to the index's own change.

    Without the rescale, missing float-adjustments and gaps in the cap field
    would let the parts drift from the whole; with it, the bars the UI shows
    always sum to (approximately) the day's index change the hero prints. The
    uncalibrated model sum is published beside the factor, so the rescale is
    checkable instead of invisible.
    """
    ihsg = ((market or {}).get("ihsg") or {})
    actual = _num(ihsg.get("change_pct"))

    weighted = [
        (row["ticker"], _num(row["change_pct"]) or 0.0, _num(row["market_cap"]) or 0.0)
        for row in joined
        if (_num(row.get("market_cap")) or 0.0) > 0 and row.get("change_pct") is not None
    ]
    if not weighted:
        return {
            "available": False,
            "reason": "no_market_cap_for_any_priced_name",
            "top": [],
            "bottom": [],
            "model_change_pct": None,
            "actual_change_pct": actual,
            "factor": None,
            "n_used": 0,
        }

    total = sum(cap for _, _, cap in weighted)
    modelled = [
        (ticker, change, cap / total, change * (cap / total))
        for ticker, change, cap in weighted
    ]
    model_sum = sum(model for _, _, _, model in modelled)

    factor = 1.0
    note = "uncalibrated"
    if actual is not None and abs(model_sum) >= MIN_CONTRIBUTION_MODEL:
        factor = actual / model_sum
        note = "calibrated"
    elif actual is None:
        note = "no_index_change"

    moved = [
        {
            "ticker": ticker,
            "weight_pct": _round(weight * 100.0),
            "change_pct": _round(change),
            "contribution_pct": _round(model * factor),
        }
        for ticker, change, weight, model in modelled
        if abs(model) > 1e-9
    ]
    moved.sort(key=lambda row: row["contribution_pct"], reverse=True)
    # Sign makes the split, not rank position: a quiet day with two movers must
    # not print the same name twice, and an all-down day shows no contributor.
    contributors = [row for row in moved if row["contribution_pct"] > 0]
    detractors = [row for row in moved if row["contribution_pct"] < 0]
    detractors.reverse()
    contributors = contributors[:TOP_CONTRIBUTORS]
    detractors = detractors[:TOP_CONTRIBUTORS]

    moved_any = bool(contributors or detractors)
    return {
        "available": moved_any,
        "reason": None if moved_any else ("index_unchanged" if model_sum == 0 else note),
        "top": contributors,
        "bottom": detractors,
        "calibration": note,
        "model_change_pct": _round(model_sum),
        "actual_change_pct": actual,
        "factor": _round(factor, 3),
        "n_used": len(weighted),
    }


# ── benchmark tail ──────────────────────────────────────────────────────────


def build_benchmark_tail(
    benchmark: Any, quote: dict[str, Any] | None, print_date: Any
) -> dict[str, Any]:
    """The benchmark's last sessions for the hero sparkline.

    The quote's close is appended only when it is newer than the series' last
    session, so the sparkline never duplicates or rewrites a settled bar.
    """
    series = benchmark if isinstance(benchmark, pd.Series) else pd.Series(dtype=float)
    series = pd.to_numeric(series, errors="coerce").dropna()
    series = series[~series.index.duplicated(keep="last")].sort_index()

    stamp = pd.Timestamp(print_date) if print_date is not None else None
    close = _num((quote or {}).get("close"))
    if stamp is not None and close is not None and (len(series) == 0 or stamp > series.index.max()):
        series = pd.concat([series, pd.Series({stamp: close})])

    series = series.tail(TAIL_SESSIONS)
    points = [
        {"date": stamp.date().isoformat(), "close": _round(value)}
        for stamp, value in series.items()
        if _num(value) is not None
    ]
    return {
        "available": bool(points),
        "reason": None if points else "no_benchmark_history",
        "points": points,
        "as_of": points[-1]["date"] if points else None,
    }


def build(inputs: dict[str, Any], market: dict[str, Any]) -> dict[str, Any]:
    """Every move-derived block for the snapshot, in one call."""
    joined = inputs.get("joined") or []
    quote = (
        inputs.get("benchmark_quote")
        if isinstance(inputs.get("benchmark_quote"), dict)
        else None
    )
    return {
        "movers": build_movers(joined),
        "sector_day": build_sector_day(joined),
        "index_contribution": build_index_contribution(joined, market),
        "benchmark_tail": build_benchmark_tail(
            inputs.get("benchmark"), quote, inputs.get("print_date")
        ),
    }
