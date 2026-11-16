"""The alert feed — the plan's book, shaped for one glance.

Takes the computed plan payload (the same artifact the /plan page reads) and
shapes it into the answer a person checks at night: the verdict, the ranked
book of entries (never just one recommendation — up to MAX_ENTRIES concurrent
positions), the watchlist remainder, and NO_TRADE as a first-class state.
Pure shaping: no new measurement, no second method.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from app.plan import plan_payload

# Money-management decision (grill session): at most 5 concurrent positions;
# the ranked rest stay watchlist.
MAX_ENTRIES = 5

# A plan older than this many days is stale (long weekend + holidays budget).
STALE_AFTER_DAYS = 4

_REGIME_KEYS = ("band", "action", "breadth")


def _why(candidate: dict[str, Any]) -> str:
    """One sentence a person reads before sending the order."""
    breakout = candidate.get("breakout_pct")
    rs = candidate.get("rs_rating")
    parts: list[str] = []
    if breakout is not None:
        parts.append(f"breakout {float(breakout):+.1f}% di atas high 40 sesi")
    if rs is not None:
        parts.append(f"RS {float(rs):.0f}")
    geo = candidate.get("geometry") or {}
    basis = geo.get("entry_basis")
    if basis:
        parts.append(f"entry {basis}")
    return ", ".join(parts) if parts else "lolos semua gerbang metode"


def _entry(rank: int, candidate: dict[str, Any]) -> dict[str, Any]:
    geo = candidate.get("geometry") or {}
    reason = candidate.get("reason") or {}
    return {
        "rank": rank,
        "ticker": candidate.get("ticker"),
        "name": candidate.get("name"),
        "close": candidate.get("close"),
        "score": candidate.get("score"),
        "rs_rating": candidate.get("rs_rating"),
        "entry_ref": geo.get("entry_ref"),
        "target_price": geo.get("target_price"),
        "stop_price": geo.get("stop_price"),
        "target_pct": geo.get("target_pct"),
        "stop_pct": geo.get("stop_pct"),
        "reward_risk": geo.get("reward_risk"),
        "position_idr": geo.get("position_idr"),
        "shares": geo.get("shares"),
        "lots": geo.get("lots"),
        "max_loss_idr": geo.get("max_loss_idr"),
        "entry_session": reason.get("entry_session"),
        "why": _why(candidate),
    }


def build_feed() -> dict[str, Any]:
    """The whole alert payload for the UI: state, book, watchlist, no-trade."""
    payload = plan_payload()

    candidates = payload.get("candidates") or []
    entries = [_entry(i + 1, cand) for i, cand in enumerate(candidates)]
    book, rest = entries[:MAX_ENTRIES], entries[MAX_ENTRIES:]

    verdict = payload.get("verdict") or {}
    state = verdict.get("state") or ("ENTER" if book else "NO_TRADE")
    blockers = verdict.get("blockers") or []
    no_trade_reasons = [
        str(b.get("label") or b.get("detail") or b.get("key") or "")
        for b in blockers
        if (b.get("label") or b.get("detail") or b.get("key"))
    ]

    as_of_raw = payload.get("as_of")
    data_age_days: int | None = None
    stale = False
    try:
        as_of_date = date.fromisoformat(str(as_of_raw))
        data_age_days = (date.today() - as_of_date).days
        stale = data_age_days > STALE_AFTER_DAYS
    except (TypeError, ValueError):
        stale = True  # an unreadable date is exactly when we must not act

    regime = payload.get("regime") or {}
    corrected = payload.get("corrected") or payload.get("evidence") or {}

    return {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "as_of": as_of_raw,
        "session_label": payload.get("session_label"),
        "next_session": payload.get("next_session"),
        "next_session_basis": payload.get("next_session_basis"),
        "horizon": payload.get("horizon"),
        "headline": payload.get("headline"),
        "state": state,
        "regime": {key: regime.get(key) for key in _REGIME_KEYS},
        "entries": book,
        "book_overflow": rest,
        "watchlist_count": len(payload.get("watchlist") or []),
        "no_trade_reasons": no_trade_reasons,
        "data_age_days": data_age_days,
        "stale": stale,
        # The expectation, quoted as the study's number — never tonight's.
        "study": {
            "win_rate": corrected.get("win_rate"),
            "avg_ret_pct": corrected.get("avg_ret_pct"),
            "oos_trades": corrected.get("oos_trades"),
            "role": corrected.get("role"),
        },
    }
