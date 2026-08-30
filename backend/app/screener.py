"""Consolidated stock screener service.

Merges three screener implementations from the source repos into one:

- stock-screener/main.py      (UltimateScreener: MA/RSI/MACD/Stoch/OBV
  behavior scoring -> STRONG BUY .. STRONG SELL)
- stock-backtester backend    (StockScanner + MA-squeeze screener with
  liquidity gate and RSI 35-70 window, ~1000-ticker universe)
- bot-trading-simulator       (tri-bucket triage: AVOID / WAIT / TRADE)

The ticker universe comes from bot-trading-simulator/config/tickers.py
(900+ IDX tickers), the single canonical list.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import numpy as np
import pandas as pd

from app.indicators import history_to_frame
from app.market import fetch_history
from config.tickers import get_yf_tickers

# Cached from the canonical 900+ universe
_TICKER_CACHE: dict[str, list[str]] = {}


def get_ticker_universe() -> list[str]:
    """Return the canonical IDX ticker universe (raw codes, no .JK)."""
    if not _TICKER_CACHE:
        try:
            _TICKER_CACHE["universe"] = get_yf_tickers()
        except Exception:  # noqa: BLE001 - fall back to a safe subset
            _TICKER_CACHE["universe"] = [
                "BBCA",
                "BBRI",
                "BMRI",
                "BBNI",
                "TLKM",
                "ASII",
                "ADRO",
                "ANTM",
                "MDKA",
                "MBMA",
                "AMMN",
                "GOTO",
                "INCO",
                "ICBP",
                "UNVR",
                "INDF",
                "KLBF",
                "PGAS",
                "PTBA",
                "SMGR",
            ]
    return _TICKER_CACHE["universe"]


def _safe_float(val: Any) -> float | None:
    try:
        v = float(val)
        return v if not math.isnan(v) else None
    except (TypeError, ValueError):
        return None


def _safe_int(val: Any) -> int | None:
    v = _safe_float(val)
    if v is None:
        return None
    try:
        return int(v)
    except (OverflowError, ValueError):
        return None


def _compute_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Add the indicator columns used by the screener scoring."""
    close = df["Close"]
    high = df["High"]
    low = df["Low"]
    volume = df["Volume"]

    df["MA9"] = close.ewm(span=9, adjust=False).mean()
    df["MA20"] = close.rolling(window=20).mean()
    df["MA50"] = close.rolling(window=50).mean()
    df["MA200"] = close.rolling(window=200).mean()

    ema12 = close.ewm(span=12, adjust=False, min_periods=12).mean()
    ema26 = close.ewm(span=26, adjust=False, min_periods=26).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_Signal"] = df["MACD"].ewm(span=9, adjust=False, min_periods=9).mean()

    delta = close.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = pd.Series(gain / loss).replace([np.inf, -np.inf], 0).fillna(0)
    df["RSI"] = 100 - (100 / (1 + rs))

    low_min = low.rolling(window=14).min()
    high_max = high.rolling(window=14).max()
    denom = pd.Series(high_max - low_min).replace(0, 1e-4)  # pyright: ignore[reportAttributeAccessIssue]
    df["Stoch_K"] = 100 * ((close - low_min) / denom)
    df["Stoch_D"] = df["Stoch_K"].rolling(window=3).mean()

    obv_change = np.where(
        close > close.shift(1),
        volume,
        np.where(close < close.shift(1), -volume, 0),
    )
    df["OBV"] = pd.Series(obv_change, index=df.index).cumsum()

    # Volume context (20-day average volume in IDR shares)
    df["Avg_Volume_20"] = volume.rolling(window=20).mean()

    return df


def analyze_single(
    history: list[dict[str, Any]],
    ticker: str,
    avg_price_idr: float | None = None,
) -> dict[str, Any]:
    """Behavior-scoring analysis for one ticker (stock-screener logic)."""
    df = history_to_frame(history)
    if len(df) < 30:
        return {"ticker": ticker, "error": "not enough data"}
    df = _compute_columns(df)
    curr = df.iloc[-1]
    prev = df.iloc[-2]

    signals: list[str] = []
    score = 0.0

    # MA trend
    trend_status = "SIDEWAYS"
    if curr["Close"] > curr["MA200"]:
        score += 1
        trend_status = "UP > MA200"
    else:
        trend_status = "DOWN < MA200"
        score -= 1

    # MA crosses
    if prev["MA9"] < prev["MA20"] and curr["MA9"] > curr["MA20"]:
        signals.append("MA9 CROSS MA20 (BULL)")
        score += 1.5
    elif prev["MA9"] > prev["MA20"] and curr["MA9"] < curr["MA20"]:
        signals.append("MA9 CROSS MA20 (BEAR)")
        score -= 1.5

    if prev["MA20"] < prev["MA50"] and curr["MA20"] > curr["MA50"]:
        signals.append("MA20 CROSS MA50 (BULL)")
        score += 2.0
    elif prev["MA20"] > prev["MA50"] and curr["MA20"] < curr["MA50"]:
        signals.append("MA20 CROSS MA50 (BEAR)")
        score -= 2.0

    # MACD
    macd_cross = "-"
    if prev["MACD"] < prev["MACD_Signal"] and curr["MACD"] > curr["MACD_Signal"]:
        macd_cross = "GOLDEN CROSS"
        signals.append("MACD BULL")
        score += 2
    elif prev["MACD"] > prev["MACD_Signal"] and curr["MACD"] < curr["MACD_Signal"]:
        macd_cross = "DEATH CROSS"
        signals.append("MACD BEAR")
        score -= 2

    # RSI
    rsi_val = _safe_float(curr["RSI"]) or 50.0
    rsi_desc = f"{rsi_val:.0f}"
    if rsi_val < 30:
        rsi_desc += " (OS)"
        if curr["RSI"] > prev["RSI"]:
            signals.append("RSI REV UP")
            score += 1.5
    elif rsi_val > 70:
        rsi_desc += " (OB)"
        if curr["RSI"] < prev["RSI"]:
            signals.append("RSI REV DOWN")
            score -= 1.5

    # Stochastic
    stoch_desc = "-"
    if (
        curr["Stoch_K"] < 20
        and curr["Stoch_K"] > curr["Stoch_D"]
        and prev["Stoch_K"] < prev["Stoch_D"]
    ):
        stoch_desc = "CROSS UP"
        signals.append("STOCH BULL")
        score += 1
    elif (
        curr["Stoch_K"] > 80
        and curr["Stoch_K"] < curr["Stoch_D"]
        and prev["Stoch_K"] > prev["Stoch_D"]
    ):
        stoch_desc = "CROSS DOWN"
        signals.append("STOCH BEAR")
        score -= 1

    # OBV
    obv_trend = "-"
    if len(df) >= 5:
        if df["OBV"].iloc[-1] > df["OBV"].iloc[-5]:
            obv_trend = "UP"
            score += 0.5
        else:
            obv_trend = "DOWN"
            score -= 0.5

    # Action
    if score >= 3.5:
        action = "STRONG BUY"
    elif score >= 1.5:
        action = "BUY"
    elif score > -1.5:
        action = "WAIT"
    elif score > -3.5:
        action = "SELL"
    else:
        action = "STRONG SELL"

    last_close = _safe_float(curr["Close"]) or 0.0
    prev_close = _safe_float(prev["Close"]) or 0.0
    change_pct = ((last_close - prev_close) / prev_close * 100) if prev_close else 0.0
    avg_vol_20 = _safe_float(curr["Avg_Volume_20"]) or 0.0
    liquidity_idr = avg_price_idr * avg_vol_20 if avg_price_idr else None

    return {
        "ticker": ticker,
        "action": action,
        "score": round(score, 2),
        "signals": signals,
        "trend_status": trend_status,
        "macd_cross": macd_cross,
        "rsi": round(rsi_val, 2),
        "rsi_desc": rsi_desc,
        "stoch": stoch_desc,
        "obv_trend": obv_trend,
        "close": last_close,
        "change_pct": round(change_pct, 2),
        "avg_volume_20": _safe_int(avg_vol_20),
        "liquidity_idr_est": _safe_int(liquidity_idr),
        "ma9": _round_or_none(curr["MA9"]),
        "ma20": _round_or_none(curr["MA20"]),
        "ma50": _round_or_none(curr["MA50"]),
        "ma200": _round_or_none(curr["MA200"]),
    }


def ma_squeeze_score(
    history: list[dict[str, Any]],
    ticker: str,
    avg_price_idr: float | None = None,
) -> dict[str, Any]:
    """MA-squeeze scoring (from stock-backtester api.py:_scan_ma_squeeze).

    Squeeze = tight MA cluster; requires liquidity > 1B IDR and RSI in
    35-70; threshold score >= 45 to flag a candidate.
    """
    df = history_to_frame(history)
    if len(df) < 60:
        return {"ticker": ticker, "eligible": False, "reason": "not enough data"}

    df = _compute_columns(df)
    curr = df.iloc[-1]

    rsi_val = _safe_float(curr["RSI"]) or 50.0
    ma9 = _safe_float(curr["MA9"]) or 0.0
    ma20 = _safe_float(curr["MA20"]) or 0.0
    ma50 = _safe_float(curr["MA50"]) or 0.0
    ma200 = _safe_float(curr["MA200"]) or 0.0
    close = _safe_float(curr["Close"]) or 0.0
    avg_vol = _safe_float(curr["Avg_Volume_20"]) or 0.0

    liquidity = avg_price_idr * avg_vol if avg_price_idr else None
    score = 0.0
    checks: list[str] = []

    if ma9 and ma20 and ma50:
        spread = max(ma9, ma20, ma50) - min(ma9, ma20, ma50)
        squeeze_pct = (spread / close * 100) if close else 999.0
        if squeeze_pct < 2.0:
            score += 40
            checks.append(f"squeeze {squeeze_pct:.1f}%")
        elif squeeze_pct < 4.0:
            score += 20
            checks.append(f"tight {squeeze_pct:.1f}%")

    if ma200 and close > ma200:
        score += 15
        checks.append("above MA200")
    elif ma200 and close < ma200:
        score -= 10
        checks.append("below MA200")

    if 35 <= rsi_val <= 70:
        score += 15
        checks.append(f"RSI {rsi_val:.0f}")
    else:
        score -= 10
        checks.append(f"RSI {rsi_val:.0f} out-of-window")

    if liquidity is not None:
        if liquidity >= 1_000_000_000:
            score += 15
            checks.append("liquid >1B")
        else:
            score -= 20
            checks.append("illiquid")

    eligible = score >= 45
    return {
        "ticker": ticker,
        "eligible": eligible,
        "score": round(score, 1),
        "checks": checks,
        "rsi": round(rsi_val, 2),
        "close": close,
        "squeeze_pct": round((max(ma9, ma20, ma50) - min(ma9, ma20, ma50)) / close * 100, 2)
        if close and ma9 and ma20 and ma50
        else None,
        "liquidity_idr_est": _safe_int(liquidity),
    }


def run_universe_scan(
    tickers: list[str],
    on_ticker: Callable[[dict[str, Any]], None] | None = None,
    max_tickers: int | None = None,
    ma_squeeze: bool = False,
    mode: str = "behavior",
    excluded: set[str] | None = None,
) -> dict[str, Any]:
    """Scan the universe with throttled yfinance calls.

    `on_ticker` is invoked after each ticker completes (SSE progress).
    Returns {"results": [...], "errors": [...], "scanned": n} — failing
    tickers are reported, never silently dropped.
    mode: "behavior" | "squeeze" | "vault" | "stealth" | "bull_div" (vault = NYAHAM MA-positioning, bull_div = price vs RSI bullish divergence)
    """
    if max_tickers:
        tickers = tickers[:max_tickers]
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    # Suspended / special-monitoring names must not be scored — yfinance keeps
    # stale history for them, making them look scannable. Reuse the same IDX
    # Remarks-X signal as /api/intel/suspended; skip their fetch entirely.
    # `excluded` override is for tests (inject a fake suspended set).
    if excluded is not None:
        suspended_set: set[str] = {s.upper() for s in excluded}
    else:
        suspended_set = set()
        try:
            from app.idx import suspended_stocks

            susp = suspended_stocks(force=False)
            suspended_set = {str(r.get("ticker")).upper() for r in susp.get("rows", [])}
        except Exception:  # noqa: BLE001 — filter is best-effort, never break the scan
            suspended_set = set()

    def _scan_one(i: int, ticker: str) -> dict[str, Any]:
        try:
            history = fetch_history(ticker, period="2y", interval="1d")
            if not history:
                raise ValueError("empty history")
            avg_price = _avg_price(history)
            if mode == "vault":
                res = vault_ma_score(history, ticker, avg_price)
            elif ma_squeeze or mode == "squeeze":
                res = ma_squeeze_score(history, ticker, avg_price)
            elif mode == "bull_div":
                res = bull_divergence_scan(history, ticker, avg_price)
            else:
                res = analyze_single(history, ticker, avg_price)
            res["rank"] = i + 1
            return res
        except (
            ValueError,
            ConnectionError,
            TimeoutError,
            KeyError,
            AttributeError,
            IndexError,
        ) as exc:
            return {"ticker": ticker, "error": str(exc)[:120]}

    # Parallel fetch+compute (cache-deduped via fetch_history SWR); results
    # stream per-ticker as each completes so SSE progress still ticks live.
    tickers = [t for t in tickers if t.upper() not in suspended_set]
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(_scan_one, i, t): (i, t) for i, t in enumerate(tickers)}
        for fut in as_completed(futs):
            i, ticker = futs[fut]
            try:
                res = fut.result()
            except Exception as exc:  # noqa: BLE001 — never abort the scan
                res = {"ticker": ticker, "error": str(exc)[:120]}
            if "error" in res:
                failures.append({"ticker": ticker, "error": res["error"]})
            else:
                results.append(res)
            if on_ticker:
                on_ticker({**res, "progress": i + 1, "total": len(tickers)})

    results.sort(key=lambda r: r.get("score", 0), reverse=True)
    return {"results": results, "errors": failures, "scanned": len(results) + len(failures)}


def _avg_price(history: list[dict[str, Any]]) -> float | None:
    """Mean close of recent 20 bars (proxy for average traded price)."""
    closes = [h["close"] for h in history[-20:] if h.get("close")]
    if not closes:
        return None
    try:
        return float(sum(closes) / len(closes))
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _round_or_none(val: Any) -> float | None:
    v = _safe_float(val)
    return round(v, 4) if v is not None else None


# ─── Vault-derived screeners (NYAHAM knowledge base) ─────────────────────────
# Formulas ported from /home/mariobgsp/Project/brain/nyaham/scripts/:
#   ma_screener.py          — MA-positioning score (0-100)
#   _daily_market_brief.py  — swing signal taxonomy
#   bm_flow_screener.py     — intensity / MFI / posture


def vault_ma_score(
    history: list[dict[str, Any]],
    ticker: str,
    avg_price_idr: float | None = None,
) -> dict[str, Any]:
    """Vault MA-positioning screener (exact formula from nyaham scripts).

    score = above_count*25 +10(bull stack) +10(near MA) +10(golden cross)
            -15(far above >20%) -25(death cross)
    NEAR_BAND = 6%, FAR_BAND = 20%.  MA50 is treated as the strongest level.
    """
    df = history_to_frame(history)
    if len(df) < 60:
        return {"ticker": ticker, "error": "not enough data"}
    df = _compute_columns(df)
    curr = df.iloc[-1]
    prev = df.iloc[-2]

    close = _safe_float(curr["Close"]) or 0.0
    ma20 = _safe_float(curr["MA20"])
    ma50 = _safe_float(curr["MA50"])
    ma200 = _safe_float(curr["MA200"])

    m = {"MA20": ma20, "MA50": ma50, "MA200": ma200}
    above_count = sum(1 for v in m.values() if v is not None and close > v)
    score = above_count * 25

    bull_stack = bool(ma20 and ma50 and ma200 and ma20 > ma50 > ma200)
    if bull_stack:
        score += 10

    # near-MA band (6%): within 6% of any MA
    near_ma = any(v is not None and 0 < abs(close - v) / v <= 0.06 for v in m.values())
    if near_ma:
        score += 10

    # golden cross: MA20 crossed above MA50 recently
    if ma20 is not None and ma50 is not None:
        prev20 = _safe_float(prev["MA20"])
        prev50 = _safe_float(prev["MA50"])
        if prev20 is not None and prev50 is not None and prev20 <= prev50 and ma20 > ma50:
            score += 10
        elif prev20 is not None and prev50 is not None and prev20 >= prev50 and ma20 < ma50:
            score -= 25

    # far above (>20% above MA50)
    if ma50 is not None and close > ma50 * 1.20:
        score -= 15

    score = max(0, min(100, score))

    if above_count == 3:
        cat = "ABOVE ALL MA - BEST"
    elif above_count == 2 and ma50 is not None and close > ma50:
        cat = "ABOVE MA - HOLD"
    elif above_count == 1:
        cat = "MIXED"
    elif above_count == 0 and ma20 is not None and close < ma20:
        cat = "BELOW ALL MA - AVOID"
    else:
        cat = "MIXED"

    # T1-AVOID overlay: >200% off 52w low, or near high & far above SMA50
    low_52 = _safe_float(df["Close"].tail(252).min())
    high_52 = _safe_float(df["Close"].tail(252).max())
    overlay = "ok"
    if (
        low_52 is not None
        and low_52 > 0
        and close > low_52 * 3.0
        or (
            high_52 is not None
            and close > high_52 * 0.97
            and ma50 is not None
            and close > ma50 * 1.20
        )
    ):
        overlay = "T1-AVOID"

    return {
        "ticker": ticker,
        "category": cat,
        "score": score,
        "close": round(close, 2),
        "ma20": _round_or_none(ma20),
        "ma50": _round_or_none(ma50),
        "ma200": _round_or_none(ma200),
        "above_count": above_count,
        "bull_stack": bull_stack,
        "near_ma": near_ma,
        "overlay": overlay,
        "up_off_52w_low": round((close / low_52 - 1) * 100, 1)
        if low_52 is not None and low_52 > 0
        else None,
    }


def vault_signal(
    history: list[dict[str, Any]],
    ticker: str,
    buy_zone: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """NYAHAM swing-signal taxonomy (from _daily_market_brief.py signal()).

    RESET BUY (Stoch bull cross + K<=55) -> PULLBACK ZONE (in zone + vol>=1.2x)
    -> BREAKOUT (close>R1, vol>=1.5x) -> OVERBOUGHT (K>=80)
    -> HOLD/EXTENDED (50-80) -> COOLING (25-50) -> OVERSOLD (<25).
    """
    df = history_to_frame(history)
    if len(df) < 30:
        return {"ticker": ticker, "error": "not enough data"}
    df = _compute_columns(df)
    curr = df.iloc[-1]
    prev = df.iloc[-2]

    k = _safe_float(curr["Stoch_K"]) or 50.0
    k_prev = _safe_float(prev["Stoch_K"]) or 50.0
    d = _safe_float(curr["Stoch_D"]) or 50.0
    d_prev = _safe_float(prev["Stoch_D"]) or 50.0
    close = _safe_float(curr["Close"]) or 0.0
    rsi_val = _safe_float(curr["RSI"]) or 50.0

    # volume ratio vs trailing 20-bar average
    vol = _safe_float(curr["Volume"]) or 0.0
    vol_avg = _safe_float(df["Volume"].tail(21).head(20).mean()) or 1.0
    vol_ratio = vol / vol_avg if vol_avg > 0 else 0.0

    # pivots from previous bar (P = (H+L+C)/3, R1 = 2P-L, S1 = 2P-H)
    prev_high = _safe_float(prev["High"]) or 0.0
    prev_low = _safe_float(prev["Low"]) or 0.0
    prev_close = _safe_float(prev["Close"]) or 0.0
    p = (prev_high + prev_low + prev_close) / 3
    r1 = 2 * p - prev_low
    s1 = 2 * p - prev_high

    bull_cross = k_prev <= d_prev and k > d
    in_zone = bool(buy_zone and buy_zone[0] <= close <= buy_zone[1])

    if k >= 80:
        signal = "OVERBOUGHT"
    elif bull_cross and k <= 55:
        signal = "RESET BUY"
    elif in_zone and vol_ratio >= 1.2:
        signal = "PULLBACK ZONE"
    elif close > r1 and vol_ratio >= 1.5:
        signal = "BREAKOUT"
    elif 50 <= k < 80:
        signal = "HOLD/EXTENDED"
    elif 25 <= k < 50:
        signal = "COOLING"
    else:
        signal = "OVERSOLD"

    return {
        "ticker": ticker,
        "signal": signal,
        "stoch_k": round(k, 1),
        "rsi": round(rsi_val, 1),
        "vol_ratio": round(vol_ratio, 2),
        "close": round(close, 2),
        "r1": round(r1, 2),
        "s1": round(s1, 2),
        "pivot": round(p, 2),
        "in_buy_zone": in_zone,
        "bull_cross": bool(bull_cross),
    }


# ─── Bull divergence: price lower low + RSI higher low ──────────────────────
# ponytail: tiny divergence check, no need for full swing engine
def bull_divergence_scan(
    history: list[dict[str, Any]],
    ticker: str,
    avg_price_idr: float | None = None,  # noqa: ARG001 — parity with other scanners
) -> dict[str, Any]:
    """Detect bullish divergence: price makes lower low, RSI makes higher low.

    Uses last 40 bars split 20/20. Divergence when late_price < early_price
    and late_rsi > early_rsi. Score = RSI_gain + price_drop contribution.
    """
    df = history_to_frame(history)
    if len(df) < 40:
        return {"ticker": ticker, "eligible": False, "reason": "not enough data"}
    df = _compute_columns(df)
    # need at least 40 with valid RSI
    window = df.tail(40)
    if window["RSI"].dropna().empty:
        return {"ticker": ticker, "eligible": False, "reason": "no RSI"}
    early = window.iloc[:20]
    late = window.iloc[20:]
    # find lowest close in each half and its RSI
    try:
        e_idx = early["Close"].idxmin()
        l_idx = late["Close"].idxmin()
        e_price = _safe_float(early.loc[e_idx, "Close"]) or 0.0
        l_price = _safe_float(late.loc[l_idx, "Close"]) or 0.0
        e_rsi = _safe_float(early.loc[e_idx, "RSI"]) or 50.0
        l_rsi = _safe_float(late.loc[l_idx, "RSI"]) or 50.0
    except Exception:  # noqa: BLE001
        return {"ticker": ticker, "eligible": False, "reason": "calc failed"}
    price_lower = l_price < e_price * 0.995  # at least 0.5% lower low
    rsi_higher = l_rsi > e_rsi + 1.0  # at least 1 pt higher
    divergence = bool(price_lower and rsi_higher)
    # filter: RSI should be oversold-ish in early low to be meaningful
    oversold_context = e_rsi < 40 and l_rsi < 50
    score = 0.0
    if divergence:
        rsi_gain = l_rsi - e_rsi
        price_drop = (e_price - l_price) / e_price * 100 if e_price else 0
        # weight RSI gain more; price drop adds conviction
        score = rsi_gain * 2 + min(price_drop * 3, 15)
        if oversold_context:
            score += 10
        score = max(0, min(100, score))
    close = _safe_float(df.iloc[-1]["Close"]) or 0.0
    return {
        "ticker": ticker,
        "eligible": divergence and oversold_context if divergence else divergence,
        "divergence": divergence,
        "score": round(score, 1),
        "close": round(close, 2),
        "early_price": round(e_price, 2),
        "late_price": round(l_price, 2),
        "early_rsi": round(e_rsi, 1),
        "late_rsi": round(l_rsi, 1),
        "price_change_pct": round((l_price - e_price) / e_price * 100, 2) if e_price else None,
        "rsi_gain": round(l_rsi - e_rsi, 1),
        "oversold_context": oversold_context,
        "checks": [
            f"price {e_price:.2f}→{l_price:.2f} {'lower low' if price_lower else 'no lower low'}",
            f"RSI {e_rsi:.1f}→{l_rsi:.1f} {'higher low' if rsi_higher else 'no higher low'}",
            "oversold context" if oversold_context else "not oversold",
        ],
    }
