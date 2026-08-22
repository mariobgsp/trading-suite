"""Offline smoke tests for the trading-suite backend services.

No network: all tests use synthetic history data so they pass on a
fresh checkout without yfinance/Stockbit access.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _synthetic_history(n: int = 120, start: float = 100.0) -> list[dict]:
    """OHLCV series with realistic pullbacks (so indicators stay defined)."""
    from datetime import date, timedelta

    rows = []
    d = date(2026, 1, 1)
    price = start
    for i in range(n):
        # gentle uptrend with occasional pullback days
        drift = 0.004 if i % 7 != 5 else -0.006
        o = price
        c = price * (1 + drift)
        hi = max(o, c) * 1.01
        lo = min(o, c) * 0.99
        rows.append(
            {
                "date": (d + timedelta(days=i)).isoformat(),
                "open": round(o, 2),
                "high": round(hi, 2),
                "low": round(lo, 2),
                "close": round(c, 2),
                "volume": int(1_000_000 + i * 1000),
            }
        )
        price = c
    return rows


def test_backtest_runs_and_returns_expected_shape():
    from app.backtest import run_backtest

    result = run_backtest(_synthetic_history(), strategy="momentum", initial_capital=10_000_000)
    assert "trades" in result
    assert "equity" in result
    assert "stats" in result
    assert len(result["equity"]) > 0
    assert result["stats"]["total_trades"] >= 0


def test_indicators_bundle_shapes():
    from app.indicators import compute_indicators

    out = compute_indicators(_synthetic_history())
    cols = out["columns"]
    assert "date" in cols
    assert "rsi" in cols
    assert "macd_0" in cols
    assert len(cols["rsi"]) == len(cols["date"])
    assert out["latest"]["rsi"] is not None


def test_screener_single_analysis():
    from app.screener import analyze_single

    res = analyze_single(_synthetic_history(), "TEST")
    assert res["ticker"] == "TEST"
    assert res["action"] in {"STRONG BUY", "BUY", "WAIT", "SELL", "STRONG SELL"}


def test_vault_ma_score_and_signal():
    from app.screener import vault_ma_score, vault_signal

    score = vault_ma_score(_synthetic_history(), "TEST")
    assert 0 <= score["score"] <= 100
    assert score["category"]

    signal = vault_signal(_synthetic_history(), "TEST")
    assert signal["signal"] in {
        "RESET BUY",
        "PULLBACK ZONE",
        "BREAKOUT",
        "OVERBOUGHT",
        "HOLD/EXTENDED",
        "COOLING",
        "OVERSOLD",
    }


def test_validator_analyzes():
    from app.validator import BandarmologyAnalyzer

    analyzer = BandarmologyAnalyzer()
    out = analyzer.analyze(_synthetic_history(90))
    assert out["summary"]["bandar_phase"]["phase"]
    assert out["summary"]["current_intent"]
    assert len(out["radar"]) > 0


def test_validator_score_block():
    from app.validator import BandarmologyAnalyzer

    analyzer = BandarmologyAnalyzer()
    out = analyzer.analyze(_synthetic_history(260))
    score = out["score"]
    assert 0 <= score["composite_score"] <= 100
    assert score["score_label"] in {"EXCELLENT", "GOOD", "NEUTRAL", "WEAK"}
    assert score["bandar_type"] in {"Accumulation", "Distribution", "Balanced"}
    assert score["kapitalisasi"] in {"BIG", "MID", "SMALL", "MICRO"}
    assert 0 <= score["wyckoff_confidence"] <= 100
    assert score["recommendation"] in {"BUY", "HOLD", "AVOID"}
    assert score["two_layer_alignment"] in {"AGREE", "DIVERGE", "N/A"}


def test_beta_correlation_known_shape():
    # Uses market service; monkeypatch-free path would need network — test the
    # internal math directly instead.
    from app.beta import _corr, _log_returns

    a = _log_returns([100, 101, 102, 103, 104])
    b = _log_returns([100, 102, 104, 106, 108])
    c = _corr(a, b)
    assert c is not None
    assert abs(c - 1.0) < 0.05


# ─── Regression tests for fixed bugs ─────────────────────────────────────────


def test_normalize_ticker_never_munges_us_symbols():
    """Regression: AAPL/BTC must not become AAPL.JK/BTC.JK (was H1 blocker)."""
    from app.market import normalize_ticker

    assert normalize_ticker("BBCA") == "BBCA.JK"
    assert normalize_ticker("BBCA.JK") == "BBCA.JK"
    assert normalize_ticker("^JKSE") == "^JKSE"
    assert normalize_ticker("AAPL") == "AAPL"  # US large cap
    assert normalize_ticker("NVDA") == "NVDA"
    assert normalize_ticker("BTC-USD") == "BTC-USD"
    assert normalize_ticker("USDIDR=X") == "USDIDR=X"


def test_fifo_engine_rejects_phantom_sell():
    """Regression: SELL without a matching BUY lot must raise, not book fake P&L."""
    from app.services.fifo_engine import FIFOEngine

    engine = FIFOEngine(live_forex=16300.0)
    hist_forex: dict[str, float] = {}
    # BUY 100 BBCA @ 6000 IDR
    engine.process_entry(
        {
            "action": "BUY",
            "ticker": "BBCA",
            "qty": 100,
            "price": 6000,
            "currency": "IDR",
            "date": "2026-01-01",
        },
        hist_forex,
    )
    # SELL 200 — exceeds the 100-share holding
    try:
        engine.process_entry(
            {
                "action": "SELL",
                "ticker": "BBCA",
                "qty": 200,
                "price": 6100,
                "currency": "IDR",
                "date": "2026-01-02",
            },
            hist_forex,
        )
    except ValueError as exc:
        assert "exceeds holdings" in str(exc)
        # cash must be rolled back: only the BUY debit remains
        assert engine.cash_idr == -6000 * 100
        assert len(engine.realized_trades) == 0
    else:
        raise AssertionError("phantom SELL did not raise")


def test_fifo_engine_partial_sell_then_remaining():
    """Partial SELL within holdings works; oversell of the remainder still raises."""
    from app.services.fifo_engine import FIFOEngine

    engine = FIFOEngine(live_forex=16300.0)
    hist: dict[str, float] = {}
    engine.process_entry(
        {
            "action": "BUY",
            "ticker": "BBRI",
            "qty": 100,
            "price": 5000,
            "currency": "IDR",
            "date": "2026-01-01",
        },
        hist,
    )
    engine.process_entry(
        {
            "action": "SELL",
            "ticker": "BBRI",
            "qty": 40,
            "price": 5100,
            "currency": "IDR",
            "date": "2026-01-02",
        },
        hist,
    )
    assert len(engine.realized_trades) == 1
    # remaining 60 shares still held; selling 61 must raise
    try:
        engine.process_entry(
            {
                "action": "SELL",
                "ticker": "BBRI",
                "qty": 61,
                "price": 5200,
                "currency": "IDR",
                "date": "2026-01-03",
            },
            hist,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("oversell of remainder did not raise")


def test_sentiment_degraded_flag_on_empty_fetch():
    """Regression: an empty (failed) news fetch must NOT be cached, and must
    carry a `degraded` flag instead of silently returning an authoritative
    empty feed (was H4 blocker)."""
    from unittest.mock import patch

    from app import db as cache_db
    from app import sentiment

    cache_db.delete("sentiment:news")  # start clean
    with patch.object(sentiment, "_fetch_google_news", return_value=[]):
        payload = sentiment.fetch_sentiment_news(force=True)

    assert payload["count"] == 0
    assert payload.get("degraded") is True
    # and the cache must not contain the empty payload
    assert cache_db.get("sentiment:news") is None
