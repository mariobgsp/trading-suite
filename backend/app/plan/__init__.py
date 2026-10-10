"""Tonight's plan: which IDX names to buy next session, and why.

The interface is three functions:

    plan()        the nightly answer - regime, candidates, watchlist, evidence
    detail(code)  one name, with every gate's measured value and its geometry
    method_card() the rule chain and the measured proof, for the Method page

Everything a caller must know is here. The rule chain, the cost model, the
universe filters, the cross-sectional panels and the evidence lookup sit behind
the seam in `method.py`, `bars.py`, `screen.py`, `citations.py` and `model.py`.

Plans are memoised per (source, as-of, exit): a nightly screen is a full
universe pass, and the front end asks for it more than once.
"""

from __future__ import annotations

import logging
import threading
from datetime import date

import pandas as pd

from . import citations as C
from . import idx as X
from . import method as M
from . import screen as S
from . import verdict as V
from .bars import BarsSource, Frames, default_source
from .model import Candidate, Evidence, Gate, Plan, Regime, WatchItem

log = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: dict[tuple[str, str, str, str], Plan] = {}
_frames_cache: dict[str, Frames] = {}


def _load(source: BarsSource, label: str) -> Frames:
    with _lock:
        if label not in _frames_cache:
            _frames_cache[label] = source.load(None)  # type: ignore[arg-type]
    return _frames_cache[label]


def set_source(source: BarsSource, label: str) -> None:
    """Swap the bar adapter. Tests use this; production keeps the default."""
    with _lock:
        _frames_cache.pop(label, None)
        _cache.clear()
    global _active
    _active = (source, label)


_active: tuple[BarsSource, str] = (default_source(), "default")


def invalidate() -> None:
    """Forget the cached plan so the next call re-reads bars and results.

    Call this after the study finishes a round, or after a manual refresh.
    """
    with _lock:
        _frames_cache.clear()
        _cache.clear()
    M.clear_cache()


def _horizon(as_of: date) -> str:
    day = as_of.strftime("%a")
    if day == "Fri":
        return "next week"
    return "tomorrow"


def plan(as_of: date | None = None, exit_method: str | None = None) -> Plan:
    """The plan for the next session.

    `as_of` defaults to the last session with data — tonight's close, or
    Friday's close if you are reading this on the weekend. The horizon follows
    from it.
    """
    source, label = _active
    evidence = M.default_evidence()
    spec = M.family_spec(evidence.family)
    exit_name = exit_method or evidence.exit_method or M.DEFAULT_EXIT

    try:
        frames = _load(source, label)
    except Exception as exc:  # noqa: BLE001 - a bad data root must not 500 the page
        log.warning("plan: could not load bars from %s: %s", label, exc)
        raise

    session = frames.as_of()
    if session is None:
        raise RuntimeError(f"no benchmark bars available from {label}")
    if as_of is not None and pd.Timestamp(as_of) < session:
        session = pd.Timestamp(as_of)

    key = (label, session.date().isoformat(), exit_name, spec.family)
    with _lock:
        hit = _cache.get(key)
    if hit is not None:
        return hit

    regime, candidates, watchlist, ranked = S.screen(frames, session, exit_name, spec)
    as_of_date = session.date()
    calendar = frames.sessions()
    market_open = regime.breadth_open and (regime.index_above_200 or not spec.need_bench)

    required = tuple(r.key for r in M.RULES if _rule_required(r.key, spec))
    next_session = S.next_session(as_of_date, calendar)
    next_basis = S.next_session_basis(as_of_date, calendar)
    # The verdict is built from the same numbers the plan shows, and it is the
    # single source for the headline: two sentences describing one session is how
    # a UI ends up disagreeing with itself.
    verdict = V.build(
        regime=regime,
        candidates=candidates,
        watchlist=watchlist,
        required_gates=required,
        evidence=evidence,
        bars_session=as_of_date,
        exchange_session=calendar[-1].date() if calendar else None,
        universe_size=regime.universe_size,
        names_on_session=frames.coverage_on(session),
        phantom_dropped=frames.phantom_dropped,
        next_session=next_session,
        next_session_basis=next_basis,
        frequency=M.regime_frequency(),
    )
    result = Plan(
        as_of=as_of_date,
        session_label=as_of_date.strftime("%a %d %b %Y"),
        next_session=next_session,
        next_session_basis=next_basis,
        horizon=_horizon(as_of_date),
        method_name=evidence.family,
        open=market_open,
        headline=verdict.headline,
        regime=regime,
        candidates=tuple(candidates),
        watchlist=tuple(watchlist),
        evidence=evidence,
        ladder=M.ladder(),
        costs=dict(
            fee_buy=M.FEE_BUY * 100,
            fee_sell=M.FEE_SELL * 100,
            slippage=M.SLIPPAGE * 100,
            round_trip=M.ROUND_TRIP_COST * 100,
            lot_size=M.LOT_SIZE,
            risk_budget_idr=M.RISK_BUDGET_IDR,
        ),
        source=frames.source,
        ranked=tuple(ranked),
        required_gates=required,
        verdict=verdict.as_dict(),
        coverage=dict(
            codes=len(frames.bars),
            benchmark=str(session.date()),
            tradable_on_session=len(candidates) + len(watchlist),
            # Rows the app refused to screen on, per scripts/repair_phantom_bars.
            # Normally zero after the study's repair; non-zero means a re-fetch
            # reintroduced sessions the exchange never held.
            phantom_bars_dropped=frames.phantom_dropped,
            phantom_dates=list(frames.phantom_dates),
            exchange_sessions=len(calendar),
        ),
        # Attached to every plan, not only the Method page. A user deciding what
        # to buy tomorrow is owed the searched maximum *and* what survived
        # unseen data in the same glance; separating them is how the headline
        # becomes a promise it never was.
        holdout=M.holdout(),
        frequency=M.regime_frequency(),
        # The same chain's corrected numbers, beside the searched row rather than
        # instead of it. One is what the search found; the other is what the study
        # publishes after its own correctness pass, and telling them apart is the
        # whole reason this app carries both.
        corrected=M.corrected_evidence(),
        idx=_idx_block(),
    )
    with _lock:
        _cache[key] = result
    return result


def detail(ticker: str) -> dict[str, object]:
    """One name at the current session, with each gate's measured value.

    Returns the gates whether or not the name passed, because "why not" is the
    question a user asks most often.
    """
    current = plan()
    code = ticker.upper().strip()
    source, label = _active
    frames = _load(source, label)
    session = frames.as_of()

    # Evaluate against the whole universe's panels regardless of whether the
    # name is in tonight's list: a name that is not in the plan still deserves a
    # full answer, and the panels cannot be built from one ticker.
    record = None
    regime = None
    if session is not None:
        record, regime = S.evaluate_one(
            frames, session, code, M.family_spec(current.evidence.family)
        )

    gates: tuple[Gate, ...] = ()
    close: float | None = None
    rs = 0.0
    breadth = 0.0
    breakout_level: float | None = None
    if record is not None:
        gates = tuple(record["gates"].values())  # type: ignore[union-attr]
        close = float(record["close"])  # type: ignore[arg-type]
        rs = float(record["rs_rating"])  # type: ignore[arg-type]
        breakout_level = float(record["high_n"])  # type: ignore[arg-type]
        if regime is not None:
            breadth = regime.breadth

    watch = next((w for w in current.watchlist if w.ticker == code), None)
    in_plan = close is not None and all(g.passed for g in gates)

    return {
        "ticker": code,
        "in_plan": in_plan,
        "as_of": current.as_of.isoformat(),
        "close": close,
        "rs_rating": rs,
        "breadth": breadth,
        "breakout_level": breakout_level,
        "blocked_by": watch.blocked_by if watch else None,
        "distance_text": watch.distance_text if watch else "Not close to firing yet.",
        "gates": [g.__dict__ for g in gates],
        "geometry": (
            S._geometry(
                close,
                current.evidence.exit_method or M.DEFAULT_EXIT,
                turnover_idr=(record.get("turnover_idr") if record is not None else None),
            ).as_dict()
            if close
            else None
        ),
        "evidence": current.evidence.as_dict(),
    }


def method_card() -> dict[str, object]:
    """The rule chain and its measured proof, for the Method page."""
    evidence = M.default_evidence()
    spec = M.family_spec(evidence.family)
    ladder = M.ladder()
    return {
        "family": evidence.family or M.DEFAULT_FAMILY,
        "exit_method": evidence.exit_method or M.DEFAULT_EXIT,
        "exit_geometry": dict(
            zip(
                ("target_pct", "stop_pct", "hold_bars"),
                M.exit_for(evidence.exit_method or M.DEFAULT_EXIT),
            )
        ),
        "family_summary": spec.label(),
        "rules": [
            {
                "key": r.key,
                "label": r.label,
                "source": r.source,
                "explain": r.explain,
                "required": _rule_required(r.key, spec),
            }
            for r in M.RULES
        ],
        "evidence": evidence.as_dict(),
        # Three tiers, never blended. `citations` carries the file, line and
        # sentence behind every figure that is cited rather than read.
        "corrected": M.corrected_evidence().as_dict(),
        "citations": [c.as_dict() for c in C.all_citations()],
        "evidence_tiers": {
            "searched": evidence.as_dict(),
            "corrected": M.corrected_evidence().as_dict(),
            "replay": M.five_year_replay(),
        },
        "corrected_block": C.corrected_tier1(),
        "ladder": [e.as_dict() for e in ladder[:12]],
        "families": [
            {
                "family": name,
                "summary": s.label(),
                "breadth": s.breadth,
                "oos_trades": next(
                    (e.oos_trades for e in ladder if e.family == name), None
                ),
                "win_rate": next((e.win_rate for e in ladder if e.family == name), None),
                "avg_ret_pct": next(
                    (e.avg_ret_pct for e in ladder if e.family == name), None
                ),
                "fold_worst_win_rate": next(
                    (e.fold_worst_win_rate for e in ladder if e.family == name), None
                ),
            }
            for name, s in M.FAMILY_SPECS.items()
        ],
        "bar": {
            "win_rate": M.TARGET_WIN_RATE,
            "avg_trade_pct": M.TARGET_AVG_TRADE_PCT,
            "min_trades": M.MIN_TEST_TRADES,
        },
        "deployment": M.deployment(),
        "robustness": M.robustness(),
        # The three things that answer "should I believe the headline?".
        "holdout": (lambda h: h.as_dict() if h else None)(M.holdout()),
        "shipped": M.shipped_config(),
        "five_year": M.five_year_replay(),
        "regime_bands": {
            "trending": M.BREADTH_TRENDING,
            "capitulation": M.BREADTH_CAPITULATION,
            "frequency": (lambda f: f.as_dict() if f else None)(M.regime_frequency()),
            "note": (
                "Above the trending line the screen trades; between the two lines "
                "it stays flat, because the study measured that band drifting "
                "about zero over five sessions while a round trip costs 0.50%; "
                "below the capitulation line it watches."
            ),
        },
        "tradability": {
            "min_price_idr": S.MIN_PRICE_IDR,
            "max_frozen_fraction": S.MAX_FROZEN_FRACTION,
            "why": (
                "An audit found 7.0% of the study's trades came from names whose "
                "close does not move - one ticker alone supplied 4.2%. Excluding "
                "them moved the study's own headline down, so the screen applies "
                "the same filter before scoring anything."
            ),
        },
        "costs": {
            "round_trip_pct": M.ROUND_TRIP_COST * 100,
            "note": "Fees and slippage are inside every measured trade.",
            "idx_note": (
                "This is the study's flat model and it carries no spread term. The "
                "ticket prices the real one separately."
            ),
        },
        "idx": _idx_block(),
        "studies_at": M.DOCS_DIR.name,
    }


def _idx_block() -> dict[str, object]:
    """The IDX tables the UI renders, so no component hard-codes a tick size."""
    return X.tables()


def size_ticket(
    price: float,
    median_turnover_60: float | None = None,
    risk_budget_idr: float | None = None,
    exit_method: str | None = None,
    spread_ticks: int = 2,
) -> dict[str, object]:
    """Size one order without running a universe pass (docs/21 §8)."""
    return S.size_ticket(
        price, median_turnover_60, risk_budget_idr, exit_method, spread_ticks
    )


def idx_tables() -> dict[str, object]:
    """The tick, AR and fee tables, for a UI that will not hard-code them."""
    return _idx_block()


def _rule_required(key: str, spec: M.FamilySpec) -> bool:
    """Whether the running family actually applies this rule.

    A family that does not read the index still has to show the index reading -
    but labelled as not one of its conditions, rather than as a failed gate the
    user thinks they can fix.
    """
    return {
        "index_above_200": spec.need_bench,
        "breadth": True,
        "relative_strength": True,
        "quiet_vol": True,
        "weekly_trend": spec.need_weekly,
        "breakout": True,
    }.get(key, True)


def ladder() -> tuple[Evidence, ...]:
    """Every measured row clearing both bars, best average return first."""
    return M.ladder()


__all__ = [
    "Candidate",
    "Evidence",
    "Gate",
    "Plan",
    "Regime",
    "WatchItem",
    "detail",
    "invalidate",
    "ladder",
    "method_card",
    "plan",
    "idx_tables",
    "set_source",
    "size_ticket",
]