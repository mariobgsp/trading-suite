"""The Flow card scan: a bounded universe, a free proxy, explicit degradation.

The card is a readout, not a recommendation. It never returns a buy verdict and
never feeds the nightly plan. A missing source produces a warning on the card,
not a fabricated number.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from app.flow import cache as flow_cache
from app.flow import lpm as L
from app.flow import sources
from app.flow import technicals as T
from app.flow.model import FlowCard, SourceInfo

log = logging.getLogger(__name__)
JAKARTA = ZoneInfo("Asia/Jakarta")

MAX_UNIVERSE = 100
DEFAULT_LIMIT = 30
MIN_BARS = 30


def _clean_codes(values: list[str] | str | None) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = values.split(",")
    out: list[str] = []
    for raw in values:
        code = str(raw or "").upper().strip().replace(".JK", "")
        if code and code not in out:
            out.append(code)
    return out


def _watchlist() -> list[str]:
    try:
        from app.portfolio import get_watchlist

        return _clean_codes(get_watchlist())
    except Exception:  # noqa: BLE001
        return []


def _movers(limit: int) -> tuple[list[str], dict[str, str]]:
    try:
        from app.movers import fetch_universe

        rows = fetch_universe()
    except Exception as exc:  # noqa: BLE001
        log.warning("flow movers failed: %s", exc)
        return [], {}
    scored: list[tuple[float, str]] = []
    names: dict[str, str] = {}
    for row in rows or []:
        code = str(row.get("symbol") or "").upper().strip()
        if not code:
            continue
        names[code] = str(row.get("name") or code)
        try:
            value = float(row.get("price") or 0.0) * float(row.get("volume") or 0.0)
        except (TypeError, ValueError):
            value = 0.0
        scored.append((value, code))
    scored.sort(reverse=True)
    return [code for _, code in scored[:limit]], names


def _plan_codes(limit: int) -> list[str]:
    try:
        from app.plan import plan as plan_module

        current = plan_module.plan()
    except Exception as exc:  # noqa: BLE001
        log.warning("flow plan universe failed: %s", exc)
        return []
    codes = [str(c.ticker).upper() for c in current.candidates]
    codes += [str(w.ticker).upper() for w in current.watchlist]
    codes += [str(r.get("ticker", "")).upper() for r in current.ranked]
    return _clean_codes(codes)[:limit]


def resolve_universe(
    universe: str = "watchlist",
    tickers: list[str] | str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> tuple[list[str], dict[str, str], str, list[str]]:
    """Resolve the requested universe to a bounded, de-duplicated code list."""
    cap = max(1, min(MAX_UNIVERSE, int(limit or DEFAULT_LIMIT)))
    warnings: list[str] = []
    names = sources.name_map()

    if universe == "tickers":
        codes = _clean_codes(tickers)
        return codes[:cap], names, "tickers", warnings

    if universe == "watchlist":
        codes = _watchlist()
        if codes:
            return codes[:cap], names, "watchlist", warnings
        warnings.append("watchlist is empty; falling back to the most active movers")
        universe = "movers"

    if universe == "plan":
        codes = _plan_codes(cap)
        if codes:
            return codes, names, "plan", warnings
        warnings.append("plan ranked no names; falling back to the most active movers")
        universe = "movers"

    codes, mover_names = _movers(cap)
    names.update(mover_names)
    if not codes:
        warnings.append("no movers available from the market universe")
    return codes[:cap], names, "movers", warnings


def _flow_for(df: pd.DataFrame, foreign_value: float | None) -> tuple[pd.DataFrame, dict[str, Any]]:
    if foreign_value is not None and len(df):
        last = df.index[-1]
        foreign = pd.Series({last: float(foreign_value)})
    else:
        foreign = None
    frame, meta = L.score_frame(df, foreign_net_idr=foreign)
    if foreign is not None:
        meta.setdefault("warnings", []).append(
            "IDX foreign flow is current-day only; the historical line is CMF-driven"
        )
    return frame, meta


def build_card(
    ticker: str,
    *,
    name: str | None = None,
    foreign_value: float | None = None,
    foreign_as_of: str | None = None,
    source: str = "auto",
) -> FlowCard | None:
    code = ticker.upper().strip()
    df = sources.bars(code)
    if df is None or len(df) < MIN_BARS:
        return None

    frame = T.compute(df)
    if frame.empty:
        return None
    foreign_fresh = foreign_value is None or sources.foreign_is_fresh(
        {"as_of": foreign_as_of}, frame.index[-1].date()
    )
    if not foreign_fresh:
        foreign_value = None
    frame, flow_meta = _flow_for(frame, foreign_value)
    latest = T.latest(frame)
    flow = L.latest(frame)

    if latest.get("price") is None:
        return None

    warnings: list[str] = []
    if not foreign_fresh:
        warnings.append(
            "IDX foreign flow is stale (" 
            + str(foreign_as_of)
            + "); using OHLCV + CMF"
        )
    if len(frame) < 240:
        warnings.append("history is shorter than 52 weeks; the 52W distance is partial")
    for warning in flow_meta.get("warnings", []):
        if warning and warning not in warnings:
            warnings.append(warning)

    as_of = str(frame.index[-1].date())
    source_info = SourceInfo(
        bars="yfinance",
        flow=str(flow_meta.get("source") or "unavailable"),
        quality="proxy",
        as_of=as_of,
        available=bool(flow.get("available")),
        warnings=tuple(warnings),
    )
    return FlowCard(
        ticker=code,
        name=(name or code),
        as_of=as_of,
        price=latest.get("price"),
        previous_close=latest.get("previous_close"),
        change_pct=latest.get("change_pct"),
        value_5d_idr=latest.get("value_5d_idr"),
        technicals={
            "rsi14": latest.get("rsi14"),
            "stoch_k": latest.get("stoch_k"),
            "stoch_d": latest.get("stoch_d"),
            "supertrend": latest.get("supertrend"),
            "kumo": latest.get("kumo"),
            "vwap_pct": latest.get("vwap_pct"),
            "above_ma20": latest.get("above_ma20"),
            "above_ma50": latest.get("above_ma50"),
            "from_52w_high_pct": latest.get("from_52w_high_pct"),
            "change_5d_pct": latest.get("change_5d_pct"),
        },
        flow={
            "direction": flow.get("direction"),
            "slope_5d": flow.get("slope_5d"),
            "score": flow.get("score"),
            "source": source_info.flow,
            "quality": source_info.quality,
            "available": flow.get("available", False),
        },
        tags={
            "board": None,
            "syariah": None,
            "source": "unavailable",
        },
        source=source_info,
        warnings=tuple(warnings),
    )


def _rank(card: FlowCard) -> tuple[int, float, float]:
    direction = str(card.flow.get("direction") or "unavailable")
    rank = {"rising": 2, "flat": 1, "falling": 0}.get(direction, -1)
    score = card.flow.get("score")
    try:
        score_value = float(score) if score is not None else -9.0
    except (TypeError, ValueError):
        score_value = -9.0
    try:
        value = float(card.value_5d_idr or 0.0)
    except (TypeError, ValueError):
        value = 0.0
    return rank, score_value, value


def cards(
    universe: str = "watchlist",
    tickers: list[str] | str | None = None,
    limit: int = DEFAULT_LIMIT,
    source: str = "auto",
    days: int = 120,
    refresh: bool = False,
) -> dict[str, Any]:
    """Build the Flow cards for a bounded universe, cached in SQLite.

    The key includes the resolved codes, so a change to the watchlist or the
    plan does not serve a stale membership list. `refresh=True` bypasses the
    cache for an explicit reload.
    """
    chosen_source = source if source in {"auto", "idx", "stockbit", "ohlcv"} else "auto"
    window = max(30, min(250, int(days or 120)))
    codes, names, label, base_warnings = resolve_universe(universe, tickers, limit)
    if not codes:
        return {
            "available": False,
            "universe": label,
            "as_of": datetime.now(JAKARTA).date().isoformat(),
            "count": 0,
            "cards": [],
            "source": {"quality": "unavailable", "flow": "none"},
            "warnings": base_warnings or ["no names to screen"],
            "parameters": _parameters(),
            "cache": {
                "hit": False,
                "fresh": False,
                "age_seconds": 0,
                "saved_at": None,
                "ttl_seconds": 0,
                "cache_key": None,
                "warning": None,
            },
        }

    key = flow_cache.make_key(
        "cards",
        label,
        chosen_source,
        window,
        ",".join(codes),
    )

    def compute() -> dict[str, Any]:
        warnings = list(base_warnings)
        foreign_values: dict[str, float] = {}
        foreign_meta: dict[str, Any] = {"available": False}
        if chosen_source != "ohlcv":
            foreign_values, foreign_meta = sources.foreign_map()
        if chosen_source == "stockbit":
            warnings.append(
                "Stockbit broker history is detail-only; cards use the free IDX/CMF proxy"
            )

        built: list[FlowCard] = []
        failed: list[str] = []
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(
                    build_card,
                    code,
                    name=names.get(code),
                    foreign_value=foreign_values.get(code),
                    foreign_as_of=foreign_meta.get("as_of"),
                    source=chosen_source,
                ): code
                for code in codes
            }
            for future in as_completed(futures):
                code = futures[future]
                try:
                    card = future.result()
                except Exception as exc:  # noqa: BLE001
                    log.warning("flow card %s failed: %s", code, exc)
                    failed.append(code)
                    continue
                if card is None:
                    failed.append(code)
                    continue
                built.append(card)

        built.sort(key=_rank, reverse=True)
        if failed:
            warnings.append(f"{len(failed)} name(s) skipped: {', '.join(failed[:8])}")
        if not foreign_values:
            warnings.append(
                "IDX foreign flow unavailable; cards fall back to OHLCV + CMF"
            )

        quality = "proxy" if built else "unavailable"
        as_of = max(
            (card.as_of for card in built),
            default=datetime.now(JAKARTA).date().isoformat(),
        )
        foreign_fresh = bool(foreign_values) and sources.foreign_is_fresh(
            foreign_meta, pd.to_datetime(as_of).date()
        )
        if foreign_values and not foreign_fresh:
            warnings.append(
                "IDX foreign flow is stale; the cards use OHLCV + CMF"
            )
        return {
            "available": bool(built),
            "universe": label,
            "as_of": as_of,
            "count": len(built),
            "cards": [card.as_dict() for card in built],
            "source": {
                "bars": "yfinance",
                "flow": ("mixed_free_proxy" if foreign_fresh else "ohlcv+cmf"),
                "quality": quality,
                "foreign_available": foreign_fresh,
                "foreign_as_of": foreign_meta.get("as_of"),
                "foreign_stale": bool(foreign_values) and not foreign_fresh,
            },
            "warnings": warnings,
            "parameters": _parameters(),
        }

    payload, meta = flow_cache.get_or_compute(
        key,
        compute,
        ttl=flow_cache.DEFAULT_TTL,
        refresh=refresh,
    )
    payload["cache"] = meta.as_dict()
    if meta.warning:
        payload.setdefault("warnings", []).append(meta.warning)
    return payload


def _parameters() -> dict[str, Any]:
    return {
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
