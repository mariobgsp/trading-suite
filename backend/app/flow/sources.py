"""Data adapters for the Flow surface.

The default path is deliberately free and bounded:

    OHLCV          yfinance via app.market (cached)
    foreign flow   one official IDX daily-summary call, all tickers
    broker flow    optional Stockbit per-ticker history, only on explicit request

The Stockbit adapter is not a hard dependency. If it is absent, expired or
rate-limited, the Flow card says so and falls back to the free proxy.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from app.indicators import history_to_frame

log = logging.getLogger(__name__)

JAKARTA = ZoneInfo("Asia/Jakarta")
MARKET_CLOSE = time(16, 2)  # WIB; a bar stamped today is unfinished before this


def drop_partial_today(
    df: pd.DataFrame, now: datetime | None = None
) -> pd.DataFrame:
    """Drop a today-stamped bar until the IDX session has closed.

    A daily bar that is still forming is a partial price. The nightly plan has
    the same rule; this helper keeps the Flow cards from quoting one.
    """
    if df is None or df.empty:
        return df
    current = now or datetime.now(JAKARTA)
    if current.tzinfo is None:
        current = current.replace(tzinfo=JAKARTA)
    current = current.astimezone(JAKARTA)
    try:
        last_date = df.index[-1].date()
    except (AttributeError, IndexError):
        return df
    if last_date == current.date() and current.time() < MARKET_CLOSE:
        return df.iloc[:-1]
    return df


def bars(ticker: str, period: str = "1y") -> pd.DataFrame:
    """OHLCV for one ticker, adjusted and cached by the market service."""
    code = ticker.upper().strip()
    if not code:
        return pd.DataFrame()
    try:
        from app.market import fetch_history

        records = fetch_history(code, period=period, interval="1d")
    except Exception as exc:  # noqa: BLE001 - a feed outage is a card warning
        log.warning("flow bars %s failed: %s", code, exc)
        return pd.DataFrame()
    if not records:
        return pd.DataFrame()
    frame = history_to_frame(records)
    return drop_partial_today(frame)


def foreign_map() -> tuple[dict[str, float], dict[str, Any]]:
    """Official per-stock foreign flow, keyed by ticker.

    IDX publishes one daily summary for the whole market; this is the only
    per-stock flow the free source carries. It is *not* broker attribution.
    """
    try:
        from app.idx import foreign_flow_universe

        payload = foreign_flow_universe()
    except Exception as exc:  # noqa: BLE001
        log.warning("flow foreign universe failed: %s", exc)
        return {}, {"available": False, "warning": str(exc)[:200]}

    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not rows:
        return {}, {
            "available": False,
            "as_of": payload.get("as_of") if isinstance(payload, dict) else None,
            "warning": payload.get("error") if isinstance(payload, dict) else "no rows",
        }

    out: dict[str, float] = {}
    for row in rows:
        ticker = str(row.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        try:
            out[ticker] = float(row.get("net_foreign_idr") or 0.0)
        except (TypeError, ValueError):
            continue
    return out, {
        "available": bool(out),
        "as_of": payload.get("as_of"),
        "count": len(out),
    }


def foreign_date(meta: dict[str, Any]) -> date | None:
    """The date the foreign-flow payload was generated, if it carries one."""
    raw = meta.get("as_of") if isinstance(meta, dict) else None
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=JAKARTA)
    return parsed.astimezone(JAKARTA).date()


def foreign_is_fresh(
    meta: dict[str, Any],
    bar_date: date | None,
    max_age_days: int = 3,
) -> bool:
    """Do not paint today's flow onto a bar from three weeks ago.

    IDX foreign flow has no historical series; the payload's `as_of` is when it
    was fetched. A weekend or a holiday can make it a couple of days old, so the
    tolerance is three calendar days, not zero.
    """
    found = foreign_date(meta)
    if found is None or bar_date is None:
        return False
    try:
        gap = (bar_date - found).days
    except (AttributeError, TypeError):
        return False
    return abs(gap) <= max_age_days


def broker_series(
    ticker: str, days: int = 60
) -> tuple[pd.Series | None, dict[str, Any]]:
    """Optional Stockbit top-3 broker net-lot series for one ticker.

    This is intentionally a detail-only adapter. `broker_history` makes one
    request per trading day per ticker, so a whole-universe scan on page load
    would be both slow and abusive. Cards use the free proxy.
    """
    try:
        from app import stockbit

        if not stockbit.stockbit_available():
            return None, {
                "available": False,
                "warning": "Stockbit JWT not configured; using the free foreign-flow proxy",
            }
        hist = stockbit.broker_history(ticker.upper(), days=max(20, min(90, int(days))))
    except Exception as exc:  # noqa: BLE001
        log.warning("flow broker %s failed: %s", ticker, exc)
        return None, {"available": False, "warning": str(exc)[:200]}

    per_day = hist.get("per_day") if isinstance(hist, dict) else None
    if not per_day:
        return None, {"available": False, "warning": "no Stockbit broker rows"}

    values: dict[str, float] = {}
    for row in per_day:
        date = str(row.get("date") or "")[:10]
        try:
            value = float(row.get("top3_net") or 0.0)
        except (TypeError, ValueError):
            value = 0.0
        if date:
            values[date] = value
    if not any(abs(v) > 0 for v in values.values()):
        return None, {"available": False, "warning": "Stockbit broker rows are empty"}
    return pd.Series(values), {
        "available": True,
        "as_of": hist.get("as_of"),
        "days": len(values),
    }


def name_map() -> dict[str, str]:
    """Ticker -> company name from the cached TradingView universe.

    Best effort: a name is metadata, never a reason to fail a card.
    """
    try:
        from app.movers import fetch_universe

        rows = fetch_universe()
    except Exception:  # noqa: BLE001
        return {}
    out: dict[str, str] = {}
    for row in rows or []:
        ticker = str(row.get("symbol") or "").upper().strip()
        name = str(row.get("name") or "").strip()
        if ticker and name:
            out[ticker] = name
    return out
