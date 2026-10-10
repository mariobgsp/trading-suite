"""The study's prose is part of this app's evidence, so it is under test.

Every figure in `app/plan/citations.py` names a file, a line and the words on that
line. If a later study round rewrites those documents, the app must not keep
quoting the old sentence — it must fail here and be updated. That is what makes a
cited number as trustworthy as one read from a CSV: both are checked against the
study on every run, and neither can drift silently.

The check tolerates a paragraph reflow (a window of a few lines) and does not
tolerate a rewrite (the sentence gone from the window entirely).
"""

from __future__ import annotations

import pytest

from app.plan import citations as C
from app.plan import method as M

# Lines either side of the recorded one. Enough for a reflow, too little to let a
# deleted sentence pass because the same words appear somewhere else in the file.
WINDOW = 4


@pytest.mark.parametrize("cited", C.all_citations(), ids=lambda c: c.label)
def test_a_cited_line_still_says_what_it_said(cited: C.Citation):
    doc = M.DOCS_DIR / cited.doc
    assert doc.exists(), (
        f"{cited.doc} is gone, so the citation for {cited.label!r} points at nothing. "
        "Either the study moved the document or the app is quoting a file that no "
        "longer exists."
    )
    lines = doc.read_text(encoding="utf-8").splitlines()
    assert cited.line <= len(lines), (
        f"{cited.doc} is shorter than line {cited.line}, so {cited.label!r} points past "
        "the end of the document"
    )
    lo = max(cited.line - WINDOW - 1, 0)
    hi = min(cited.line + WINDOW, len(lines))
    window = "\n".join(lines[lo:hi])
    assert cited.quote in window, (
        f"{cited.doc}:{cited.line} no longer says {cited.quote!r} (checked lines "
        f"{lo + 1}-{hi}).\nFound instead:\n{window}"
    )


def test_every_citation_records_where_it_came_from():
    """A number without a source is a number nobody can check."""
    for cited in C.all_citations():
        assert cited.label, "a citation needs a label"
        assert cited.doc.startswith("docs/"), f"{cited.label}: {cited.doc}"
        assert cited.line > 0, f"{cited.label}: line {cited.line}"
        assert cited.quote.strip(), f"{cited.label} cites a blank quote"
        assert cited.regenerate.strip(), f"{cited.label} names no way to regenerate it"
        assert cited.unit in {"%", "-", "trades", "sessions", "x"}, f"{cited.label}: {cited.unit}"


def test_the_corrected_row_reads_the_cited_values():
    """The corrected tier-1 row is assembled from citations, not from literals."""
    corrected = M.corrected_evidence()
    assert corrected.role == C.ROLE_WALK_FORWARD
    assert corrected.family == M.STUDY_PICK_FAMILY
    assert corrected.exit_method == M.STUDY_PICK_EXIT
    assert corrected.oos_trades == C.value("tier1_corrected_trades")
    assert corrected.win_rate == C.value("tier1_corrected_win_rate")
    assert corrected.avg_ret_pct == C.value("tier1_corrected_avg_ret_pct")
    assert corrected.profit_factor == C.value("tier1_corrected_profit_factor")
    assert corrected.max_drawdown_pct == C.value("tier1_corrected_max_drawdown_pct")
    assert corrected.book_return_pct == C.value("tier1_corrected_book_total_pct")
    assert corrected.book_max_drawdown_pct == C.value(
        "tier1_corrected_book_max_drawdown_pct"
    )
    assert corrected.win_rate_lo == C.value("tier1_wilson_lo")
    assert corrected.win_rate_hi == C.value("tier1_wilson_hi")
    assert len(corrected.provenance) == len(C.all_citations())


def test_the_corrected_block_answers_the_questions_a_trader_asks():
    """Every figure the corrected card claims to show is present and cited."""
    block = C.corrected_tier1()
    for label in (
        "tier1_corrected_win_rate",
        "tier1_corrected_avg_ret_pct",
        "tier1_corrected_max_drawdown_pct",
        "tier1_corrected_book_total_pct",
        "tier1_corrected_book_max_drawdown_pct",
        "tier1_survivorship_avg_ret_pct",
        "tier1_holdout_avg_ret_pct",
        "tier1_quarterly_avg_ret_pct",
        "single_spec_trades",
        "trending_share",
        "sideways_share",
    ):
        assert label in block, f"{label} is missing from corrected_tier1()"
        assert block[label]["quote"], f"{label} is in the block without a quote"

    # The two comparison figures the app leans on must stay in the study's own
    # order: the haircut and the holdout both make the edge smaller, and a UI
    # that showed them the other way round would understate the risk.
    assert block["tier1_survivorship_avg_ret_pct"]["value"] < block[
        "tier1_corrected_avg_ret_pct"
    ]["value"]
    assert block["tier1_holdout_avg_ret_pct"]["value"] < block[
        "tier1_corrected_avg_ret_pct"
    ]["value"]


def test_the_measured_and_corrected_win_rates_are_not_the_same_number():
    """If these ever match, someone has replaced one with the other."""
    measured = M.default_evidence()
    corrected = M.corrected_evidence()
    assert measured.measured and corrected.measured
    assert measured.avg_ret_pct != corrected.avg_ret_pct
    assert measured.oos_trades != corrected.oos_trades
