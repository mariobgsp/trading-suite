"""The run-up: when each condition turned true, and that it is the screen's own.

`_reason` replays the chain by calling `_evaluate` — the function the live screen
uses — once per session. That is the point: a history that re-derives the gates
with its own arithmetic is a history that will eventually disagree with the value
printed above it. These tests use synthetic bars so the assertions are about the
replay, not about the study.

The load-bearing test is the first one: the last point of every series must equal
the gate the screen reports for that same session.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.plan import method as M
from app.plan import screen as S
from app.plan.bars import Frames
from app.plan import idx as X


def synthetic(n: int = 320, seed: int = 7) -> tuple[pd.DataFrame, pd.DataFrame]:
    """A quiet name that breaks out in its last session, and a benchmark.

    Deterministic, so a failure is a real change in behaviour rather than noise.
    """
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2025-01-06", periods=n)
    close = 1_000.0 + np.cumsum(rng.normal(0.0, 3.0, n))
    # A step that clears the prior 40-session high by a comfortable margin.
    close[-1] = float(close[-6]) * 1.06
    frame = pd.DataFrame(
        {
            "date": dates,
            "open": close,
            "high": close * 1.004,
            "low": close * 0.996,
            "close": close,
            "volume": rng.integers(1_000_000, 5_000_000, n).astype(float),
        }
    )
    bench_close = 7_000.0 + np.cumsum(rng.normal(0.0, 2.0, n))
    bench = pd.DataFrame(
        {
            "date": dates,
            "open": bench_close,
            "high": bench_close,
            "low": bench_close,
            "close": bench_close,
            "volume": np.full(n, 1e9),
        }
    )
    return frame, bench


def setup() -> tuple[Frames, pd.Timestamp, M.FamilySpec]:
    frame, bench = synthetic()
    frames = Frames(bars={"TEST": frame}, benchmark=bench, source="synthetic")
    session = frame["date"].iloc[-1]
    spec = M.family_spec(M.STUDY_PICK_FAMILY)
    return frames, session, spec


def build() -> tuple[S.Reason, dict[str, object], pd.DataFrame, pd.Timestamp, M.FamilySpec]:
    frames, session, spec = setup()
    panel = S.panel_history(
        frames.source, frames.bars, frames.sessions(), session, window=S.REASON_WINDOW
    )
    bench = S._benchmark_state(frames.benchmark, session)
    breadth = panel.breadth.get(session, 0.0)
    record = S._evaluate(
        "TEST", frames.bars["TEST"], session, panel.rs.get(session, {}), breadth, bench, spec
    )
    assert record is not None
    geometry = S._geometry(
        float(record["close"]), M.STUDY_PICK_EXIT, record.get("turnover_idr")  # type: ignore[arg-type]
    )
    reason, histories = S._reason(
        "TEST",
        frames.bars["TEST"],
        session,
        panel,
        frames.benchmark,
        spec,
        geometry,
        S.next_session(session.date(), frames.sessions()),
    )
    return reason, histories, frames.bars["TEST"], session, spec


# ── the replay must be the live chain ───────────────────────────────────────
def test_the_last_point_of_every_series_is_the_gate_the_screen_reported():
    reason, histories, frame, session, spec = build()
    panel = S.panel_history(
        "synthetic", {"TEST": frame}, [session], session, window=1
    )
    record = S._evaluate(
        "TEST",
        frame,
        session,
        panel.rs.get(session, {}),
        panel.breadth.get(session, 0.0),
        S._benchmark_state(None, session),
        spec,
    )
    assert record is not None
    for key, history in histories.items():
        series = history.series
        if not series:
            continue
        assert series[-1] is bool(record["gates"][key].passed), (
            f"{key}: replay says {series[-1]}, the live chain says "
            f"{record['gates'][key].passed}"
        )
    last = reason.history[-1]
    assert last.gates_passed == sum(1 for g in record["gates"].values() if g.passed)
    assert last.breakout_pct == round(float(record["breakout_pct"]), 2)


def test_a_gate_that_is_false_at_the_session_reports_no_run():
    _, histories, _, _, _ = build()
    for key, history in histories.items():
        if history.held_sessions == 0:
            assert history.first_true_session is None, key
        else:
            assert history.first_true_session is not None, key


def test_the_breakout_run_names_the_session_it_started():
    reason, histories, _, session, _ = build()
    breakout = histories.get("breakout")
    assert breakout is not None
    if breakout.held_sessions:
        assert reason.breakout_date is not None
        assert reason.sessions_since_breakout == breakout.held_sessions - 1
        assert reason.breakout_date == breakout.first_true_session
        assert reason.breakout_date <= session.date()
        # and the date is in the window that travelled with the reason
        assert reason.breakout_date in [point.session for point in reason.history]
    else:
        assert reason.breakout_date is None
        assert reason.sessions_since_breakout is None


# ── the shape of the payload ────────────────────────────────────────────────
def test_the_window_is_bounded_and_in_order():
    reason, _, _, _, _ = build()
    assert 0 < len(reason.history) <= S.REASON_WINDOW
    sessions = [point.session for point in reason.history]
    assert sessions == sorted(sessions)
    assert sessions[-1] == reason.signal_session
    assert reason.window == len(reason.history)
    assert reason.seconds >= 0.0


def test_every_history_point_carries_the_numbers_the_chart_needs():
    reason, _, _, _, _ = build()
    last = reason.history[-1]
    for field in ("close", "gates_passed", "breakout_pct", "vol20", "breadth", "band"):
        assert getattr(last, field) is not None, field
    assert last.gates_total >= 1
    assert 0.0 <= last.breadth <= 1.0
    assert last.band in {"trending", "sideways", "capitulation"}


def test_levels_are_orderable_and_the_band_limits_travel_with_them():
    reason, _, _, _, _ = build()
    levels = reason.levels
    entry = float(levels["entry_ref"])
    for key in ("target_price", "stop_price"):
        price = float(levels[key])
        tick = X.tick_for(price)
        assert abs(price / tick - round(price / tick)) < 1e-9, f"{key}={price} is off the grid"
    assert levels["donchian_level"] is not None
    assert float(levels["target_price"]) > entry > float(levels["stop_price"])
    assert reason.ar["up_price"] >= entry
    assert reason.ar["down_price"] <= entry
    assert reason.entry_session > reason.signal_session


def test_the_entry_basis_names_the_session_it_fills_in():
    reason, _, _, _, _ = build()
    assert "open" in reason.entry_basis.lower()
    assert "close" in reason.known_from.lower()


def test_reason_for_works_for_a_name_that_is_not_in_the_plan():
    """The Name page asks "why not" far more often than it asks "why"."""
    frames, session, spec = setup()
    reason = S.reason_for(frames, session, "TEST", spec, M.STUDY_PICK_EXIT)
    assert reason is not None
    assert reason.history, "a name outside the plan still gets its run-up"
    assert reason.signal_session == session.date()
    assert S.reason_for(frames, session, "NOPE", spec, M.STUDY_PICK_EXIT) is None
