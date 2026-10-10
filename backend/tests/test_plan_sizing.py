"""Sizing, ticks and friction: the arithmetic that decides how much can be lost.

The app used to size a position by treating `RISK_BUDGET_IDR` — documented as the
loss the user will book on one name — as the *notional*, which with a 35% stop is
roughly four times the risk the constant describes. It also ignored turnover
entirely and printed levels off the tick grid.

These tests pin the study's own rule (docs/21 §8: 2% of median 60-session
turnover, clamped 2M-10M IDR, rejected above 2% participation) and the IDX
structure the ticket prices against.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.plan import idx as X
from app.plan import screen as S


# ── ticks ───────────────────────────────────────────────────────────────────
def test_tick_bands_match_the_rulebook():
    assert X.tick_for(1) == 1
    assert X.tick_for(199.99) == 1
    assert X.tick_for(200) == 2
    assert X.tick_for(499) == 2
    assert X.tick_for(500) == 5
    assert X.tick_for(1_999) == 5
    assert X.tick_for(2_000) == 10
    assert X.tick_for(4_999) == 10
    assert X.tick_for(5_000) == 25
    assert X.tick_for(50_000) == 25


@pytest.mark.parametrize(
    ("price", "how", "want"),
    (
        (1_007, "nearest", 1_005),
        (1_007, "down", 1_005),
        (1_007, "up", 1_010),
        (1_002, "nearest", 1_000),
        (250, "nearest", 250),
        (251, "down", 250),
        (251, "up", 252),
        (33, "nearest", 33),
    ),
)
def test_rounding_lands_on_the_grid(price: float, how: str, want: float):
    got = X.round_to_tick(price, how)
    assert got == want, f"{price} {how} -> {got}, wanted {want}"
    tick = X.tick_for(got)
    assert abs(got / tick - round(got / tick)) < 1e-9, f"{got} is off its own {tick} grid"


# ── friction ────────────────────────────────────────────────────────────────
def test_friction_is_broker_fees_plus_the_spread():
    """The gap between the study's model and a real account, at three prices.

    Rp100: one tick is 1%, so a two-tick spread is 2% against 0.40% of fees.
    Rp1,000: a 1% spread. Rp10,000: 0.50%.
    """
    cheap = X.friction_round_trip(100)
    assert cheap.tick_idr == 1
    assert cheap.fees_pct == pytest.approx(0.40, abs=0.001)
    assert cheap.spread_pct == pytest.approx(2.00, abs=0.01)
    assert cheap.total_pct == pytest.approx(2.40, abs=0.01)

    mid = X.friction_round_trip(1_000)
    assert mid.tick_idr == 5
    assert mid.spread_pct == pytest.approx(1.00, abs=0.01)
    assert mid.total_pct == pytest.approx(1.40, abs=0.01)
    # and the study's flat model is the thing it exceeds
    assert mid.study_model_pct == pytest.approx(S.M.ROUND_TRIP_COST * 100.0)
    assert mid.over_study_pct == pytest.approx(0.90, abs=0.01)

    rich = X.friction_round_trip(10_000)
    assert rich.tick_idr == 25
    assert rich.total_pct == pytest.approx(0.90, abs=0.01)


def test_a_wider_spread_costs_more():
    tight = X.friction_round_trip(1_000, spread_ticks=1)
    wide = X.friction_round_trip(1_000, spread_ticks=4)
    assert wide.total_pct > tight.total_pct
    assert tight.total_pct - X.BROKER_FEE_BUY * 100 - X.BROKER_FEE_SELL * 100 == pytest.approx(
        0.50, abs=0.01
    )


# ── auto-rejection ──────────────────────────────────────────────────────────
def test_ar_bands_are_directional_today_and_symmetric_in_2027():
    today = X.ar_limits(1_000, date(2026, 10, 10))
    assert today.up_price == 1_250  # +25%
    assert today.down_price == 850  # -15%

    next_year = X.ar_limits(1_000, date(2027, 1, 2))
    assert next_year.down_price == 750  # symmetric: -25%
    assert next_year.up_price == 1_250


def test_the_penny_band_is_one_tick_wide():
    penny = X.ar_limits(5, date(2026, 10, 10))
    assert penny.up_price == 6
    assert penny.down_price == 4
    assert X.one_tick_band(5)
    assert not X.one_tick_band(50)


def test_a_target_outside_the_band_is_flagged():
    assert X.target_inside_ar(1_000, 1_130) is True
    assert X.target_inside_ar(1_000, 1_400) is False


def test_the_untradeable_window_is_named():
    assert X.tradeable_clock("09:30")
    assert X.tradeable_clock("15:50")
    assert not X.tradeable_clock("15:57")
    assert not X.tradeable_clock("16:01")
    session = X.sessions_for("09:30")
    assert session is not None and session.label == "session I"


# ── the study's sizing rule ─────────────────────────────────────────────────
def test_the_sizing_rule_clamps_to_the_study_band():
    position, participation, why = S.study_position(100_000_000)
    assert position == 2_000_000, "the 2M floor binds at exactly 100M of turnover"
    assert participation == pytest.approx(0.02)
    assert why == ""

    position, participation, _ = S.study_position(500_000_000)
    assert position == 10_000_000
    assert participation == pytest.approx(0.02)

    position, participation, _ = S.study_position(5_000_000_000)
    assert position == 10_000_000, "the 10M cap binds on a liquid name"
    assert participation is not None and participation < 0.01


def test_a_name_too_thin_for_the_floor_is_refused_not_simulated():
    """Under 100M a day, the 2M floor would be more than 2% of ADV."""
    position, participation, why = S.study_position(50_000_000)
    assert position is None and participation is None
    assert "100M" in why or "2%" in why

    assert S.study_position(None)[0] is None
    assert S.study_position(0)[0] is None


# ── the geometry a ticket reads ─────────────────────────────────────────────
def test_a_position_risks_the_budget_not_the_notional():
    """The defect this phase exists to fix, pinned.

    A 10M IDR risk budget with a 35% stop must not produce a 3.5M IDR loss by
    accident of calling the budget a position.
    """
    geometry = S._geometry(
        1_000.0,
        "lt_13_35_95",
        turnover_idr=5_000_000_000,
        risk_budget_idr=10_000_000,
    )
    assert geometry.position_idr == 10_000_000
    assert geometry.sizing_basis == "study_adv"
    assert geometry.shares == 10_000
    assert geometry.lots == 100

    assert geometry.max_loss_idr is not None
    expected = geometry.shares * (
        geometry.entry_ref - geometry.stop_price
    ) + geometry.position_idr * S.M.ROUND_TRIP_COST
    assert geometry.max_loss_idr == pytest.approx(expected, rel=1e-6)
    # ~35.5% of the position: the stop plus costs, which is the real number
    assert geometry.risk_pct_of_position is not None
    assert 30.0 < geometry.risk_pct_of_position < 40.0


def test_a_small_risk_budget_sizes_the_position_down():
    geometry = S._geometry(
        1_000.0,
        "lt_13_35_95",
        turnover_idr=5_000_000_000,
        risk_budget_idr=1_000_000,
    )
    assert geometry.sizing_basis == "risk_budget"
    assert geometry.position_idr is not None and geometry.position_idr < 3_000_000
    assert geometry.max_loss_idr is not None and geometry.max_loss_idr <= 1_020_000
    assert any("risk budget" in note for note in geometry.notes)


def test_an_unsizeable_name_says_so_rather_than_getting_the_cap():
    geometry = S._geometry(
        1_000.0,
        "lt_13_35_95",
        turnover_idr=50_000_000,
        risk_budget_idr=10_000_000,
    )
    assert geometry.position_idr is None
    assert geometry.max_loss_idr is None
    assert geometry.notes, "a refused size must say why"
    assert any("refuse" in note or "2% ADV" in note for note in geometry.notes)


def test_levels_are_on_the_tick_grid():
    geometry = S._geometry(
        1_007.0, "lt_13_35_95", turnover_idr=5_000_000_000
    )
    for level in (geometry.target_price, geometry.stop_price):
        tick = X.tick_for(level)
        assert abs(level / tick - round(level / tick)) < 1e-9, f"{level} is off the grid"
    # the target is rounded *down*, so it is never advertised beyond the rule
    assert geometry.target_price <= 1_007.0 * 1.13 + 1e-9
    assert geometry.tick_idr == 5


def test_every_geometry_carries_its_friction_and_its_notes():
    geometry = S._geometry(1_000.0, "lt_13_35_95", turnover_idr=5_000_000_000)
    assert geometry.friction["total_pct"] == pytest.approx(1.40, abs=0.01)
    assert geometry.friction["study_model_pct"] == pytest.approx(0.50, abs=0.001)
    assert any("round trip costs" in note for note in geometry.notes)


# ── the standalone sizing call ──────────────────────────────────────────────
def test_size_ticket_is_the_same_arithmetic_as_the_plan():
    ticket = S.size_ticket(1_000.0, 5_000_000_000, 10_000_000, "lt_13_35_95")
    direct = S._geometry(1_000.0, "lt_13_35_95", 5_000_000_000, 10_000_000)
    assert ticket["geometry"]["position_idr"] == direct.position_idr
    assert ticket["geometry"]["target_price"] == direct.target_price
    assert ticket["geometry"]["stop_price"] == direct.stop_price
    assert ticket["ar"]["up_price"] == 1_250
    assert ticket["tables"]["lot_size"] == 100
    assert ticket["tables"]["ar_bands"], "the AR table travels with the ticket"
    assert ticket["position"]["max_participation"] == S.MAX_PARTICIPATION


def test_size_ticket_prices_a_wider_spread():
    tight = S.size_ticket(1_000.0, 5_000_000_000, 10_000_000, "lt_13_35_95", 1)
    wide = S.size_ticket(1_000.0, 5_000_000_000, 10_000_000, "lt_13_35_95", 4)
    assert (
        wide["geometry"]["friction"]["total_pct"]
        > tight["geometry"]["friction"]["total_pct"]
    )
