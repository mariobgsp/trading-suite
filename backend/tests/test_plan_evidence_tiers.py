"""Three tiers of evidence, and no surface may blend them.

`searched_census` rows come from the study's results files and are maxima over a
search. `walk_forward_corrected` is what the study publishes after its own
correctness pass. `replay` is a one-window, mark-to-market projection. They answer
different questions, and this app's central claim is that it never presents one as
another.

These tests are deliberately cheap: they read the results files and the citation
table, not the 900-name universe. The expensive end-to-end checks live in
`test_plan_conformance.py`, which needs bars and the study's own signal code.
"""

from __future__ import annotations

import pytest

from app.plan import citations as C
from app.plan import method as M
from app.plan import method_card


def test_the_three_tiers_exist_and_are_labelled():
    corrected = M.corrected_evidence()
    searched = M.default_evidence()
    replay = M.five_year_replay()

    assert corrected.role == C.ROLE_WALK_FORWARD
    assert corrected.measured is True
    assert searched.role == C.ROLE_SEARCHED
    assert searched.measured is True
    assert replay, "the five-year replay should be readable from its artifact"
    assert replay["tiers"], "the replay carries one row per regime tier"


def test_the_corrected_row_is_smaller_than_the_searched_row():
    """The correction moved every headline down; a UI showing it up is a bug."""
    corrected = M.corrected_evidence()
    searched = M.default_evidence()
    assert corrected.avg_ret_pct is not None and searched.avg_ret_pct is not None
    assert corrected.avg_ret_pct < searched.avg_ret_pct
    assert corrected.oos_trades is not None and searched.oos_trades is not None
    assert corrected.oos_trades < searched.oos_trades


def test_the_searched_row_is_the_census_row_for_the_shipped_chain():
    """It is measured, it is the shipped chain, and it came from the census file."""
    row = M.evidence_for(M.STUDY_PICK_FAMILY, M.STUDY_PICK_EXIT)
    assert row.measured is True
    assert row.family == M.STUDY_PICK_FAMILY
    assert row.exit_method == M.STUDY_PICK_EXIT
    assert row.source.endswith("method_table.csv")
    assert row.caveat and "census" in row.caveat.lower()


def test_a_pooled_row_says_how_many_variants_it_pools():
    """523 trades is four donchian windows; this screen runs one of them.

    Without this the app quotes a sample four times the size of the one it would
    actually trade, which is precisely the kind of overstatement the study's own
    documents spend their length correcting.
    """
    row = M.evidence_for(M.STUDY_PICK_FAMILY, M.STUDY_PICK_EXIT)
    assert row.n_specs == 4, "n20/n40/n50/n60 are pooled into the family's count"
    assert row.n_cells == 20
    assert row.single_spec_trades == C.value("single_spec_trades")
    assert row.single_spec_trades == 108


def test_a_row_for_another_chain_is_never_borrowed():
    """No row is evidence for a chain that did not measure it."""
    blank = M.evidence_for("no_such_family", "no_such_exit")
    assert blank.measured is False
    assert blank.win_rate is None and blank.avg_ret_pct is None
    assert "no measured row" in blank.caveat


def test_the_replay_names_its_own_limits():
    """The replay is the number most likely to be mistaken for an expectation."""
    replay = M.five_year_replay()
    assert replay["comparable_to_folds"] is False
    assert "survivorship" in replay["caveat"].lower()
    assert "2021" in replay["window"] and "one window" in replay["window"]


def test_the_horizon_ladder_refuses_intraday_with_its_own_numbers():
    """The day-trade answer is a measurement, so it is testable."""
    rows = M.horizons()
    assert rows[0]["key"] == "intraday", "the refused horizon leads, not hides"
    intraday = rows[0]
    assert intraday["tradeable"] is False
    assert intraday["verdict"] == "refused"
    labels = {cited["label"] for cited in intraday["provenance"]}
    assert {
        "intraday_captured_pct",
        "intraday_cost_hi_pct",
        "intraday_best_net_pct",
        "intraday_configs",
    } <= labels

    caps = {row["key"]: row for row in rows}
    assert caps["lt_13_35_95"]["tradeable"] is True
    assert caps["lt_13_35_95"]["sessions"] == 95
    assert caps["lt_13_35_55"]["sessions"] == 55
    assert caps["lt_13_35_55"]["tradeable"] is False, "the shorter cap is not the shipped one"
    # And the shipped cap carries the measured row, so the page cannot show a
    # horizon without saying what it did.
    assert caps["lt_13_35_95"]["evidence"] is not None


def test_the_method_card_carries_all_the_tiers_and_their_provenance():
    """The API surface a reader can audit without running a plan."""
    card = method_card()
    assert card["corrected"]["role"] == C.ROLE_WALK_FORWARD
    assert card["evidence"]["role"] == C.ROLE_SEARCHED
    tiers = card["evidence_tiers"]
    assert set(tiers) == {"searched", "corrected", "replay"}
    assert card["citations"], "the card must carry the citations it relies on"
    for cited in card["citations"]:
        assert cited["doc"].startswith("docs/")
        assert cited["line"] > 0
        assert cited["quote"]
    # The corrected block is the one the Method page renders as the headline.
    assert card["corrected_block"]["tier1_corrected_win_rate"]["value"] == 0.7632


def test_the_card_carries_the_headline_recosted_on_the_tick_grid():
    """The study's +1.85% beside what the IDX grid does to it.

    The re-cost is arithmetic over the study's own ledger, so it must never
    replace the published figure: both travel, and the card says explicitly that
    the tick term is charged *on top of* the study's model rather than instead
    of it (the model already contains 0.10% of slippage).
    """
    card = method_card()
    recost = card["recost"]

    assert recost["measured"] is True
    assert recost["modelled_mean_pct"] == pytest.approx(1.85)
    assert card["corrected"]["avg_ret_pct"] == pytest.approx(1.85), (
        "the study's own figure must survive beside its re-cost"
    )

    # Two ticks cost more than one, and each re-cost is the headline less the
    # spread it charged. If either stops holding, the arithmetic moved.
    assert recost["spread_1tick_pct"] < recost["spread_2tick_pct"]
    assert recost["recosted_mean_1tick_pct"] == pytest.approx(
        1.85 - recost["spread_1tick_pct"], abs=0.01
    )
    assert recost["recosted_mean_2tick_pct"] == pytest.approx(
        1.85 - recost["spread_2tick_pct"], abs=0.01
    )

    # Every tier-1 trade in the ledger lands in exactly one band, so the report
    # cannot quietly drop the expensive names and report a cheaper average.
    assert recost["ledger_tier1_trades"] == 57
    assert sum(b["trades"] for b in recost["bands"]) == 57
    assert all(b["share_pct"] is not None for b in recost["bands"])

    # The two things a reader has to know to trust the number at all.
    assert "on top of" in recost["assumption"]
    assert "corporate-action adjusted" in recost["caveat"]
    assert "bound on the cost" in recost["caveat"]


def test_the_record_is_read_as_episodes_not_as_independent_trades():
    """Tier 1's 57 trades sit inside a single gate-open run.

    The Wilson interval beside the headline counts every trade as an independent
    draw. When the whole record is one run the effective sample is that run, so
    the episode-blocked interval has to travel beside the per-trade one and be
    visibly wider. If this ever stops holding the study's measurement moved.
    """
    ci = method_card()["episode_ci"]

    assert ci["measured"] is True
    assert ci["trades"] == 57
    assert ci["trade_episodes"] is not None and ci["trade_episodes"] < 5
    assert ci["largest_episode_trade_share"] == pytest.approx(1.0)
    assert ci["gate_open_share"] is not None and ci["gate_open_share"] < 0.25

    naive_lo, naive_hi = ci["naive_win_rate"]
    block_lo, block_hi = ci["block_win_rate"]
    assert block_lo < naive_lo, "blocking must not narrow the interval"
    assert (block_hi - block_lo) > (naive_hi - naive_lo)

    assert "effective number of independent observations" in ci["note"]
