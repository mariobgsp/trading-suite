"""The monthly gate and the full-series signal contract.

Two properties the compare engine must keep:

  * the Faber gate judges month-end closes only, so every signal lands on a
    month's final bar - a mid-month flip would be an invention;
  * ``start_idx`` trims the simulation, never the signals: a strategy whose
    lookback reaches before the window must still be able to trade inside it.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import cast

import pandas as pd

from app.backtest import (
    SIM_WINDOW_BARS,
    _signals,
    history_to_frame,
    pattern_backtests,
    run_backtest,
)


def _rising(days: int, base: float = 4_000.0, step: float = 0.002) -> list[dict]:
    """A daily OHLCV list that only ever rises, one calendar bar per day."""
    out: list[dict] = []
    day = date(2024, 1, 1)
    price = base
    for _ in range(days):
        close = price * (1 + step)
        out.append(
            {
                "date": day.isoformat(),
                "open": round(price, 2),
                "high": round(close * 1.001, 2),
                "low": round(price * 0.999, 2),
                "close": round(close, 2),
                "volume": 10_000.0,
            }
        )
        price = close
        day += timedelta(days=1)
    return out


def test_the_gate_judges_month_ends_only():
    history = _rising(420)  # ~14 months, monotonic rise
    df = history_to_frame(history)
    sig = _signals(df, "gate_sma200")
    events = cast("pd.Series", sig[sig != 0])

    assert (sig == 1).sum() == 1, "a monotonic rise turns the gate on exactly once"
    assert (sig == -1).sum() == 0, "a monotonic rise never turns the gate off"

    month_end: dict[tuple[int, int], object] = {}
    for stamp in cast("pd.DatetimeIndex", df.index):
        key = (stamp.year, stamp.month)
        if key not in month_end or stamp > month_end[key]:  # type: ignore[operator]
            month_end[key] = stamp
    for stamp in cast("pd.DatetimeIndex", events.index):
        assert stamp == month_end[(stamp.year, stamp.month)], (
            f"gate signal off a month's final bar: {stamp}"
        )


def test_start_idx_trims_the_simulation_not_the_signals():
    history = _rising(600)
    out = run_backtest(history, strategy="tsmom", initial_capital=10_000_000.0, start_idx=560)
    assert "error" not in out, out.get("error")
    stats = out["stats"]
    assert stats["total_trades"] >= 1, (
        "tsmom needs a 252-bar lookback that starts before the window; signals "
        "must read the full series or a trimmed tail can never trade"
    )


def test_pattern_backtests_simulate_one_warm_year(monkeypatch):
    history = _rising(780)  # ~3 years fetched, one year simulated
    monkeypatch.setattr("app.market.fetch_history", lambda *a, **k: history)
    result = pattern_backtests("AAA")

    assert result["available"] is True
    assert result["bars"] == SIM_WINDOW_BARS
    gate = result["strategies"]["gate_sma200"]
    assert not gate["error"], gate["error"]
    assert "total_return_pct" in gate["stats"], "the gate row must carry stats"
    for row in result["strategies"].values():
        assert row["label"], "every row carries the backend-owned label"
