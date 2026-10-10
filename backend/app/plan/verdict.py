"""One verdict per session, and the measured case for standing down.

The plan answers "what should I buy". This module answers the question before it:
*should I be buying anything at all tonight*. Four states, in strict precedence:

    DATA_UNSAFE  the bars or the evidence cannot be trusted — nothing else matters
    NO_TRADE     the tape is not one this method trades, or nothing can be sized
    WAIT         the tape is right and nothing has cleared the chain yet
    ENTER        at least one name cleared every condition and can be sized

The order is the point. A screen that says "buy" on a broken bar source is worse
than one that says nothing, so every integrity check fails closed: a failed check
suppresses the ticket instead of sitting beside it as a warning.

The stand-down case is not a disclaimer. The study measured the flat band and
found it loses to costs (57.41% win, -2.11% a trade over 71.9% of sessions), and
measured the same book *with* that band traded: -65.6% total, a 67.0% drawdown,
against +31.9% and a 7.9% drawdown with the band skipped. Those numbers are what
makes "no trade" an answer rather than an absence of one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Sequence

from . import citations as C
from . import method as M
from .bars import COVERAGE_FLOOR
from .model import Candidate, Evidence, Gate, Regime, RegimeFrequency, WatchItem

STATE_ENTER = "ENTER"
STATE_WAIT = "WAIT"
STATE_NO_TRADE = "NO_TRADE"
STATE_DATA_UNSAFE = "DATA_UNSAFE"

# Below this many names the breadth reading is not a market reading. The study's
# own universe runs 308-525; a hundred is a floor for "something is wrong with
# the data", not a trading threshold.
MIN_UNIVERSE = 100

# Last moment the pre-opening book takes an order (IDX rulebook: input
# 08:45:00-08:57:59, no-cancel from 08:56:00). The study fills at the open.
PLACE_BY = "08:57"
PLACE_NOTE = (
    "The pre-opening book takes orders until 08:57:59 WIB and the study fills at "
    "the open, so an order placed after that waits for the next session."
)


@dataclass(frozen=True)
class Blocker:
    """Why the verdict is not simply "buy"."""

    key: str
    label: str
    severity: str  # "data" | "market" | "size" | "name"
    text: str
    value: float | None = None
    threshold: float | None = None
    unit: str = ""

    def as_dict(self) -> dict[str, object]:
        return dict(
            key=self.key,
            label=self.label,
            severity=self.severity,
            text=self.text,
            value=self.value,
            threshold=self.threshold,
            unit=self.unit,
        )


@dataclass(frozen=True)
class Check:
    """One data-integrity test. All of them must pass before a ticket is issued."""

    key: str
    label: str
    ok: bool
    detail: str

    def as_dict(self) -> dict[str, object]:
        return dict(key=self.key, label=self.label, ok=self.ok, detail=self.detail)


@dataclass(frozen=True)
class Verdict:
    state: str
    action: str
    headline: str
    detail: str
    primary_blocker: Blocker | None
    blockers: tuple[Blocker, ...]
    change_needed: str
    recheck_on: date
    recheck_basis: str
    integrity: tuple[Check, ...]
    sound: bool
    stand_down_case: dict[str, object]
    place_by: str = PLACE_BY
    place_note: str = PLACE_NOTE

    @property
    def buys(self) -> bool:
        return self.state == STATE_ENTER

    def as_dict(self) -> dict[str, object]:
        return dict(
            state=self.state,
            action=self.action,
            headline=self.headline,
            detail=self.detail,
            primary_blocker=(
                self.primary_blocker.as_dict() if self.primary_blocker else None
            ),
            blockers=[b.as_dict() for b in self.blockers],
            change_needed=self.change_needed,
            recheck_on=self.recheck_on.isoformat(),
            recheck_basis=self.recheck_basis,
            integrity=[c.as_dict() for c in self.integrity],
            sound=self.sound,
            buys=self.buys,
            stand_down_case=self.stand_down_case,
            place_by=self.place_by,
            place_note=self.place_note,
        )


# ── data integrity, fail closed ─────────────────────────────────────────────
def integrity(
    *,
    bars_session: date | None,
    exchange_session: date | None,
    universe_size: int,
    names_on_session: int,
    phantom_dropped: int,
    evidence_measured: bool,
) -> tuple[Check, ...]:
    """Every check a ticket depends on, in the order that fails fastest."""
    coverage = (names_on_session / universe_size) if universe_size else 0.0
    return (
        Check(
            "exchange_calendar",
            "The exchange's own session calendar",
            exchange_session is not None,
            (
                f"Last session the exchange held, from the benchmark's own bars: {exchange_session}."
                if exchange_session
                else "The benchmark's bars are missing, so the app cannot say which session it is screening."
            ),
        ),
        Check(
            "bars_current",
            "Bars reach the last exchange session",
            bars_session is not None and bars_session == exchange_session,
            f"Bars end {bars_session}; the exchange's last session is {exchange_session}.",
        ),
        Check(
            "universe",
            "The universe is big enough to be a market reading",
            universe_size >= MIN_UNIVERSE,
            f"{universe_size} names traded above their own 200-day average "
            f"(floor {MIN_UNIVERSE}).",
        ),
        Check(
            "coverage",
            "Enough of the universe traded on the session",
            coverage >= COVERAGE_FLOOR,
            f"{names_on_session} of {universe_size} names have a bar on the session "
            f"({coverage * 100:.0f}%, floor {COVERAGE_FLOOR * 100:.0f}%).",
        ),
        Check(
            "no_phantom_bars",
            "No bars on sessions the exchange never held",
            phantom_dropped == 0,
            (
                "The source carried no off-calendar rows."
                if phantom_dropped == 0
                else f"{phantom_dropped} row(s) fell on dates absent from the benchmark "
                "calendar and were refused — which means the source is suspect."
            ),
        ),
        Check(
            "evidence_measured",
            "The measured row for this chain is readable",
            evidence_measured,
            (
                "The study's results carry a row for the running chain."
                if evidence_measured
                else "The study's results were unreadable, or carry no row for this chain."
            ),
        ),
    )


# ── blockers ────────────────────────────────────────────────────────────────
def _market_blockers(regime: Regime, required_gates: Sequence[str]) -> tuple[Blocker, ...]:
    """The market conditions this family actually applies, when they are shut."""
    required = set(required_gates)
    out: list[Blocker] = []
    if "breadth" in required and not regime.breadth_open:
        out.append(
            Blocker(
                key="breadth",
                label="Market breadth",
                severity="market",
                text=(
                    f"{regime.breadth * 100:.0f}% of the universe is above its own "
                    f"200-day average; this method trades at "
                    f"{regime.breadth_threshold * 100:.0f}%."
                ),
                value=round(regime.breadth, 4),
                threshold=regime.breadth_threshold,
                unit="share of the universe",
            )
        )
    if "index_above_200" in required and regime.index_above_200 is False:
        out.append(
            Blocker(
                key="index_above_200",
                label="IHSG above its 200-day average",
                severity="market",
                text="The index is below its own long-term average, which this method does not buy into.",
                value=regime.index_close,
                threshold=None,
                unit="IDR",
            )
        )
    return tuple(out)


def name_blocker(gate: Gate) -> Blocker:
    """A per-name condition, for the "closest name" line on a WAIT verdict."""
    return Blocker(
        key=gate.key,
        label=gate.label,
        severity="name",
        text=gate.text,
        value=gate.value,
        threshold=gate.threshold,
        unit=gate.unit,
    )


# ── the stand-down case ─────────────────────────────────────────────────────
_STAND_DOWN_LABELS = (
    "trending_share",
    "sideways_share",
    "capitulation_share",
    "sideways_win_rate",
    "sideways_avg_ret_pct",
    "sideways_drift_5s_pct",
    "sideways_capture_hi",
    "capitulation_win_rate",
    "capitulation_avg_ret_pct",
    "capitulation_drift_5s_pct",
    "trending_drift_5s_pct",
    "trending_capture",
)


def stand_down_case(
    regime: Regime, frequency: RegimeFrequency | None = None
) -> dict[str, object]:
    """The measured argument for not trading, as numbers rather than a warning."""
    cited = C.value
    book = M.book_with_sideways()
    return {
        "band": regime.band,
        "breadth": round(regime.breadth, 4),
        "threshold": regime.breadth_threshold,
        "long_run_median": round(regime.breadth_median, 4),
        "sessions_measured": frequency.sessions if frequency else None,
        "round_trip_pct": M.ROUND_TRIP_COST * 100.0,
        "bands": {
            "trending": cited("trending_share"),
            "sideways": cited("sideways_share"),
            "capitulation": cited("capitulation_share"),
        },
        "sideways": {
            "win_rate": cited("sideways_win_rate"),
            "avg_ret_pct": cited("sideways_avg_ret_pct"),
            "drift_5s_pct": cited("sideways_drift_5s_pct"),
            "capture_needed_x": cited("sideways_capture_hi"),
        },
        "capitulation": {
            "win_rate": cited("capitulation_win_rate"),
            "avg_ret_pct": cited("capitulation_avg_ret_pct"),
            "drift_5s_pct": cited("capitulation_drift_5s_pct"),
        },
        "trending": {
            "drift_5s_pct": cited("trending_drift_5s_pct"),
            "capture_achieved_x": cited("trending_capture"),
        },
        "book": book,
        "claim": (
            "Trading the flat band is measured, not asserted: the study ran the same "
            "rules there and they lose to costs."
        ),
        "provenance": [
            cited_citation.as_dict()
            for cited_citation in (C.citation(label) for label in _STAND_DOWN_LABELS)
            if cited_citation is not None
        ],
    }


# ── the verdict ─────────────────────────────────────────────────────────────
def build(
    *,
    regime: Regime,
    candidates: Sequence[Candidate],
    watchlist: Sequence[WatchItem],
    required_gates: Sequence[str],
    evidence: Evidence,
    bars_session: date | None,
    exchange_session: date | None,
    universe_size: int,
    names_on_session: int,
    phantom_dropped: int,
    next_session: date,
    next_session_basis: str,
    frequency: RegimeFrequency | None = None,
) -> Verdict:
    """Decide the session's verdict. Pure: everything it needs is an argument."""
    checks = integrity(
        bars_session=bars_session,
        exchange_session=exchange_session,
        universe_size=universe_size,
        names_on_session=names_on_session,
        phantom_dropped=phantom_dropped,
        evidence_measured=bool(evidence.measured),
    )
    failed = [c for c in checks if not c.ok]
    blockers: list[Blocker] = list(_market_blockers(regime, required_gates))
    sizeable = [c for c in candidates if c.geometry.position_idr]
    case = stand_down_case(regime, frequency)

    if failed:
        first = failed[0]
        return Verdict(
            state=STATE_DATA_UNSAFE,
            action="Do not trade. Fix the data or the evidence first.",
            headline="The data behind this screen is not sound",
            detail=(
                "A verdict is only worth the bars under it. This session fails "
                f"{len(failed)} of {len(checks)} integrity checks, so the app withholds "
                "every ticket rather than qualifying it."
            ),
            primary_blocker=Blocker(
                key=first.key, label=first.label, severity="data", text=first.detail
            ),
            blockers=tuple(blockers),
            change_needed=(
                "Repair the failed check, then refresh. Nothing here is tradeable "
                "until it passes."
            ),
            recheck_on=next_session,
            recheck_basis=next_session_basis,
            integrity=checks,
            sound=False,
            stand_down_case=case,
        )

    if regime.band != "trending":
        return Verdict(
            state=STATE_NO_TRADE,
            action=(
                "Do not trade. Watch the list instead."
                if regime.band == "capitulation"
                else "Do not trade. Stay flat."
            ),
            headline=(
                "Capitulation: nothing here is a buy"
                if regime.band == "capitulation"
                else (
                    f"Sideways: breadth {regime.breadth * 100:.0f}%, short of the "
                    f"{regime.breadth_threshold * 100:.0f}% this method trades at"
                )
            ),
            detail=(
                "This is the method's own instruction, not a malfunction. The flat "
                "band is where the study measured the loss it avoids."
            ),
            primary_blocker=blockers[0] if blockers else None,
            blockers=tuple(blockers),
            change_needed=_change_needed(
                regime, STATE_NO_TRADE, candidates, watchlist
            ),
            recheck_on=next_session,
            recheck_basis=next_session_basis,
            integrity=checks,
            sound=True,
            stand_down_case=case,
        )

    if not sizeable:
        if candidates:
            size_blocker = Blocker(
                key="size",
                label="Tradeable at size",
                severity="size",
                text=(
                    f"{len(candidates)} name(s) cleared every condition, but none can be "
                    "sized at 2% of median 60-session turnover without breaching the "
                    "participation cap — so the study would not take the trade either."
                ),
            )
            return Verdict(
                state=STATE_NO_TRADE,
                action="Do not trade. The names that cleared cannot be filled at size.",
                headline="Nothing is tradeable at size",
                detail=(
                    "Clearing the rules is half the condition; the other half is that "
                    "the position can be absorbed. The study rejects these rather than "
                    "simulating a size nobody could have filled (docs/21 §8)."
                ),
                primary_blocker=size_blocker,
                blockers=tuple(blockers) + (size_blocker,),
                change_needed=_change_needed(
                    regime, STATE_NO_TRADE, candidates, watchlist
                ),
                recheck_on=next_session,
                recheck_basis=next_session_basis,
                integrity=checks,
                sound=True,
                stand_down_case=case,
            )
        return Verdict(
            state=STATE_WAIT,
            action="No order tonight. Watch the list and look again at the next session.",
            headline="Trending tape, nothing has cleared the chain yet",
            detail=(
                "The market condition is met, which is the half that cannot be fixed "
                "from a single name. What is missing is a name closing all of its own "
                "conditions."
            ),
            primary_blocker=blockers[0] if blockers else None,
            blockers=tuple(blockers),
            change_needed=_change_needed(regime, STATE_WAIT, candidates, watchlist),
            recheck_on=next_session,
            recheck_basis=next_session_basis,
            integrity=checks,
            sound=True,
            stand_down_case=case,
        )

    return Verdict(
        state=STATE_ENTER,
        action=f"Place {len(sizeable)} order(s) at the open, before {PLACE_BY} WIB.",
        headline=(
            f"{len(sizeable)} name{'s' if len(sizeable) != 1 else ''} cleared every "
            "condition and can be sized"
        ),
        detail=(
            "Each ticket below carries its entry, target, stop, size and the real cost "
            "of a round trip at its price."
        ),
        primary_blocker=None,
        blockers=tuple(blockers),
        change_needed="Nothing. Place the orders at the next session's open.",
        recheck_on=next_session,
        recheck_basis=next_session_basis,
        integrity=checks,
        sound=True,
        stand_down_case=case,
    )


def _change_needed(
    regime: Regime,
    state: str,
    candidates: Sequence[Candidate],
    watchlist: Sequence[WatchItem],
) -> str:
    """What would have to change for this to become a buy, in one sentence."""
    if regime.band == "sideways":
        need = (regime.breadth_threshold - regime.breadth) * 100.0
        return (
            f"Breadth must rise from {regime.breadth * 100:.0f}% to "
            f"{regime.breadth_threshold * 100:.0f}% — {need:.0f} points, and no name "
            "can supply it."
        )
    if regime.band == "capitulation":
        return (
            "Breadth must climb back above 25% and then past 60%. The study measured "
            "this band as a watchlist, not an entry."
        )
    if candidates and not any(c.geometry.position_idr for c in candidates):
        return (
            "A name that clears every condition and trades at least 100M IDR a day. "
            "Below that the 2M floor is more than 2% of ADV."
        )
    if watchlist:
        head = watchlist[0]
        return (
            f"One name must close the condition it is missing. Closest tonight is "
            f"{head.ticker}: {head.distance_text}"
        )
    return (
        "One name must close above its 40-session high with relative strength in the "
        "top 10% of the universe and volatility below its own 40th percentile."
    )


__all__ = [
    "Blocker",
    "Check",
    "MIN_UNIVERSE",
    "PLACE_BY",
    "PLACE_NOTE",
    "STATE_DATA_UNSAFE",
    "STATE_ENTER",
    "STATE_NO_TRADE",
    "STATE_WAIT",
    "Verdict",
    "build",
    "integrity",
    "name_blocker",
    "stand_down_case",
]
