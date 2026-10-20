"""A momentum scan, transcribed from the study's `momentum` family.

The study measures a `momentum` entry (src/strategies.py:604): a name's own
n-session return above a threshold while the close holds above its 50-session
average. It is a *scan*, never a ticket: every measured row for the family sits
below the study's 80% win / +5% per trade bar (`hit_bar` is False on all of
them), so this surface shows the names and their honest numbers rather than
recommending them.
"""

from __future__ import annotations

from datetime import date
from typing import cast

import numpy as np
import pandas as pd

from . import idx as X
from . import method as M
from . import screen as S

# The "slip in on small momentum" entry: a 5% return over 60 sessions is the
# smallest threshold the study searched (thr in 0.05/0.10/0.15), paired with the
# family's own trend condition close > sma50. src/strategies.py:604.
MOM_N = 60
MOM_THR = 0.05
SMA_TREND_N = 50

# The take-profit exit: target 8x ATR14, stop 4x ATR14, 90-session cap. This is
# the only measured momentum exit with a positive post-cost average (+2.68% /
# 33.0% win). src/common.py EXIT_ATR. Near take-profits (fixed_2_10_40,
# fixed_3_12_40) lose money after costs and are shown in the ledger, not hidden.
EXIT_NAME = "atr_8_4"
TP_ATR = 8.0
SL_ATR = 4.0
HOLD_BARS = 90

LABEL = (
    "Measured, below the study's bar, never a ticket. The momentum family never "
    "clears 80% win rate and +5% per trade together; every row carries hit_bar "
    "False. This is a scan of what the rule would flag, not an order."
)


def entry_conditions(window: pd.DataFrame) -> dict[str, object] | None:
    """The momentum family's entry on one window, or None if it cannot read.

    Matches src/strategies.py `fam == "momentum"` exactly: `mom{n} > thr` and
    `close > sma50`, with `mom{n} = close / close.shift(n) - 1`.
    """
    if len(window) < MOM_N + 1:
        return None
    close = float(window["close"].iloc[-1])
    if not np.isfinite(close) or close <= 0:
        return None
    past = float(window["close"].iloc[-(MOM_N + 1)])
    if not np.isfinite(past) or past <= 0:
        return None
    mom = close / past - 1.0
    sma50 = float(cast(pd.Series, window["close"].rolling(SMA_TREND_N).mean()).iloc[-1])
    return {
        "mom_pct": round(100.0 * mom, 2),
        "sma50": round(sma50, 2),
        "passed": bool(mom > MOM_THR and close > sma50),
    }


def evaluate(frames, as_of: pd.Timestamp) -> list[dict[str, object]]:
    """Every name the momentum family would flag at one session."""
    rows: list[dict[str, object]] = []
    for code, frame in frames.bars.items():
        window = frame[frame["date"] <= as_of]
        if len(window) < MOM_N + 1 or window["date"].iloc[-1] != as_of:
            continue
        if not S.tradable(window)[0]:
            continue
        if not {"high", "low", "close"}.issubset(window.columns):
            continue
        cond = entry_conditions(window)
        if cond is None or not cond["passed"]:
            continue
        close = float(window["close"].iloc[-1])
        atr = float(S._atr14(window["high"], window["low"], window["close"]).iloc[-1])
        if not np.isfinite(atr) or atr <= 0:
            continue
        target = X.round_to_tick(close + TP_ATR * atr, "down")
        stop = X.round_to_tick(close - SL_ATR * atr, "down")
        turnover = S._median_turnover(window)
        position, participation, why = S.study_position(turnover)
        rows.append(
            {
                "ticker": code,
                "close": round(close, 2),
                "mom_pct": cond["mom_pct"],
                "sma50": cond["sma50"],
                "atr14_idr": round(atr, 2),
                "target_price": round(target, 2),
                "stop_price": round(stop, 2),
                "reward_risk": round(TP_ATR / SL_ATR, 2),
                "turnover_idr": turnover,
                "position_idr": round(position, 2) if position else None,
                "participation_pct": participation,
                "sizing_basis": why,
                "tick_idr": X.tick_for(close),
            }
        )
    rows.sort(key=lambda r: -cast(float, r["mom_pct"]))
    return rows


def momentum_ledger() -> list[dict[str, object]]:
    """Every measured momentum row, best average first, so the weak numbers are
    shown rather than replaced by a story."""
    out: list[dict[str, object]] = []
    for r in M._method_table_rows():
        if r.get("family") != "momentum":
            continue
        out.append(
            {
                "exit_method": r.get("exit_method"),
                "win_rate": M._f(r, "win_rate"),
                "avg_ret_pct": M._f(r, "avg_ret_pct"),
                "oos_trades": M._f(r, "oos_trades"),
                "cells": M._f(r, "cells"),
                "hit_bar": str(r.get("hit_bar", "")).strip().lower() == "true",
            }
        )
    return sorted(out, key=lambda d: -cast(float, d["avg_ret_pct"] or 0.0))


def scan(as_of: date | None = None) -> dict[str, object]:
    """The momentum scan at the current session (or an earlier one for replay)."""
    import app.plan as P

    source, label = P._active
    frames = P._load(source, label)
    session = frames.as_of()
    if session is None:
        raise RuntimeError("no benchmark bars available")
    when = session
    if as_of is not None:
        stamp = pd.Timestamp(as_of)
        if stamp < session:
            when = stamp

    hits = evaluate(frames, cast(pd.Timestamp, when))
    return {
        "method": "momentum",
        "family": "momentum",
        "entry": {
            "n": MOM_N,
            "thr": MOM_THR,
            "sma_trend_n": SMA_TREND_N,
            "description": (
                f"{MOM_N}-session return above {MOM_THR * 100:.0f}% while the close "
                f"holds above its {SMA_TREND_N}-session average."
            ),
        },
        "exit": {
            "name": EXIT_NAME,
            "tp_atr": TP_ATR,
            "sl_atr": SL_ATR,
            "hold_bars": HOLD_BARS,
            "description": (
                f"Take profit {TP_ATR:.0f}x ATR14 above entry, stop {SL_ATR:.0f}x "
                f"ATR14 below, {HOLD_BARS}-session cap."
            ),
        },
        "as_of": when.date().isoformat(),
        "hit_count": len(hits),
        "hits": hits,
        "evidence": M.evidence_for("momentum", EXIT_NAME).as_dict(),
        "ledger": momentum_ledger(),
        "label": LABEL,
    }
