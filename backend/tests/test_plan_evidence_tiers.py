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
