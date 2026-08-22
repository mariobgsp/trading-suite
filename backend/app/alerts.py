"""D-Signal alert scanner — BidBot-style market-wide technical alerts.

Scans the IDX universe for:
- D-Signal Premium  : oversold (RSI<40) + price above VWAP20 + volume kick
- D-Signal Breakout : close breaks the 20-session high
- Above-MA ladder   : which MA stack (3/5/10/20/50/100) price sits above
- Spike Pagi        : morning volume spike (vol >= 2x vol_ma20, green close)

Histories come from the shared cache (app.market.fetch_history), so repeat
scans are cheap; a cold scan is bounded by `limit`.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pandas as pd

from app.market import fetch_history
from app.screener import get_ticker_universe

logger = logging.getLogger(__name__)


def _to_float(val: Any) -> float | None:
    """Guarded numeric coercion — same contract as validator._safe_float."""
    try:
        out = float(val)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    # Reject NaN/Inf like validator._safe_float — keeps RSI/ladder finite.
    import math

    return out if math.isfinite(out) else None


_MA_WINDOWS = (3, 5, 10, 20, 50, 100)

# ponytail: ThreadPool(8) over cached yfinance history — good enough for a
# 900-ticker scan in a few seconds; raise workers if scans ever feel slow.
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="alerts")


def _rsi(closes: pd.Series, length: int = 14) -> float | None:
    """Classic Wilder RSI on the close series."""
    if len(closes) < length + 1:
        return None
    delta = closes.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / length, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / length, adjust=False).mean()
    loss_last = _to_float(loss.iloc[-1]) or 0.0
    gain_last = _to_float(gain.iloc[-1]) or 0.0
    if loss_last == 0:
        return 100.0  # no losses in window → RSI is fully bullish
    rs = gain_last / loss_last
    return round(100 - 100 / (1 + rs), 1)


def _sma(series: pd.Series, window: int) -> float | None:
    """Last value of a simple moving average, guarded for short series."""
    if len(series) < window:
        return None
    return _to_float(pd.Series(series.rolling(window).mean()).iloc[-1])


def _above_mas(close: float, closes: pd.Series) -> list[int]:
    """Windows whose SMA the last close is above."""
    out: list[int] = []
    for w in _MA_WINDOWS:
        ma = _sma(closes, w)
        if ma is not None and close > ma:
            out.append(w)
    return out


def _ladder(mas: list[int]) -> str:
    """BidBot-style tier label from the above-MA window list."""
    if not mas:
        return "Di bawah semua MA"
    full = [3, 5, 10, 20, 50, 100]
    if mas == full:
        return "Di atas MA3/5/10/20/50/100"
    # Long-term stacks (no short-term requirement), as on BidBot's Alert page.
    if all(w in mas for w in (20, 50, 100)):
        return "Di atas MA20/50/100 (long-term)"
    if all(w in mas for w in (50, 100)):
        return "Di atas MA50/100 (long-term)"
    return "Di atas MA" + "/".join(str(w) for w in mas)


def _scan_one(ticker: str) -> dict[str, Any] | None:
    """Compute D-signal flags for one ticker from cached history."""
    try:
        history = fetch_history(ticker, period="6mo", interval="1d")
    except Exception as exc:  # noqa: BLE001
        logger.warning("alerts: %s history failed: %s", ticker, exc)
        return None
    if not history or len(history) < 30:
        return None

    df = pd.DataFrame(
        {
            "close": [_to_float(h.get("close")) for h in history],
            "high": [_to_float(h.get("high")) for h in history],
            "volume": [_to_float(h.get("volume")) or 0.0 for h in history],
        }
    ).dropna(subset=["close", "high"])
    if len(df) < 30:
        return None

    closes = pd.Series(df["close"])
    volumes = pd.Series(df["volume"])
    highs = pd.Series(df["high"])

    close = _to_float(closes.iloc[-1]) or 0.0
    prev_close = _to_float(closes.iloc[-2]) or 0.0
    change_pct = ((close - prev_close) / prev_close * 100) if prev_close else 0.0

    vol_ma20 = _to_float(pd.Series(volumes.rolling(20).mean()).iloc[-1]) or 0.0
    vwap_den = _to_float(volumes.tail(20).sum()) or 0.0
    vwap = (
        (_to_float(((closes * volumes).tail(20).sum()) / vwap_den) or close) if vwap_den else close
    )

    rsi = _rsi(closes)
    above = _above_mas(close, closes)
    high20 = _to_float(highs.tail(20).max()) or close

    breakout = bool(high20 > 0 and close >= high20 * 0.999)
    last_vol = _to_float(volumes.iloc[-1]) or 0.0
    premium = bool(
        rsi is not None and rsi < 40 and close > vwap and vol_ma20 > 0 and last_vol > 1.5 * vol_ma20
    )
    spike_pagi = bool(vol_ma20 > 0 and last_vol >= 2 * vol_ma20 and change_pct > 0)

    return {
        "ticker": ticker,
        "price": round(close, 2),
        "change_percent": round(change_pct, 2),
        "rsi": rsi,
        "above_ma": above,
        "ma_ladder": _ladder(above),
        "d_signal": "PREMIUM" if premium else ("BREAKOUT" if breakout else None),
        "spike_pagi": spike_pagi,
    }


def run_alert_scan(limit: int = 300) -> dict[str, Any]:
    """Scan up to `limit` tickers and group the alerts."""
    universe = get_ticker_universe()[:limit]
    results = [r for r in _POOL.map(_scan_one, universe) if r]

    counts = {
        "premium": sum(1 for r in results if r["d_signal"] == "PREMIUM"),
        "breakout": sum(1 for r in results if r["d_signal"] == "BREAKOUT"),
        "spike_pagi": sum(1 for r in results if r["spike_pagi"]),
        "full_ladder": sum(1 for r in results if r["ma_ladder"].startswith("Di atas MA3/")),
    }
    # Interesting-first ordering: signals, then deepest ladder, then % move.
    rank = {None: 2, "BREAKOUT": 1, "PREMIUM": 0}
    results.sort(
        key=lambda r: (
            rank[r["d_signal"]],
            -len(r["above_ma"]),
            abs(r["change_percent"]),
        ),
        reverse=True,
    )
    return {"count": len(results), "counts": counts, "items": results}
