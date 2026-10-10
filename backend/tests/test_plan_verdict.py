"""The four verdicts, their precedence, and the measured case for standing down.

`verdict.build` is pure — every input is an argument — so all four states can be
produced without bars, without the universe and without the study. That is the
point: these states decide whether the app offers a ticket at all, so they need
tests that fail loudly and run in milliseconds.

The precedence is the load-bearing rule. A screen that says "buy" on a broken bar
source is worse than one that says nothing, so every integrity failure must beat
every trading signal.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.plan import method as M
from app.plan import verdict as V
from app.plan.model import Candidate, Geometry, Regime, WatchItem

SESSION = date(2026, 10, 9)
NEXT = date(2026, 10, 12)
GATES = ("breadth", "relative_strength", "quiet_vol", "breakout")


def regime(band: str = "trending", breadth: float = 0.72, above200: bool = True) -> Regime:
    return Regime(
        breadth=breadth,
        breadth_threshold=0.60,
        breadth_open=band == "trending",
        breadth_median=0.45,
        index_close=7_000.0,
        index_above_200=above200,
        index_above_50=True,
        universe_size=420,
        band=band,
        action={"trending": "trade", "sideways": "flat", "capitulation": "watch"}[band],
    )


def geometry(sizeable: bool = True) -> Geometry:
    return Geometry(
        entry_basis="last close; the study fills at the next session's open",
        target_pct=13.0,
        stop_pct=35.0,
        hold_bars=95,
        entry_ref=1_000.0,
        target_price=1_130.0,
        stop_price=650.0,
        gross_risk_pct=35.5,
        reward_risk=0.371,
        max_loss_idr_1m=355_000.0,
        target_gain_idr_1m=125_000.0,
        holding_weeks=19.0,
        position_idr=10_000_000.0 if sizeable else None,
        shares=10_000 if sizeable else None,
        lots=100 if sizeable else None,
        participation_pct=2.0 if sizeable else None,
        sizing_basis="study_adv" if sizeable else "none",
        risk_budget_idr=10_000_000.0,
        max_loss_idr=3_550_000.0 if sizeable else None,
        risk_pct_of_position=35.5 if sizeable else None,
        notes=() if sizeable else ("The study's sizing rule refuses this name: over 2% of ADV.",),
    )


def candidate(sizeable: bool = True) -> Candidate:
    return Candidate(
        ticker="BBCA",
        name=None,
        close=1_000.0,
        change_pct=1.0,
        as_of=SESSION,
        gates=(),
        geometry=geometry(sizeable),
        rs_rating=95.0,
        breadth=0.72,
        breakout_pct=1.2,
        vol20=1.4,
        vol20_median=2.0,
        turnover_idr=5_000_000_000.0,
        score=100.0,
    )


def watch() -> WatchItem:
    return WatchItem(
        ticker="TLKM",
        name=None,
        close=3_000.0,
        blocked_by="breakout",
        distance_pct=-1.2,
        distance_text="1.2% under its 40-session high.",
        rs_rating=93.0,
        gates_passed=3,
        gates_total=4,
    )


def build(**overrides: object) -> V.Verdict:
    base: dict[str, object] = dict(
        regime=regime(),
        candidates=[],
        watchlist=[],
        required_gates=GATES,
        evidence=M.corrected_evidence(),
        bars_session=SESSION,
        exchange_session=SESSION,
        universe_size=420,
        names_on_session=400,
        phantom_dropped=0,
        next_session=NEXT,
        next_session_basis="exchange_calendar",
        frequency=None,
    )
    base.update(overrides)
    return V.build(**base)  # type: ignore[arg-type]


# ── the four states ─────────────────────────────────────────────────────────
def test_enter_when_a_name_clears_every_condition_and_can_be_sized():
    verdict = build(candidates=[candidate()])
    assert verdict.state == V.STATE_ENTER
    assert verdict.buys is True
    assert verdict.primary_blocker is None
    assert "1 name" in verdict.headline
    assert str(V.PLACE_BY) in verdict.action
    assert verdict.integrity and all(check.ok for check in verdict.integrity)


def test_wait_when_the_tape_is_right_and_nothing_has_cleared():
    verdict = build(watchlist=[watch()])
    assert verdict.state == V.STATE_WAIT
    assert verdict.buys is False
    assert "TLKM" in verdict.change_needed
    assert verdict.sound is True


def test_no_trade_in_the_flat_band_and_the_reason_is_arithmetic():
    verdict = build(regime=regime("sideways", breadth=0.41))
    assert verdict.state == V.STATE_NO_TRADE
    assert verdict.primary_blocker is not None
    assert verdict.primary_blocker.key == "breadth"
    assert verdict.primary_blocker.severity == "market"
    assert "19 points" in verdict.change_needed  # 0.41 -> 0.60
    assert verdict.integrity and all(check.ok for check in verdict.integrity)


def test_no_trade_in_capitulation_points_at_the_watchlist():
    verdict = build(regime=regime("capitulation", breadth=0.18))
    assert verdict.state == V.STATE_NO_TRADE
    assert "watchlist" in verdict.change_needed
    assert "Capitulation" in verdict.headline


def test_no_trade_when_the_cleared_names_cannot_be_sized():
    """Clearing the rules is half the condition; the other half is being fillable."""
    verdict = build(candidates=[candidate(sizeable=False)])
    assert verdict.state == V.STATE_NO_TRADE
    assert verdict.primary_blocker is not None
    assert verdict.primary_blocker.key == "size"
    assert "100M" in verdict.change_needed
    assert verdict.sound is True


# ── integrity beats every signal ────────────────────────────────────────────
@pytest.mark.parametrize(
    ("overrides", "check_key"),
    (
        ({"bars_session": date(2026, 10, 8)}, "bars_current"),
        ({"exchange_session": None}, "exchange_calendar"),
        ({"universe_size": 40, "names_on_session": 40}, "universe"),
        ({"names_on_session": 100}, "coverage"),
        ({"phantom_dropped": 12}, "no_phantom_bars"),
    ),
)
def test_a_broken_input_yields_data_unsafe(overrides: dict[str, object], check_key: str):
    verdict = build(candidates=[candidate()], **overrides)
    assert verdict.state == V.STATE_DATA_UNSAFE
    assert verdict.sound is False
    assert verdict.primary_blocker is not None
    assert verdict.primary_blocker.key == check_key
    assert verdict.primary_blocker.severity == "data"
    failed = {check.key for check in verdict.integrity if not check.ok}
    assert check_key in failed


def test_unreadable_evidence_is_data_unsafe_even_when_names_cleared():
    unmeasured = M._unmeasured("breadth_quiet4_rs90_donchian", "lt_13_35_95", "no row")
    verdict = build(candidates=[candidate()], evidence=unmeasured)
    assert verdict.state == V.STATE_DATA_UNSAFE
    assert verdict.primary_blocker is not None
    assert verdict.primary_blocker.key == "evidence_measured"


def test_data_unsafe_beats_a_shut_market_gate():
    """Precedence, stated once: broken data outranks "the band is flat"."""
    verdict = build(regime=regime("sideways", breadth=0.4), phantom_dropped=3)
    assert verdict.state == V.STATE_DATA_UNSAFE


# ── the stand-down case ─────────────────────────────────────────────────────
def test_the_stand_down_case_carries_the_measured_numbers():
    verdict = build(regime=regime("sideways", breadth=0.41))
    case = verdict.stand_down_case
    assert case["band"] == "sideways"
    assert case["sideways"]["win_rate"] == pytest.approx(0.5741, abs=1e-4)
    assert case["sideways"]["avg_ret_pct"] == pytest.approx(-2.11, abs=0.01)
    assert case["sideways"]["capture_needed_x"] == pytest.approx(40.0)
    assert case["bands"]["sideways"] == pytest.approx(0.719, abs=1e-3)
    assert case["round_trip_pct"] == pytest.approx(M.ROUND_TRIP_COST * 100.0)
    assert case["provenance"], "a cited figure must carry its provenance"
    for cited in case["provenance"]:
        assert cited["doc"].startswith("docs/")
        assert cited["line"] > 0
        assert cited["quote"]


def test_the_book_comparison_is_the_argument_for_flat():
    """Same screen, same period, ten slots: with the flat band in it loses."""
    book = M.book_with_sideways()
    assert book["trend_only"]["available"] is True
    assert book["with_sideways"]["available"] is True
    assert book["slots"] == 10
    assert book["trend_only"]["total_pct"] > 0
    assert book["with_sideways"]["total_pct"] < 0
    assert book["with_sideways"]["max_drawdown_pct"] > book["trend_only"]["max_drawdown_pct"]
    assert book["source"].endswith("max_return_ceiling.csv")


def test_a_no_trade_verdict_still_shows_the_band_it_is_in():
    for band, breadth in (("sideways", 0.41), ("capitulation", 0.18)):
        verdict = build(regime=regime(band, breadth=breadth))
        assert verdict.stand_down_case["band"] == band
        assert verdict.stand_down_case["breadth"] == pytest.approx(breadth)
