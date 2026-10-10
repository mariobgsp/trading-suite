"""The method, and the measured evidence for it.

Two things live here and nothing else does:

1. The rule chain, transcribed from the study. Every constant carries the file
   and line of `trading-backtest-docs` it came from, because this module is the
   app's copy of the study and a silent divergence would make every number on
   screen a lie. `tests/test_plan_conformance.py` replays the study's own
   `strategies.signals()` against this chain and fails if they disagree.

2. The measured result, read from `results/top10_methods.csv` at request time.
   Never hard-coded: when the study's next round lands, the app picks it up.

The default is the widest qualifying row - the one with the most out-of-sample
trades that still clears 80% win rate and >5% average - because a daily screen
needs names to show, not just a high win rate.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from . import citations as C
from .model import Evidence, Holdout, RegimeFrequency

# Where the study lives. Overridable so a checkout elsewhere still works.
DOCS_DIR = Path(os.environ.get("TRADING_DOCS_DIR", "~/Projects/trading-backtest-docs")).expanduser()
RESULTS = DOCS_DIR / "results"
TOP10_CSV = RESULTS / "top10_methods.csv"
METHOD_TABLE_CSV = RESULTS / "method_table.csv"
PORTFOLIO_MULTI_CSV = RESULTS / "portfolio_multi.csv"
PORTFOLIO_ROBUST_CSV = RESULTS / "portfolio_robust.csv"
PORTFOLIO_TEST_CSV = RESULTS / "portfolio_test.csv"
MULTIPLE_TESTING_CSV = RESULTS / "multiple_testing.csv"
SURVIVORSHIP_CSV = RESULTS / "survivorship_bound.csv"
QUARTERLY_DIR = RESULTS / "quarterly"
QUARTERLY_BOOKS_CSV = QUARTERLY_DIR / "quarterly_books.csv"
QUARTERLY_ANALYSIS_CSV = QUARTERLY_DIR / "quarterly_analysis.csv"
# docs/22 — the holdout experiment that answers the 80%-and-5% question, and
# the breadth-day census from docs/24 that says how often each regime band
# actually occurs. Without these the app quotes a searched maximum as though it
# were an expectation.
HOLDOUT_SEARCH_CSV = RESULTS / "holdout_search_screen.csv"
HOLDOUT_CELLS_CSV = RESULTS / "holdout_search_cells_screen.csv"
BREADTH_DAYS_CSV = RESULTS / "results_breadth_days.csv"
MAX_RETURN_CEILING_CSV = RESULTS / "max_return_ceiling.csv"
FIVE_YEAR_REPLAY_CSV = RESULTS / "five_year_replay_flat.csv"

# ── the rule chain ───────────────────────────────────────────────────────────
# A strategy is named `family` x `exit`. Three families cleared both bars in the
# study; they share this chain and differ only in which gates they apply (see
# FAMILY_SPECS). From src/strategies.py GATES and the base family at l.417-419:
#
#   breakout            close > high.rolling(40).max().shift(1)     strategies.py:242
#   index_above_200     IHSG close > its own 200-session mean       indicators.py:293
#   breadth             share of the universe above its own 200     strategies.py:581
#   relative_strength   120-session momentum percentile             loop_search.py:142
#   quiet_vol           20-session realised vol vs its median      indicators.py:295
#   weekly_trend        weekly close > weekly 30-period mean        indicators.py:242
#
# BREADTH_THRESHOLD is the plain "breadth" gate's 50%; the "breadth7" variant
# needs 70%. Which one a family uses lives in FAMILY_SPECS, not here.
DONCHIAN_N = 40
RS_LOOKBACK = 120
RS_PERCENTILE_MIN = 90.0
BREADTH_THRESHOLD = 0.50  # the plain "breadth" gate; breadth7 would be 0.70
MA_WINDOW = 200
VOL_WINDOW = 20
VOL_MEDIAN_WINDOW = 120
BENCH_SMA = 200
WEEKLY_SMA = 30

# ── the regime band the tape is in (docs/21 §1, scripts/screen.py:58-59) ──────
# The shipped screen splits breadth into three bands rather than a binary
# open/shut, and the middle one is the finding: sideways drifts about zero over
# five sessions while a round trip costs 0.50%, so the answer there is to sit out
# rather than trade it. `capitulation` is not a sell signal either - it is when
# the watchlist earns its keep.
BREADTH_TRENDING = 0.60
BREADTH_CAPITULATION = 0.25

# ── costs (docs/00-scope-and-definitions.md §3, src/common.py) ────────────────
FEE_BUY = 0.0015
FEE_SELL = 0.0025
SLIPPAGE = 0.0005
LOT_SIZE = 100
ROUND_TRIP_COST = FEE_BUY + FEE_SELL + 2 * SLIPPAGE  # 0.50%
RISK_BUDGET_IDR = 10_000_000.0  # loss the user is willing to book on one name

# ── the bar the study set, and the caveat that travels with every number ─────
TARGET_WIN_RATE = 0.80
TARGET_AVG_TRADE_PCT = 5.0
# docs/22 §1: the floor exists because one configuration in the study reads
# 86.67% / +5.88% - clearing both halves - on 15 trades from a single fold.
MIN_TEST_TRADES = 100

# Not decoration. This travels with every Evidence the app emits, and it exists
# because docs/22 answered the question directly: searching 280 configurations
# and reporting the best gives you a maximum, not an expectation.
CAVEAT = (
    "A searched figure, not a forecast. The study tried 280 configurations on "
    "folds 0-2 and reported the best of them; not one cleared both bars even on "
    "the data it was searched on, and none held up on folds 3-5 that no search "
    "had seen. Read the holdout result beside this number, never alone."
)
HOLDOUT_CAVEAT = (
    "Measured on folds the search never saw, so this is the honest expectation. "
    "It clears neither bar: not 80% win rate, and not +5% per trade."
)

@dataclass(frozen=True)
class FamilySpec:
    """One measured entry family, and the thresholds it was measured with.

    `quiet` is how the volatility gate reads: "median" is vol20 <= its own
    120-session median, "q40" is vol20 <= its 40th percentile. `breadth` is the
    share of the universe that must be above its own 200-day average.
    """

    family: str
    breadth: float
    rs_min: float
    quiet: str
    need_bench: bool
    need_weekly: bool

    def label(self) -> str:
        bits: list[str] = []
        if self.need_bench:
            bits.append("IHSG above its 200-day average")
        bits.append(f"breadth over {self.breadth * 100:.0f}%")
        bits.append(f"relative strength top {100 - self.rs_min:.0f}%")
        bits.append(
            "quiet volatility" if self.quiet == "median" else "volatility under its 40th percentile"
        )
        if self.need_weekly:
            bits.append("weekly trend up")
        return ", ".join(bits)


# The three families the study measured above both bars. The app runs one of
# these rather than a blend, so the gates on screen are the gates that were
# backtested - the app never shows a rule the study did not measure.
FAMILY_SPECS: dict[str, FamilySpec] = {
    # The study's published #1 family, and 19 of the 27 qualifying rows. No
    # index gate, but it needs a genuinely broad tape, so it fires least often.
    "breadth7_quiet_rs90_donchian": FamilySpec(
        family="breadth7_quiet_rs90_donchian",
        breadth=0.70,
        rs_min=90.0,
        quiet="median",
        need_bench=False,
        need_weekly=False,
    ),
    # No index gate and the tightest volatility bar. This is the family the app
    # runs. Its breadth gate is 0.60, not the 0.50 it was first searched at:
    # docs/24 tested the lower gates directly and found each extra trade bought
    # by loosening breadth is a worse trade — breadth >= 0.60 is where the return
    # is, and it is also the gate the study ships (docs/21 §1).
    "breadth_quiet4_rs90_donchian": FamilySpec(
        family="breadth_quiet4_rs90_donchian",
        breadth=0.60,
        rs_min=90.0,
        quiet="q40",
        need_bench=False,
        need_weekly=False,
    ),
    # Index and weekly trend on top of mid breadth. Trades in the most folds and
    # holds up best fold to fold, but sits shut for long stretches in a bear.
    "full_breadth_quiet_wup_rs90_donchian": FamilySpec(
        family="full_breadth_quiet_wup_rs90_donchian",
        breadth=0.50,
        rs_min=90.0,
        quiet="median",
        need_bench=True,
        need_weekly=True,
    ),
}

DEFAULT_FAMILY = "full_breadth_quiet_wup_rs90_donchian"
# The exit the study ships (docs/21 §0a, docs/24 §7). Not the first row its
# search ranked — that was 14/40/95 — but the geometry its corrected numbers
# belong to, and the one the acceptance checklist names.
DEFAULT_EXIT = "lt_13_35_95"

# The configuration the study actually ships (docs/21 §1, scripts/screen.py
# 58-90). These are the numbers the app runs tonight, and the numbers
# `shipped_config()` looks up in the holdout census so the evidence on screen
# belongs to the rules being applied rather than to a nearby variant.
#
#   entry    40-session breakout, RS rank >= 90, own vol20 in its lowest 40%
#   exit     +13% target, -35% stop, 95-session cap
#   regime   breadth >= 0.60 trade, 0.25-0.60 flat, < 0.25 watchlist
SHIP_BREADTH = BREADTH_TRENDING
SHIP_RS = 90.0
SHIP_QUIET = "quiet4"

# The chain the app runs, and the reason it is two decisions rather than one.
#
#   family  breadth_quiet4_rs90_donchian — no index gate, so it is not shut for
#           whole quarters the way an index-gated family is; it traded in five of
#           the study's six windows, the most of any qualifying row.
#   exit    lt_13_35_95 — the geometry the study ships (docs/21 §0a, docs/24 §7).
#
# docs/18 named 14/40/95 as the family's published pick and quoted 523 trades at
# 81.07% / +5.51% for it. Those are the *searched* numbers, and docs/21 later
# corrected every headline down after an audit found 7.0% of the study's trades
# came from names that do not trade: the corrected tier-1 result is 76 trades at
# 76.32% / +1.85% with a 9.4% max drawdown. The app runs the corrected chain.
#
# The two live in different files, which is worth knowing when reading the code:
# results/top10_methods.csv holds only the rows that cleared both bars, and
# 13/35/95 for this family clears the win bar but not the +5% bar, so it is only
# in results/method_table.csv — the 2,952-row census. `evidence_for` searches
# both; `corrected_evidence` cites the published corrected figures.
STUDY_PICK_FAMILY = "breadth_quiet4_rs90_donchian"
STUDY_PICK_EXIT = "lt_13_35_95"


def family_spec(family: str | None) -> FamilySpec:
    """The spec for a measured family, falling back to the default."""
    if family and family in FAMILY_SPECS:
        return FAMILY_SPECS[family]
    return FAMILY_SPECS[DEFAULT_FAMILY]

# Exit ladder options, as (target %, stop %, hold bars). Measured, not invented:
# every one of these is a row of results/top10_methods.csv.
EXIT_LADDER = {
    # The shipped screen's geometry, and the one the corrected figures describe:
    # a nearer target and a tighter stop than the searched pick, which is what
    # halves the drawdown.
    "lt_13_35_95": (13.0, 35.0, 95),
    "lt_14_40_95": (14.0, 40.0, 95),  # the study's published pick
    "lt_14_45_95": (14.0, 45.0, 95),
    "lt_14_35_95": (14.0, 35.0, 95),
    "lt_14_40_55": (14.0, 40.0, 55),
    "lt_14_35_55": (14.0, 35.0, 55),
    "lt_13_35_55": (13.0, 35.0, 55),
    "lt_16_35_55": (16.0, 35.0, 55),
    "wide_16_35_60": (16.0, 35.0, 60),
}
FALLBACK_EXIT = EXIT_LADDER[STUDY_PICK_EXIT]


@dataclass(frozen=True)
class Rule:
    """One named condition, with the sentence the UI shows for it."""

    key: str
    label: str
    source: str
    explain: str


RULES: tuple[Rule, ...] = (
    Rule(
        "breakout",
        f"{DONCHIAN_N}-session breakout",
        "src/strategies.py:242 broke_above",
        f"The close broke above the highest high of the previous {DONCHIAN_N} sessions.",
    ),
    Rule(
        "index_above_200",
        "IHSG above its 200-day average",
        "src/indicators.py:293",
        "The market index itself is above its own long-term average, so the tape is worth buying.",
    ),
    Rule(
        "breadth",
        # No threshold baked into the label: the family gate and the regime
        # band are different numbers (0.50 was first searched, 0.60 ships), and
        # the Gate the screen builds carries the spec-aware one.
        "Market breadth",
        "src/loop_search.py:157 build_breadth",
        f"At least {int(BREADTH_THRESHOLD * 100)}% of the universe is above its own 200-day "
        "average, so the move is broad rather than two or three stocks.",
    ),
    Rule(
        "relative_strength",
        f"Relative strength top {100 - RS_PERCENTILE_MIN:.0f}%",
        "src/loop_search.py:142 build_rs_rank",
        f"{RS_LOOKBACK}-session momentum ranks in the top "
        f"{100 - RS_PERCENTILE_MIN:.0f}% of every IDX name in the universe.",
    ),
    Rule(
        "quiet_vol",
        "Quiet before the break",
        "src/indicators.py:295",
        f"{VOL_WINDOW}-session realised volatility is at or below the name's own "
        f"{VOL_MEDIAN_WINDOW}-session median: it coiled instead of running.",
    ),
    Rule(
        "weekly_trend",
        "Weekly trend up",
        "src/indicators.py:242 mtf_features",
        f"On the weekly chart the close is above its {WEEKLY_SMA}-week average.",
    ),
)

RULE_BY_KEY = {r.key: r for r in RULES}


def exit_for(exit_method: str) -> tuple[float, float, int]:
    """(target %, stop %, hold bars) for a measured exit name, else the default."""
    return EXIT_LADDER.get(exit_method, FALLBACK_EXIT)


# ── evidence ─────────────────────────────────────────────────────────────────
def _f(row: dict[str, str], key: str) -> float | None:
    try:
        v = row.get(key, "")
        return float(v) if v not in ("", "nan", None) else None
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=1)
def _table() -> tuple[tuple[dict[str, str], ...], str]:
    """(rows, status) of the study's measured ladder. Cached for the process.

    The study writes this file while its rounds run, so a read failure is
    reported rather than raised: the plan is still correct without it, it just
    cannot cite a number.
    """
    if not TOP10_CSV.exists():
        return (), f"no measured results at {TOP10_CSV}"
    try:
        with TOP10_CSV.open(newline="", encoding="utf-8") as fh:
            rows = tuple(csv.DictReader(fh))
    except (OSError, csv.Error) as exc:
        return (), f"unreadable {TOP10_CSV}: {exc}"
    if not rows:
        return (), f"empty {TOP10_CSV}"
    return rows, "ok"


def clear_cache() -> None:
    """Drop every memoised read, so a finished study round is picked up.

    The holdout and regime-frequency readers are cached too. A study round that
    lands mid-session writes new CSVs, and a stale cache would leave the app
    quoting the previous round's answer to a question it has already re-asked.
    """
    _table.cache_clear()
    _family_spec_count.cache_clear()
    book_with_sideways.cache_clear()
    holdout.cache_clear()
    regime_frequency.cache_clear()
    five_year_replay.cache_clear()


def _evidence(
    row: dict[str, str],
    cells: int | None,
    source: Path = TOP10_CSV,
    role: str = C.ROLE_SEARCHED,
) -> Evidence:
    """One measured row, from whichever results file carries it.

    `top10_methods.csv` holds the rows that cleared both bars and carries the
    per-fold detail, the spec count and the cell count. `method_table.csv` holds
    every family x exit the study measured: the trade count, the win rate and the
    average, but no per-fold string. The shipped chain is a method_table row — it
    is measured, it misses the +5% bar, and it never reached the ranked list — so
    the app says which file a number came from instead of implying they are one.
    """
    row_cells = int(_f(row, "cells") or 0) or None
    from_ranked = Path(source) == TOP10_CSV
    caveat = CAVEAT
    if not from_ranked:
        caveat = (
            f"{CAVEAT} Read from the census file ({Path(source).name}), not from the "
            "ranked file: this row is measured, but it did not clear both bars, so it "
            "was never in a ranked list and its trade count is not a promise."
        )
    return Evidence(
        family=row.get("family", ""),
        exit_method=row.get("exit_method", ""),
        oos_trades=_f(row, "oos_trades"),
        win_rate=_f(row, "win_rate"),
        avg_ret_pct=_f(row, "avg_ret_pct"),
        fold_worst_win_rate=_f(row, "fold_worst_wr"),
        fold_best_win_rate=_f(row, "fold_best_wr"),
        folds_traded=int(_f(row, "folds_traded") or 0) or None,
        fold_detail=row.get("fold_detail", ""),
        total_cells_measured=cells if cells is not None else row_cells,
        source=str(source),
        measured=True,
        caveat=caveat,
        role=role,
        n_specs=int(_f(row, "n_specs") or 0) or None,
        n_cells=row_cells,
        single_spec_trades=(
            int(C.value("single_spec_trades") or 0) or None
            if row.get("family") == STUDY_PICK_FAMILY
            else None
        ),
    )


def _unmeasured(
    family: str, exit_method: str, reason: str, role: str = C.ROLE_SEARCHED
) -> Evidence:
    return Evidence(
        family=family,
        exit_method=exit_method,
        oos_trades=None,
        win_rate=None,
        avg_ret_pct=None,
        fold_worst_win_rate=None,
        fold_best_win_rate=None,
        folds_traded=None,
        fold_detail="",
        total_cells_measured=None,
        source=str(TOP10_CSV),
        measured=False,
        caveat=f"{reason}. The rule still applies; the number is simply not available.",
        role=role,
    )


@lru_cache(maxsize=1)
def _cell_count() -> int | None:
    """How many (family, exit) rows the study measured in total."""
    if not METHOD_TABLE_CSV.exists():
        return None
    try:
        with METHOD_TABLE_CSV.open(newline="", encoding="utf-8") as fh:
            return max(sum(1 for _ in csv.DictReader(fh)) - 1, 0)
    except (OSError, csv.Error):
        return None


def ladder() -> tuple[Evidence, ...]:
    """Every measured row that clears both bars, best average return first."""
    rows, status = _table()
    if status != "ok":
        return ()
    cells = _cell_count()
    out = [
        _evidence(r, cells)
        for r in rows
        if (_f(r, "win_rate") or 0) >= TARGET_WIN_RATE
        and (_f(r, "avg_ret_pct") or 0) > TARGET_AVG_TRADE_PCT
        and (_f(r, "oos_trades") or 0) >= 100
    ]
    return tuple(sorted(out, key=lambda e: -(e.avg_ret_pct or 0)))


def default_evidence() -> Evidence:
    """The searched row the plan runs: the census row for the shipped chain.

    The chain is the study's shipped screen (docs/21 §0a): breadth 0.60, RS 90,
    quiet volatility, a 40-session breakout and a +13%/-35%/95 exit. Its measured
    row lives in the census file, because it clears the win bar but not the +5%
    bar. If even that row is missing — an older checkout, a partial run — the app
    falls back to the widest qualifying row it can run, because a screen needs
    names to show rather than a headline rate with nothing behind it.
    """
    # The one lookup that matters: the exact chain this screen applies, from the
    # ranked file when it cleared both bars and from the census when it did not.
    # The shipped 13/35/95 is the second case — a real, measured 528-trade row
    # that misses the +5% bar, and so was never in a ranked list.
    exact = evidence_for(STUDY_PICK_FAMILY, STUDY_PICK_EXIT)
    if exact.measured:
        return exact

    measured = ladder()
    runnable = [e for e in measured if e.exit_method in EXIT_LADDER]
    if not runnable:
        return exact

    widest = max(runnable, key=lambda e: e.oos_trades or 0)
    return _unmeasured(
        STUDY_PICK_FAMILY,
        STUDY_PICK_EXIT,
        f"the study's pick is not in the results; running the widest qualifying row instead "
        f"({widest.family} x {widest.exit_method})",
    )


def deployment() -> dict[str, object]:
    """How the book behaves when the method is actually traded.

    A per-trade win rate says nothing about how much to hold, how often, or how
    deep the drawdown gets, so the study measured that separately
    (docs/17). Read from `results/portfolio_multi.csv` and
    `results/portfolio_robust.csv` rather than restated, for the same reason the
    win rate is read and not typed.

    The number to plan against is the walk-forward rate for the *selection*
    rule, not the headline pooled return: the pooled figure is measured with the
    family set known in hindsight, and quoting it as an expectation is exactly
    the mistake the study warns about twice.
    """
    multi = _rows(PORTFOLIO_MULTI_CSV)
    robust = _rows(PORTFOLIO_ROBUST_CSV)

    book = _find(
        multi,
        scope="gated24",
        slots="10",
        mode="ext",
        case=PORTFOLIO_ROBUST_CSV.name,
    )
    single = _find(multi, scope="pick", slots="10", mode="first", case=PORTFOLIO_MULTI_CSV.name)

    # The pick's own book, re-priced by the correctness pass: gap-through stops
    # fill at the open and open positions are marked to market, so this is
    # deeper than the realised-only figure `portfolio_multi.csv` still carries.
    canonical = next(
        (
            dict(r)
            for r in _rows(PORTFOLIO_TEST_CSV)
            if r.get("family") == STUDY_PICK_FAMILY
        ),
        None,
    )

    # The leave-one-out rows are the selection tested on folds it was not chosen
    # on. Chaining them is how the study summarises its own walk-forward.
    #
    # It is reported, not promoted. Two things have to travel with it or it reads
    # as a promise: those rows select over a *pool of 24 families*, not the single
    # family the app runs; and they predate the frozen-name correction, which
    # moved every headline in the study down. Meanwhile the newest artifact -
    # the five-year replay - has the pooled book at -80.52%. Both numbers are in
    # the same study; presenting either alone is the error.
    loo = [
        _f(r, "oos_pct")
        for r in robust
        if r.get("test") == "fold_loo" and _f(r, "oos_pct") is not None
    ]
    chained = None
    per_year = None
    if loo:
        factor = 1.0
        for v in loo:
            factor *= 1.0 + v / 100.0
        chained = (factor - 1.0) * 100.0
        years = 2.99  # the study's out-of-sample window
        per_year = (factor ** (1.0 / years) - 1.0) * 100.0

    variants = sorted(
        {r.get("variant", "") for r in robust if r.get("test") == "fold_loo" and r.get("variant")}
    )

    return {
        "available": bool(book or single or canonical),
        "book": book,
        "single_family_book": single,
        "canonical_book": canonical,
        "walk_forward_chained_pct": round(chained, 1) if chained is not None else None,
        "walk_forward_pct_per_year": round(per_year, 1) if per_year is not None else None,
        "walk_forward_selects_over": variants,
        "walk_forward_is_expected_return": False,
        "walk_forward_caveat": (
            f"Chained leave-one-out over {len(loo)} folds, selecting across "
            f"{len(variants) or 'a pool of'} method variants - not the single family "
            "this app runs - and measured before the frozen-name correction that "
            "lowered every headline in the study. The five-year replay in the same "
            "repository books the pooled version at -80.52%. Treat this as the "
            "study's best case, not a rate to plan around."
        ),
        "folds_tested": len(loo),
        "source": [
            str(PORTFOLIO_MULTI_CSV),
            str(PORTFOLIO_ROBUST_CSV),
            str(PORTFOLIO_TEST_CSV),
        ],
        "note": (
            "The pooled book ranks the day's signals by how far each has already run "
            "and takes the best ten; taking whatever signal arrives first is measured "
            "at roughly break-even. The single-family row is marked to market, so its "
            "drawdown is deeper than a realised-only one."
        ),
    }


def robustness() -> dict[str, object]:
    """The three things that could make the headline number wrong.

    Each of these was left open by the study and then closed by a later pass
    (docs/18 §3.1 and §7, docs/19). They are read from their artifacts rather
    than restated, for the same reason the win rate is: a number copied by hand
    is a number that can drift away from the thing it claims to describe.

    The honest summary is that the headline clears the bar and each of these
    three says something the headline does not. That is not a contradiction to
    resolve in the app's favour — it is the shape of the result, and the UI shows
    all of it.
    """
    quarterly = _quarterly()
    survivorship = _survivorship()
    testing = _multiple_testing()

    flags: list[str] = []
    if quarterly.get("below_bar"):
        flags.append(
            "Sampled quarterly rather than every six months, the method's book "
            f"wins {quarterly['pick_win_rate']:.1f}% — below the 80% the headline "
            "quotes. The headline number comes from six-month windows."
        )
    if survivorship.get("worst_drop_avg_pct") is not None and survivorship.get(
        "baseline_avg_pct"
    ) is not None:
        flags.append(
            "The panel is missing 13.4% of a full listing, because it is built "
            "from today's listing. Removing the best fifth of the names traded "
            f"takes the average from +{survivorship['baseline_avg_pct']:.2f}% to "
            f"{survivorship['worst_drop_avg_pct']:+.2f}%, so the edge sits in a "
            "minority of names and every published return is an upper bound."
        )
    if testing.get("deflated_sharpe_pct") == 0.0:
        flags.append(
            "The census searched 53,039 trading cells with the target already "
            "known. A deflated Sharpe of zero means the single best row should "
            "not be read as a discovery — what the study supports is the pattern "
            "(breakout + breadth + momentum + quiet), not this exact exit."
        )
    if quarterly.get("windows_lost_money") is not None:
        flags.append(
            f"Of the {quarterly['windows_traded']} quarterly windows the book "
            f"traded in, {quarterly['windows_lost_money']} lost money; two "
            "quarters carry the result."
        )

    return {
        "quarterly": quarterly,
        "survivorship": survivorship,
        "multiple_testing": testing,
        "flags": flags,
        "headline_is": (
            "a six-month-window, survivor-panel, best-of-many figure — true as "
            "reported, and not a rate to expect"
        ),
        # These are side artifacts by design (docs/19 §5): they deliberately moved
        # no canonical number. But they also were not re-run after the correctness
        # pass that re-priced the census, so a strict like-for-like against the
        # headline is not possible. The UI says so instead of quietly comparing
        # two engine revisions as if they were one.
        "revisions_note": (
            "The quarterly and survivorship passes were run on the engine as it "
            "stood before the correctness pass; the headline above is from after "
            "it. They are the same method and the same data, so the shape holds, "
            "but the exact figures are not a strict re-run of today's census."
        ),
    }


def _quarterly() -> dict[str, object]:
    """docs/19 §4: the same search re-run with three-month test windows.

    The like-for-like row is the one for this method. The pooled row is over
    four families and is not comparable; it is kept because it shows that
    pooling does not rescue the effect.
    """
    books = _rows(QUARTERLY_BOOKS_CSV)
    pick = next(
        (r for r in books if r.get("book", "").startswith("pick ")), None
    )
    analysis = _rows(QUARTERLY_ANALYSIS_CSV)

    traded: list[dict[str, str]] = []
    for row in analysis:
        trades = _f(row, "sel_trades")
        if trades and trades > 0:
            traded.append(row)
    lost = sum(1 for r in traded if (_f(r, "sel_avg_ret_pct") or 0) < 0)

    # The study's bar is 80%. The quarterly win rate is compared against it, and
    # being below it is the single most important thing this screen can say.
    win = _f(pick, "win_rate") if pick else None
    return {
        "available": bool(pick),
        "pick_win_rate": (win * 100.0) if win is not None else None,
        "pick_avg_ret_pct": _f(pick, "avg_ret_pct"),
        "pick_total_return_pct": _f(pick, "total_return_pct"),
        "pick_max_dd_pct": _f(pick, "max_dd_pct"),
        "pick_taken": int(_f(pick, "taken") or 0) if pick else None,
        "windows_total": len(analysis),
        "windows_traded": len(traded),
        "windows_lost_money": lost,
        "windows_too_short_for_the_bar": sum(
            1 for r in analysis if (_f(r, "test_eligible") or 0) == 0
        ),
        "below_bar": win is not None and win < TARGET_WIN_RATE,
        "source": [str(QUARTERLY_BOOKS_CSV), str(QUARTERLY_ANALYSIS_CSV)],
        "note": (
            "Same method, same data, test windows cut from six months to three. "
            "A quarter does not hold the 30 trades a cell needs before the bar "
            "can be evaluated at all, so most windows cannot be scored — but the "
            "pooled book can, and it is lower."
        ),
    }


def _drop_row(rows: list[dict[str, str]], share_pct: int) -> dict[str, str] | None:
    """The name-leave-out row that drops this share of the names.

    Matched on the scenario label, which is the study's own statement of the
    share ("drop top 20% of names"). Inferring it from the trade count is
    unreliable — trades and names do not fall in step, because the best names
    trade more often — and picking the nearest one silently reports a different
    proportion than the flag claims.
    """
    want = f"top {share_pct}%"
    for row in rows:
        if want in (row.get("scenario") or ""):
            return row
    return None


def _survivorship() -> dict[str, object]:
    """docs/19 §2: the panel is today's listing, applied backwards.

    Name leave-out is the measured end of the range. Survivorship bias is
    one-sided, so this is the optimistic bound: a panel holding the names that
    died would sit below it, not above.
    """
    rows = _rows(SURVIVORSHIP_CSV)
    if not rows:
        return {"available": False, "source": [str(SURVIVORSHIP_CSV)]}

    # The study rewrote this file twice. It is now keyed by `cell` and `bound`
    # (full / survivorship / trend / both) rather than by leave-out fraction, so
    # the curve is gone and what remains is the pair that answers the question:
    # the same universe with and without the names that died.
    def pair(cell: str) -> tuple[dict[str, str] | None, dict[str, str] | None]:
        return (
            next((r for r in rows if r.get("cell") == cell and r.get("bound") == "full"), None),
            next(
                (
                    r
                    for r in rows
                    if r.get("cell") == cell and r.get("bound") == "survivorship"
                ),
                None,
            ),
        )

    # Prefer the cell whose exit matches what the app ships, then the tier-1 rows,
    # then anything at all - so a renamed cell degrades to a different-but-real
    # measurement instead of to a crash.
    # Order matters and is stated: the `screen` universe is the one the study
    # ships (docs/21), so its cell is the app's measurement. `study_illiquid` is
    # next. `control1b` is the 1bn liquid panel, a robustness check rather than
    # the thing being recommended, so it is the last resort.
    tp, sl, hold = exit_for(STUDY_PICK_EXIT)

    def rank(cell: str) -> int:
        if f"lt{tp:.0f}_{sl:.0f}_{hold}" not in cell:
            return 99
        for i, tag in enumerate(("screen", "study_illiquid", "mid500", "control1b")):
            if cell.endswith(f"{tag}_flat"):
                return i
        return 50

    candidates = sorted(
        dict.fromkeys(r.get("cell", "") for r in rows), key=lambda c: (rank(c), c)
    )
    preferred = next((c for c in candidates if rank(c) < 99), None) or next(
        (c for c in dict.fromkeys(r.get("cell", "") for r in rows) if c == "tier1"),
        None,
    ) or next(iter(dict.fromkeys(r.get("cell", "") for r in rows)), None)

    base, stressed = pair(preferred or "")

    # Every bound for the chosen cell, so the UI can show the whole picture and
    # not just the flattering pair.
    detail = [
        {
            "bound": r.get("bound", ""),
            "trades": _f(r, "n"),
            "tickers": _f(r, "tickers"),
            "win_rate": _f(r, "win_rate"),
            "win_rate_lo": _f(r, "wr_lo"),
            "avg_ret_pct": _f(r, "avg_ret"),
            "profit_factor": _f(r, "profit_factor"),
        }
        for r in rows
        if r.get("cell") == (preferred or "")
    ]

    return {
        "available": bool(detail),
        "cell": preferred,
        "baseline_win_rate": _f(base, "win_rate"),
        "baseline_avg_pct": _f(base, "avg_ret"),
        "baseline_trades": _f(base, "n"),
        # Named for what it is: the universe rebuilt without the names that died.
        # On the shipped screen cell this is the difference between +2.09% and
        # -0.59% per trade - the single most useful number in this file.
        "worst_drop_names": _f(stressed, "tickers"),
        "worst_drop_share_pct": 20,
        "worst_drop_win_rate": _f(stressed, "win_rate"),
        "worst_drop_avg_pct": _f(stressed, "avg_ret"),
        "curve": detail,
        "source": [str(SURVIVORSHIP_CSV)],
        "note": (
            "`full` is the universe the study could see, including names that "
            "later delisted. `survivorship` is that same cell rebuilt on the "
            "names that survived. The gap between them is the part of the result "
            "that only history knows about."
        ),
    }


def _multiple_testing() -> dict[str, object]:
    """docs/18 §3.1: how much of the headline is the search, not the market.

    The three tests disagree on purpose. The SPA says something in the set is
    real; the reality check says the leader is not distinguishable from the best
    mined alternative; the deflated Sharpe says the single best row is not a
    discovery. Reporting only the first would be dishonest.
    """
    rows = _rows(MULTIPLE_TESTING_CSV)
    by = {r.get("metric", ""): _f(r, "value") for r in rows}

    def find(prefix: str) -> float | None:
        for key, value in by.items():
            if key.startswith(prefix):
                return value
        return None

    return {
        "available": bool(by),
        "cells_searched": find("trial count, cells with trades"),
        "designs_searched": find("trial count, distinct designs"),
        "reality_check_p": find("white reality check p-value"),
        "spa_p": find("hansen spa p-value"),
        "spa_statistic": find("hansen spa max statistic"),
        "deflated_sharpe_pct": next(
            (
                v
                for k, v in by.items()
                if k.startswith("deflated sharpe p-value") and STUDY_PICK_FAMILY in k
            ),
            None,
        ),
        "source": [str(MULTIPLE_TESTING_CSV)],
        "note": (
            "Three tests, three answers. A signal in the set is real (SPA "
            "p = 0.004). The single best row is not distinguishable from the best "
            "data-mined alternative (reality check p = 0.29), and should not be "
            "read as a discovery (deflated Sharpe 0). What the study supports is "
            "the family-level pattern, not one exit geometry."
        ),
    }


def _rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    try:
        with path.open(newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))
    except (OSError, csv.Error):
        return []


def _find(rows: list[dict[str, str]], case: str, **want: str) -> dict[str, object] | None:
    for row in rows:
        if all(row.get(k) == v for k, v in want.items()):
            return {k: row.get(k) for k in row}
    return None


def _method_table_rows() -> tuple[dict[str, str], ...]:
    """Every family x exit the study measured, from its census file."""
    return tuple(_rows(METHOD_TABLE_CSV))


@lru_cache(maxsize=8)
def _family_spec_count(family: str) -> int | None:
    """How many parameter variants the study's rows for this family pool.

    `top10_methods.csv` carries an `n_specs` column and the census file does not,
    so a census row borrows the spec count of its own family from the ranked
    file. That is the honest reading: a published trade count for the family is a
    sum over those variants, not over the one window this screen runs.
    """
    rows, status = _table()
    if status != "ok":
        return None
    counts = [
        int(_f(r, "n_specs") or 0)
        for r in rows
        if r.get("family") == family and (_f(r, "n_specs") or 0) > 0
    ]
    return max(counts) if counts else None


def evidence_for(family: str, exit_method: str) -> Evidence:
    """The measured row for a specific (family, exit), or an honest blank.

    Searched in the ranked file first, then in the census. Both are the study's
    own outputs; the difference is that only the ranked file's rows cleared both
    bars. A blank is returned rather than a nearby row, because a row for a
    different chain is not evidence for this one.
    """
    rows, status = _table()
    if status == "ok":
        for r in rows:
            if r.get("family") == family and r.get("exit_method") == exit_method:
                return _evidence(r, _cell_count())

    for r in _method_table_rows():
        if r.get("family") == family and r.get("exit_method") == exit_method:
            row = dict(r)
            specs = _family_spec_count(family)
            if specs:
                row["n_specs"] = str(specs)
            return _evidence(row, _cell_count(), source=METHOD_TABLE_CSV)

    return _unmeasured(family, exit_method, f"no measured row for {family} x {exit_method}")


def corrected_evidence() -> Evidence:
    """What the study publishes for this chain after its own correctness pass.

    Not read from a results file, because no results file carries it: the
    correction was a pass over the engine (price-frozen names excluded, tiered
    costs) and its outcome was published in prose in docs/21 §0a and docs/20 §12.
    Every figure travels with the file, line and sentence it came from, and
    `test_plan_citations.py` fails the build if the study stops saying it.
    """
    def cited(label: str) -> float | None:
        return C.value(label)

    return Evidence(
        family=STUDY_PICK_FAMILY,
        exit_method=STUDY_PICK_EXIT,
        oos_trades=cited("tier1_corrected_trades"),
        win_rate=cited("tier1_corrected_win_rate"),
        avg_ret_pct=cited("tier1_corrected_avg_ret_pct"),
        fold_worst_win_rate=None,
        fold_best_win_rate=None,
        # docs/21 §11: tier 1 traded in f2, f3 and f4, and never in f0, f1 or f5.
        folds_traded=3,
        fold_detail="f2/f3/f4 only - folds f0, f1 and f5 never reach the 0.60 gate",
        total_cells_measured=_cell_count(),
        source="docs/21-screener-spec.md §0a (corrected) + docs/20 §12",
        measured=True,
        caveat=(
            "The corrected result: clean universe, price-frozen names excluded, tiered "
            "costs. It is smaller than the searched maximum and it is the number the "
            "study tells you to trade. Two stress tests travel with it, both in the "
            "provenance: dropping the best 20% of tickers leaves +0.04%, and on the "
            "unseen folds f3-f5 the same family reads +0.09%. A high hit rate on a "
            "thin, concentrated sample rather than a compounding edge."
        ),
        role=C.ROLE_WALK_FORWARD,
        profit_factor=cited("tier1_corrected_profit_factor"),
        max_drawdown_pct=cited("tier1_corrected_max_drawdown_pct"),
        book_return_pct=cited("tier1_corrected_book_total_pct"),
        book_max_drawdown_pct=cited("tier1_corrected_book_max_drawdown_pct"),
        win_rate_lo=cited("tier1_wilson_lo"),
        win_rate_hi=cited("tier1_wilson_hi"),
        provenance=C.all_citations(),
        # The published trade count pools four donchian windows; this screen runs
        # one of them, and both numbers travel together so the UI cannot quote the
        # pool as its own sample.
        n_specs=_family_spec_count(STUDY_PICK_FAMILY),
        single_spec_trades=int(C.value("single_spec_trades") or 0) or None,
    )

# ── the holdout (docs/22) ─────────────────────────────────────────────────────
# Why this is a separate reader rather than another row of `ladder()`: every row
# of top10_methods.csv is a cell the study *searched over*. Reporting the best of
# those as the method's expected result is the exact error docs/22 was written to
# correct, so the holdout is a distinct object with its own place on screen.
def _clears_bars(row: dict[str, str]) -> bool:
    """Both bars at once, plus the study's 100-trade floor. docs/22 §1."""
    return (
        (_f(row, "win") or 0) >= TARGET_WIN_RATE
        and (_f(row, "avg") or 0) > TARGET_AVG_TRADE_PCT
        and (_f(row, "n") or 0) >= MIN_TEST_TRADES
    )


@lru_cache(maxsize=1)
def holdout() -> Holdout | None:
    """What the search's best cells did on data no search had seen.

    Read from `results/holdout_search_cells_screen.csv` (every cell the search
    ranked) and `results/holdout_search_screen.csv` (the shortlist carried
    forward unchanged). Returns None when those are absent, so an older checkout
    of the study shows the headline without claiming a holdout that was never run
    — silence is better than a number nobody measured.
    """
    cells = _rows(HOLDOUT_CELLS_CSV)
    winners = _rows(HOLDOUT_SEARCH_CSV)
    if not cells or not winners:
        return None

    clearing = sum(1 for r in cells if _clears_bars(r))
    surviving = sum(1 for r in winners if r.get("HOLDS", "").strip().lower() == "true")

    # "Best" is the one that earned most on unseen data. Ranking by holdout win
    # rate alone would crown a config that won often and lost big, which is the
    # failure mode the +5% bar exists to catch.
    scored = [r for r in winners if _f(r, "h_avg") is not None]
    best = max(scored, key=lambda r: _f(r, "h_avg") or -1e9) if scored else None

    def mean(key: str) -> float | None:
        vals = [_f(r, key) for r in winners]
        vals = [v for v in vals if v is not None]
        return sum(vals) / len(vals) if vals else None

    if clearing == 0 and surviving == 0:
        verdict = (
            f"None of the {len(cells)} configurations searched cleared 80% and "
            f"+5% together, and none of the {len(winners)} best were carried "
            f"forward held up on unseen folds. The bars are not reachable on "
            f"this data with these rules."
        )
    elif surviving == 0:
        verdict = (
            f"{clearing} of {len(cells)} searched configurations cleared both bars "
            f"on their own data, but none of the {len(winners)} best survived "
            f"the holdout. A searched maximum is not an expectation."
        )
    else:
        verdict = (
            f"{surviving} of {len(winners)} shortlisted configurations held up on "
            f"folds the search never saw."
        )

    return Holdout(
        search_cells=len(cells),
        search_cells_clearing=clearing,
        winners_tested=len(winners),
        winners_surviving=surviving,
        best_holdout_win_rate=_f(best, "h_win") if best else None,
        best_holdout_avg_ret_pct=_f(best, "h_avg") if best else None,
        win_rate_decay_pp=mean("decay_win_pp"),
        return_decay_pp=mean("decay_avg_pp"),
        verdict=verdict,
    )


@lru_cache(maxsize=1)
def regime_frequency() -> RegimeFrequency | None:
    """How often the tape was strong enough to act, per `results_breadth_days.csv`.

    The study's own census (docs/24 §1): test sessions, and how many cleared
    breadth 0.60 / 0.50 / 0.45. Only these three lines are counted, because only
    these three were measured — the census does not resolve the 0.25 capitulation
    threshold, so the app does not report a share for it.

    This is the answer to "the screen is closed again, is it broken?" No: at the
    study's own shipped gate, roughly one session in five qualifies, and the rest
    is the market declining to be traded rather than the rules misfiring.
    """
    rows = _rows(BREADTH_DAYS_CSV)
    if not rows:
        return None

    sessions = sum(int(_f(r, "sessions") or 0) for r in rows)
    if not sessions:
        return None

    return RegimeFrequency(
        sessions=sessions,
        days_b60=sum(int(_f(r, "days_b60") or 0) for r in rows),
        days_b50=sum(int(_f(r, "days_b50") or 0) for r in rows),
        days_b45=sum(int(_f(r, "days_b45") or 0) for r in rows),
    )


@lru_cache(maxsize=1)
def five_year_replay() -> dict[str, object]:
    """The 2021-10 → 2026-10 replay, by regime tier (docs/22 §4).

    Read, not restated, because this is the number that most looks impressive on
    paper and least survives contact: one window, universe fixed at the final
    date, so it carries the full survivorship exposure the fold numbers do not.
    Tier 2 and tier 3 both lose money as books despite positive per-trade averages,
    which is the clearest available statement that per-trade and book returns are
    different quantities.
    """
    rows = _rows(FIVE_YEAR_REPLAY_CSV)
    if not rows:
        return {}

    tiers: list[dict[str, object]] = []
    for r in rows:
        label = (r.get("tier") or "").strip()
        tiers.append(
            dict(
                tier=label,
                trades=_f(r, "n"),
                tickers=_f(r, "tickers"),
                win_rate=_f(r, "win_rate"),
                win_rate_lo=_f(r, "wr_lo"),
                win_rate_hi=_f(r, "wr_hi"),
                avg_ret_pct=_f(r, "avg_ret"),
                profit_factor=_f(r, "profit_factor"),
                book_taken=_f(r, "book_taken"),
                book_total_pct=_f(r, "book_total"),
                book_max_drawdown_pct=_f(r, "book_max_dd"),
                cost_model=r.get("cost", ""),
            )
        )
    return {
        "window": "2021-10 → 2026-10, one window, universe as of the final date",
        "comparable_to_folds": False,
        "tiers": tiers,
        "source": str(FIVE_YEAR_REPLAY_CSV),
        "caveat": (
            "Not comparable to the walk-forward numbers: one window instead of "
            "six, and the universe is fixed at the final date, so delisted names "
            "are missing entirely. Survivorship runs through every tier."
        ),
    }


@lru_cache(maxsize=1)
def book_with_sideways() -> dict[str, object]:
    """What the same book earns when the flat band is traded rather than skipped.

    Read from `results/max_return_ceiling.csv`. This is the sharpest statement of
    why the app's default answer is "no trade": one universe, one screen, one
    period, ten slots — the only difference between the two rows is whether the
    sideways band was left in. Trading it books a loss and a 67% drawdown; leaving
    it out books a gain and a 7.9% drawdown.
    """
    rows = _rows(MAX_RETURN_CEILING_CSV)

    def row_for(combo: str) -> dict[str, str] | None:
        return next(
            (
                r
                for r in rows
                if r.get("universe") == "illiquid (screen)"
                and r.get("combo") == combo
                and _f(r, "slots") == 10.0
            ),
            None,
        )

    def shape(row: dict[str, str] | None, label: str) -> dict[str, object]:
        if row is None:
            return {"available": False, "label": label}
        return {
            "available": True,
            "label": label,
            "trades": _f(row, "trades"),
            "win_rate": _f(row, "win"),
            "avg_ret_pct": _f(row, "avg"),
            "total_pct": _f(row, "total"),
            "max_drawdown_pct": _f(row, "max_dd"),
        }

    return {
        "trend_only": shape(row_for("tier 1 only (trending)"), "flat band skipped"),
        "with_sideways": shape(
            row_for("all tiers (incl. sideways, loses money)"), "flat band traded"
        ),
        "slots": 10,
        "universe": "illiquid screen (250M IDR turnover floor)",
        "source": str(MAX_RETURN_CEILING_CSV),
        "note": (
            "One universe, one screen, one period: the only difference between these "
            "two rows is whether the sideways band was traded."
        ),
    }


@lru_cache(maxsize=1)
def shipped_config() -> dict[str, object]:
    """The app's own rule chain, measured on the search folds that ranked it.

    Every other number in the app comes from a row someone chose by looking at a
    table. This one is looked up by matching the app's own constants against the
    holdout census, so it describes the chain the user is actually being asked to
    trade tonight: breadth 0.60, RS 90, vol20 in its lowest 40%, exit 13/35/95.

    It reports the *range* across every matching row rather than the best or the
    biggest one. The census scores this configuration several times over - four
    rows, 10 to 17 trades - and they disagree by several percent per trade, with
    one of them losing money. Picking the flattering row would repeat exactly the
    error docs/22 was written to correct, so the app shows the spread and lets
    the sample size speak.
    """
    rows = _rows(HOLDOUT_CELLS_CSV)
    if not rows:
        return {}

    # Matched against the exit the app actually runs, not a separately-declared
    # one. Two constants for the same thing is how a lookup ends up describing
    # rules the screen is not applying.
    target_pct, stop_pct, hold = exit_for(STUDY_PICK_EXIT)

    def matches(r: dict[str, str]) -> bool:
        return (
            _f(r, "breadth") == SHIP_BREADTH
            and _f(r, "rs") == SHIP_RS
            and (r.get("quiet") or "") == SHIP_QUIET
            and _f(r, "tp") == target_pct
            and _f(r, "sl") == stop_pct
            and _f(r, "hold") == hold
        )

    hits = [r for r in rows if matches(r)]
    if not hits:
        return {}

    def span(key: str) -> tuple[float | None, float | None]:
        vals = [v for v in (_f(r, key) for r in hits) if v is not None]
        return (min(vals), max(vals)) if vals else (None, None)

    n_lo, n_hi = span("n")
    wr_lo, wr_hi = span("win")
    ret_lo, ret_hi = span("avg")

    return {
        "entry": (
            f"{DONCHIAN_N}-session breakout, relative strength >= {SHIP_RS:.0f}, "
            "vol20 in its own lowest 40%"
        ),
        "exit": f"+{target_pct:.0f}% target, -{stop_pct:.0f}% stop, {hold}-session cap",
        "regime_gate": f"breadth >= {SHIP_BREADTH:.2f}",
        "rows_matched": len(hits),
        "search_trades_lo": n_lo,
        "search_trades_hi": n_hi,
        "search_win_rate_lo": wr_lo,
        "search_win_rate_hi": wr_hi,
        "search_avg_ret_lo": ret_lo,
        "search_avg_ret_hi": ret_hi,
        "any_row_clears_win_bar": bool(wr_hi is not None and wr_hi >= TARGET_WIN_RATE),
        "source": str(HOLDOUT_CELLS_CSV),
        "note": (
            "Measured on folds 0-2, the half the search was allowed to look at, "
            "across every row of the census that scored this exact "
            "configuration. A gate strict enough to fire one session in five "
            "produces few observations; the small sample is the price of the "
            "selectivity, not a reason to trust it more."
        ),
    }
