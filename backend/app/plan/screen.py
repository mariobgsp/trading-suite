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

import threading
import time
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

import numpy as np
import pandas as pd

from . import idx
from . import method as M
from .bars import Frames
from .model import (
    Candidate,
    CapitulationItem,
    Gate,
    GateHistory,
    GateKey,
    Geometry,
    Reason,
    ReasonPoint,
    Regime,
    WatchItem,
)

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
# Economic, not legal. The rulebook has allowed a Rp1 minimum price since
# 2026-09-28; the screen keeps Rp50 because at Rp100 a single tick is already 1%
# of the price. See `idx.economic_floor_note()`.
MIN_PRICE_IDR = 50.0
TURNOVER_WINDOW = 60
# ── sizing (docs/21 §8) — what makes a thin name's number real ──────────────
POSITION_FLOOR_IDR = 2_000_000.0
POSITION_CAP_IDR = 10_000_000.0
MAX_PARTICIPATION = 0.02
# A "breakout" of more than this over the 40-day high is a gap or a corporate
# action, not a breakout, and the study's geometry would never have filled it.
MAX_BREAKOUT_PCT = 15.0
# -- the capitulation watch (docs/25, docs/20 sec 7-8) -------------------------
# The tier-3 bounce, transcribed from the study's own `cap_bounce` family
# (src/strategies.py) with the sweep champion's parameters (cfg 6 of
# results/three_regime_sweep_screen_flat.csv: cap_rsi2 30.0, cap_flush 5.0,
# cap_atr_stop True) and the constants of src/common.py (CAP_*). This is a
# *watch*: every measured row for the rule failed the study's 80%/+5% bar, and
# the rule broke on quarterly windows and under the survivorship haircut.
CAP_RSI2_MAX = 30.0
CAP_FLUSH_PCT = 5.0
CAP_MIN_BELOW_SMA_PCT = 5.0
CAP_MAX_BELOW_SMA_PCT = 30.0
CAP_ATR_FLOOR_PCT = 2.0
# How many tier-3 names the plan will carry at most. The band is rare (7.2% of
# sessions) and the conditions are strict, so a bound only protects the payload.
CAP_WATCH_LIMIT = 25
# How many sessions of gate history the reason payload carries. Bounded because
# the history calls the screen's own breadth and relative-strength passes once
# per session: a dozen sessions costs about five seconds, and the value above the
# line is the same code path rather than a second implementation of it.
REASON_WINDOW = 12
# How close to the high a name must be to count as "about to fire".
WATCH_GAP_PCT = 3.0
MAX_WATCH = 12


# ── features ─────────────────────────────────────────────────────────────────
def _sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def _volatility(close: pd.Series) -> pd.Series:
    """20-session realised volatility in percent, as the study computes it."""
    return close.pct_change().rolling(M.VOL_WINDOW).std() * 100.0


def _rsi2(close: pd.Series) -> pd.Series:
    """RSI(2), computed exactly as the study computes it (src/indicators.py).

    `ewm(alpha=1/n)` Wilder flavour, so a comparison between the app's watch and
    the study's `cap_bounce` signal is a comparison of numbers, not of
    approximations.
    """
    d = close.diff()
    gains = d.clip(lower=0.0).ewm(alpha=1.0 / 2, adjust=False).mean()
    losses = (-d).clip(lower=0.0).ewm(alpha=1.0 / 2, adjust=False).mean()
    return 100.0 - 100.0 / (1.0 + gains / losses)


def _atr14(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """ATR(14), Wilder flavour, as the study computes it (src/indicators.py)."""
    tr = pd.concat(
        [
            high - low,
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / 14, adjust=False).mean()


def _median_turnover(window: pd.DataFrame) -> float | None:
    """Median session value traded over the study's 60-session window, in IDR.

    None rather than a guess when the history is short or the volume column is
    missing: a position size computed from a missing number is the kind of
    fiction the participation cap exists to prevent.
    """
    if "volume" not in window.columns or len(window) < TURNOVER_WINDOW:
        return None
    tail = window.tail(TURNOVER_WINDOW)
    value = (tail["close"].astype(float) * tail["volume"].astype(float)).median()
    return float(value) if np.isfinite(value) and value > 0 else None


def study_position(turnover_idr: float | None) -> tuple[float | None, float | None, str]:
    """The study's own sizing rule, and why it refuses a name.

    `clamp(2% x median 60-session turnover, 2M, 10M)` with a 2% participation
    reject (docs/21 §8). The reject is the load-bearing part: at a 250M IDR
    turnover floor the 2M floor binds for anything under 100M a day, and those
    names are refused as untradeable rather than simulated at a size nobody could
    have filled.
    """
    if turnover_idr is None or turnover_idr <= 0:
        return None, None, "no turnover history"
    position = min(max(MAX_PARTICIPATION * turnover_idr, POSITION_FLOOR_IDR), POSITION_CAP_IDR)
    participation = position / turnover_idr
    if turnover_idr < POSITION_FLOOR_IDR / MAX_PARTICIPATION:
        return None, None, "under 100M IDR a day: the 2M floor would be over 2% of ADV"
    if participation > MAX_PARTICIPATION:
        return None, None, "over 2% of ADV"
    return position, participation, ""


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


@dataclass(frozen=True)
class PanelHistory:
    """Breadth and relative-strength percentile for each of the recent sessions."""

    dates: tuple[pd.Timestamp, ...]
    breadth: dict[pd.Timestamp, float]
    rs: dict[pd.Timestamp, dict[str, float]]
    seconds: float


_history_lock = threading.Lock()
_history_cache: dict[tuple[str, int, str], PanelHistory] = {}


def clear_history_cache() -> None:
    """Drop the cached panels, on the same schedule as the plan itself."""
    with _history_lock:
        _history_cache.clear()


def panel_history(
    source: str,
    bars: dict[str, pd.DataFrame],
    calendar: Iterable[pd.Timestamp],
    session: pd.Timestamp,
    window: int = REASON_WINDOW,
) -> PanelHistory:
    """The last `window` sessions of the two cross-sectional panels.

    Deliberately calls `_breadth` and `_relative_strength` — the same functions
    the screen uses — once per session rather than reimplementing them
    vectorised. A faster second implementation is how a history line ends up
    disagreeing with the value printed above it, and these two numbers decide the
    whole plan.
    """
    key = (source, window, session.isoformat())
    with _history_lock:
        hit = _history_cache.get(key)
    if hit is not None:
        return hit

    started = time.perf_counter()
    dates = tuple(d for d in calendar if d <= session)[-window:]
    breadth = {d: _breadth(bars, d)[0] for d in dates}
    rs = {d: _relative_strength(bars, d) for d in dates}
    panel = PanelHistory(
        dates=dates,
        breadth=breadth,
        rs=rs,
        seconds=time.perf_counter() - started,
    )
    with _history_lock:
        _history_cache[key] = panel
    return panel


def _trailing_run(series: list[bool]) -> tuple[int, int | None]:
    """(length, index) of the run of True that ends the series."""
    if not series or not series[-1]:
        return 0, None
    length = 0
    for value in reversed(series):
        if not value:
            break
        length += 1
    return length, len(series) - length


def _reason(
    code: str,
    frame: pd.DataFrame,
    session: pd.Timestamp,
    panel: PanelHistory,
    benchmark: pd.DataFrame | None,
    spec: M.FamilySpec,
    geometry: Geometry,
    next_session: date,
) -> tuple[Reason, dict[str, GateHistory]]:
    """Replay the chain over the recent sessions for one name.

    The chain is replayed by calling `_evaluate` — the function the screen itself
    uses — once per session, so the history cannot describe conditions the screen
    does not apply. The last point in the series is by construction the gate set
    the plan is showing; `test_plan_why_now.py` pins that.
    """
    started = time.perf_counter()
    points: list[ReasonPoint] = []
    runs: dict[str, list[bool]] = {}

    for when in panel.dates:
        bench = _benchmark_state(benchmark, when)
        breadth = panel.breadth.get(when, 0.0)
        record = _evaluate(
            code, frame, when, panel.rs.get(when, {}), breadth, bench, spec
        )
        gates = record["gates"] if record else {}
        for gate_key in ("breakout", "breadth", "relative_strength", "quiet_vol"):
            runs.setdefault(gate_key, []).append(
                bool(gates[gate_key].passed) if gate_key in gates else False
            )
        points.append(
            ReasonPoint(
                session=when.date(),
                close=float(record["close"]) if record else None,
                gates_passed=sum(1 for g in gates.values() if g.passed),
                gates_total=len(gates) if gates else 6,
                breakout_pct=(
                    round(float(record["breakout_pct"]), 2) if record else None
                ),
                vol20=round(float(record["vol20"]), 2) if record else None,
                rs_rating=(
                    round(float(record["rs_rating"]), 1)
                    if record and float(record["rs_rating"])
                    else None
                ),
                breadth=round(breadth, 4),
                band=regime_of(breadth),
            )
        )

    held = {key: _trailing_run(series) for key, series in runs.items()}
    # Built from the replay itself, so a gate's "held for four sessions" and the
    # value printed beside it come from one evaluation rather than two.
    histories = {
        key: GateHistory(
            held_sessions=length,
            first_true_session=(panel.dates[start].date() if start is not None else None),
            series=tuple(runs.get(key, [])),
        )
        for key, (length, start) in held.items()
    }
    breakout_held, breakout_start = held.get("breakout", (0, None))
    breakout_date = (
        panel.dates[breakout_start].date() if breakout_start is not None else None
    )

    reason = Reason(
        signal_session=session.date(),
        entry_session=next_session,
        entry_basis=geometry.entry_basis,
        known_from=(
            "Every condition above is read from the close of the signal session; "
            "the study fills at the next session's open."
        ),
        breakout_date=breakout_date,
        sessions_since_breakout=(breakout_held - 1) if breakout_held else None,
        window=len(points),
        seconds=time.perf_counter() - started,
        history=tuple(points),
        levels={
            "donchian_level": (
                round(float(_donchian_level(frame, session)), 2)
                if _donchian_level(frame, session) is not None
                else None
            ),
            "entry_ref": geometry.entry_ref,
            "target_price": geometry.target_price,
            "stop_price": geometry.stop_price,
            "tick_idr": geometry.tick_idr,
            "holding_weeks": geometry.holding_weeks,
        },
        ar=idx.ar_limits(geometry.entry_ref).as_dict(),
    )
    return reason, histories


def _donchian_level(frame: pd.DataFrame, session: pd.Timestamp) -> float | None:
    """The 40-session high the breakout had to clear, as of the session."""
    window = frame[frame["date"] <= session]
    if len(window) < M.DONCHIAN_N + 1:
        return None
    level = window["high"].rolling(M.DONCHIAN_N).max().shift(1).iloc[-1]
    return float(level) if np.isfinite(level) and level > 0 else None


def attach_histories(
    gates: tuple[Gate, ...], histories: dict[str, GateHistory] | None
) -> tuple[Gate, ...]:
    """The same gates with their run lengths attached, when there are any."""
    if not histories:
        return gates
    return tuple(
        Gate(
            key=g.key,
            label=g.label,
            passed=g.passed,
            value=g.value,
            threshold=g.threshold,
            unit=g.unit,
            text=g.text,
            history=histories.get(g.key),
        )
        for g in gates
    )


def reason_for(
    frames: Frames,
    session: pd.Timestamp,
    code: str,
    spec: M.FamilySpec,
    exit_method: str,
) -> tuple[Reason, dict[str, GateHistory]] | None:
    """The run-up for one name, whether or not it is in tonight's plan.

    Returns the histories too, so a caller holding a gate set can attach the run
    lengths to the same gates the plan shows.
    """
    frame = frames.bars.get(code)
    if frame is None:
        return None
    panel = panel_history(
        frames.source, frames.bars, frames.sessions(), session
    )
    bench = _benchmark_state(frames.benchmark, session)
    breadth = panel.breadth.get(session, 0.0)
    record = _evaluate(code, frame, session, panel.rs.get(session, {}), breadth, bench, spec)
    if record is None:
        return None
    geometry = _geometry(
        float(record["close"]),
        exit_method,
        turnover_idr=record.get("turnover_idr"),  # type: ignore[arg-type]
    )
    return _reason(
        code,
        frame,
        session,
        panel,
        frames.benchmark,
        spec,
        geometry,
        next_session(session.date(), frames.sessions()),
    )


def _history_for_candidates(
    frames: Frames,
    session: pd.Timestamp,
    spec: M.FamilySpec,
    exit_method: str,
    candidates: list[Candidate],
) -> tuple[list[Candidate], PanelHistory | None]:
    """Attach the run-up to each candidate. Only candidates: a screen with none
    does not pay for a history nobody will read."""
    if not candidates:
        return candidates, None
    panel = panel_history(frames.source, frames.bars, frames.sessions(), session)
    next_day = next_session(session.date(), frames.sessions())
    enriched: list[Candidate] = []
    for candidate in candidates:
        frame = frames.bars.get(candidate.ticker)
        if frame is None:
            enriched.append(candidate)
            continue
        reason, histories = _reason(
            candidate.ticker,
            frame,
            session,
            panel,
            frames.benchmark,
            spec,
            candidate.geometry,
            next_day,
        )
        # The gates the plan shows gain their run length, so the UI can say
        # "held for four sessions" beside the value rather than only the value.
        gates = attach_histories(candidate.gates, histories)
        enriched.append(
            Candidate(
                ticker=candidate.ticker,
                name=candidate.name,
                close=candidate.close,
                change_pct=candidate.change_pct,
                as_of=candidate.as_of,
                gates=gates,
                geometry=candidate.geometry,
                rs_rating=candidate.rs_rating,
                breadth=candidate.breadth,
                breakout_pct=candidate.breakout_pct,
                vol20=candidate.vol20,
                vol20_median=candidate.vol20_median,
                turnover_idr=candidate.turnover_idr,
                score=candidate.score,
                reason=reason,
            )
        )
    return enriched, panel


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
        "turnover_idr": _median_turnover(window),
        "passed": all(g.passed for g in gates.values()),
    }


# ── geometry ─────────────────────────────────────────────────────────────────
def _geometry(
    close: float,
    exit_method: str,
    turnover_idr: float | None = None,
    risk_budget_idr: float | None = None,
    spread_ticks: int = 2,
) -> Geometry:
    """Entry, target, stop, and a size the market can absorb.

    Three things this got wrong, all of them expensive:

      * it took `RISK_BUDGET_IDR` — documented as the loss the user will book on
        one name — and used it as the *notional*. With a 35% stop that is a 35%
        loss on the budget rather than the budget, roughly four times the risk the
        constant describes.
      * it ignored turnover entirely, so a name the study refuses to size (under
        100M IDR a day) was handed the full cap.
      * it printed levels off the tick grid, which are not prices anyone can
        enter.

    The study's rule is `clamp(2% x median 60-session turnover, 2M, 10M)` with a
    2% participation reject (docs/21 §8). This applies it, then takes the smaller
    of that and what the risk budget affords, and rounds to whole lots.
    """
    target_pct, stop_pct, hold = M.exit_for(exit_method)
    cost_pct = M.ROUND_TRIP_COST * 100.0
    budget = float(risk_budget_idr if risk_budget_idr is not None else M.RISK_BUDGET_IDR)
    entry = close
    tick = idx.tick_for(entry)
    # Both levels onto the grid. Rounding down keeps the advertised target inside
    # the rule that was measured; the ticket states the rounding either way.
    target = idx.round_to_tick(entry * (1.0 + target_pct / 100.0), "down")
    stop = idx.round_to_tick(entry * (1.0 - stop_pct / 100.0), "down")
    friction = idx.friction_round_trip(
        entry, spread_ticks=spread_ticks, study_model_pct=cost_pct
    )

    study_size, _study_participation, why = study_position(turnover_idr)
    cap_shares = int(study_size // (entry * M.LOT_SIZE)) * M.LOT_SIZE if study_size else 0
    risk_per_share = max(entry - stop, 0.0) + entry * cost_pct / 100.0
    budget_shares = int(budget / risk_per_share) if risk_per_share > 0 else 0
    budget_lots = int(budget_shares // M.LOT_SIZE) * M.LOT_SIZE

    # A name the study's rule refuses has no size at all. The risk budget can make
    # a position smaller; it can never admit one the participation cap rejects —
    # otherwise "refused as untradeable" would become a 28M position in a name
    # that trades 50M a day.
    if study_size is None:
        shares, basis = 0, "none"
    elif cap_shares <= budget_lots:
        shares, basis = cap_shares, "study_adv"
    elif budget_lots:
        shares, basis = budget_lots, "risk_budget"
    else:
        shares, basis = 0, "none"

    position = shares * entry
    max_loss = shares * (entry - stop) + position * cost_pct / 100.0
    participation_pct = (
        round(position / turnover_idr * 100.0, 3) if (turnover_idr and shares) else None
    )

    notes: list[str] = []
    if study_size is None:
        notes.append(f"The study's sizing rule refuses this name: {why}.")
    elif basis == "risk_budget":
        notes.append(
            "Sized by the risk budget rather than by turnover: the 2% ADV cap "
            f"would allow {round(study_size):,} IDR."
        )
    if shares == 0 and study_size is not None:
        notes.append("No size fits both the 2% ADV cap and the risk budget.")
    if friction.over_study_pct > 0.01:
        notes.append(
            f"A real round trip costs about {friction.total_pct:.2f}% at this price "
            f"({friction.fees_pct:.2f}% fees + {friction.spread_pct:.2f}% spread), against "
            f"the study's {friction.study_model_pct:.2f}% model."
        )
    if not idx.target_inside_ar(entry, target):
        notes.append(
            "The target sits outside today's auto-rejection band, so it cannot be "
            "reached in one session."
        )

    gross_risk = stop_pct + cost_pct
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
        max_loss_idr_1m=round(1_000_000.0 * gross_risk / 100.0, -2),
        target_gain_idr_1m=round(1_000_000.0 * (target_pct - cost_pct) / 100.0, -2),
        holding_weeks=round(hold / 5.0, 1),
        position_idr=round(position, 2) if shares else None,
        shares=shares or None,
        lots=(shares // M.LOT_SIZE) or None,
        participation_pct=participation_pct,
        sizing_basis=basis,
        risk_budget_idr=round(budget, 2),
        max_loss_idr=round(max_loss, 2) if shares else None,
        risk_pct_of_position=(
            round(max_loss / position * 100.0, 2) if (shares and position) else None
        ),
        tick_idr=tick,
        friction=friction.as_dict(),
        notes=tuple(notes),
    )


def size_ticket(
    price: float,
    median_turnover_60: float | None = None,
    risk_budget_idr: float | None = None,
    exit_method: str | None = None,
    spread_ticks: int = 2,
) -> dict[str, object]:
    """Size one order and price its friction, without a universe pass.

    The ticket has to re-size when the price or the budget changes, and running a
    900-name screen for arithmetic would be absurd. This is the same code path the
    plan uses, so the two cannot disagree.
    """
    exit_name = exit_method or M.DEFAULT_EXIT
    geometry = _geometry(
        price, exit_name, median_turnover_60, risk_budget_idr, spread_ticks
    )
    return {
        "price": price,
        "exit_method": exit_name,
        "geometry": geometry.as_dict(),
        "ar": idx.ar_limits(price).as_dict(),
        "position": {
            "study_cap_idr": POSITION_CAP_IDR,
            "study_floor_idr": POSITION_FLOOR_IDR,
            "max_participation": MAX_PARTICIPATION,
            "median_turnover_60": median_turnover_60,
        },
        "tables": idx.tables(),
    }


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
def cap_watch(
    frames: Frames,
    as_of: pd.Timestamp,
    breadth: float,
    limit: int = CAP_WATCH_LIMIT,
) -> tuple[CapitulationItem, ...]:
    """The tier-3 capitulation-bounce names at one session (docs/25).

    Runs only in the capitulation band, and only this band: the study measured
    the flat band as a loss and every other regime's rules as failures, but the
    capitulation bounce was the one non-trending rule that came anywhere near
    the bar on semi-annual folds. It is a watch, not a ticket: every sweep
    config's HIT flag is False, and the quarterly windows and the survivorship
    haircut broke it. The returned names carry the study's parameters (cfg 6 of
    the sweep: rsi2 <= 30, a 5-session flush of at least 5%, between 5% and 30%
    under the 200sma, the flush stabilising, ATR% above the dead-name floor)
    so the UI can show precisely what its author measured - and refused.

    The same feature definitions as the study's own `cap_bounce` family
    (strategies.py, common.py): rsi2 and atr14 are Wilder-flavour EWMs, and all
    comparisons are numeric so a NaN fails the gate rather than passing it.
    """
    if breadth >= M.BREADTH_CAPITULATION:
        return ()
    rows: list[CapitulationItem] = []
    for code, frame in frames.bars.items():
        window = frame[frame["date"] <= as_of]
        if len(window) < M.MA_WINDOW + 1 or window["date"].iloc[-1] != as_of:
            continue
        if not tradable(window)[0]:
            continue
        if not {"high", "low", "close"}.issubset(window.columns):
            continue  # a feed without high/low cannot carry an ATR reading
        close = float(window["close"].iloc[-1])
        if close <= 0:
            continue

        cond = _cap_conditions(window, close)
        if cond is None or not cond["passed"]:
            continue  # the watch only carries names the rule itself would flag
        rows.append(
            CapitulationItem(
                ticker=code,
                close=close,
                as_of=as_of.date(),
                breadth=breadth,
                rsi2=cond["rsi2"],
                ret5=cond["ret5"],
                ret10=cond["ret10"],
                dist_200_pct=cond["dist_200_pct"],
                atr14_pct=cond["atr14_pct"],
                flushed=cond["flushed"],
                washed=cond["washed"],
                in_band=cond["in_band"],
                stabilising=cond["stabilising"],
                alive=cond["alive"],
                passed_all=cond["passed"],
                score=cond["score"],
            )
        )
    rows.sort(key=lambda item: -item.score)
    return tuple(rows[:limit])


def _cap_conditions(window: pd.DataFrame, close: float) -> dict[str, object] | None:
    """The five measured tier-3 conditions for one window, as the study codes them.

    Returns None when the window cannot carry a reading. The comparisons are
    numeric so a NaN fails the gate rather than passing it - the study's own
    convention (strategies.py regime helpers). Shared by `cap_watch` and the
    conformance test, so the screen and its verifier measure one implementation.
    """
    rsi2 = float(_rsi2(window["close"]).iloc[-1])
    ret5 = 100.0 * (close / float(window["close"].iloc[-6]) - 1.0)
    ret10 = 100.0 * (close / float(window["close"].iloc[-11]) - 1.0)
    sma200 = float(_sma(window["close"], M.MA_WINDOW).iloc[-1])
    atrp = 100.0 * float(_atr14(window["high"], window["low"], window["close"]).iloc[-1]) / close

    finite = all(np.isfinite(v) for v in (rsi2, ret5, ret10, sma200, atrp))
    dist_200 = 100.0 * (close / sma200 - 1.0) if finite else float("nan")

    flushed = finite and rsi2 <= CAP_RSI2_MAX
    washed = finite and ret5 <= -CAP_FLUSH_PCT
    in_band = finite and -CAP_MAX_BELOW_SMA_PCT <= dist_200 <= -CAP_MIN_BELOW_SMA_PCT
    stabilising = finite and ret5 >= ret10 * 0.5
    alive = finite and atrp >= CAP_ATR_FLOOR_PCT
    passed = flushed and washed and in_band and stabilising and alive
    return {
        "rsi2": rsi2 if finite else None,
        "ret5": ret5 if finite else None,
        "ret10": ret10 if finite else None,
        "dist_200_pct": dist_200 if finite else None,
        "atr14_pct": atrp if finite else None,
        "flushed": flushed,
        "washed": washed,
        "in_band": in_band,
        "stabilising": stabilising,
        "alive": alive,
        "passed": passed,
        "score": (-ret5 if finite else 0.0) + (CAP_RSI2_MAX - rsi2 if finite else 0.0),
    }


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
                    geometry=_geometry(
                        float(record["close"]),
                        exit_method,
                        turnover_idr=(
                            float(record["turnover_idr"])  # type: ignore[arg-type]
                            if record.get("turnover_idr") is not None
                            else None
                        ),
                    ),
                    rs_rating=float(record["rs_rating"]),
                    breadth=breadth,
                    breakout_pct=float(record["breakout_pct"]),
                    vol20=float(record["vol20"]),
                    vol20_median=float(record["vol20_median"]),
                    turnover_idr=(
                        float(record["turnover_idr"])  # type: ignore[arg-type]
                        if record.get("turnover_idr") is not None
                        else None
                    ),
                    score=_score(record),
                )
            )

    candidates.sort(key=lambda c: -c.score)
    candidates, panel = _history_for_candidates(
        frames, as_of, spec, exit_method, candidates
    )
    if panel is not None:
        for record in scored:
            record["panel_seconds"] = panel.seconds
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
                            # The measured value and its threshold travel with the
                            # ranked row too: "3 of 4" tells a reader nothing about
                            # how close the fourth was.
                            "value": g.value,
                            "threshold": g.threshold,
                            "unit": g.unit,
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