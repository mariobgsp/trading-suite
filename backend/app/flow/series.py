"""Detail series for the Flow chart.

The series is the same proxy as the card, with its dates and per-bar values
exposed for drawing. `lpm_score` is dimensionless; `lpm_price_space` is a
transformed display line, never a vendor level.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from app.flow import cache as flow_cache
from app.flow import lpm as L
from app.flow import sources
from app.flow import technicals as T
from app.flow.model import FlowSeries, SourceInfo

log = logging.getLogger(__name__)
JAKARTA = ZoneInfo("Asia/Jakarta")


def _clean(value: Any, digits: int = 4) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):
        return None
    return round(out, digits)


def _list(series: pd.Series | None, digits: int = 4) -> list[float | None]:
    if series is None:
        return []
    return [_clean(value, digits) for value in series.tolist()]


def series(
    ticker: str,
    days: int = 120,
    source: str = "auto",
    refresh: bool = False,
) -> dict[str, Any]:
    """Return one name's price and proxy-flow series, cached in SQLite.

    A cache hit avoids the OHLCV pull and the indicator recomputation. A stale
    entry is served with a warning if recomputation fails, so a feed outage does
    not blank a chart that was correct minutes ago.
    """
    code = ticker.upper().strip()
    window = max(30, min(250, int(days or 120)))
    chosen = source if source in {"auto", "idx", "stockbit", "ohlcv"} else "auto"
    key = flow_cache.make_key("series", code, window, chosen)
    payload, meta = flow_cache.get_or_compute(
        key,
        lambda: _build_series(code, window, chosen),
        ttl=flow_cache.DEFAULT_TTL,
        refresh=refresh,
    )
    payload["cache"] = meta.as_dict()
    if meta.warning:
        payload.setdefault("warnings", []).append(meta.warning)
    return payload


def _build_series(code: str, window: int, chosen: str) -> dict[str, Any]:
    """Compute the series behind `series()`; cached by the public wrapper."""
    if not code:
        raise LookupError("ticker is empty")

    df = sources.bars(code)
    if df is None or len(df) < 30:
        raise LookupError(f"no enough price history for {code}")

    frame = T.compute(df)
    if frame.empty:
        raise LookupError(f"no indicators for {code}")

    warnings: list[str] = []
    foreign_series: pd.Series | None = None
    foreign_meta: dict[str, Any] = {"available": False}
    if chosen in {"auto", "idx", "stockbit"}:
        foreign_values, foreign_meta = sources.foreign_map()
        value = foreign_values.get(code)
        fresh = sources.foreign_is_fresh(foreign_meta, frame.index[-1].date())
        if value is not None and fresh:
            foreign_series = pd.Series({frame.index[-1]: float(value)})
            warnings.append(
                "IDX foreign flow is current-day only; the historical line is CMF-driven"
            )
        elif value is not None:
            warnings.append(
                "IDX foreign flow is stale ("
                + str(foreign_meta.get("as_of"))
                + "); using OHLCV + CMF"
            )
        if not foreign_meta.get("available"):
            warnings.append("IDX foreign flow unavailable; using OHLCV + CMF")

    broker_series: pd.Series | None = None
    if chosen == "stockbit":
        broker_series, broker_meta = sources.broker_series(code, days=min(window, 90))
        if broker_series is not None:
            warnings.append(
                "Stockbit broker flow is a top-3 net-lot proxy, not vendor LPM"
            )
        else:
            warnings.append(str(broker_meta.get("warning") or "Stockbit broker flow unavailable"))

    frame, flow_meta = L.score_frame(
        frame,
        foreign_net_idr=foreign_series,
        broker_net_lots=broker_series,
    )
    for warning in flow_meta.get("warnings", []):
        if warning and warning not in warnings:
            warnings.append(warning)
    if len(frame) < 240:
        warnings.append("history is shorter than 52 weeks; the 52W distance is partial")

    tail = frame.tail(window)
    foreign_tail = (
        foreign_series.reindex(tail.index)
        if foreign_series is not None
        else pd.Series([None] * len(tail), index=tail.index, dtype=float)
    )
    as_of = str(tail.index[-1].date()) if len(tail) else datetime.now(JAKARTA).date().isoformat()
    source_info = SourceInfo(
        bars="yfinance",
        flow=str(flow_meta.get("source") or "unavailable"),
        quality="proxy",
        as_of=as_of,
        available=bool(flow_meta.get("source") and flow_meta.get("source") != "unavailable"),
        warnings=tuple(warnings),
    )
    out = FlowSeries(
        ticker=code,
        dates=[str(d.date()) for d in tail.index],
        price=_list(tail["Close"], 2),
        lpm_score=_list(tail["lpm_score"], 4),
        lpm_price_space=_list(tail["lpm_price_space"], 2),
        intensity=_list(tail["intensity"], 3),
        foreign_net_idr=_list(foreign_tail, 0),
        money_flow=_list(tail["cmf20"], 4),
        source=source_info,
        parameters=_parameters(window),
        warnings=tuple(warnings),
    )
    return out.as_dict()


def _parameters(window: int) -> dict[str, Any]:
    return {
        "window": window,
        "rsi": T.RSI_PERIOD,
        "stoch": f"{T.STOCH_K},{T.STOCH_D}",
        "supertrend": f"{T.SUPERTREND_ATR},{T.SUPERTREND_MULT}",
        "ichimoku": f"{T.ICHIMOKU_TENKAN},{T.ICHIMOKU_KIJUN},{T.ICHIMOKU_SENKOU}",
        "vwap": T.VWAP_WINDOW,
        "ma_fast": T.MA_FAST,
        "ma_slow": T.MA_SLOW,
        "high_52w": T.HIGH_52W,
        "lpm_ema": L.EMA_SPAN,
        "lpm_lookback": L.DIRECTION_LOOKBACK,
        "lpm_threshold": L.DIRECTION_THRESHOLD,
    }
