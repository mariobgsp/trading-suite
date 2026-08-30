"""Beta / relative-strength service.

Ported from /home/mariobgsp/Project/brain/nyaham/scripts/nyaham_beta_correlation.py.
Computes beta, correlation and relative-strength classification of a ticker
vs the IHSG composite (^JKSE) over 3M / 6M / 1Y windows.
"""

from __future__ import annotations

import math
from typing import Any

from app import db
from app.market import fetch_history

CACHE_TTL = 43200  # 12h — keep local; cache.ttl_for("beta:*") mirrors this


def _log_returns(prices: list[float]) -> list[float]:
    out: list[float] = []
    for i in range(1, len(prices)):
        prev, cur = prices[i - 1], prices[i]
        if prev and cur and prev > 0 and cur > 0:
            out.append(math.log(cur / prev))
    return out


def _corr(a: list[float], b: list[float]) -> float | None:
    if len(a) < 2 or len(a) != len(b):
        return None
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va == 0 or vb == 0:
        return None
    return cov / math.sqrt(va * vb)


def _beta(stock_ret: list[float], idx_ret: list[float], corr: float | None) -> float | None:
    if corr is None or len(stock_ret) < 2 or len(idx_ret) < 2:
        return None
    n = len(idx_ret)
    mi = sum(idx_ret) / n
    var_i = sum((x - mi) ** 2 for x in idx_ret) / n
    if var_i == 0:
        return None
    m = len(stock_ret)
    ms = sum(stock_ret) / m
    cov = sum((s - ms) * (i - mi) for s, i in zip(stock_ret, idx_ret)) / n
    return cov / var_i


def _excess(stock_ret: list[float], idx_ret: list[float]) -> float | None:
    if not stock_ret or not idx_ret:
        return None
    return sum(stock_ret) - sum(idx_ret)


def _to_float(val: Any) -> float | None:
    try:
        v = float(val)
        return v if not math.isnan(v) else None
    except (TypeError, ValueError):
        return None


def beta_correlation(ticker: str, force: bool = False) -> dict[str, Any]:
    """Beta/rho/excess-return vs ^JKSE over 3M/6M/1Y — 12h TTL."""
    cache_key = f"beta:{ticker}"
    if not force:
        cached = db.get_fresh(cache_key, CACHE_TTL)
        if cached is not None:
            return cached
    # ponytail: cache.serve seam available for future SWR here; direct get_fresh/set kept — beta is recomputed not fetched upstream

    idx = fetch_history("^JKSE", period="1y", interval="1d")
    stock = fetch_history(ticker, period="1y", interval="1d")
    if not idx or not stock:
        return {"ticker": ticker, "error": "no data"}

    idx_map: dict[str, float] = {}
    stock_map: dict[str, float] = {}
    for r in idx:
        c = _to_float(r.get("close"))
        if c is not None:
            idx_map[r["date"]] = c
    for r in stock:
        c = _to_float(r.get("close"))
        if c is not None:
            stock_map[r["date"]] = c
    dates = sorted(set(idx_map) & set(stock_map))
    if len(dates) < 60:
        return {"ticker": ticker, "error": "insufficient overlapping history"}

    idx_prices = [idx_map[d] for d in dates]
    stock_prices = [stock_map[d] for d in dates]
    idx_ret = _log_returns(idx_prices)
    stock_ret = _log_returns(stock_prices)

    windows = {"3mo": 63, "6mo": 126, "1y": len(stock_ret)}
    results: dict[str, Any] = {}
    for label, n in windows.items():
        n = max(2, min(n, len(stock_ret)))
        s = stock_ret[-n:]
        i = idx_ret[-n:]
        c = _corr(s, i)
        b = _beta(s, i, c)
        excess = _excess(s, i)
        results[label] = {
            "beta": round(b, 3) if b is not None else None,
            "correlation": round(c, 3) if c is not None else None,
            "excess_return_pct": round(excess * 100, 2) if excess is not None else None,
        }

    # Classification (vault scheme): DEFENSIVE <0.8, MARKET 0.8-1.2, ELEVATED 1.2-1.8, HIGH >1.8
    b1y = results["1y"]["beta"]
    if b1y is None:
        cls, sub = "UNKNOWN", "insufficient data"
    elif b1y > 1.8:
        cls, sub = "HIGH-BETA", "satellite sizing + tight stops"
    elif b1y > 1.2:
        cls, sub = "ELEVATED", "reduce size on weakness"
    elif b1y >= 0.8:
        cls, sub = "MARKET", "normal sizing"
    else:
        cls, sub = "DEFENSIVE", "portable in drawdowns"

    rho1y = results["1y"]["correlation"]
    if rho1y is not None and rho1y < 0.5:
        sub += " · decoupled from index"

    payload = {
        "ticker": ticker,
        "windows": results,
        "classification": cls,
        "note": sub,
        "overlap_bars": len(dates),
    }
    db.set(cache_key, payload)
    return payload
