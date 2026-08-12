"""API router: per-page AI summaries via the connected opencode-go model.

`GET /api/summary/{page}` gathers compact live data for the requested page,
asks the connected model (opencode-go / deepseek-v4-flash, the same provider
this repo's agent tooling uses) for a short desk-ready summary, and returns it.
If the model is unreachable or unconfigured, a data-derived template summary is
returned instead so the UI never hard-fails.

Configuration (env):
  OPENCODE_GO_API_KEY   API key for opencode.ai/zen/go (same key as agent auth)
  OPENCODE_GO_BASE_URL  default https://opencode.ai/zen/go/v1
  OPENCODE_GO_MODEL     default deepseek-v4-flash
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, HTTPException

from app import portfolio, regime, screener, sentiment
from app.ai import MODEL, call_model
from app.market import fetch_indices
from app.validator import BandarmologyAnalyzer

router = APIRouter(prefix="/api/summary", tags=["ai-summary"])

API_KEY = os.getenv("OPENCODE_GO_API_KEY", "")

# Default ticker used for ticker-scoped context (validator/regime are the
# pages the user called out explicitly).
DEFAULT_TICKER = os.getenv("SUMMARY_DEFAULT_TICKER", "BBRI")

_PAGES = {
    "launcher": "the app menu / launcher — collective desk overview of all 8 tools",
    "overview": "market overview — IHSG indices, watchlist quotes, market regime",
    "markets": "markets — per-ticker candle history, indicators, momentum",
    "portfolio": "portfolio — FIFO positions, cash, net worth, realized P&L",
    "backtest": "backtest — strategy backtests (momentum / mean-reversion / buy&hold)",
    "screener": "screener — 900+ IDX universe behavior/squeeze/vault scans (SSE stream)",
    "validator": "bandarmology validator — smart-money detector (VWAP phase, inst flow, intent)",
    "sentiment": "sentiment radar — news sentiment by category/tag",
    "regime": "regime & bot — IHSG regime filter gating the entry engines",
}

_PROMPT = """You are the desk analyst for an Indonesian (IDX) trading suite.
Write a concise summary for the page: {page_label}.

Use ONLY the live data below. Keep it 3-5 sentences, factual and decision-
oriented (level, direction, risks, what to watch). No disclaimers, no markdown
headers — plain sentences.

LIVE DATA:
{context}
"""


# ─── Context gatherers (one per page, bounded and cheap) ─────────────────────


def _context_launcher() -> str:
    try:
        indices = fetch_indices()
        reg = regime.regime_snapshot(force=False)
        feed = sentiment.fetch_sentiment_news(force=False)
        pos = sum(1 for i in feed.get("items", []) if i.get("sentiment") == "positive")
        neg = sum(1 for i in feed.get("items", []) if i.get("sentiment") == "negative")
        rows = [
            f"Regime: {reg.get('regime')} (close {reg.get('close')}, ATR {reg.get('atr_value')})",
            "Indices: "
            + ", ".join(
                f"{q.get('symbol')} {q.get('price')} ({q.get('change_percent')}%)"
                for q in indices[:5]
            ),
            f"Sentiment feed: {len(feed.get('items', []))} headlines, {pos} positive / {neg} negative",
        ]
        return "\n".join(rows)
    except Exception as e:  # noqa: BLE001 - summary must never crash
        return f"(live data unavailable: {e})"


def _context_overview() -> str:
    try:
        indices = fetch_indices()
        reg = regime.regime_snapshot(force=False)
        rows = [
            "Indices: "
            + ", ".join(
                f"{q.get('symbol')} {q.get('price')} ({q.get('change_percent')}%)"
                for q in indices[:6]
            ),
            f"Regime: {reg.get('regime')} — close {reg.get('close')}, "
            f"SMA short/long {reg.get('sma_short')}/{reg.get('sma_long')}, "
            f"ATR {reg.get('atr_value')}",
        ]
        return "\n".join(rows)
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


def _context_markets(ticker: str) -> str:
    try:
        from app.market import fetch_quote

        q = fetch_quote(ticker, force=False) or {}
        reg = regime.regime_snapshot(force=False)
        return (
            f"Ticker: {ticker} — last {q.get('price')}, "
            f"change {q.get('change_percent')}%, open {q.get('open')}, "
            f"day range {q.get('day_low')}-{q.get('day_high')}, "
            f"volume {q.get('volume')} "
            f"| Regime: {reg.get('regime')}"
        )
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


def _context_portfolio() -> str:
    try:
        st = portfolio.portfolio_state(force_forex=False)
        pos = st.get("positions", [])
        rows = [
            f"Net worth {st.get('net_worth_idr')} IDR, cash {st.get('cash_idr')} IDR, "
            f"market value {st.get('total_market_value_idr')} IDR, "
            f"realized P&L {st.get('realized_pnl_idr')} IDR, "
            f"{st.get('total_trades')} trades",
            f"Positions ({len(pos)}): "
            + ", ".join(
                f"{p.get('ticker')} {p.get('qty')}sh avg {p.get('avg_cost_idr')} "
                f"uPnL {p.get('unrealized_pnl_idr')}"
                for p in pos[:8]
            ),
        ]
        return "\n".join(rows)
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


def _context_backtest(ticker: str) -> str:
    try:
        from app.backtest import run_backtest
        from app.market import fetch_history

        hist = fetch_history(ticker, period="2y") or []
        res = run_backtest(hist, strategy="momentum")
        st = (res or {}).get("stats", {})
        return (
            f"Ticker {ticker} momentum/2y — total return {st.get('total_return_pct')}%, "
            f"trades {st.get('total_trades')} (win rate {st.get('win_rate')}%), "
            f"max drawdown {st.get('max_drawdown_pct')}%, "
            f"vs buy&hold {st.get('buyhold_return_pct')}%"
        )
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


def _context_screener(ticker: str) -> str:
    try:
        from app.market import fetch_history

        hist = fetch_history(ticker, period="1y") or []
        res = screener.analyze_single(hist, ticker)
        return (
            f"Sample {ticker}: action {res.get('action')}, score {res.get('score')}, "
            f"trend {res.get('trend_status')}, RSI {res.get('rsi')}, "
            f"signals {', '.join((res.get('signals') or [])[:4])}"
        )
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


def _context_validator(ticker: str) -> str:
    try:
        from app.market import fetch_history

        analyzer = BandarmologyAnalyzer()
        hist = fetch_history(ticker, period="6mo") or []
        result = analyzer.analyze(hist)
        if not result:
            return f"(validator data for {ticker} unavailable: no data)"
        summary = result.get("summary") or {}
        if summary.get("error"):
            return f"(validator data for {ticker} unavailable: {summary.get('error')})"
        return (
            f"Ticker {ticker}: bandar phase {summary.get('bandar_phase', {}).get('phase')} "
            f"(VWAP gap {summary.get('bandar_phase', {}).get('gap_pct')}%), "
            f"inst flow {summary.get('inst_flow')}, "
            f"intent {summary.get('current_intent')}, "
            f"conf flow {summary.get('conf_flow_index')}/4, RSI {summary.get('rsi')}, "
            f"close {summary.get('close')} ({summary.get('change_pct')}%)"
        )
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


def _context_sentiment() -> str:
    try:
        feed = sentiment.fetch_sentiment_news(force=False)
        items = feed.get("items", [])
        pos = sum(1 for i in items if i.get("sentiment") == "positive")
        neg = sum(1 for i in items if i.get("sentiment") == "negative")
        neutral = len(items) - pos - neg
        cats = {}
        for i in items:
            cats[i.get("category", "?")] = cats.get(i.get("category", "?"), 0) + 1
        top = sorted(items, key=lambda i: abs(i.get("score", 0)), reverse=True)[:5]
        return (
            f"{len(items)} headlines — {pos} positive / {neg} negative / {neutral} neutral; "
            f"categories: {cats}; "
            f"top: " + "; ".join(f"{i.get('title')[:60]} ({i.get('sentiment')})" for i in top)
        )
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


def _context_regime() -> str:
    try:
        reg = regime.regime_snapshot(force=False)
        hist = regime.regime_history()
        points = hist.get("history", [])
        last5 = points[-5:] if points else []
        return (
            f"Regime: {reg.get('regime')} — close {reg.get('close')}, "
            f"SMA short/long {reg.get('sma_short')}/{reg.get('sma_long')}, "
            f"ATR {reg.get('atr_value')}, Hurst {reg.get('hurst_value')}, "
            f"allowed engines: {', '.join(reg.get('allowed_engines', []))}; "
            f"recent closes: {[p.get('close') for p in last5]}"
        )
    except Exception as e:  # noqa: BLE001
        return f"(live data unavailable: {e})"


_CONTEXT_BUILDERS = {
    "launcher": lambda _t: _context_launcher(),
    "overview": lambda _t: _context_overview(),
    "markets": _context_markets,
    "portfolio": lambda _t: _context_portfolio(),
    "backtest": _context_backtest,
    "screener": _context_screener,
    "validator": _context_validator,
    "sentiment": lambda _t: _context_sentiment(),
    "regime": lambda _t: _context_regime(),
}


# ─── Model call ──────────────────────────────────────────────────────────────


def _call_model(prompt: str) -> str | None:
    """Ask the connected opencode-go model (deepseek-v4-flash)."""
    return call_model(
        "You are the desk analyst for an Indonesian (IDX) trading suite.",
        prompt,
    )


def _fallback_summary(page: str, context: str) -> str:
    """Data-derived summary when the model is unreachable or unconfigured."""
    first_line = context.splitlines()[0] if context.splitlines() else ""
    labels = {
        "launcher": "Desk overview",
        "overview": "Market overview",
        "markets": "Markets",
        "portfolio": "Portfolio",
        "backtest": "Backtest",
        "screener": "Screener",
        "validator": "Validator",
        "sentiment": "Sentiment radar",
        "regime": "Regime",
    }
    return (
        f"{labels.get(page, page)} summary (generated from live data; model offline): {first_line}"
    )


@router.get("/{page}")
async def summary(page: str, ticker: str | None = None) -> dict[str, Any]:
    """Per-page AI summary. `ticker` optionally scopes markets/validator/backtest."""
    if page not in _CONTEXT_BUILDERS:
        raise HTTPException(status_code=404, detail=f"unknown summary page: {page}")
    t = (ticker or DEFAULT_TICKER).upper()
    context = await asyncio.to_thread(_CONTEXT_BUILDERS[page], t)
    prompt = _PROMPT.format(page_label=_PAGES[page], context=context)
    text = await asyncio.to_thread(_call_model, prompt) or _fallback_summary(page, context)
    return {
        "page": page,
        "ticker": t,
        "summary": text,
        "model": MODEL,
        "generated_at": __import__("datetime").datetime.now().isoformat() + "Z",
    }
