"""Assemble the dashboard universe: historical frames + current prints.

The expensive part is history. The study checkout already carries ~887 verified
daily frames, so the dashboard reuses them instead of making 888 yfinance calls.
TradingView supplies the current print and the sector/industry labels in one
call.

Nothing here is allowed to run inside a GET request. `snapshot.py` calls this
from a background job and persists the derived payload.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from app.plan.bars import StudyBars, session_is_final

log = logging.getLogger(__name__)
JAKARTA = ZoneInfo("Asia/Jakarta")
MARKET_CLOSE = time(16, 2)
BENCHMARK = "^JKSE"
MIN_HISTORY = 200
NEAR_52W_PCT = 5.0


def _num(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def _series(frame: pd.DataFrame | None, column: str) -> pd.Series:
    if frame is None or frame.empty or column not in frame:
        return pd.Series(dtype=float)
    index = pd.to_datetime(frame["date"], errors="coerce")
    values = pd.to_numeric(frame[column], errors="coerce")
    out = pd.Series(values.to_numpy(), index=index)
    out = out[~out.index.isna()]
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out.dropna()


def _last_date(frame: pd.DataFrame | None) -> date | None:
    if frame is None or frame.empty:
        return None
    try:
        return pd.Timestamp(frame["date"].iloc[-1]).date()
    except (ValueError, TypeError, IndexError):
        return None


def current_session(now: datetime | None = None) -> date:
    """The last completed IDX session, in Jakarta time."""
    moment = (now or datetime.now(JAKARTA)).astimezone(JAKARTA)
    today = moment.date()
    if today.weekday() >= 5:
        # Weekend: walk back to Friday. The study calendar refines this when it
        # is available, but this keeps the label honest before the build.
        return today - pd.Timedelta(days=today.weekday() - 4).to_pytimedelta()
    return today if session_is_final(today, moment) else today - pd.Timedelta(days=1).to_pytimedelta()


def _benchmark_quote() -> dict[str, float] | None:
    try:
        from app.market import fetch_quote

        quote = fetch_quote(BENCHMARK) or {}
        price = _num(quote.get("price") or quote.get("close"))
        change = _num(quote.get("change_percent") or quote.get("change"))
        if price is None:
            return None
        return {"close": price, "change_pct": change}
    except Exception as exc:  # noqa: BLE001
        log.warning("overview benchmark quote failed: %s", exc)
        return None


def _benchmark_series(
    frames: Any,
    append_current: bool,
    print_date: date,
    quote: dict[str, float] | None,
) -> pd.Series:
    series = _series(getattr(frames, "benchmark", None), "close")
    if append_current and quote and quote.get("close") is not None:
        series = pd.concat(
            [series, pd.Series({pd.Timestamp(print_date): quote["close"]})]
        )
        series = series[~series.index.duplicated(keep="last")].sort_index()
    return series


def load_inputs(now: datetime | None = None) -> dict[str, Any]:
    """Read study history and the current TradingView universe once.

    Returns a plain dict so the caller can persist or test it without importing a
    second model. The frames are dropped at the end of the build; only derived
    aggregates are persisted.
    """
    from app.movers import fetch_universe

    try:
        frames = StudyBars().load(None)
        source = "study"
    except Exception as exc:  # noqa: BLE001
        log.warning("overview study bars unavailable: %s", exc)
        from app.plan.bars import Frames

        frames = Frames(source="unavailable")
        source = "unavailable"

    universe = fetch_universe()
    history_as_of = _last_date(getattr(frames, "benchmark", None))
    if history_as_of is None:
        # Fall back to the newest frame date if the benchmark is missing.
        dates = [_last_date(frame) for frame in getattr(frames, "bars", {}).values()]
        history_as_of = max((d for d in dates if d is not None), default=None)

    moment = (now or datetime.now(JAKARTA)).astimezone(JAKARTA)
    today = moment.date()
    last_session = today
    while last_session.weekday() >= 5 or not session_is_final(last_session, moment):
        last_session -= pd.Timedelta(days=1).to_pytimedelta()
    after_close = today.weekday() < 5 and session_is_final(today, moment)
    weekend = today.weekday() >= 5
    use_print = bool(universe) and (after_close or weekend)
    print_date = today if after_close else last_session if weekend else (history_as_of or today)
    if history_as_of and print_date < history_as_of:
        print_date = history_as_of
    gap_days = (print_date - history_as_of).days if history_as_of else None
    # A current print is a close, not a bridge over a multi-week gap. When the
    # study history is materially older, keep the historical series intact and
    # let the summary compare today's price against it; otherwise the group
    # returns would treat 16 calendar days as one session.
    append_history = use_print and (gap_days is None or gap_days <= 5)

    benchmark_quote = _benchmark_quote() if use_print else None
    benchmark = _benchmark_series(
        frames,
        use_print and append_history,
        print_date,
        benchmark_quote,
    )
    joined: list[dict[str, Any]] = []
    missing_history = 0
    missing_print = 0
    for row in universe:
        code = str(row.get("symbol") or "").upper().strip()
        if not code:
            continue
        frame = getattr(frames, "bars", {}).get(code)
        closes = _series(frame, "close")
        highs = _series(frame, "high")
        lows = _series(frame, "low")
        if closes.empty:
            missing_history += 1
        price = _num(row.get("price"))
        change_pct = _num(row.get("change_percent"))
        if price is None:
            missing_print += 1
            price = float(closes.iloc[-1]) if len(closes) else None
        if change_pct is None and len(closes) >= 2:
            change_pct = float((closes.iloc[-1] / closes.iloc[-2] - 1.0) * 100.0)
        if use_print and append_history and price is not None:
            stamp = pd.Timestamp(print_date)
            closes = pd.concat([closes, pd.Series({stamp: price})])
            closes = closes[~closes.index.duplicated(keep="last")].sort_index()
            # Current high/low are not in the scan; compare the print against the
            # historical extremes instead of inventing a bar.
        joined.append(
            {
                "ticker": code,
                "name": str(row.get("name") or code),
                "sector": str(row.get("sector") or ""),
                "industry": str(row.get("industry") or ""),
                "market_cap": _num(row.get("market_cap")),
                "price": price,
                "change_pct": change_pct,
                "closes": closes,
                "highs": highs,
                "lows": lows,
                "history_bars": int(len(closes)),
            }
        )

    warnings = [] if source == "study" else ["study history unavailable; rotation is limited"]
    with_history = max(0, len(universe) - missing_history)
    if universe and with_history / len(universe) < 0.60:
        warnings.append(
            "less than 60% of the current universe has study history; "
            "breadth and rotation are partial"
        )
    if gap_days is not None and gap_days > 3:
        warnings.append(
            "study history is "
            + str(gap_days)
            + " days older than the current print; MA, 52W and rotation use the latest "
            "study bars, while the today's-change column uses the current print"
        )

    return {
        "source": source,
        "frames": frames,
        "universe": universe,
        "joined": joined,
        "benchmark": benchmark,
        "benchmark_quote": benchmark_quote,
        "history_as_of": history_as_of,
        "print_date": print_date,
        "history_gap_days": gap_days,
        "use_print": use_print,
        "as_of": print_date,
        "coverage": {
            "universe": len(universe),
            "joined": len(joined),
            "missing_history": missing_history,
            "missing_print": missing_print,
            "history_floor": MIN_HISTORY,
            "history_as_of": history_as_of.isoformat() if history_as_of else None,
            "print_as_of": print_date.isoformat(),
            "use_current_print": use_print,
            "appended_current_to_history": append_history,
            "history_gap_days": gap_days,
        },
        "warnings": warnings,
    }
