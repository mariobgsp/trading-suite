"""The alert feed shaping and the method exit geometry, offline.

No network, no study checkout: the feed test monkeypatches plan_payload with a
synthetic payload; the exit tests use a deterministic OHLCV series.
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _history(path: list[float]) -> list[dict]:
    """Deterministic OHLCV from one close path; open = previous close."""
    rows = []
    day = date(2026, 1, 1)
    for i, close in enumerate(path):
        open_ = path[i - 1] if i > 0 else close
        rows.append(
            {
                "date": (day + timedelta(days=i)).isoformat(),
                "open": round(open_, 2),
                "high": round(close * 1.005, 2),
                "low": round(close * 0.995, 2),
                "close": round(close, 2),
                "volume": 10_000,
            }
        )
    return rows


def _history_rise_then_crash() -> list[dict]:
    """Buy signal on bar 0, flat stretch, a rise past +13%, then a crash.

    ≥30 bars so run_backtest's minimum-history gate stays closed."""
    return _history(
        [100.0]  # signal bar (buyhold buys on bar 0; fill on bar 1's open)
        + [101.0] * 28  # flat: neither the +13% target nor the −35% stop
        + [103.0, 105.0, 108.0, 111.0, 114.0]  # the rise clears the target
        + [100.0, 90.0, 60.0]  # a later crash, after the target exit
        + [60.0] * 3
    )


def _history_flat_then_crash() -> list[dict]:
    """Same shape without the rise: the fill is followed by the −35% crash."""
    return _history([100.0] + [101.0] * 28 + [100.0, 90.0, 60.0] + [60.0] * 3)


def test_method_profile_targets_and_fills_next_open():
    from app.backtest import run_backtest

    result = run_backtest(
        _history_rise_then_crash(), strategy="buyhold", initial_capital=10_000_000.0
    )
    trades = result["trades"]
    assert trades, "the buy signal on bar 0 must fill on bar 1's open"
    first = trades[0]
    # The signal bar's close is filled at the NEXT session's open (study §9)
    assert first["entry_price"] == 100.15  # open 100 + 0.15% slippage
    assert first["trigger"] == "Target"
    # +13% target minus sell-side costs ≈ +12.8%
    assert 12.0 < first["profit_pct"] < 13.5
    assert first["pnl_idr"] > 0


def test_method_profile_stops_and_never_deeper_than_the_stop():
    from app.backtest import run_backtest

    result = run_backtest(
        _history_flat_then_crash(), strategy="buyhold", initial_capital=10_000_000.0
    )
    trades = result["trades"]
    assert trades
    first = trades[0]
    assert first["trigger"] in ("Stop", "Stop (gap)")
    assert -36.0 < first["profit_pct"] < -33.0


def test_lot_rounding_keeps_whole_board_lots():
    from app.backtest import run_backtest

    result = run_backtest(_history_rise_then_crash(), strategy="buyhold", initial_capital=523_456.0)
    trades = result["trades"]
    assert trades, "one lot at ~100 IDR is affordable on this capital"
    assert trades[0]["shares"] % 100 == 0
    assert trades[0]["shares"] > 0


def test_unknown_profile_falls_back_to_method():
    from app.backtest import DEFAULT_EXIT_PROFILE, run_backtest

    result = run_backtest(_history_rise_then_crash(), strategy="buyhold", exit_profile="bogus")
    trades = result["trades"]
    assert trades and trades[0]["trigger"] == "Target"
    assert DEFAULT_EXIT_PROFILE == "method"


def test_legacy_profile_keeps_the_old_engine():
    from app.backtest import run_backtest

    result = run_backtest(_history_flat_then_crash(), strategy="buyhold", exit_profile="legacy")
    trades = result["trades"]
    assert trades
    assert trades[0]["trigger"] in ("Stop Loss", "Trailing Stop")
    assert trades[0]["profit_pct"] < 0


def _payload(candidates: int = 7, state: str = "ENTER") -> dict:
    cands = []
    for i in range(candidates):
        cands.append(
            {
                "ticker": f"T{i}",
                "name": f"Name {i}",
                "close": 100.0,
                "score": 10.0 - i,
                "rs_rating": 90.0 + i,
                "breakout_pct": 1.5,
                "vol20": 1.0,
                "vol20_median": 1.0,
                "geometry": {
                    "entry_ref": 100.0,
                    "target_price": 113.0,
                    "stop_price": 65.0,
                    "target_pct": 13.0,
                    "stop_pct": -35.0,
                    "reward_risk": 0.37,
                    "position_idr": 5_000_000,
                    "shares": 49_900,
                    "lots": 499,
                    "max_loss_idr": 1_750_000,
                    "entry_basis": "open besok",
                },
                "reason": {"entry_session": (date.today() + timedelta(days=1)).isoformat()},
            }
        )
    blockers = [] if state == "ENTER" else [{"label": "breadth 0.18 < 0.60"}]
    return {
        "as_of": (date.today() - timedelta(days=2)).isoformat(),
        "session_label": "Sab 14 Nov",
        "next_session": (date.today() + timedelta(days=1)).isoformat(),
        "next_session_basis": "exchange_calendar",
        "horizon": "tomorrow",
        "headline": "uji",
        "regime": {"band": "trending", "action": "trade", "breadth": 0.62},
        "candidates": cands,
        "watchlist": [{"ticker": f"W{i}"} for i in range(3)],
        "verdict": {"state": state, "blockers": blockers},
        "corrected": {
            "win_rate": 76.32,
            "avg_ret_pct": 1.85,
            "oos_trades": 76,
            "role": "walk_forward_corrected",
        },
    }


def test_feed_caps_the_book_at_five_and_ranks_the_rest_as_watchlist(monkeypatch):
    from app import feed

    monkeypatch.setattr(feed, "plan_payload", lambda: _payload(candidates=7))
    out = feed.build_feed()
    assert out["state"] == "ENTER"
    assert [e["rank"] for e in out["entries"]] == [1, 2, 3, 4, 5]
    assert out["entries"][0]["ticker"] == "T0"
    assert len(out["book_overflow"]) == 2
    assert out["watchlist_count"] == 3
    assert out["entries"][0]["why"]
    assert out["study"]["win_rate"] == 76.32
    assert out["stale"] is False


def test_feed_keeps_no_trade_first_class(monkeypatch):
    from app import feed

    monkeypatch.setattr(feed, "plan_payload", lambda: _payload(candidates=0, state="NO_TRADE"))
    out = feed.build_feed()
    assert out["state"] == "NO_TRADE"
    assert out["entries"] == []
    assert out["no_trade_reasons"] == ["breadth 0.18 < 0.60"]


def test_feed_flags_stale_data(monkeypatch):
    from app import feed

    payload = _payload(candidates=0, state="NO_TRADE")
    payload["as_of"] = (date.today() - timedelta(days=9)).isoformat()
    monkeypatch.setattr(feed, "plan_payload", lambda: payload)
    out = feed.build_feed()
    assert out["stale"] is True
    assert out["data_age_days"] == 9


def test_feed_survives_an_unreadable_date(monkeypatch):
    from app import feed

    payload = _payload(candidates=0, state="NO_TRADE")
    payload["as_of"] = "not-a-date"
    monkeypatch.setattr(feed, "plan_payload", lambda: payload)
    out = feed.build_feed()
    assert out["stale"] is True
