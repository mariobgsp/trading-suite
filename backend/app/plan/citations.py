"""Numbers the study published in prose, with the line that carries them.

Most of this app's evidence is read from a CSV the study writes: a row exists,
the app quotes it, and `test_plan_conformance.py` can diff the rule chain against
the study's own code. A few of the numbers that matter most do not work that way.

The corrected tier-1 result is the case in point. After an audit found 7.0% of
the study's trades came from names that do not actually trade, the study re-ran
the screen on the clean universe and every headline moved:

    win rate      78.48%  ->  76.32%
    mean return   +2.91%  ->  +1.85%
    max drawdown   22.5%  ->    9.4%

Those corrected figures were published in `docs/21-screener-spec.md` and
`docs/20-illiquid-and-adaptive-screener.md`. No results CSV carries them: the
artifacts hold the pre-correction numbers, because the correction was a pass over
the engine rather than a new artifact round. So the choice is to cite them with
their provenance, or to leave the app quoting a number the study has withdrawn.

This module cites them. Every entry carries the file, the line, the words on that
line, and how to regenerate it, so a reader can check the number rather than trust
it. `test_plan_citations.py` re-reads the study and fails the build if a cited
line stops saying what it said — the app cannot quietly drift away from the study
it claims to re-transcribe.
"""

from __future__ import annotations

from .model import Citation

# The tiers an `Evidence` row can belong to. The app must never present one as
# another: a searched maximum is not an expectation, and a marked replay is not a
# walk-forward.
ROLE_WALK_FORWARD = "walk_forward_corrected"
ROLE_SEARCHED = "searched_census"
ROLE_REPLAY = "replay"

# Regenerating the corrected figures is the study's job, not this app's: it means
# re-running the screen over the clean universe with tiered costs across every
# fold. The commands below are the study's own entry points.
REGEN_SCREEN = (
    "cd ~/Projects/trading-backtest-docs && "
    ".venv/bin/python scripts/screen.py --asof <session>"
)
REGEN_ENGINE = (
    "cd ~/Projects/trading-backtest-docs && .venv/bin/python scripts/illiquid_engine.py"
)

_SPEC = "docs/21-screener-spec.md"
_CLEAN = "docs/20-illiquid-and-adaptive-screener.md"
_CEIL = "docs/24-trade-count-ceiling.md"
_FOLDS = "docs/14-portfolio-test.md"
_REFUSAL = "docs/22-the-80-and-5-question.md"

def _cite(
    label: str,
    value: float | None,
    unit: str,
    doc: str,
    line: int,
    quote: str,
    regenerate: str = REGEN_SCREEN,
) -> Citation:
    """One citation, defaulting to the study's screen command as its regenerator.

    Nothing is cited here without a way to reproduce it: a number a reader cannot
    re-run is a number they have to take on trust, which is the opposite of the
    point.
    """
    return Citation(
        label=label,
        value=value,
        unit=unit,
        doc=doc,
        line=line,
        quote=quote,
        regenerate=regenerate,
    )


_ALL: tuple[Citation, ...] = (
    # ── the corrected tier-1 result, in the study's own corrected table ──────
    _cite(
        "tier1_corrected_win_rate",
        0.7632,
        "%",
        _SPEC,
        11,
        "**76.32%** (Wilson [65.6%, 84.5%])",
    ),
    _cite("tier1_corrected_avg_ret_pct", 1.85, "%", _SPEC, 12, "**+1.85%**"),
    _cite("tier1_corrected_profit_factor", 1.24, "-", _SPEC, 13, "**1.24**"),
    _cite("tier1_corrected_max_drawdown_pct", 9.4, "%", _SPEC, 15, "**9.4%**"),
    _cite(
        "tier1_corrected_book_total_pct",
        28.7,
        "%",
        _SPEC,
        16,
        "**+28.7%**, maxDD 10.7%",
    ),
    _cite(
        "tier1_corrected_book_max_drawdown_pct",
        10.7,
        "%",
        _SPEC,
        16,
        "maxDD 10.7%",
    ),
    _cite("tier1_corrected_book_cagr_pct", 18.3, "%", _SPEC, 62, "**+18.3%** CAGR"),
    _cite("tier1_wilson_lo", 0.656, "%", _SPEC, 56, "**[65.6%, 84.5%]**"),
    _cite("tier1_wilson_hi", 0.845, "%", _SPEC, 56, "**[65.6%, 84.5%]**"),
    _cite(
        "tier1_corrected_trades",
        76.0,
        "trades",
        _SPEC,
        211,
        "on 76 trades across f2/f3/f4",
    ),
    _cite(
        "tier1_corrected_restated",
        0.7632,
        "%",
        _CLEAN,
        476,
        "CLEAN-UNIVERSE tier 1 (shipped, breadth 0.60, 76 trades): 76.32% · +1.85%",
    ),
    # ── what the same wallet loses under the study's stress tests ────────────
    _cite("tier1_survivorship_win_rate", 0.7231, "%", _SPEC, 59, "72.31% · **+0.04%**"),
    _cite("tier1_survivorship_avg_ret_pct", 0.04, "%", _SPEC, 59, "72.31% · **+0.04%**"),
    _cite("tier1_holdout_win_rate", 0.7411, "%", _SPEC, 60, "**74.11% / +0.09%**"),
    _cite("tier1_holdout_avg_ret_pct", 0.09, "%", _SPEC, 60, "**74.11% / +0.09%**"),
    _cite("tier1_quarterly_win_rate", 0.7619, "%", _CLEAN, 500, "**76.19% · +0.31%**"),
    _cite("tier1_quarterly_avg_ret_pct", 0.31, "%", _CLEAN, 500, "**76.19% · +0.31%**"),
    # ── the shipped configuration, stated as a configuration ─────────────────
    _cite("shipped_exit", None, "-", _SPEC, 46, "+13% target, -35% stop, 95-session cap"),
    _cite("shipped_chain", None, "-", _CEIL, 126, "+13%/−35%/95 sessions, 2% ADV cap"),
    # ── how often the screen can act at all ─────────────────────────────────
    _cite("trending_share", 0.209, "%", _SPEC, 75, "**20.9%**"),
    _cite("sideways_share", 0.719, "%", _SPEC, 76, "**71.9%**"),
    _cite("idle_sessions", None, "sessions", _CEIL, 9, "150 of 715 sessions"),
    # ── one spec, not four: the app runs donchian 40 alone ──────────────────
    _cite(
        "single_spec_trades",
        108.0,
        "trades",
        _FOLDS,
        52,
        "| breadth_quiet4_rs90_donchian | 2 | 13 | 61.5% | -0.07% |",
    ),
    # ── the bar itself was never reached on unseen data ─────────────────────
    _cite(
        "bar_not_reached",
        None,
        "-",
        _REFUSAL,
        3,
        "no configuration of the rules",
        REGEN_ENGINE,
    ),
)

CITATIONS: dict[str, Citation] = {c.label: c for c in _ALL}


def citation(label: str) -> Citation | None:
    """One cited number, or None when this app does not cite that label."""
    return CITATIONS.get(label)


def value(label: str) -> float | None:
    """The number behind a citation, for assembling an `Evidence` row."""
    found = CITATIONS.get(label)
    return found.value if found else None


def corrected_tier1() -> dict[str, object]:
    """The corrected tier-1 block, ready to be shown with its provenance.

    Reads through `citation()` rather than restating the figures, so each number
    lives in one place and the drift test has one thing to guard.
    """
    labels = (
        "tier1_corrected_trades",
        "tier1_corrected_win_rate",
        "tier1_corrected_avg_ret_pct",
        "tier1_corrected_profit_factor",
        "tier1_corrected_max_drawdown_pct",
        "tier1_corrected_book_total_pct",
        "tier1_corrected_book_max_drawdown_pct",
        "tier1_corrected_book_cagr_pct",
        "tier1_survivorship_win_rate",
        "tier1_survivorship_avg_ret_pct",
        "tier1_holdout_win_rate",
        "tier1_holdout_avg_ret_pct",
        "tier1_quarterly_win_rate",
        "tier1_quarterly_avg_ret_pct",
        "single_spec_trades",
        "trending_share",
        "sideways_share",
    )
    return {label: CITATIONS[label].as_dict() for label in labels if label in CITATIONS}


def all_citations() -> tuple[Citation, ...]:
    """Every cited number, in the order the module declares them."""
    return _ALL


__all__ = [
    "CITATIONS",
    "ROLE_REPLAY",
    "ROLE_SEARCHED",
    "ROLE_WALK_FORWARD",
    "all_citations",
    "citation",
    "corrected_tier1",
    "value",
]
