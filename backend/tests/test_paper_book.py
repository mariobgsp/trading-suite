"""The paper book's settle loop.

Every test drives a temporary market.db through the same functions the sync
calls, because a fake fill here becomes a fake track record there: the exit
price, the watermark and the cash balance are the things a reader will believe.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app import market_store, paper
from app.costs import buy_cash, sell_cash

_INSERT_BARS = (
    "INSERT OR REPLACE INTO bars"
    " (ticker, trade_date, yahoo_symbol, open, high, low, close, adj_close, volume)"
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
)
_INSERT_SNAPSHOT = (
    "INSERT INTO snapshots"
    " (source, generated_at, started_at, finished_at, status, symbols, rows, as_of)"
    " VALUES ('test', ?, ?, ?, 'complete', ?, ?, ?)"
)


def _db(tmp_path: Path, bars: dict[str, list[dict[str, Any]]]) -> Path:
    db = tmp_path / "market.db"
    conn = market_store._connect(db)
    rows = [
        (
            ticker,
            bar["date"],
            market_store.yahoo_symbol(ticker),
            bar["open"],
            bar["high"],
            bar["low"],
            bar["close"],
            bar["close"],
            bar.get("volume", 1_000_000),
        )
        for ticker, spec in bars.items()
        for bar in spec
    ]
    newest = max(bar["date"] for spec in bars.values() for bar in spec)
    snapshot_row = (newest, newest, newest, len(bars), len(rows), newest)
    cur = conn.cursor()
    cur.executemany(_INSERT_BARS, rows)
    cur.execute(_INSERT_SNAPSHOT, snapshot_row)
    conn.commit()
    conn.close()
    return db


def _bench(dates: list[str]) -> list[dict[str, Any]]:
    return [
        {"date": d, "open": 7000.0, "high": 7010.0, "low": 6990.0, "close": 7000.0} for d in dates
    ]


def _payload(
    *,
    state: str = "ENTER",
    next_session: str = "2026-01-05",
    candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "as_of": "2026-01-02",
        "open": state == "ENTER",
        "next_session": next_session,
        "verdict": {"state": state},
        "candidates": candidates
        if candidates is not None
        else [
            {
                "ticker": "AAA",
                "geometry": {
                    "shares": 1000,
                    "entry_ref": 101.0,
                    "stop_price": 95.0,
                    "target_price": 120.0,
                    "hold_bars": 5,
                },
            }
        ],
    }


AAA = [
    {"date": "2026-01-02", "open": 100.0, "high": 102.0, "low": 99.0, "close": 101.0},
    {"date": "2026-01-05", "open": 101.0, "high": 104.0, "low": 100.0, "close": 103.0},
    {"date": "2026-01-06", "open": 90.0, "high": 92.0, "low": 88.0, "close": 89.0},
    {"date": "2026-01-07", "open": 96.0, "high": 121.0, "low": 95.0, "close": 120.0},
]


def test_order_fills_at_the_next_sessions_open(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)
    created = paper.orders_from_plan(_payload(), db_path=db)
    assert [o["ticker"] for o in created["created"]] == ["AAA"]

    result = paper.settle(until="2026-01-05", db_path=db)

    assert result["settled_through"] == "2026-01-05"
    buy = next(f for f in result["fills"] if f["side"] == "BUY")
    assert (buy["date"], buy["price"]) == ("2026-01-05", 101.0)
    assert result["cash"] == pytest.approx(1_000_000 - buy_cash(101.0, 1000), abs=0.01)


def test_a_stop_that_gaps_through_fills_at_the_open(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)
    paper.orders_from_plan(_payload(), db_path=db)
    paper.settle(until="2026-01-05", db_path=db)

    result = paper.settle(until="2026-01-06", db_path=db)

    sell = next(f for f in result["fills"] if f["side"] == "SELL")
    assert (sell["date"], sell["price"], sell["note"]) == ("2026-01-06", 90.0, "stop")


def test_a_target_that_gaps_above_fills_at_the_open(tmp_path):
    bars = [
        {"date": "2026-01-02", "open": 100.0, "high": 102.0, "low": 99.0, "close": 101.0},
        {"date": "2026-01-05", "open": 101.0, "high": 104.0, "low": 100.0, "close": 103.0},
        {"date": "2026-01-06", "open": 125.0, "high": 126.0, "low": 124.0, "close": 125.0},
    ]
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in bars]), "AAA": bars})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)
    paper.orders_from_plan(_payload(), db_path=db)
    paper.settle(until="2026-01-05", db_path=db)

    result = paper.settle(db_path=db)

    sell = next(f for f in result["fills"] if f["side"] == "SELL")
    assert (sell["price"], sell["note"]) == (125.0, "target")


def test_the_hold_horizon_exits_at_the_close(tmp_path):
    bars = [
        {"date": "2026-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        {"date": "2026-01-05", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
        {"date": "2026-01-06", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0},
    ]
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in bars]), "AAA": bars})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)
    candidate = _payload()
    candidate["candidates"][0]["geometry"]["hold_bars"] = 1
    candidate["candidates"][0]["geometry"]["target_price"] = 999.0
    paper.orders_from_plan(candidate, db_path=db)
    paper.settle(until="2026-01-05", db_path=db)

    result = paper.settle(db_path=db)

    sell = next(f for f in result["fills"] if f["side"] == "SELL")
    assert (sell["date"], sell["note"]) == ("2026-01-06", "hold")


def test_settling_twice_writes_nothing_the_second_time(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)
    paper.orders_from_plan(_payload(), db_path=db)
    first = paper.settle(db_path=db)

    second = paper.settle(db_path=db)

    assert first["fills"] and not second["fills"]
    assert second["sessions"] == 0
    assert second["cash"] == first["cash"]


def test_a_watermark_past_the_bars_refuses_to_settle(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(1_000_000, started="2026-03-01", db_path=db)

    with pytest.raises(paper.NotSettled):
        paper.settle(db_path=db)


def test_a_closed_plan_places_no_orders(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)

    created = paper.orders_from_plan(_payload(state="NO_TRADE"), db_path=db)

    assert created["created"] == []
    assert paper.settle(db_path=db)["fills"] == []


def test_an_unsized_candidate_is_skipped_with_a_reason(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)
    payload = _payload(
        candidates=[{"ticker": "AAA", "geometry": {"shares": None, "stop_price": 95.0}}]
    )

    created = paper.orders_from_plan(payload, db_path=db)

    assert created["created"] == []
    assert created["skipped"][0]["reason"] == "NoSizing"


def test_cash_binds_before_the_order_does(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(50_000, started="2026-01-02", db_path=db)
    payload = _payload()
    payload["candidates"][0]["geometry"]["shares"] = 100_000

    created = paper.orders_from_plan(payload, db_path=db)

    assert created["created"][0]["shares"] == 400  # 4 lots of 101,000 fits in 50k
    result = paper.settle(until="2026-01-05", db_path=db)
    assert result["cash"] >= 0


def test_snapshot_prices_the_book_and_reports_the_trade(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})
    paper.open_book(1_000_000, started="2026-01-02", db_path=db)
    paper.orders_from_plan(_payload(), db_path=db)
    paper.settle(db_path=db)

    snap = paper.snapshot(db_path=db)

    assert snap["hasBook"] is True
    assert snap["settledThrough"] == "2026-01-07"
    trade = snap["closed_trades"][0]
    # 01-06 gaps down through the 95 stop, so the stop is the exit that happens
    # first: the later target on 01-07 is never traded.
    assert (trade["ticker"], trade["reason"], trade["exit_price"]) == ("AAA", "stop", 90.0)
    assert snap["stats"]["closed_count"] == 1
    assert snap["open_positions"] == []
    assert snap["equity_idr"] == pytest.approx(snap["cash_idr"], abs=0.01)
    assert snap["pnl_idr"] == pytest.approx(sell_cash(90.0, 1000) - buy_cash(101.0, 1000), abs=1.0)


def test_snapshot_before_the_book_exists(tmp_path):
    db = _db(tmp_path, {"^JKSE": _bench([b["date"] for b in AAA]), "AAA": AAA})

    assert paper.snapshot(db_path=db) == {"hasBook": False}
