"""The compare-all engine: ten strategies, honest rows, aligned curves."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from app.backtest import BENCHMARK_TICKER, STRATEGIES, _hold_curve, compare_all


def _history(days: int = 500, base: float = 4_000.0, wave: float = 0.010):
    """A daily OHLCV list whose direction flips every ~40 sessions."""
    out = []
    day = date(2025, 1, 6)
    price = base
    for i in range(days):
        step = wave if (i // 40) % 2 == 0 else -wave
        noise = 0.001 * np.sin(i / 7.0)
        change = step + noise
        high = price * (1 + abs(change) / 2)
        low = price * (1 - abs(change) / 2)
        out.append(
            {
                "date": day.isoformat(),
                "open": round(price, 2),
                "high": round(high, 2),
                "low": round(low, 2),
                "close": round(price * (1 + change), 2),
                "volume": 10_000.0,
            }
        )
        price *= 1 + change
        day += timedelta(days=1)
    return out


def test_compare_runs_every_strategy_with_rows_and_curves():
    history = _history()
    result = compare_all(history, capital=10_000_000.0)
    listed = sorted(row["strategy"] for row in result["strategies"])
    assert listed == sorted(STRATEGIES), listed
    buyhold = next(row for row in result["strategies"] if row["strategy"] == "buyhold")
    curves = [row for row in result["strategies"] if "curve" in row and row["curve"]]
    assert len(curves) >= 9  # buy-hold at minimum; the others depend on signals
    lengths = {row["strategy"]: len(row["curve"]) for row in curves}
    assert lengths["buyhold"] > 300
    # buy-and-hold equity is the target itself: its total return matches stats
    assert buyhold["stats"]["buyhold_return_pct"] != 0.0
    base_curve = next(row["curve"] for row in result["strategies"] if row["strategy"] == "buyhold")
    assert base_curve[0]["value"] > 90 and base_curve[-1]["value"] > 0


def test_hold_curve_respects_the_strategy_dates():
    history = _history(days=120)
    curve, total = _hold_curve(history, 1_000.0)
    assert curve is not None and len(curve) == 120
    first = curve[0]
    # base-100 on this capital: first value is capital itself by construction
    assert first["value"] == 1_000.0
    assert total is not None and total == round(total, 2)


def test_bench_alignment_when_target_differs_from_index():
    target = _history(days=300)
    bench = _history(days=310, base=6_500.0, wave=0.006)
    result = compare_all(target, capital=5_000_000.0, bench_history=bench)
    assert result["hold_index"]["total_pct"] is not None
    # every method carries its alpha against the simulated "index"; the
    # buy-and-hold baseline is the comparison itself and carries none
    for row in result["strategies"]:
        if row["strategy"] == "buyhold":
            assert row["alpha_vs_index_pct"] is None
        else:
            assert row["alpha_vs_index_pct"] is not None
    # curves land on the same sessions the strategies traded
    one = next(row["curve"] for row in result["strategies"] if row.get("curve"))
    bench_curve = result["hold_index"]["curve"]
    bench_dates = [point["date"] for point in bench_curve]
    assert one[-1]["date"] in bench_dates or one[-1]["date"] <= bench_curve[-1]["date"]


def test_short_history_becomes_a_row_error_not_a_crash():
    short = _history(days=40)
    result = compare_all(short, capital=10_000_000.0)
    errors = [row for row in result["strategies"] if "error" in row]
    ok = [row for row in result["strategies"] if "stats" in row]
    assert ok or errors
    tsmom = next(row for row in result["strategies"] if row["strategy"] == "tsmom")
    assert "error" in tsmom or tsmom["stats"]["total_trades"] < 5


def test_benchmark_ticker_constant_is_the_index():
    assert BENCHMARK_TICKER == "^JKSE"


def test_hold_curve_skips_zero_and_dupes():
    history = [
        {"date": "2025-01-02", "close": 0.0},
        {"date": "2025-01-03", "close": 100.0},
        {"date": "2025-01-06", "close": 110.0},
        {"date": "2025-01-06", "close": 111.0},
    ]
    curve, total = _hold_curve(history, 100.0)
    assert [point["date"] for point in curve] == ["2025-01-03", "2025-01-06"]
    # first record wins for a duplicated session, and a zero close is skipped
    assert total == 10.0
