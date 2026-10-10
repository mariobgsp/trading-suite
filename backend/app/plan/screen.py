"""The implementation behind the seam: feature panels, the gate chain, geometry.

Everything here is derived from `method.py`'s constants, so the rule chain and
the numbers the UI shows can never drift apart. The study's semantics are kept
exactly, including the details that a rewrite usually gets wrong:

  * the Donchian high is `rolling(40).max().shift(1)` - the current bar is
    excluded, so a breakout is a breakout and not a tautology;
  * relative strength is a cross-sectional percentile of 120-session momentum,
    recomputed across every name that has data on that date, so the threshold
    means the same thing on a day when 40 names are suspended as on a day when
    none are;
  * breadth is the share of the universe above its own 200-session average, and
    it is a *market* gate: it closes the whole plan, not one name;
  * the weekly bar labelled Friday is only known from Saturday, so the weekly
    gate is merged as-of, never same-bar.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable

import numpy as np
import pandas as pd

from . import method as M
from .bars import Frames
from .model import Candidate, Gate, GateKey, Geometry, Regime, WatchItem

# A name with no volatility at all is a halted or degenerate series, and it
# passes the "quiet" gate for free (0 <= 0). Drop it rather than recommend it.
MIN_VOL20 = 0.05
# A series whose close is unchanged on this share of sessions is not trading.
# An audit of the study found 7.0% of its trades came from such names — one
# ticker alone supplied 4.2% — and every signal on a frozen series is a breakout
# nobody could have filled. Excluding them moved the study's own headline from
# 78.48% to 76.32% win, so the gate is not cosmetic.
MAX_FROZEN_FRACTION = 0.50
# Liquidity, from the shipped screener spec (docs/21 §1). The study's own
# universe used 1bn; the shipped screen lowered it to 250m for thin names and
# pairs it with an ADV cap so a position is still fillable.
MIN_TURNOVER_IDR = 250_000_000.0
MIN_PRICE_IDR = 50.0
TURNOVER_WINDOW = 60
# A "breakout" of more than this over the 40-day high is a gap or a corporate
# action, not a breakout, and the study's geometry would never have filled it.
MAX_BREAKOUT_PCT = 15.0
# How close to the high a name must be to count as "about to fire".
WATCH_GAP_PCT = 3.0
MAX_WATCH = 12


# ── features ─────────────────────────────────────────────────────────────────
def _sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def _volatility(close: pd.Series) -> pd.Series:
    """20-session realised volatility in percent, as the study computes it."""
    return close.pct_change().rolling(M.VOL_WINDOW).std() * 100.0


def _weekly_trend(frame: pd.DataFrame) -> pd.Series:
    """Weekly close above its 30-week mean, known only from the Saturday after.

    Mirrors `mtf_features` (src/indicators.py:227-250): resample to W-FRI, take
    the 30-period mean, then merge as-of `date + 1 day` so a bar labelled Friday
    is never visible on its own Friday.
    """
    d = frame[["date", "close"]].copy()
    base = d.set_index("date")
    agg = base.resample("W-FRI").agg(close=("close", "last"))
    agg = agg[agg["close"].notna()]
    agg["w_trend"] = (agg["close"] > agg["close"].rolling(M.WEEKLY_SMA).mean()).astype(float)
    agg["known_from"] = agg.index + pd.Timedelta(days=1)
    left = pd.DataFrame({"date": frame["date"]})
    merged = pd.merge_asof(
        left.sort_values("date"),
        agg.reset_index()[["known_from", "w_trend"]].sort_values("known_from"),
        left_on="date",
        right_on="known_from",
        direction="backward",
    )
    return pd.Series(merged["w_trend"].to_numpy(), index=frame.index)


def _benchmark_state(bench: pd.DataFrame, as_of: pd.Timestamp) -> dict[str, float | None]:
    """IHSG versus its own averages on the as-of session."""
    if bench is None:
        return {"close": None, "above_200": None, "above_50": None}
    window = bench[bench["date"] <= as_of]
    if len(window) < M.BENCH_SMA:
        return {"close": None, "above_200": None, "above_50": None}
    close = float(window["close"].iloc[-1])
    sma200 = float(_sma(window["close"], M.BENCH_SMA).iloc[-1])
    sma50 = float(_sma(window["close"], 50).iloc[-1])
    return {"close": close, "above_200": close > sma200, "above_50": close > sma50}


def _merge_benchmark(frame: pd.DataFrame, bench: pd.DataFrame | None) -> pd.DataFrame:
    """Attach `bench_above200` as-of, the way `add_benchmark_rs` does."""
    if bench is None:
        return frame
    b = bench[["date", "close"]].copy()
    b["sma200"] = _sma(b["close"], M.BENCH_SMA)
    b["above200"] = (b["close"] > b["sma200"]).astype(float)
    out = frame.sort_values("date")
    merged = pd.merge_asof(
        out,
        b[["date", "above200"]].sort_values("date"),
        on="date",
        direction="backward",
    )
    frame = merged
    return frame


# ── cross-sectional panels, evaluated on one date ───────────────────────────
def tradable(window: pd.DataFrame) -> tuple[bool, str]:
    """Can this name actually be bought at size today?

    Three screens the study settled on, in the order that fails fastest:

      * enough history to have a 40-session high worth breaking;
      * a price someone could actually trade — the study's floor, not a
        guess, since a sub-50 IDR name is a different instrument;
      * a series that is *moving*. A close unchanged on half its sessions is a
        halted or unquoted name, and every signal on it is un-fillable.
    """
    if len(window) < M.MA_WINDOW:
        return False, "not enough history"
    close = window["close"]
    if not np.isfinite(close.iloc[-1]) or float(close.iloc[-1]) < MIN_PRICE_IDR:
        return False, f"below {MIN_PRICE_IDR:,.0f} IDR"
    frozen = float((close.diff().abs() < 1e-9).mean())
    if frozen >= MAX_FROZEN_FRACTION:
        return False, "price frozen — not trading"
    return True, ""


def _relative_strength(bars: dict[str, pd.DataFrame], as_of: pd.Timestamp) -> dict[str, float]:
    """Percentile of 120-session momentum among the names trading on this session.

    Ranking only the as-of row is identical to ranking the whole panel and
    reading that row: `rank(axis=1)` never looks across dates.

    A name whose last bar predates the session is excluded, not carried at its
    stale price. Counting it would drag down the percentile of every name that
    did trade, which is exactly how a cross-sectional rating goes wrong on a
    thin tape.
    """
    values: dict[str, float] = {}
    for code, frame in bars.items():
        window = frame[frame["date"] <= as_of]
        if len(window) < M.RS_LOOKBACK + 1 or window["date"].iloc[-1] != as_of:
            continue
        past = float(window["close"].iloc[-(M.RS_LOOKBACK + 1)])
        now = float(window["close"].iloc[-1])
        if past > 0:
            values[code] = now / past - 1.0
    if not values:
        return {}
    series = pd.Series(values, dtype=float)
    return (series.rank(pct=True) * 100.0).to_dict()


def _breadth(bars: dict[str, pd.DataFrame], as_of: pd.Timestamp) -> tuple[float, float]:
    """(share above own 200-day average, tradable names) on the as-of session.

    Counted over the *tradable* set, not everything with a bar. Including frozen
    and sub-50 IDR names would put names nobody could buy into the denominator of
    the market's health, and the study's own breadth is computed the same way.
    """
    flags: list[float] = []
    for frame in bars.values():
        window = frame[frame["date"] <= as_of]
        if len(window) < M.MA_WINDOW or window["date"].iloc[-1] != as_of:
            continue
        ok, _ = tradable(window)
        if not ok:
            continue
        close = float(window["close"].iloc[-1])
        flags.append(float(close > _sma(window["close"], M.MA_WINDOW).iloc[-1]))
    if not flags:
        return 0.0, 0
    return float(np.mean(flags)), len(flags)


def regime_of(breadth: float) -> str:
    """Which of the study's three bands the tape is in.

    Three bands, not two, because the study found the middle one is the answer:
    sideways drifts about zero over five sessions while a round trip costs 0.50%,
    so trading it is paying to trade. Flat there is the finding, not a gap.
    """
    if breadth >= M.BREADTH_TRENDING:
        return "trending"
    if breadth < M.BREADTH_CAPITULATION:
        return "capitulation"
    return "sideways"


# ── the gate chain ───────────────────────────────────────────────────────────
def _evaluate(
    code: str,
    frame: pd.DataFrame,
    as_of: pd.Timestamp,
    rs: dict[str, float],
    breadth: float,
    bench: dict[str, float | None],
    spec: M.FamilySpec,
) -> dict[str, object] | None:
    """Score one name at one session. Returns None if it has no usable bar."""
    window = frame[frame["date"] <= as_of]
    if len(window) < max(M.VOL_MEDIAN_WINDOW, M.DONCHIAN_N) + 1:
        return None

    last = window.iloc[-1]
    if last["date"] != as_of:
        return None  # the name has not traded this session

    # A name that cannot be bought at size is not a candidate however well it
    # scores. The study's audit measured 7.0% of its trades arriving on frozen
    # series, and removing them moved its own headline from 78.48% to 76.32%.
    if not tradable(window)[0]:
        return None

    close = float(last["close"])
    if close <= 0:
        return None

    high_n = float(window["high"].rolling(M.DONCHIAN_N).max().shift(1).iloc[-1])
    if not np.isfinite(high_n) or high_n <= 0:
        return None

    vol20_series = _volatility(window["close"])
    vol20 = float(vol20_series.iloc[-1])
    rolling_vol = vol20_series.rolling(M.VOL_MEDIAN_WINDOW)
    vol20_median = float(rolling_vol.median().iloc[-1])
    if spec.quiet == "q40":
        vol_threshold = float(rolling_vol.quantile(0.40).iloc[-1])
    else:
        vol_threshold = vol20_median
    if not np.isfinite(vol20) or vol20 < MIN_VOL20:
        return None

    rating = rs.get(code, float("nan"))
    w_trend = float(_weekly_trend(window).iloc[-1])
    above200 = bench.get("above_200")
    prev_close = float(window["close"].iloc[-2]) if len(window) > 1 else close

    breakout_pct = 100.0 * (close / high_n - 1.0)
    if breakout_pct > MAX_BREAKOUT_PCT:
        breakout_text = (
            f"Jumped {breakout_pct:.0f}% above its {M.DONCHIAN_N}-session high of "
            f"{high_n:,.0f}. That is a gap or a corporate action, not a breakout - skipped."
        )
    elif breakout_pct > 0:
        breakout_text = (
            f"Closed at {close:,.0f}, above the {M.DONCHIAN_N}-session high of "
            f"{high_n:,.0f} ({breakout_pct:+.2f}%)."
        )
    else:
        breakout_text = (
            f"Still {abs(breakout_pct):.2f}% under its {M.DONCHIAN_N}-session high of {high_n:,.0f}."
        )

    gates: dict[GateKey, Gate] = {
        "breakout": Gate(
            "breakout",
            M.RULE_BY_KEY["breakout"].label,
            0.0 < breakout_pct <= MAX_BREAKOUT_PCT,
            breakout_pct,
            0.0,
            "% over the 40-day high",
            breakout_text,
        ),
        "index_above_200": Gate(
            "index_above_200",
            M.RULE_BY_KEY["index_above_200"].label,
            bool(above200) if spec.need_bench else True,
            None,
            None,
            "IHSG vs its 200-day average",
            (
                (
                    "The index is above its own 200-day average, so the market is worth buying."
                    if above200
                    else "The index is below its own 200-day average - the market gate is shut."
                )
                if above200 is not None
                else "Index history is too short to judge."
            )
            if spec.need_bench
            else "Not required by this method - the index's own long-term average is not one of its conditions.",
        ),
        "breadth": Gate(
            "breadth",
            f"Market breadth over {spec.breadth * 100:.0f}%",
            breadth >= spec.breadth,
            breadth,
            spec.breadth,
            "share of universe above its 200-day average",
            f"{breadth * 100:.0f}% of the universe is above its own 200-day average "
            f"(needs {spec.breadth * 100:.0f}%).",
        ),
        "relative_strength": Gate(
            "relative_strength",
            M.RULE_BY_KEY["relative_strength"].label,
            np.isfinite(rating) and rating >= spec.rs_min,
            float(rating) if np.isfinite(rating) else None,
            spec.rs_min,
            "percentile of 120-session momentum",
            (
                f"120-day momentum ranks it {rating:.0f}th of the universe."
                if np.isfinite(rating)
                else "No relative-strength reading."
            ),
        ),
        "quiet_vol": Gate(
            "quiet_vol",
            M.RULE_BY_KEY["quiet_vol"].label,
            vol20 <= vol_threshold,
            vol20,
            vol_threshold,
            "% 20-day realised volatility against its own threshold",
            f"Realised volatility {vol20:.2f}% against its own "
            + ("median " if spec.quiet == "median" else "40th percentile ")
            + f"{vol_threshold:.2f}%.",
        ),
        "weekly_trend": Gate(
            "weekly_trend",
            M.RULE_BY_KEY["weekly_trend"].label,
            w_trend > 0.5 if spec.need_weekly else True,
            w_trend,
            1.0,
            "weekly close vs 30-week mean",
            (
                "The weekly close is above its 30-week average."
                if w_trend > 0.5
                else "The weekly trend is down."
            )
            if spec.need_weekly
            else "Not required by this method - the weekly trend is not one of its conditions.",
        ),
    }

    return {
        "ticker": code,
        "close": close,
        "change_pct": 100.0 * (close / prev_close - 1.0) if prev_close > 0 else None,
        "gates": gates,
        "high_n": high_n,
        "breakout_pct": breakout_pct,
        "rs_rating": float(rating) if np.isfinite(rating) else 0.0,
        "vol20": vol20,
        "vol20_median": vol20_median,
        "passed": all(g.passed for g in gates.values()),
    }


# ── geometry ─────────────────────────────────────────────────────────────────
def _geometry(close: float, exit_method: str) -> Geometry:
    target_pct, stop_pct, hold = M.exit_for(exit_method)
    entry = close
    target = entry * (1.0 + target_pct / 100.0)
    stop = entry * (1.0 - stop_pct / 100.0)
    per_lot = entry * M.LOT_SIZE
    lots = int(M.RISK_BUDGET_IDR // per_lot) * M.LOT_SIZE
    notional = lots * entry
    gross_risk = stop_pct + M.ROUND_TRIP_COST * 100.0
    return Geometry(
        entry_basis="last close; the study fills at the next session's open",
        target_pct=target_pct,
        stop_pct=stop_pct,
        hold_bars=hold,
        entry_ref=round(entry, 2),
        target_price=round(target, 2),
        stop_price=round(stop, 2),
        gross_risk_pct=round(gross_risk, 2),
        reward_risk=round(target_pct / stop_pct, 3),
        max_loss_idr_1m=round(notional * gross_risk / 100.0, -2),
        target_gain_idr_1m=round(notional * (target_pct - M.ROUND_TRIP_COST * 100.0) / 100.0, -2),
        holding_weeks=round(hold / 5.0, 1),
    )


def _score(record: dict[str, object]) -> float:
    """Rank candidates by how cleanly they cleared the chain, not by hype."""
    gates: dict[GateKey, Gate] = record["gates"]  # type: ignore[assignment]
    rating = float(record["rs_rating"])
    gap = float(record["breakout_pct"])
    return (
        100.0
        + min(gap, 10.0) * 2.0
        + (rating - M.RS_PERCENTILE_MIN) * 0.5
        + (20.0 if gates["quiet_vol"].passed else 0.0)
        + (20.0 if gates["weekly_trend"].passed and gates["weekly_trend"].value is not None else 0.0)
    )


def evaluate_one(
    frames: Frames, as_of: pd.Timestamp, code: str, spec: M.FamilySpec
) -> tuple[dict[str, object] | None, Regime]:
    """Evaluate a single name against the *whole* universe's panels.

    The panels are cross-sectional, so they cannot be built from the one name
    being asked about: a frame holding only BBCA would rank BBCA against itself
    and report 100th percentile every time. This builds the universe's breadth
    and relative strength and evaluates the one name inside them.
    """
    bench = _benchmark_state(frames.benchmark, as_of)
    breadth, universe = _breadth(frames.bars, as_of)
    rs = _relative_strength(frames.bars, as_of)
    regime = _regime(breadth, universe, bench, frames.bars, as_of)
    frame = frames.bars.get(code)
    if frame is None:
        return None, regime
    return _evaluate(code, frame, as_of, rs, breadth, bench, spec), regime


def _regime(
    breadth: float,
    universe: int,
    bench: dict[str, float | None],
    bars: dict[str, pd.DataFrame],
    as_of: pd.Timestamp,
) -> Regime:
    band = regime_of(breadth)
    return Regime(
        breadth=breadth,
        breadth_threshold=M.BREADTH_TRENDING,
        # `open` means "the study says trade this", not "breadth is above zero".
        # docs/21 §1 is explicit that the sideways band is a flat band: the index
        # drifts about zero over five sessions there while a round trip costs
        # 0.50%, so trading it is paying to trade.
        breadth_open=band == "trending",
        breadth_median=_breadth_median(bars, as_of),
        index_close=bench.get("close"),
        index_above_200=bench.get("above_200"),
        index_above_50=bench.get("above_50"),
        universe_size=universe,
        band=band,
        action={"trending": "trade", "sideways": "flat", "capitulation": "watch"}[band],
    )


# ── the two public operations ────────────────────────────────────────────────
def screen(
    frames: Frames,
    as_of: pd.Timestamp,
    exit_method: str,
    spec: M.FamilySpec,
    ladder_limit: int = 80,
) -> tuple[Regime, list[Candidate], list[WatchItem], list[dict[str, object]]]:
    """Evaluate every name at one session: the gate chain, once.

    Returns the regime, the names that cleared it, the near misses, and the full
    universe ranked by how near it is to clearing it.
    """
    bench = _benchmark_state(frames.benchmark, as_of)
    breadth, universe = _breadth(frames.bars, as_of)
    rs = _relative_strength(frames.bars, as_of)

    regime = _regime(breadth, universe, bench, frames.bars, as_of)

    candidates: list[Candidate] = []
    scored: list[dict[str, object]] = []
    for code, frame in frames.bars.items():
        record = _evaluate(code, frame, as_of, rs, breadth, bench, spec)
        if record is None:
            continue
        scored.append(record)
        if record["passed"]:
            candidates.append(
                Candidate(
                    ticker=code,
                    name=None,
                    close=float(record["close"]),
                    change_pct=float(record["change_pct"] or 0.0),
                    as_of=as_of.date(),
                    gates=tuple(record["gates"].values()),  # type: ignore[union-attr]
                    geometry=_geometry(float(record["close"]), exit_method),
                    rs_rating=float(record["rs_rating"]),
                    breadth=breadth,
                    breakout_pct=float(record["breakout_pct"]),
                    vol20=float(record["vol20"]),
                    vol20_median=float(record["vol20_median"]),
                    turnover_idr=None,
                    score=_score(record),
                )
            )

    candidates.sort(key=lambda c: -c.score)
    return (
        regime,
        candidates,
        _watchlist(scored, as_of, regime),
        ladder(scored, spec, limit=ladder_limit),
    )


def _breadth_median(bars: dict[str, pd.DataFrame], as_of: pd.Timestamp) -> float:
    """The median breadth over the study's history, so the UI can say
    'unusually low' rather than just 'below 50%'.

    Sampled every 21 sessions: the shape of the answer does not change with a
    weekly stride, and a full panel over 887 names would cost seconds.
    """
    columns: dict[str, np.ndarray] = {}
    for frame in bars.values():
        window = frame[frame["date"] <= as_of]
        if len(window) < M.MA_WINDOW:
            continue
        above = window["close"].to_numpy(float) > _sma(window["close"], M.MA_WINDOW).to_numpy(float)
        columns[frame["date"].iloc[-1].isoformat()] = above[::21]
    if not columns:
        return 0.0
    length = min(len(v) for v in columns.values())
    panel = np.vstack([v[-length:] for v in columns.values()])
    return float(np.nanmedian(panel.mean(axis=0)))


def ladder(
    scored: list[dict[str, object]], spec: M.FamilySpec, limit: int = 60
) -> list[dict[str, object]]:
    """The whole universe, ranked by how near it is to being buyable.

    The plan is a gate: a name either clears all six conditions or it does not,
    and on most sessions nothing does. That makes the plan a poor way to answer
    "what should I be watching" — it throws away the ordering of the names that
    nearly made it.

    This is that ordering. Every row is the same gate chain the plan uses, with
    no invented score: a rank is the number of conditions passed, and within a
    rank, how close the name is to clearing the one it fails. Nothing here is a
    buy signal — a name at the top of this list has still failed a condition, and
    the plan page says so.
    """
    rows: list[tuple[tuple[float, float], dict[str, object]]] = []
    for record in scored:
        gates: dict[GateKey, Gate] = record["gates"]  # type: ignore[assignment]
        passed = [g for g in gates.values() if g.passed]
        failed = [g for g in gates.values() if not g.passed]
        if not failed:
            continue  # a real candidate; it belongs on the plan, not here
        if len(passed) < 2:
            continue  # not close enough to be worth a row

        # Proximity is measured on the *per-name* gates only. Market-wide gates
        # (breadth, the index level) fail identically for every name on the
        # session, so including them would make the distance a constant and the
        # ranking meaningless. A name waiting on the market sorts last instead,
        # which is the honest description of where it stands.
        own = [g for g in failed if g.key in _NAME_LEVEL]
        distance = min(_gap(g, record, spec) for g in own) if own else 1e6
        rank = (float(len(passed)), -distance)
        rows.append(
            (
                rank,
                {
                    "ticker": str(record["ticker"]),
                    "close": float(record["close"]),  # type: ignore[arg-type]
                    "gates_passed": len(passed),
                    "gates_total": len(gates),
                    "blocked_by": failed[0].key,
                    "blocked_text": failed[0].text,
                    "waiting_on_market": not own,
                    "distance_pct": None if not own else round(distance, 2),
                    "rs_rating": round(float(record["rs_rating"]), 1),  # type: ignore[arg-type]
                    "gates": [
                        {
                            "key": g.key,
                            "label": GATE_LABEL.get(g.key, g.key),
                            "passed": g.passed,
                            "text": g.text,
                        }
                        for g in gates.values()
                    ],
                },
            )
        )

    rows.sort(key=lambda pair: pair[0], reverse=True)
    return [row for _, row in rows[:limit]]


# The gates a single name can close on its own. The rest are market-wide.
# (A second `_gap` used to sit above this line and was shadowed by the one below
# it: same intent, two definitions, only the second ever called.)
_NAME_LEVEL: frozenset[GateKey] = frozenset({"breakout", "relative_strength", "quiet_vol"})


def _gap(gate: Gate, record: dict[str, object], spec: M.FamilySpec) -> float:
    """How far a failed condition is from passing, as a positive fraction.

    0.0 would mean it has already passed. The units are deliberately not
    comparable across gates — this orders names, it does not score them.
    """
    if gate.key == "breakout":
        # a percentage of the 40-session high still to recover
        return max(-float(record["breakout_pct"]), 0.0) / 100.0 * 100.0  # type: ignore[arg-type]
    if gate.key == "relative_strength":
        if gate.value is None:
            return 100.0
        return max(gate.threshold - gate.value, 0.0) if gate.threshold else 100.0
    if gate.key == "breadth":
        if gate.value is None or gate.threshold is None:
            return 100.0
        return max(gate.threshold - gate.value, 0.0) * 100.0
    if gate.key == "quiet_vol":
        if gate.value is None or not gate.threshold:
            return 100.0
        return max((gate.value / gate.threshold - 1.0) * 100.0, 0.0)
    # A binary gate (index level, weekly trend) is either in or out, so it is
    # treated as maximally far rather than inventing a distance for it.
    return 100.0


# One vocabulary, taken from the rule chain itself. This used to be a second
# hand-written list, which is how one condition acquired three names across the
# app — one in screen.py, one in method.RULES, one in the frontend.
GATE_LABEL: dict[str, str] = {key: rule.label for key, rule in M.RULE_BY_KEY.items()}


def _watchlist(
    scored: list[dict[str, object]], as_of: pd.Timestamp, regime: Regime
) -> list[WatchItem]:
    """Names one *name-level* gate away.

    Deliberately independent of the market gate. When breadth is shut no name
    can be a candidate, and the useful thing to say is not "nothing" but "these
    would be the ones". A name that broke out, leads the universe on momentum
    and sits under its own 40-day high is worth watching whatever the tape is
    doing.
    """
    items: list[tuple[float, WatchItem]] = []
    for record in scored:
        gates: dict[GateKey, Gate] = record["gates"]  # type: ignore[assignment]
        bps = float(record["breakout_pct"])  # type: ignore[arg-type]
        broke = gates["breakout"].passed
        strong = gates["relative_strength"].passed

        # Strictly under the high and close to it. A name already far above it is
        # not "about to break out", and a name far below it is not close either.
        near_high = -WATCH_GAP_PCT < bps <= 0.0

        if broke and strong and not gates["quiet_vol"].passed:
            blocked = "quiet_vol"
            text = (
                f"Broke out with top-decile momentum, but realised volatility "
                f"{record['vol20']:.2f}% is above its own {record['vol20_median']:.2f}% median - "
                f"too wild to buy."
            )
        elif broke and strong and not gates["weekly_trend"].passed:
            blocked = "weekly_trend"
            text = "Broke out with top-decile momentum, but the weekly trend is still down."
        elif strong and not broke and near_high:
            blocked = "breakout"
            text = (
                f"Top-decile momentum and quiet - {abs(bps):.2f}% under its "
                f"{M.DONCHIAN_N}-session high. Buyable if it clears."
            )
        else:
            continue

        items.append(
            (
                -float(record["rs_rating"]),
                WatchItem(
                    ticker=str(record["ticker"]),
                    name=None,
                    close=float(record["close"]),  # type: ignore[arg-type]
                    blocked_by=blocked,
                    distance_pct=bps,
                    distance_text=text,
                    rs_rating=float(record["rs_rating"]),
                    gates_passed=sum(1 for g in gates.values() if g.passed),
                    gates_total=len(gates),
                ),
            )
        )
    items.sort(key=lambda pair: pair[0])
    return [item for _, item in items[:MAX_WATCH]]


def next_session(as_of: date, calendar: list[pd.Timestamp] | None = None) -> date:
    """The next session IDX actually held, after the as-of session.

    Uses the benchmark's own bar dates as the exchange calendar. That is not a
    guess: `scripts/repair_phantom_bars.py` establishes ^JKSE as the authority on
    which dates were trading days, by finding ticker caches that carried bars on
    dates the index did not - one of them a public holiday, present in every one
    of 886 files.

    Beyond the last known session the calendar cannot help, because no calendar
    contains the future. There the fallback is the next weekday, and
    `next_session_basis` says so, so a public holiday next month is labelled as
    unverified rather than presented as known.
    """
    if calendar:
        future = [c.date() for c in calendar if c.date() > as_of]
        if future:
            return min(future)

    nxt = as_of + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


def next_session_basis(as_of: date, calendar: list[pd.Timestamp] | None) -> str:
    """Whether `next_session` came from the exchange calendar or from weekdays.

    Shown in the UI. "Next weekday" and "next session IDX held" are different
    claims, and only one of them survives a public holiday.
    """
    if calendar and any(c.date() > as_of for c in calendar):
        return "exchange_calendar"
    return "next_weekday_unverified"