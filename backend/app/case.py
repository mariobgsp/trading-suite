"""One name's invest case: a fundamental pillar and a technical pillar.

The question is "how valid is an investment in this stock?" — asked twice and
answered twice, because owning a good business and buying it at a good moment
are different facts, and this app never blends two evidence tiers.

    fundamental   yfinance company info + the IDX ownership register
    ownership     shares outstanding, controlling holdings, public float, the
                  stake trend between the two latest archived snapshots
    technical     the same Flow card and bars the research panel already reads

Nothing here predicts anything. Each criterion is a measurement against a
written band, and the verdict is a count of the criteria states.

Failure modes are explicit and never faked:

    info unavailable       criteria that need it stay `unknown`
    IDX unavailable        the share block says so; the stake trend is unknown
    history too short      the technical pillar says so instead of guessing

Codes: info_unavailable, ownership_unavailable, no_history, no_bars,
assessment_error, idx_unavailable, no_disclosures, feed_unavailable,
no_headlines.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from app import computed_cache, db, sentiment
from app import idx as idx_service
from app import ownership as ownership_register
from app.flow import sources as flow_sources
from app.flow.cards import build_card

TICKER_RE = re.compile(r"[A-Z]{4}\Z")
INFO_TTL = 6 * 3600
CASE_TTL = 900  # news and KI ride along, so the assembly cannot be a 6h cache
NEWS_DEADLINE = 12.0

# The one place yfinance's company payload is decoded. `debtToEquity` arrives
# in percentage units (45.6 means 0.456x) and is normalised in _ratio().
INFO_FIELDS = (
    "trailingPE",
    "priceToBook",
    "returnOnEquity",
    "profitMargins",
    "debtToEquity",
    "revenueGrowth",
    "sharesOutstanding",
    "impliedSharesOutstanding",
)

Criterion = dict[str, Any]


# ── decoding ────────────────────────────────────────────────────────────────


def _num(value: Any) -> float | None:
    """One decoder for every external number: finite floats only."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _ratio(value: Any) -> float | None:
    """yfinance reports debt/equity in percent units; keep a ratio."""
    number = _num(value)
    if number is None:
        return None
    return number / 100.0 if number > 10 else number


def _pct_text(value: float | None, digits: int = 1) -> str:
    return "—" if value is None else f"{value:.{digits}f}%"


def _idr(value: float | None) -> str:
    if value is None:
        return "—"
    if value >= 1e12:
        return f"Rp {value / 1e12:.2f} T"
    if value >= 1e9:
        return f"Rp {value / 1e9:.1f} M"
    if value >= 1e6:
        return f"Rp {value / 1e6:.1f} Jt"
    return f"Rp {value:,.0f}"


# ── criteria ────────────────────────────────────────────────────────────────


def _criterion(key: str, label: str, display: str, state: str, detail: str) -> Criterion:
    return {"key": key, "label": label, "display": display, "state": state, "detail": detail}


def _graded(
    key: str,
    label: str,
    value: float | None,
    display: str,
    supportive: Callable[[float], bool],
    caution: Callable[[float], bool],
    detail: str,
) -> Criterion:
    if value is None:
        return _criterion(key, label, "—", "unknown", detail)
    if supportive(value):
        state = "supportive"
    elif caution(value):
        state = "caution"
    else:
        state = "against"
    return _criterion(key, label, display, state, detail)


def _flag(
    key: str,
    label: str,
    flag: bool | None,
    yes: str,
    no: str,
    detail: str,
) -> Criterion:
    if flag is None:
        return _criterion(key, label, "—", "unknown", detail)
    return _criterion(key, label, yes if flag else no, "supportive" if flag else "against", detail)


def verdict(criteria: list[Criterion]) -> dict[str, Any]:
    """A count, not a prediction: <3 measured is unknown, 2+ against is weak."""
    counts = {"supportive": 0, "caution": 0, "against": 0, "unknown": 0}
    for criterion in criteria:
        counts[criterion["state"]] = counts.get(criterion["state"], 0) + 1
    measured = len(criteria) - counts["unknown"]
    if measured < 3:
        state = "unknown"
    elif counts["against"] >= 2:
        state = "weak"
    elif counts["supportive"] >= 4 and counts["against"] == 0:
        state = "supportive"
    else:
        state = "mixed"
    return {"state": state, **counts, "measured": measured, "total": len(criteria)}


def _pillar(
    name: str, criteria: list[Criterion], warnings: list[str] | None = None
) -> dict[str, Any]:
    return {
        "name": name,
        "label": name.capitalize(),
        "available": any(c["state"] != "unknown" for c in criteria),
        "verdict": verdict(criteria),
        "criteria": criteria,
        "warnings": list(warnings or []),
    }


def _unavailable_pillar(name: str, warning: str) -> dict[str, Any]:
    return {
        "name": name,
        "label": name.capitalize(),
        "available": False,
        "verdict": verdict([]),
        "criteria": [],
        "warnings": [warning],
    }


# ── fundamentals ────────────────────────────────────────────────────────────


def _info(code: str, refresh: bool = False) -> dict[str, Any]:
    """The measured company fields, cached 6h. An empty dict is the failure."""
    key = f"case:info:{code}"
    if not refresh:
        cached = db.get_fresh(key, INFO_TTL)
        if isinstance(cached, dict) and cached:
            return cached
    try:
        import yfinance as yf  # local import: the module stays usable without it

        raw = yf.Ticker(f"{code}.JK").info
        if not isinstance(raw, dict) or not raw:
            raise ValueError("empty company info")
        info: dict[str, Any] = {field: _num(raw.get(field)) for field in INFO_FIELDS}
        info["name"] = raw.get("longName") or raw.get("shortName") or ""
        db.set(key, info)
        return info
    except Exception:  # noqa: BLE001 - a dead quote source must not 500 the page
        stale = db.get(key)
        return stale if isinstance(stale, dict) else {}


def _fundamental_pillar(info: dict[str, Any], structure: dict[str, Any]) -> dict[str, Any]:
    pe = _num(info.get("trailingPE"))
    pb = _num(info.get("priceToBook"))
    roe = _num(info.get("returnOnEquity"))
    margin = _num(info.get("profitMargins"))
    leverage = _ratio(info.get("debtToEquity"))
    growth = _num(info.get("revenueGrowth"))

    criteria = [
        _graded(
            "pe",
            "P/E",
            pe,
            "—" if pe is None else f"{pe:.1f}×",
            lambda v: 0 < v <= 20,
            lambda v: 0 < v <= 35,
            "trailing P/E; supportive at 20× or below, caution to 35×, negative earnings against",
        ),
        _graded(
            "pb",
            "P/B",
            pb,
            "—" if pb is None else f"{pb:.2f}×",
            lambda v: 0 < v <= 3,
            lambda v: 0 < v <= 6,
            "price to book; supportive at 3× or below, caution to 6×",
        ),
        _graded(
            "roe",
            "ROE",
            roe,
            _pct_text(None if roe is None else roe * 100),
            lambda v: v >= 0.15,
            lambda v: v >= 0.05,
            "return on equity; supportive at 15% or above, caution to 5%",
        ),
        _graded(
            "margin",
            "Net margin",
            margin,
            _pct_text(None if margin is None else margin * 100),
            lambda v: v >= 0.10,
            lambda v: v >= 0.0,
            "profit margin; supportive at 10% or above, any loss against",
        ),
        _graded(
            "leverage",
            "Debt/equity",
            leverage,
            "—" if leverage is None else f"{leverage:.2f}×",
            lambda v: v >= 0 and v <= 0.5,
            lambda v: v >= 0 and v <= 1.5,
            "debt to equity; supportive at 0.5× or below, caution to 1.5×",
        ),
        _graded(
            "growth",
            "Revenue growth",
            growth,
            _pct_text(None if growth is None else growth * 100),
            lambda v: v >= 0.10,
            lambda v: v >= 0.0,
            "year-on-year revenue growth; supportive at 10% or above, shrinking against",
        ),
    ]

    trend = str(structure.get("trend") or "unknown")
    delta = _num(structure.get("delta_pp"))
    trend_state = {"rising": "supportive", "flat": "caution", "falling": "against"}.get(
        trend, "unknown"
    )
    trend_display = trend if trend != "unknown" else "—"
    if delta is not None:
        trend_display += f" {delta:+.2f} pp"
    criteria.append(
        _criterion(
            "stake_trend",
            "Owner stake",
            trend_display,
            trend_state,
            str(structure.get("trend_detail") or "No two ownership snapshots to compare yet."),
        )
    )

    warnings: list[str] = []
    if not info:
        warnings.append(
            "yfinance did not return company info; the criteria that need it stay unknown."
        )
    if not structure.get("available"):
        warnings.append("The ownership register did not answer; the stake trend is unknown.")
    return _pillar("fundamental", criteria, warnings)


# ── ownership ───────────────────────────────────────────────────────────────


def _ownership_raw(code: str, refresh: bool = False) -> dict[str, Any]:
    """Both IDX reads, kept together so one failure cannot take the other down."""
    try:
        structure = ownership_register.ownership_structure(code, refresh)
    except Exception as exc:  # noqa: BLE001 - the register is a boundary
        structure = {"available": False, "error": str(exc)[:200]}
    try:
        history = ownership_register.ownership_history(code)
    except Exception:  # noqa: BLE001
        history = {"available": False, "snapshots": [], "changes": None}
    return {"structure": structure, "history": history}


def _controlling_pct(holders: list[dict[str, Any]]) -> float | None:
    """Sum the published percentage of the controlling holders."""
    values = [
        _num(holder.get("percent"))
        for holder in holders
        if isinstance(holder, dict) and holder.get("controlling")
    ]
    known = [value for value in values if value is not None and value >= 0]
    return round(sum(known), 2) if known else None


def _empty_structure(warnings: list[str]) -> dict[str, Any]:
    return {
        "available": False,
        "shares_outstanding": None,
        "total_source": None,
        "owner_shares": None,
        "owner_pct": None,
        "public_shares": None,
        "public_pct": None,
        "trend": "unknown",
        "delta_pp": None,
        "from_date": None,
        "to_date": None,
        "holders_entered": None,
        "holders_exited": None,
        "snapshots": 0,
        "trend_detail": "",
        "warnings": warnings,
    }


def _share_structure(raw: dict[str, Any], info: dict[str, Any]) -> dict[str, Any]:
    """Shares outstanding, owner-held, public float and the stake trend."""
    registered = raw.get("structure") or {}
    if not registered.get("available"):
        reason = str(registered.get("error") or "unknown error")[:160]
        structure = _empty_structure([f"IDX ownership did not answer: {reason}"])
        total = _num(info.get("sharesOutstanding")) or _num(info.get("impliedSharesOutstanding"))
        if total is not None:
            # The register is down but the share count is still knowable.
            structure["shares_outstanding"] = total
            structure["total_source"] = "yfinance"
        return structure

    warnings: list[str] = []
    holders = [
        h for h in registered.get("shareholders") or [] if isinstance(h, dict) and h.get("name")
    ]
    controlling = [h for h in holders if h.get("controlling")]

    total = _num(info.get("sharesOutstanding")) or _num(info.get("impliedSharesOutstanding"))
    total_source = "yfinance" if total is not None else None
    if total is None:
        # A published holder stake is enough to reconstruct the share count.
        for holder in sorted(holders, key=lambda h: _num(h.get("shares")) or 0.0, reverse=True):
            shares = _num(holder.get("shares"))
            percent = _num(holder.get("percent"))
            if shares and percent and percent > 0:
                total = round(shares / (percent / 100.0))
                total_source = f"derived from {holder.get('name')}"
                break

    pcts = [_num(h.get("percent")) for h in controlling]
    known_pcts = [p for p in pcts if p is not None and p >= 0]
    owner_pct = round(min(100.0, max(0.0, sum(known_pcts))), 2) if known_pcts else None
    if len(known_pcts) != len(pcts):
        warnings.append("some controlling holders have no published percentage.")
    if not controlling:
        warnings.append("IDX lists no controlling shareholder, so the owner stake is unavailable.")
    elif owner_pct is None:
        warnings.append("the controlling percentage was not published.")

    owner_shares = (
        round(owner_pct / 100.0 * total) if owner_pct is not None and total is not None else None
    )
    public_pct = round(100.0 - owner_pct, 2) if owner_pct is not None else None
    public_shares = total - owner_shares if total is not None and owner_shares is not None else None
    if total is None:
        warnings.append("shares outstanding was not published; percentages only.")

    trend = "unknown"
    delta: float | None = None
    from_date = to_date = None
    entered = exited = None
    detail = ""

    history = raw.get("history") or {}
    snapshots = [s for s in history.get("snapshots") or [] if isinstance(s, dict)]
    if len(snapshots) >= 2:
        before, after = snapshots[-2], snapshots[-1]
        before_pct = _controlling_pct(before.get("holders") or [])
        after_pct = _controlling_pct(after.get("holders") or [])
        from_date, to_date = before.get("date"), after.get("date")
        if before_pct is not None and after_pct is not None:
            delta = round(after_pct - before_pct, 2)
            if delta > 0.05:
                trend = "rising"
            elif delta < -0.05:
                trend = "falling"
            else:
                trend = "flat"
            changes = history.get("changes") or {}
            entered = len(changes.get("entered") or [])
            exited = len(changes.get("exited") or [])
            detail = (
                f"controlling stake {before_pct:.2f}% → {after_pct:.2f}% between "
                f"{from_date} and {to_date}; {entered} holder(s) entered, {exited} exited"
            )
        else:
            warnings.append("the archived snapshots carry no controlling percentage.")
    elif not history.get("available"):
        warnings.append("the ownership archive could not be read; the trend is unknown.")
    elif len(snapshots) == 1:
        warnings.append("one ownership snapshot so far; the trend needs a second visit.")
    else:
        warnings.append("no ownership snapshots yet; the first visit starts the archive.")

    return {
        "available": True,
        "shares_outstanding": total,
        "total_source": total_source,
        "owner_shares": owner_shares,
        "owner_pct": owner_pct,
        "public_shares": public_shares,
        "public_pct": public_pct,
        "trend": trend,
        "delta_pp": delta,
        "from_date": from_date,
        "to_date": to_date,
        "holders_entered": entered,
        "holders_exited": exited,
        "snapshots": len(snapshots),
        "trend_detail": detail,
        "warnings": warnings,
    }


# ── technicals ──────────────────────────────────────────────────────────────


def _technical_pillar(code: str) -> dict[str, Any]:
    try:
        card = build_card(code)
    except Exception as exc:  # noqa: BLE001 - bars are a boundary
        return _unavailable_pillar("technical", f"price history could not be read: {exc}"[:200])
    if card is None:
        return _unavailable_pillar("technical", "not enough price history for a technical read.")

    technicals = card.technicals or {}
    flow = card.flow or {}
    price = _num(card.price)
    value_5d = _num(card.value_5d_idr)
    from_high = _num(technicals.get("from_52w_high_pct"))

    ma200 = None
    try:
        frame = flow_sources.bars(code)
        if frame is not None and len(frame) >= 200:
            ma200 = _num(frame["Close"].tail(200).mean())
    except Exception:  # noqa: BLE001
        ma200 = None
    trend_distance = (
        round((price / ma200 - 1.0) * 100.0, 1)
        if price is not None and ma200 not in (None, 0)
        else None
    )

    supertrend = technicals.get("supertrend")
    kumo = technicals.get("kumo")
    bulls = int(supertrend == "bull") + int(kumo == "above")
    bears = int(supertrend == "bear") + int(kumo == "below")
    if supertrend is None and kumo is None:
        structure = _criterion(
            "structure",
            "Structure",
            "—",
            "unknown",
            "Supertrend and Ichimoku cloud; neither was measurable.",
        )
    else:
        state = "supportive" if bulls == 2 else "against" if bears == 2 else "caution"
        structure = _criterion(
            "structure",
            "Structure",
            f"{supertrend or '—'} / {kumo or '—'}",
            state,
            "Supertrend and Ichimoku cloud; both agree is supportive, split is caution, both bearish is against",
        )

    rsi = _num(technicals.get("rsi14"))
    momentum = _graded(
        "momentum",
        "RSI 14",
        rsi,
        "—" if rsi is None else f"{rsi:.1f}",
        lambda v: 45 <= v <= 70,
        lambda v: 30 <= v <= 80,
        "Wilder RSI; 45–70 constructive, 30–45 or 70–80 caution, outside that against",
    )

    direction = str(flow.get("direction") or "unavailable")
    flow_state = {"rising": "supportive", "flat": "caution", "falling": "against"}.get(
        direction, "unknown"
    )
    flow_criterion = _criterion(
        "flow",
        "Flow proxy",
        direction,
        flow_state,
        "5-session slope of the transparent pressure proxy; not vendor LPM",
    )

    criteria = [
        _graded(
            "trend_long",
            "200-day trend",
            trend_distance,
            "—" if trend_distance is None else f"{trend_distance:+.1f}% vs MA200",
            lambda v: v >= 0,
            lambda v: v >= -3.0,
            "close against its 200-session average; above is supportive, within 3% below is caution",
        ),
        _flag(
            "trend_mid",
            "50-day trend",
            technicals.get("above_ma50"),
            "above",
            "below",
            "close against its 50-session average",
        ),
        structure,
        momentum,
        flow_criterion,
        _graded(
            "liquidity",
            "Liquidity",
            value_5d,
            _idr(value_5d),
            lambda v: v >= 5e9,
            lambda v: v >= 1e9,
            "five-session traded value; supportive at Rp 5 M or above, caution to Rp 1 M",
        ),
        _graded(
            "drawdown",
            "52-week high",
            from_high,
            "—" if from_high is None else f"{from_high:+.1f}%",
            lambda v: v >= -15,
            lambda v: v >= -30,
            "distance from the 52-week high; within 15% supportive, 30% caution, deeper against",
        ),
    ]

    pillar = _pillar("technical", criteria, list(card.warnings or []))
    pillar["as_of"] = card.as_of
    return pillar


# ── assembly ────────────────────────────────────────────────────────────────


def _disclosures(code: str, refresh: bool = False) -> dict[str, Any]:
    """Official IDX disclosures (KI) for the issuer, newest first."""
    try:
        feed = idx_service.announcements(limit=12, force=refresh, ticker=code, days=365)
    except Exception as exc:  # noqa: BLE001 - IDX is a boundary
        return {
            "available": False,
            "items": [],
            "warnings": [f"IDX KI did not answer: {str(exc)[:160]}"],
        }
    items = feed.get("items") or []
    if not items:
        error = feed.get("error")
        if error:
            reason = f"IDX KI did not answer: {str(error)[:160]}"
        else:
            reason = "no disclosures for this issuer in the last year"
        return {"available": False, "items": [], "warnings": [reason]}
    return {
        "available": True,
        "items": [
            {
                "title": str(item.get("title") or ""),
                "category": str(item.get("category") or ""),
                "date": str(item.get("date") or ""),
                "link": item.get("link"),
            }
            for item in items
        ],
        "warnings": [],
    }


def _news(code: str, name: str, refresh: bool = False) -> dict[str, Any]:
    """Headlines that name the issuer, newest first."""
    try:
        feed = sentiment.fetch_ticker_news(code, name, force=refresh)
    except Exception as exc:  # noqa: BLE001 - the feed is a boundary
        return {
            "available": False,
            "items": [],
            "warnings": [f"the news feed did not answer: {str(exc)[:160]}"],
        }
    return {
        "available": bool(feed.get("available")),
        "items": [
            {
                "title": str(item.get("title") or ""),
                "source": str(item.get("source") or ""),
                "date": str(item.get("date") or ""),
                "date_str": str(item.get("date_str") or ""),
                "link": item.get("link") or None,
            }
            for item in feed.get("items") or []
        ],
        "warnings": list(feed.get("warnings") or []),
    }


def _news_with_deadline(code: str, name: str, refresh: bool) -> dict[str, Any]:
    """A feed that names the issuer, or an unavailable feed after 12s.

    The RSS parse has no timeout of its own; a slow Google must not hold the
    whole case open. The worker may finish in the background and warm the
    cache; it is not waited on.
    """
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(_news, code, name, refresh)
    try:
        return future.result(timeout=NEWS_DEADLINE)
    except TimeoutError:
        return {
            "available": False,
            "items": [],
            "warnings": [f"the news feed did not answer within {NEWS_DEADLINE:g}s"],
        }
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _compute(code: str, refresh: bool) -> dict[str, Any]:
    # Independent boundaries; reading them in parallel keeps a cold click near
    # the slowest source instead of the sum of all of them.
    with ThreadPoolExecutor(max_workers=4) as pool:
        info_future = pool.submit(_info, code, refresh)
        ownership_future = pool.submit(_ownership_raw, code, refresh)
        technical_future = pool.submit(_technical_pillar, code)
        disclosures_future = pool.submit(_disclosures, code, refresh)
        info = info_future.result()
        raw_ownership = ownership_future.result()
        disclosures = disclosures_future.result()
        try:
            technical = technical_future.result()
        except Exception as exc:  # noqa: BLE001
            technical = _unavailable_pillar(
                "technical", f"price history could not be read: {exc}"[:200]
            )

    structure = _share_structure(raw_ownership, info)
    fundamental = _fundamental_pillar(info, structure)
    news = _news_with_deadline(code, str(info.get("name") or ""), refresh)

    warnings: list[str] = []
    for block in (fundamental, technical, structure, disclosures, news):
        for warning in block.get("warnings") or []:
            if warning and warning not in warnings:
                warnings.append(warning)

    return {
        "available": bool(fundamental["available"] or technical["available"]),
        "ticker": code,
        "name": str(info.get("name") or ""),
        "as_of": str(technical.get("as_of") or datetime.now(UTC).date().isoformat()),
        "fundamental": fundamental,
        "technical": technical,
        "ownership": structure,
        "disclosures": disclosures,
        "news": news,
        "warnings": warnings,
    }


def assess(ticker: str, refresh: bool = False) -> dict[str, Any]:
    """The invest case for one ticker; cached 15 min, refresh bypasses."""
    code = ticker.upper().strip()
    if not TICKER_RE.fullmatch(code):
        raise ValueError("a ticker is four letters")
    key = computed_cache.make_key("case", "v1", code)
    payload, meta = computed_cache.get_or_compute(
        key, lambda: _compute(code, refresh), CASE_TTL, refresh=refresh
    )
    report = dict(payload)
    report["cache"] = meta.as_dict()
    return report
