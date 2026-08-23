"""Consolidated backtesting service.

Brings together the backtest logic from three source repos into one
canonical implementation:

- trading-simulator/backtester.py  (simulate_trades: 5% SL / 10% trailing,
  MACD/RSI/Stoch signals, JCI correlation)
- stock-backtester/backend/main.py (run_backtest)
- bot-trading-simulator/core/backtester.py (concepts: equity curve,
  per-trade records, fee/slippage model)

Indicators delegate to the canonical core/indicators.py.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from app.indicators import history_to_frame
from core.indicators import ema, macd, sma, stochastic_oscillator
from core.indicators import rsi as _rsi

STOP_LOSS_PCT = 0.05
TRAILING_STOP_PCT = 0.10
FEE_RATE = 0.0015  # IDX broker fee (0.15% — from bot backtester)
SLIPPAGE_RATE = 0.0015

STRATEGIES = (
    "tsmom",
    "momentum",
    "meanreversion",
    "buyhold",
    "pullback",
    "breakout",
    "mildmover",
    "golden_cross",
    "cross_3_5",
    "cross_9_21",
)
PATTERN_STRATEGIES = (
    "pullback",
    "breakout",
    "mildmover",
    "golden_cross",
    "cross_3_5",
    "cross_9_21",
)

# MA-cross family: golden-cross entry, death-cross exit ("stop").
_CROSS_MAS = {
    "golden_cross": ("sma", 20, 50),  # classic trend-following pair
    "cross_3_5": ("ema", 3, 5),  # fast scalp pair
    "cross_9_21": ("ema", 9, 21),  # swing pair
}


TSMOM_LOOKBACK = 252  # ~12 months of trading days

# Indicator warmup before a sub-window's trades count as valid
# (covers SMA50, MACD/RSI/Stoch and the 252-bar TSMOM lookback).
WARMUP_BARS = 260


def _signals(df: pd.DataFrame, strategy: str) -> pd.Series:
    """Return +1 buy / -1 sell / 0 hold signal series for a strategy."""
    close_s = pd.Series(df["Close"])
    macd_line, macd_signal_line, _ = macd(close_s)
    rsi_s = _rsi(close_s, 14)
    stoch_k, stoch_d = stochastic_oscillator(df)

    if strategy in _CROSS_MAS:
        # Golden cross -> hold -> death cross ("stop") — nothing in between.
        kind, fast_n, slow_n = _CROSS_MAS[strategy]
        ma = sma if kind == "sma" else ema
        fast, slow = ma(close_s, fast_n), ma(close_s, slow_n)
        sig = pd.Series(0, index=df.index)
        golden = (fast > slow) & (fast.shift(1) <= slow.shift(1))
        death = (fast < slow) & (fast.shift(1) >= slow.shift(1))
        sig[golden] = 1
        sig[death] = -1
        return sig

    if strategy == "pullback":
        # Dip-buy inside an uptrend: price above the 50sma but pulled back
        # below the 20sma with RSI cooling; exit on recovery or hot RSI.
        sig = pd.Series(0, index=df.index)
        sma50 = sma(close_s, 50)
        sma20 = sma(close_s, 20)
        buy = (
            (close_s > sma50)
            & (close_s < sma20)
            & (rsi_s < 45)
            & (sma50 > sma50.shift(5))  # trend still rising
        )
        sell = ((close_s > sma20) & (close_s.shift(1) <= sma20.shift(1))) | (rsi_s > 70)
        sig[buy] = 1
        sig[sell] = -1
        return sig

    if strategy == "breakout":
        # 20-bar high breakout entry; exit when price loses the 10-bar low.
        sig = pd.Series(0, index=df.index)
        prior_high = df["High"].rolling(20).max().shift(1)
        prior_low = df["Low"].rolling(10).min().shift(1)
        sig[close_s >= prior_high] = 1
        sig[close_s < prior_low] = -1
        return sig

    if strategy == "mildmover":
        # Volatility compression: five straight mild days (<2% move) inside a
        # range, betting on expansion; exit once a day moves hard (>4%).
        sig = pd.Series(0, index=df.index)
        chg = close_s.pct_change().abs()
        mild = (chg < 0.02).rolling(5).sum() == 5
        sig[mild & (chg < 0.02)] = 1
        sig[chg > 0.04] = -1
        return sig

    if strategy == "tsmom":
        # Time series momentum (Moskowitz, Ooi & Pedersen 2012): long while
        # the past 12-month own return is positive, exit when it turns
        # negative. One lookback, own price only — deliberately simple.
        ret_12m = close_s.pct_change(TSMOM_LOOKBACK)
        sig = pd.Series(0, index=df.index)
        sig[ret_12m > 0] = 1
        sig[ret_12m < 0] = -1
        return sig

    if strategy == "momentum":
        sig = pd.Series(0, index=df.index)
        cross_up = (macd_line > macd_signal_line) & (
            macd_line.shift(1) <= macd_signal_line.shift(1)
        )
        cross_dn = (macd_line < macd_signal_line) & (
            macd_line.shift(1) >= macd_signal_line.shift(1)
        )
        sig[cross_up] = 1
        sig[cross_dn] = -1
        # oversold bounce adds an extra buy trigger
        sig[(rsi_s < 30) & (rsi_s.shift(1) >= 30)] = 1
        return sig

    if strategy == "meanreversion":
        sig = pd.Series(0, index=df.index)
        # Stoch K/D cross below 80 -> sell; above 20 -> buy (from backtester.py)
        buy = (stoch_k > stoch_d) & (stoch_k.shift(1) <= stoch_d.shift(1)) & (stoch_d < 20)
        sell = (stoch_k < stoch_d) & (stoch_k.shift(1) >= stoch_d.shift(1)) & (stoch_d > 80)
        sig[buy] = 1
        sig[sell] = -1
        sig[rsi_s < 25] = 1
        sig[rsi_s > 75] = -1
        return sig

    # buyhold
    sig = pd.Series(0, index=df.index)
    sig.iloc[0] = 1
    return sig


def _f(value: Any, default: float = 0.0) -> float:
    """NaN-safe float conversion for DataFrame cell values."""
    try:
        v = float(value)
        return v if not math.isnan(v) else default
    except (TypeError, ValueError):
        return default


def _idx_date(idx: Any) -> str:
    """Safe date formatting for a DataFrame index element."""
    if hasattr(idx, "date"):
        return str(idx.date())
    return str(idx)


def run_backtest(
    history: list[dict[str, Any]],
    strategy: str = "momentum",
    initial_capital: float = 10_000_000.0,
    stop_loss_pct: float = STOP_LOSS_PCT,
    trailing_stop_pct: float = TRAILING_STOP_PCT,
    fee_rate: float = FEE_RATE,
    slippage_rate: float = SLIPPAGE_RATE,
    start_idx: int | None = None,
) -> dict[str, Any]:
    """Run a backtest over history records.

    Returns trades, equity curve, and performance stats. Mirrors the
    fill semantics of trading-simulator/backtester.py:simulate_trades but
    adds an equity curve, per-trade records and fees/slippage.

    ``start_idx`` skips simulation of the first N bars (indicator warmup)
    while still computing signals over the full series.
    """
    if strategy not in STRATEGIES:
        strategy = "momentum"
    df = history_to_frame(history)
    if start_idx:
        if start_idx >= len(df) - 30:
            return {
                "error": "Not enough data after warmup (need >= 30 bars)",
                "trades": [],
                "equity": [],
                "stats": {},
            }
        df = df.iloc[start_idx:].reset_index(drop=False)
        df = df.set_index(df.columns[0])
    if len(df) < 30:
        return {
            "error": "Not enough data (need >= 30 bars)",
            "trades": [],
            "equity": [],
            "stats": {},
        }

    signals = _signals(df, strategy)

    trades: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    cash = initial_capital
    holding = False
    entry_price = 0.0
    entry_date = None
    shares = 0
    highest_price = 0.0

    for i, (date, row) in enumerate(df.iterrows()):
        close = _f(row.get("Close"))
        low = _f(row.get("Low"))
        high = _f(row.get("High"))
        date_str = _idx_date(df.index[i])

        if not holding:
            if signals.loc[date] == 1:
                holding = True
                entry_price = close * (1 + slippage_rate)
                entry_date = date_str
                try:
                    shares = int(cash // max(entry_price * (1 + fee_rate), 1.0))
                except (ValueError, ZeroDivisionError):
                    shares = 0
                cash -= shares * entry_price * (1 + fee_rate)
                highest_price = entry_price
        else:
            highest_price = max(highest_price, high)

            trigger = None
            sell_price = close * (1 - slippage_rate)

            if low <= entry_price * (1 - stop_loss_pct):
                trigger = "Stop Loss"
                sell_price = entry_price * (1 - stop_loss_pct) * (1 - slippage_rate)
            elif low <= highest_price * (1 - trailing_stop_pct) and highest_price > entry_price:
                trigger = "Trailing Stop"
                sell_price = highest_price * (1 - trailing_stop_pct) * (1 - slippage_rate)
            elif signals.loc[date] == -1:
                trigger = "Exit Signal"
                sell_price = close * (1 - slippage_rate)

            if trigger:
                proceeds = shares * sell_price
                fee = proceeds * fee_rate
                cash += proceeds - fee
                profit_pct = (sell_price - entry_price) / entry_price * 100
                trades.append(
                    {
                        "entry_date": entry_date,
                        "exit_date": date_str,
                        "trigger": trigger,
                        "entry_price": round(entry_price, 4),
                        "exit_price": round(sell_price, 4),
                        "shares": shares,
                        "profit_pct": round(profit_pct, 2),
                        "pnl_idr": round(
                            proceeds - fee - (shares * entry_price * (1 + fee_rate)), 0
                        ),
                    }
                )
                holding = False
                shares = 0
                highest_price = 0.0

        equity_value = cash + (shares * close if holding else 0)
        equity.append({"date": _idx_date(df.index[i]), "value": round(equity_value, 0)})

    # Mark-to-market final position
    if holding:
        last_close = _f(df["Close"].iloc[-1])
        final_value = cash + shares * last_close
        final_pnl = final_value - initial_capital
        trades.append(
            {
                "entry_date": entry_date,
                "exit_date": _idx_date(df.index[-1]),
                "trigger": "Open Position (MTM)",
                "entry_price": round(entry_price, 4),
                "exit_price": round(last_close, 4),
                "shares": shares,
                "profit_pct": round((last_close - entry_price) / entry_price * 100, 2),
                "pnl_idr": round(final_pnl, 0),
            }
        )

    stats = _compute_stats(trades, equity, initial_capital, df, strategy)
    return {"trades": trades, "equity": equity, "stats": stats}


def _compute_stats(
    trades: list[dict[str, Any]],
    equity: list[dict[str, Any]],
    initial_capital: float,
    df: pd.DataFrame,
    strategy: str,
) -> dict[str, Any]:
    wins = [t for t in trades if t["profit_pct"] > 0]
    losses = [t for t in trades if t["profit_pct"] <= 0]

    if equity:
        values = [e["value"] for e in equity]
        peak = values[0]
        max_dd = 0.0
        for v in values:
            peak = max(peak, v)
            if peak > 0:
                max_dd = min(max_dd, (v - peak) / peak)
        final_value = values[-1]
        total_return = (final_value - initial_capital) / initial_capital * 100
    else:
        max_dd, final_value, total_return = 0.0, initial_capital, 0.0

    buyhold_ret = 0.0
    if len(df) >= 2:
        first_close = _f(df["Close"].iloc[0])
        last_close = _f(df["Close"].iloc[-1])
        if first_close > 0:
            buyhold_ret = (last_close - first_close) / first_close * 100

    # Annualized return approximation over the bar span
    n_days = max(len(df), 1)
    years = n_days / 252
    annualized = (
        ((1 + total_return / 100) ** (1 / years) - 1) * 100
        if years > 0 and total_return > -100
        else 0.0
    )

    avg_win = sum(t["profit_pct"] for t in wins) / len(wins) if wins else 0.0
    avg_loss = sum(t["profit_pct"] for t in losses) / len(losses) if losses else 0.0

    return {
        "strategy": strategy,
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(trades) * 100, 2) if trades else 0.0,
        "avg_win_pct": round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "total_return_pct": round(total_return, 2),
        "annualized_return_pct": round(annualized, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "final_value": round(final_value, 0),
        "buyhold_return_pct": round(buyhold_ret, 2),
        "profit_factor": round(
            sum(t["profit_pct"] for t in wins) / abs(sum(t["profit_pct"] for t in losses)), 2
        )
        if losses and sum(t["profit_pct"] for t in losses) != 0
        else None,
        "fees_pct": fee_note(),
    }


def fee_note() -> str:
    return f"broker {FEE_RATE * 100:.2f}% + slippage {SLIPPAGE_RATE * 100:.2f}%"


def walk_forward(
    history: list[dict[str, Any]],
    strategy: str,
    initial_capital: float = 10_000_000.0,
) -> dict[str, Any] | None:
    """Rough out-of-sample check: backtest the first half (in-sample) and
    the second half (out-of-sample, with a warmup overlap so indicators
    are defined). Flags when a strategy only worked in-sample.

    Fixed-rule strategies aren't tuned on this data, so this is an
    underperformance guard, not a full walk-forward optimization harness.
    Returns None when there isn't enough data to split meaningfully.
    """
    n = len(history)
    half = n // 2
    if half < WARMUP_BARS + 30 or n - half < 30:
        return None
    ins = run_backtest(history[:half], strategy, initial_capital)
    oos = run_backtest(
        history[half - WARMUP_BARS :], strategy, initial_capital, start_idx=WARMUP_BARS
    )
    is_stats, oos_stats = ins.get("stats") or {}, oos.get("stats") or {}
    if "total_return_pct" not in is_stats or "total_return_pct" not in oos_stats:
        return None
    is_ret = round(_f(is_stats.get("total_return_pct")), 2)
    oos_ret = round(_f(oos_stats.get("total_return_pct")), 2)
    # Consistent = OOS didn't lose money while IS made it.
    consistent = not (is_ret > 0 and oos_ret < 0)
    return {
        "is_return_pct": is_ret,
        "oos_return_pct": oos_ret,
        "consistent": consistent,
    }


def pattern_backtests(ticker: str, force: bool = False) -> dict[str, Any]:
    """Run the pullback / breakout / mild-mover pattern backtests over ~1y
    of the same history the profiler charts. Each strategy shares the
    engine's fee/slippage/stop model; buy-and-hold comes free in stats."""
    # Late import avoids a market <-> backtest cycle at module load.
    from app.market import fetch_history

    history = fetch_history(ticker, period="1y", interval="1d", force=force)
    strategies: dict[str, Any] = {}
    for strat in PATTERN_STRATEGIES:
        out = run_backtest(history, strategy=strat)
        trades = out.get("trades") or []
        strategies[strat] = {
            "stats": out.get("stats") or {},
            "error": out.get("error"),
            "recent_trades": trades[-3:][::-1],  # newest first
        }
    return {
        "ticker": ticker,
        "available": len(history) >= 30,
        "bars": len(history),
        "fee_note": fee_note(),
        "strategies": strategies,
    }
