"""The interface of the plan module: the shapes a caller receives.

Everything a caller of `plan.plan()` needs to know is here. The screen behind
the seam fills these; it never exposes a pandas frame, a raw indicator name, or
a gate predicate to the outside.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal

Side = Literal["long"]
# Every condition the screen can emit. `screen.py` produces all six and the
# frontend unions the same six. "tradable" used to sit here and was simply
# wrong: tradability is a filter applied before scoring, never a gate shown to
# the user, so it is not a GateKey.
GateKey = Literal[
    "breakout",
    "relative_strength",
    "breadth",
    "quiet_vol",
    "weekly_trend",
    "index_above_200",
]


@dataclass(frozen=True)
class Citation:
    """A number the study published in prose, with the line that carries it.

    Some of the figures this app leans on hardest — the corrected tier-1 result
    above all — exist only as text in the study's own documents, because the
    correction was a pass over the engine rather than a new artifact round. A
    citation travels with the file, the line, the words on that line and the
    command that regenerates it, so the UI can show where a number came from and
    `test_plan_citations.py` can fail the build when the study stops saying it.
    """

    label: str
    value: float | None
    unit: str
    doc: str
    line: int
    quote: str
    regenerate: str = ""

    def as_dict(self) -> dict[str, object]:
        return dict(
            label=self.label,
            value=self.value,
            unit=self.unit,
            doc=self.doc,
            line=self.line,
            quote=self.quote,
            regenerate=self.regenerate,
        )


@dataclass(frozen=True)
class GateHistory:
    """How long a condition has held, and since when.

    "RS is 94 and it needs 90" answers whether a name qualifies. It does not
    answer why tonight, which is the question a person about to send an order
    actually asks. A condition that has held for one session and one that has held
    for nine are the same green tick without this.
    """

    held_sessions: int
    first_true_session: date | None
    series: tuple[bool, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return dict(
            held_sessions=self.held_sessions,
            first_true_session=(
                self.first_true_session.isoformat() if self.first_true_session else None
            ),
            series=list(self.series),
        )


@dataclass(frozen=True)
class Gate:
    """One condition of the method, evaluated for one name at one session.

    `passed` is the verdict, `value`/`threshold` are the measured numbers behind
    it, and `text` is the sentence the UI shows. Keeping all three means the UI
    never has to re-derive *why* a name is or is not in the plan.
    """

    key: GateKey
    label: str
    passed: bool
    value: float | None
    threshold: float | None
    unit: str
    text: str
    # Filled in by the reason builder, which replays the chain over recent
    # sessions. None on a gate nobody asked the history of.
    history: GateHistory | None = None

    def as_dict(self) -> dict[str, object]:
        return dict(
            key=self.key,
            label=self.label,
            passed=self.passed,
            value=self.value,
            threshold=self.threshold,
            unit=self.unit,
            text=self.text,
            history=self.history.as_dict() if self.history else None,
        )


@dataclass(frozen=True)
class Geometry:
    """The entry and exit levels for one candidate, in IDR off the last close."""

    entry_basis: str
    target_pct: float
    stop_pct: float
    hold_bars: int
    entry_ref: float
    target_price: float
    stop_price: float
    gross_risk_pct: float
    reward_risk: float
    # Kept because the buy list has shown these two for a while; they are an
    # illustration on Rp1m, never the position. `position_idr` below is the real
    # size and `max_loss_idr` the real risk.
    max_loss_idr_1m: float
    target_gain_idr_1m: float
    holding_weeks: float
    # ── sizing, docs/21 §8 ───────────────────────────────────────────────────
    position_idr: float | None = None
    shares: int | None = None
    lots: int | None = None
    participation_pct: float | None = None
    sizing_basis: str = ""
    risk_budget_idr: float | None = None
    max_loss_idr: float | None = None
    risk_pct_of_position: float | None = None
    # ── the IDX overlay ─────────────────────────────────────────────────────
    tick_idr: float | None = None
    friction: dict[str, object] = field(default_factory=dict)
    notes: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return dict(
            entry_basis=self.entry_basis,
            target_pct=self.target_pct,
            stop_pct=self.stop_pct,
            hold_bars=self.hold_bars,
            entry_ref=self.entry_ref,
            target_price=self.target_price,
            stop_price=self.stop_price,
            gross_risk_pct=self.gross_risk_pct,
            reward_risk=self.reward_risk,
            max_loss_idr_1m=self.max_loss_idr_1m,
            target_gain_idr_1m=self.target_gain_idr_1m,
            holding_weeks=self.holding_weeks,
            position_idr=self.position_idr,
            shares=self.shares,
            lots=self.lots,
            participation_pct=self.participation_pct,
            sizing_basis=self.sizing_basis,
            risk_budget_idr=self.risk_budget_idr,
            max_loss_idr=self.max_loss_idr,
            risk_pct_of_position=self.risk_pct_of_position,
            tick_idr=self.tick_idr,
            friction=dict(self.friction),
            notes=list(self.notes),
        )


@dataclass(frozen=True)
class ReasonPoint:
    """One session of the run-up to a signal."""

    session: date
    close: float | None
    gates_passed: int
    gates_total: int
    breakout_pct: float | None
    vol20: float | None
    rs_rating: float | None
    breadth: float | None
    band: str

    def as_dict(self) -> dict[str, object]:
        return dict(
            session=self.session.isoformat(),
            close=self.close,
            gates_passed=self.gates_passed,
            gates_total=self.gates_total,
            breakout_pct=self.breakout_pct,
            vol20=self.vol20,
            rs_rating=self.rs_rating,
            breadth=self.breadth,
            band=self.band,
        )


@dataclass(frozen=True)
class Reason:
    """Why this name, on this session, rather than any of the other 900.

    The gate list says a name qualifies. This says when the conditions turned
    true, how long they have held, and what the entry actually is — which is the
    part a person reads before sending an order rather than after.
    """

    signal_session: date
    entry_session: date
    entry_basis: str
    known_from: str
    breakout_date: date | None
    sessions_since_breakout: int | None
    window: int
    seconds: float
    history: tuple[ReasonPoint, ...] = ()
    levels: dict[str, object] = field(default_factory=dict)
    ar: dict[str, object] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return dict(
            signal_session=self.signal_session.isoformat(),
            entry_session=self.entry_session.isoformat(),
            entry_basis=self.entry_basis,
            known_from=self.known_from,
            breakout_date=self.breakout_date.isoformat() if self.breakout_date else None,
            sessions_since_breakout=self.sessions_since_breakout,
            window=self.window,
            seconds=round(self.seconds, 3),
            history=[point.as_dict() for point in self.history],
            levels=self.levels,
            ar=self.ar,
        )


@dataclass(frozen=True)
class Candidate:
    """A name that cleared every gate. This is what the user is meant to buy."""

    ticker: str
    name: str | None
    close: float
    change_pct: float | None
    as_of: date
    gates: tuple[Gate, ...]
    geometry: Geometry
    rs_rating: float
    breadth: float
    breakout_pct: float
    vol20: float
    vol20_median: float
    turnover_idr: float | None
    score: float
    # The run-up: when each condition turned true, and what the entry is.
    reason: Reason | None = None

    def gate(self, key: GateKey) -> Gate | None:
        return next((g for g in self.gates if g.key == key), None)

    def as_dict(self) -> dict[str, object]:
        return dict(
            ticker=self.ticker,
            name=self.name,
            close=self.close,
            change_pct=self.change_pct,
            as_of=self.as_of.isoformat(),
            gates=[g.as_dict() for g in self.gates],
            geometry=self.geometry.as_dict(),
            rs_rating=round(self.rs_rating, 1),
            breadth=round(self.breadth, 4),
            breakout_pct=round(self.breakout_pct, 2),
            vol20=round(self.vol20, 2),
            vol20_median=round(self.vol20_median, 2),
            turnover_idr=self.turnover_idr,
            score=round(self.score, 2),
            reason=self.reason.as_dict() if self.reason else None,
        )


@dataclass(frozen=True)
class WatchItem:
    """A name that did not clear every gate, with the one that blocked it.

    The plan is closed on most sessions, so this is what keeps the app useful on
    the days it says "not yet".
    """

    ticker: str
    name: str | None
    close: float
    blocked_by: GateKey
    distance_pct: float | None
    distance_text: str
    rs_rating: float
    gates_passed: int
    gates_total: int

    def as_dict(self) -> dict[str, object]:
        return dict(
            ticker=self.ticker,
            name=self.name,
            close=self.close,
            blocked_by=self.blocked_by,
            distance_pct=None if self.distance_pct is None else round(self.distance_pct, 2),
            distance_text=self.distance_text,
            rs_rating=round(self.rs_rating, 1),
            gates_passed=self.gates_passed,
            gates_total=self.gates_total,
        )


@dataclass(frozen=True)
class Regime:
    """The market-wide gate, which is shared by every name in the plan.

    Three bands, not two (docs/21 §1). The study settled the middle one: when
    breadth sits between 0.25 and 0.60 the index drifts about zero over five
    sessions while a round trip costs 0.50%, so the honest action there is flat
    rather than "buy the good names anyway". `band` and `action` are that
    decision, precomputed from the measured thresholds.
    """

    breadth: float
    breadth_threshold: float
    breadth_open: bool
    breadth_median: float
    index_close: float | None
    index_above_200: bool | None
    index_above_50: bool | None
    universe_size: int
    band: str = "trending"
    action: str = "trade"

    def as_dict(self) -> dict[str, object]:
        return dict(
            breadth=round(self.breadth, 4),
            breadth_threshold=self.breadth_threshold,
            breadth_open=self.breadth_open,
            breadth_median=round(self.breadth_median, 4),
            index_close=self.index_close,
            index_above_200=self.index_above_200,
            index_above_50=self.index_above_50,
            universe_size=self.universe_size,
            band=self.band,
            action=self.action,
        )


@dataclass(frozen=True)
class Holdout:
    """What the method did on data the search never saw (docs/22).

    This exists because the searched headline and the honest expectation are not
    the same number, and the app must not conflate them. The study searched 280
    configurations on folds 0-2, then measured the 15 best of them on folds 3-5,
    which no search had touched. What survived is what belongs on screen next to
    the headline — otherwise the app is quoting a maximum as though it were an
    expectation.
    """

    search_cells: int | None
    search_cells_clearing: int | None
    winners_tested: int | None
    winners_surviving: int | None
    best_holdout_win_rate: float | None
    best_holdout_avg_ret_pct: float | None
    win_rate_decay_pp: float | None
    return_decay_pp: float | None
    verdict: str

    def as_dict(self) -> dict[str, object]:
        return dict(
            search_cells=self.search_cells,
            search_cells_clearing=self.search_cells_clearing,
            winners_tested=self.winners_tested,
            winners_surviving=self.winners_surviving,
            best_holdout_win_rate=self.best_holdout_win_rate,
            best_holdout_avg_ret_pct=self.best_holdout_avg_ret_pct,
            win_rate_decay_pp=self.win_rate_decay_pp,
            return_decay_pp=self.return_decay_pp,
            verdict=self.verdict,
        )


@dataclass(frozen=True)
class RegimeFrequency:
    """How often each breadth level was actually met, across the test windows.

    Read from `results/results_breadth_days.csv` (docs/24 §1). The screen's
    selectivity is a fact about the market, not a defect in the rules, and
    measuring it is what lets the user plan capital around a method that says
    "not yet" more often than it says "buy".

    Named by threshold, not by band, on purpose. That census counts sessions at
    or above 0.60, 0.50 and 0.45 — it does not count the 0.25 capitulation line,
    so nothing here claims a share for a band nobody measured. The three display
    bands the app *acts* on are a separate thing (see `Regime.band`); this says
    how often the tape was strong enough to act.
    """

    sessions: int
    days_b60: int
    days_b50: int
    days_b45: int

    @property
    def share_trending(self) -> float:
        return self.days_b60 / self.sessions if self.sessions else 0.0

    @property
    def share_below_45(self) -> float:
        rest = self.sessions - self.days_b45
        return max(rest, 0) / self.sessions if self.sessions else 0.0

    def as_dict(self) -> dict[str, object]:
        return dict(
            sessions=self.sessions,
            days_b60=self.days_b60,
            days_b50=self.days_b50,
            days_b45=self.days_b45,
            share_trending=round(self.share_trending, 4),
            share_below_45=round(self.share_below_45, 4),
        )


@dataclass(frozen=True)
class Evidence:
    """The measured result of the method, read from the study's own results.

    Never computed here and never hard-coded: it is lifted from
    `results/top10_methods.csv` so the number on screen is the number the study
    measured.

    `role` matters as much as the numbers, and it has three values:

      * `"searched_census"` — a row of the study's results files. Every one is a
        cell the study *searched over*; docs/22 then took the best of them to
        unseen folds and found none holds both bars. Evidence of what the search
        found, not of what to expect.
      * `"walk_forward_corrected"` — what the study publishes after its own
        correctness pass (clean universe, tiered costs). Cited, not read.
      * `"replay"` — a one-window mark-to-market projection, not a walk-forward.

    The app shows them apart because presenting one as another is the exact
    error the study's own documents were written to correct.
    """

    family: str
    exit_method: str
    oos_trades: float | None
    win_rate: float | None
    avg_ret_pct: float | None
    fold_worst_win_rate: float | None
    fold_best_win_rate: float | None
    folds_traded: int | None
    fold_detail: str
    total_cells_measured: int | None
    source: str
    measured: bool
    caveat: str
    role: str = "searched"
    profit_factor: float | None = None
    max_drawdown_pct: float | None = None
    book_return_pct: float | None = None
    book_max_drawdown_pct: float | None = None
    win_rate_lo: float | None = None
    win_rate_hi: float | None = None
    # Provenance for figures that are cited from the study's prose rather than
    # read from one of its results files. Empty for rows read from a CSV.
    provenance: tuple[Citation, ...] = ()
    # How many parameter variants the row pools. `top10_methods.csv` rounds four
    # donchian windows (20/40/50/60) into one row, so a trade count on that row
    # is not the number of trades *this* screen takes: it runs window 40 alone.
    n_specs: int | None = None
    n_cells: int | None = None
    single_spec_trades: int | None = None

    @property
    def clears_bar(self) -> bool:
        """Does this row clear 80% win rate and >+5% per trade, simultaneously.

        True for a searched maximum. It is not a forecast, and the app must not
        present it as one — `role` and `caveat` carry the difference.
        """
        return bool(
            self.measured
            and self.win_rate is not None
            and self.avg_ret_pct is not None
            and self.win_rate >= 0.80
            and self.avg_ret_pct > 5.0
        )

    def as_dict(self) -> dict[str, object]:
        return dict(
            family=self.family,
            exit_method=self.exit_method,
            oos_trades=self.oos_trades,
            win_rate=self.win_rate,
            avg_ret_pct=self.avg_ret_pct,
            fold_worst_win_rate=self.fold_worst_win_rate,
            fold_best_win_rate=self.fold_best_win_rate,
            folds_traded=self.folds_traded,
            fold_detail=self.fold_detail,
            total_cells_measured=self.total_cells_measured,
            source=self.source,
            measured=self.measured,
            clears_bar=self.clears_bar,
            caveat=self.caveat,
            role=self.role,
            profit_factor=self.profit_factor,
            max_drawdown_pct=self.max_drawdown_pct,
            book_return_pct=self.book_return_pct,
            book_max_drawdown_pct=self.book_max_drawdown_pct,
            win_rate_lo=self.win_rate_lo,
            win_rate_hi=self.win_rate_hi,
            provenance=[c.as_dict() for c in self.provenance],
            n_specs=self.n_specs,
            n_cells=self.n_cells,
            single_spec_trades=self.single_spec_trades,
        )


@dataclass(frozen=True)
class Plan:
    """The whole nightly answer: which session, the regime, what to buy, what to watch."""

    as_of: date
    session_label: str
    next_session: date
    horizon: str
    method_name: str
    open: bool
    headline: str
    regime: Regime
    candidates: tuple[Candidate, ...]
    watchlist: tuple[WatchItem, ...]
    evidence: Evidence
    ladder: tuple[Evidence, ...]
    costs: dict[str, float]
    source: str
    # Every name that did not clear the chain, ranked by how near it came. This
    # is what the screener shows: the same rules as the plan, applied to the
    # whole universe, ordered by how close each name is to being buyable.
    ranked: tuple[dict[str, object], ...] = ()
    required_gates: tuple[str, ...] = ()
    coverage: dict[str, object] = field(default_factory=dict)
    # What survived the study's holdout (docs/22). Present on every plan because
    # the searched headline on its own is a maximum over 280 configurations, and
    # a user deciding what to buy tomorrow needs the expectation, not the best
    # cell.
    holdout: Holdout | None = None
    # How often each regime band occurred (docs/24), so "not yet" is expected
    # rather than read as a malfunction.
    frequency: RegimeFrequency | None = None
    # "exchange_calendar" when the next session came from ^JKSE's own bar dates,
    # "next_weekday_unverified" when it is only the next weekday. The UI shows
    # which, because only one of those two survives a public holiday - and no
    # calendar contains the future.
    next_session_basis: str = "next_weekday_unverified"
    # The IDX tables the ticket needs (tick bands, AR bands, fees, sessions), so
    # no component hard-codes a tick size or a commission.
    idx: dict[str, object] = field(default_factory=dict)
    # One verdict for the session: ENTER, WAIT, NO_TRADE or DATA_UNSAFE. Built by
    # `verdict.py`, which is pure — so all four states are unit-testable without
    # running a universe pass.
    verdict: dict[str, object] = field(default_factory=dict)
    # The five-year replay, so the front page can show the deepest drawdown the
    # study measured for this chain rather than only the friendly window.
    five_year: dict[str, object] = field(default_factory=dict)
    # The same chain, measured after the study's correctness pass. Kept beside
    # `evidence` rather than instead of it: one is what the search found, the
    # other is what the study now publishes, and a screen showing only the first
    # is quoting a number its own author has withdrawn.
    corrected: Evidence | None = None

    def as_dict(self) -> dict[str, object]:
        return dict(
            as_of=self.as_of.isoformat(),
            session_label=self.session_label,
            next_session=self.next_session.isoformat(),
            next_session_basis=self.next_session_basis,
            horizon=self.horizon,
            method_name=self.method_name,
            open=self.open,
            headline=self.headline,
            regime=self.regime.as_dict(),
            candidates=[c.as_dict() for c in self.candidates],
            watchlist=[w.as_dict() for w in self.watchlist],
            evidence=self.evidence.as_dict(),
            ladder=[e.as_dict() for e in self.ladder],
            costs=self.costs,
            source=self.source,
            ranked=list(self.ranked),
            required_gates=list(self.required_gates),
            coverage=self.coverage,
            holdout=self.holdout.as_dict() if self.holdout else None,
            frequency=self.frequency.as_dict() if self.frequency else None,
            corrected=self.corrected.as_dict() if self.corrected else None,
            idx=dict(self.idx),
            verdict=dict(self.verdict),
            five_year=dict(self.five_year),
        )