"""The paper book: the track record of following the plan's own signals.

Nobody plays this book. Each weekly sync turns the plan's candidates into
pending orders, and settlement fills them at the next session's open through
the same cost model the tickets quote. Every session since the watermark is
walked in order, so a stop breached on Wednesday is settled at Wednesday's
price rather than Saturday's — the difference between a track record and a
comfortable story.

State lives beside the bars in `market.db` (`paper_book`, `paper_orders`,
`paper_fills`), one transaction per session, guarded by `settled_through` so a
retried sync is a no-op instead of a second exit.
"""

from __future__ import annotations

import contextlib
import logging
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pandas as pd

from app import config, market_store
from app.costs import LOT, buy_cash, sell_cash

log = logging.getLogger(__name__)

BENCHMARK = "^JKSE"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS paper_book (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    capital         REAL NOT NULL,
    cash            REAL NOT NULL,
    started         TEXT NOT NULL,
    settled_through TEXT
);

CREATE TABLE IF NOT EXISTS paper_orders (
    id             TEXT PRIMARY KEY,
    ticker         TEXT NOT NULL,
    signal_session TEXT NOT NULL,
    fill_after     TEXT NOT NULL,
    shares         INTEGER NOT NULL,
    stop           REAL,
    target         REAL,
    hold_bars      INTEGER,
    status         TEXT NOT NULL,
    note           TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS paper_fills (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   TEXT NOT NULL,
    ticker     TEXT NOT NULL,
    side       TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    price      REAL NOT NULL,
    shares     INTEGER NOT NULL,
    cash_delta REAL NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    UNIQUE (order_id, side)
);

CREATE INDEX IF NOT EXISTS paper_fills_date ON paper_fills(trade_date);
"""


class PaperStoreError(RuntimeError):
    """The paper tables could not be read or written."""


class NoBars(RuntimeError):
    """The bar store is empty, so there is no session to settle against."""


class NotSettled(RuntimeError):
    """The watermark is past the newest bar: a rollback or a replaced store."""


class NoSizing(ValueError):
    """A candidate cleared its gates but carried no share count."""


@dataclass(frozen=True)
class Order:
    id: str
    ticker: str
    signal_session: str
    fill_after: str
    shares: int
    stop: float | None
    target: float | None
    hold_bars: int | None
    status: str
    note: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "ticker": self.ticker,
            "signal_session": self.signal_session,
            "fill_after": self.fill_after,
            "shares": self.shares,
            "stop": self.stop,
            "target": self.target,
            "hold_bars": self.hold_bars,
            "status": self.status,
            "note": self.note,
        }


@dataclass(frozen=True)
class Position:
    order_id: str
    ticker: str
    shares: int
    entry_date: str
    entry_price: float
    stop: float | None
    target: float | None
    hold_bars: int | None


# ── store ────────────────────────────────────────────────────────────────────


def _connect(db_path: Any = None) -> sqlite3.Connection:
    """A market.db connection with the paper tables present.

    Reuses `market_store._connect` for WAL, the busy timeout and the row
    factory; one database, one set of pragmas, two owners.
    """
    conn = market_store._connect(db_path)
    try:
        conn.executescript(_SCHEMA)
    except sqlite3.Error as exc:
        conn.close()
        raise PaperStoreError(f"paper schema: {exc}") from exc
    return conn


@contextlib.contextmanager
def _closed(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield conn
    finally:
        conn.close()


def _book_row(conn: sqlite3.Connection) -> sqlite3.Row | None:
    try:
        return conn.execute(
            "SELECT capital, cash, started, settled_through FROM paper_book WHERE id = 1"
        ).fetchone()
    except sqlite3.Error as exc:
        raise PaperStoreError(f"book read: {exc}") from exc


def book(db_path: Any = None) -> dict[str, Any] | None:
    """The book's own numbers, or None before it is opened."""
    with _closed(_connect(db_path)) as conn:
        row = _book_row(conn)
    return dict(row) if row else None


def open_book(
    capital: float | None = None,
    *,
    started: str | None = None,
    db_path: Any = None,
) -> dict[str, Any]:
    """Open the book at `started` (default: the newest bar's session).

    `settled_through` starts at the same session, so settlement begins with the
    next bar rather than replaying five years of nothing.
    """
    start = started or _newest_session(db_path)
    capital = float(config.PAPER_CAPITAL_IDR if capital is None else capital)
    with _closed(_connect(db_path)) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO paper_book (id, capital, cash, started, settled_through)"
            " VALUES (1, ?, ?, ?, ?)",
            (capital, capital, start, start),
        )
        conn.commit()
        row = _book_row(conn)
    if row is None:  # pragma: no cover - INSERT OR IGNORE cannot leave it empty
        raise PaperStoreError("book could not be opened")
    return dict(row)


def reset(db_path: Any = None) -> None:
    """Forget the book, its orders and its fills. The bars are untouched."""
    with _closed(_connect(db_path)) as conn:
        for table in ("paper_fills", "paper_orders", "paper_book"):
            conn.execute(f"DELETE FROM {table}")
        conn.commit()


# ── orders ───────────────────────────────────────────────────────────────────


def _existing_tickers(conn: sqlite3.Connection) -> set[str]:
    try:
        rows = conn.execute("SELECT DISTINCT ticker FROM paper_orders").fetchall()
    except sqlite3.Error as exc:
        raise PaperStoreError(f"orders read: {exc}") from exc
    return {str(r[0]) for r in rows}


def _positions(conn: sqlite3.Connection) -> list[Position]:
    """Filled orders with no sell against them, oldest first."""
    try:
        rows = conn.execute(
            """
            SELECT o.id, o.ticker, o.shares, f.trade_date, f.price, o.stop, o.target, o.hold_bars
            FROM paper_orders o
            JOIN paper_fills f ON f.order_id = o.id AND f.side = 'BUY'
            LEFT JOIN paper_fills s ON s.order_id = o.id AND s.side = 'SELL'
            WHERE s.id IS NULL
            ORDER BY f.trade_date, o.ticker
            """
        ).fetchall()
    except sqlite3.Error as exc:
        raise PaperStoreError(f"positions read: {exc}") from exc
    return [
        Position(
            order_id=str(r[0]),
            ticker=str(r[1]),
            shares=int(r[2]),
            entry_date=str(r[3]),
            entry_price=float(r[4]),
            stop=None if r[5] is None else float(r[5]),
            target=None if r[6] is None else float(r[6]),
            hold_bars=None if r[7] is None else int(r[7]),
        )
        for r in rows
    ]


def orders_from_plan(
    payload: dict[str, Any] | None = None,
    *,
    db_path: Any = None,
) -> dict[str, Any]:
    """Turn tonight's candidates into orders for the next session.

    Only an ENTER plan creates orders: WAIT and NO_TRADE are answers, and a book
    that trades them is not a track record of the method. A ticker is ordered
    at most once for the life of the book.
    """
    if payload is None:
        from app import plan as planner

        payload = planner.plan_payload()

    verdict = payload.get("verdict") or {}
    state = str(verdict.get("state") or "")
    if not payload.get("open") or state != "ENTER":
        return {
            "created": [],
            "skipped": [{"ticker": None, "reason": f"verdict {state or 'unknown'}"}],
        }

    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    fill_after = str(payload.get("next_session") or "")
    signal_session = str(payload.get("as_of") or "")
    if not fill_after:
        return {"created": [], "skipped": [{"ticker": None, "reason": "no next session"}]}

    with _closed(_connect(db_path)) as conn:
        held = {p.ticker for p in _positions(conn)}
        seen = _existing_tickers(conn)
        slots = config.PAPER_MAX_POSITIONS - len(held)
        state_row = _book_row(conn)
        if state_row is None:
            return {"created": [], "skipped": [{"ticker": None, "reason": "no book"}]}
        cash = float(state_row["cash"])
        # shortcut: heat is measured against the opening capital, not marked-to-
        # market equity — stable across runs, and conservative while the book is
        # underwater. Move to equity once the book has a closed-trade history.
        equity = float(state_row["capital"])

        for candidate in payload.get("candidates") or []:
            if slots <= 0:
                break
            ticker = str(candidate.get("ticker") or "").upper()
            geometry = candidate.get("geometry") or {}
            if not ticker or ticker in seen:
                continue
            try:
                shares = int(geometry.get("shares") or 0)
                stop = geometry.get("stop_price")
                target = geometry.get("target_price")
            except (TypeError, ValueError) as exc:
                skipped.append({"ticker": ticker, "reason": f"NoSizing ({exc})"})
                continue
            if shares <= 0 or stop is None:
                skipped.append({"ticker": ticker, "reason": "NoSizing"})
                continue
            stop = float(stop)
            # Cap to cash first: heat is a property of the position the book can
            # actually open, not of the size the screen suggested for a larger
            # account.
            shares = _cap_to_cash(shares, cash, float(geometry.get("entry_ref") or 0))
            if shares <= 0:
                skipped.append({"ticker": ticker, "reason": "cash"})
                continue
            heat_idr = shares * max(float(geometry.get("entry_ref") or 0) - stop, 0.0)
            if (heat_idr / equity * 100) > config.PAPER_MAX_HEAT_PCT:
                skipped.append({"ticker": ticker, "reason": "heat"})
                continue
            order = Order(
                id=f"{ticker}-{signal_session}",
                ticker=ticker,
                signal_session=signal_session,
                fill_after=fill_after,
                shares=shares,
                stop=stop,
                target=None if target is None else float(target),
                hold_bars=int(geometry["hold_bars"]) if geometry.get("hold_bars") else None,
                status="pending",
                note="",
            )
            conn.execute(
                "INSERT OR IGNORE INTO paper_orders"
                " (id, ticker, signal_session, fill_after, shares, stop, target, hold_bars, status, note)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    order.id,
                    order.ticker,
                    order.signal_session,
                    order.fill_after,
                    order.shares,
                    order.stop,
                    order.target,
                    order.hold_bars,
                    order.status,
                    order.note,
                ),
            )
            created.append(order.as_dict())
            seen.add(ticker)
            slots -= 1
        conn.commit()

    return {"created": created, "skipped": skipped}


def _cap_to_cash(shares: int, cash: float, price: float) -> int:
    """Cap an order at what the book can pay for, in whole lots."""
    if price <= 0 or cash <= 0:
        return 0
    affordable = LOT * int(cash / (buy_cash(price, LOT) or 1))
    return min(int(shares), affordable)


def _newest_session(db_path: Any = None) -> str:
    frames = market_store.read_bars(db_path=db_path)
    sessions = _session_dates(frames)
    if not sessions:
        raise NoBars("the store has no bars; run the sync before opening the book")
    return sessions[-1]


# ── settlement ───────────────────────────────────────────────────────────────


def _session_dates(frames: dict[str, pd.DataFrame]) -> list[str]:
    """The sessions the book keeps time by: the benchmark's own bar dates."""
    bench = frames.get(BENCHMARK)
    if bench is not None and not bench.empty:
        days = {d.date().isoformat() for d in bench["date"]}
    else:
        days = {d.date().isoformat() for f in frames.values() for d in f["date"]}
    return sorted(days)


def _index(frames: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    for ticker, frame in frames.items():
        if frame is None or frame.empty:
            continue
        keyed = frame.copy()
        keyed["key"] = keyed["date"].dt.date.map(lambda d: d.isoformat())
        out[str(ticker)] = keyed.set_index("key", drop=False)
    return out


def _exit(pos: Position, bar: Any, sessions: list[str], session: str) -> tuple[float | None, str]:
    """Where this bar takes the position out, and why.

    A stop that gaps through is filled at the open, not at the stop: that is
    the price the next order would have been for.
    """
    open_ = float(bar["open"])
    high = float(bar["high"])
    low = float(bar["low"])
    close = float(bar["close"])
    if pos.stop is not None and low <= pos.stop:
        return (min(open_, pos.stop)), "stop"
    if pos.target is not None and high >= pos.target:
        return (max(open_, pos.target)), "target"
    if pos.hold_bars:
        held = sessions.index(session) - sessions.index(pos.entry_date)
        if held >= pos.hold_bars:
            return close, "hold"
    return None, ""


def settle(until: str | None = None, *, db_path: Any = None) -> dict[str, Any]:
    """Walk every session since the watermark and write the fills.

    One transaction per session, so an interrupted run resumes at the last
    settled session rather than re-filling a day it already booked.
    """
    frames = market_store.read_bars(db_path=db_path)
    if not frames:
        raise NoBars("the store has no bars; there is nothing to settle against")
    bars = _index(frames)
    sessions = _session_dates(frames)
    if until:
        sessions = [d for d in sessions if d <= until]

    with _closed(_connect(db_path)) as conn:
        state = _book_row(conn)
        if state is None:
            start = sessions[-1] if sessions else None
            if start is None:
                raise NoBars("the store has no sessions; run the sync")
            conn.execute(
                "INSERT OR IGNORE INTO paper_book (id, capital, cash, started, settled_through)"
                " VALUES (1, ?, ?, ?, ?)",
                (float(config.PAPER_CAPITAL_IDR), float(config.PAPER_CAPITAL_IDR), start, start),
            )
            conn.commit()
            state = _book_row(conn)
        assert state is not None

        watermark = state["settled_through"]
        if watermark and sessions and str(watermark) > sessions[-1]:
            raise NotSettled(
                f"the book is settled through {watermark} but the newest bar is {sessions[-1]}"
            )

        cash = float(state["cash"])
        filled: list[dict[str, Any]] = []
        todo = [d for d in sessions if watermark is None or d > str(watermark)]
        for session in todo:
            for pos in _positions(conn):
                frame = bars.get(pos.ticker)
                if frame is None or session not in frame.index:
                    continue  # halted or not in the store: no price, no fill
                price, note = _exit(pos, frame.loc[session], sessions, session)
                if price is None:
                    continue
                delta = sell_cash(price, pos.shares)
                conn.execute(
                    "INSERT OR IGNORE INTO paper_fills"
                    " (order_id, ticker, side, trade_date, price, shares, cash_delta, note)"
                    " VALUES (?, ?, 'SELL', ?, ?, ?, ?, ?)",
                    (pos.order_id, pos.ticker, session, price, pos.shares, delta, note),
                )
                cash += delta
                filled.append(
                    {
                        "ticker": pos.ticker,
                        "side": "SELL",
                        "date": session,
                        "price": round(price, 2),
                        "shares": pos.shares,
                        "note": note,
                    }
                )

            pending = conn.execute(
                "SELECT id, ticker, shares FROM paper_orders"
                " WHERE status = 'pending' AND fill_after <= ? ORDER BY fill_after, ticker",
                (session,),
            ).fetchall()
            for order_id, ticker, shares in pending:
                frame = bars.get(str(ticker))
                if frame is None or session not in frame.index:
                    continue
                price = float(frame.loc[session]["open"])
                delta = -buy_cash(price, int(shares))
                if cash + delta < 0:
                    conn.execute(
                        "UPDATE paper_orders SET status = 'skipped', note = ? WHERE id = ?",
                        (f"cash {cash:,.0f} < {abs(delta):,.0f}", str(order_id)),
                    )
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO paper_fills"
                    " (order_id, ticker, side, trade_date, price, shares, cash_delta, note)"
                    " VALUES (?, ?, 'BUY', ?, ?, ?, ?, '')",
                    (str(order_id), str(ticker), session, price, int(shares), delta),
                )
                conn.execute(
                    "UPDATE paper_orders SET status = 'filled' WHERE id = ?", (str(order_id),)
                )
                cash += delta
                filled.append(
                    {
                        "ticker": str(ticker),
                        "side": "BUY",
                        "date": session,
                        "price": round(price, 2),
                        "shares": int(shares),
                        "note": "entry",
                    }
                )

            conn.execute(
                "UPDATE paper_book SET cash = ?, settled_through = ? WHERE id = 1",
                (cash, session),
            )
            conn.commit()

    return {
        "state": "settled",
        "sessions": len(todo),
        "settled_through": todo[-1] if todo else (str(watermark) if watermark else None),
        "cash": round(cash, 2),
        "fills": filled,
    }


def step(*, db_path: Any = None) -> dict[str, Any]:
    """One sync's work: open orders from tonight's plan, then settle them."""
    orders = orders_from_plan(db_path=db_path)
    result = settle(db_path=db_path)
    return {"orders": orders, "settle": result}


# ── reporting ────────────────────────────────────────────────────────────────


def _mark(ticker: str, frames: dict[str, pd.DataFrame]) -> tuple[float | None, str | None]:
    frame = frames.get(ticker)
    if frame is None or frame.empty:
        return None, None
    last = frame.iloc[-1]
    return float(last["close"]), last["date"].date().isoformat()


def snapshot(*, db_path: Any = None) -> dict[str, Any]:
    """The whole book, priced at the last close each name actually printed."""
    with _closed(_connect(db_path)) as conn:
        state = _book_row(conn)
        if state is None:
            return {"hasBook": False}
        positions = _positions(conn)
        orders = [
            Order(*[r[i] for i in range(10)]).as_dict()
            for r in conn.execute(
                "SELECT id, ticker, signal_session, fill_after, shares, stop, target,"
                " hold_bars, status, note FROM paper_orders ORDER BY fill_after DESC, ticker"
            ).fetchall()
        ]
        fills = [
            {
                "order_id": str(r[0]),
                "ticker": str(r[1]),
                "side": str(r[2]),
                "date": str(r[3]),
                "price": round(float(r[4]), 2),
                "shares": int(r[5]),
                "cash_delta": round(float(r[6]), 2),
                "note": str(r[7]),
            }
            for r in conn.execute(
                "SELECT order_id, ticker, side, trade_date, price, shares, cash_delta, note"
                " FROM paper_fills ORDER BY trade_date, id"
            ).fetchall()
        ]
        capital = float(state["capital"])
        cash = float(state["cash"])
        started = str(state["started"])
        watermark = state["settled_through"]

    frames = (
        market_store.read_bars(codes=[p.ticker for p in positions], db_path=db_path)
        if positions
        else {}
    )
    open_positions = []
    invested = 0.0
    for pos in positions:
        last, as_of = _mark(pos.ticker, frames)
        price = last if last is not None else pos.entry_price
        value = price * pos.shares
        invested += value
        open_positions.append(
            {
                "ticker": pos.ticker,
                "shares": pos.shares,
                "lots": pos.shares // LOT,
                "entry_date": pos.entry_date,
                "entry_price": round(pos.entry_price, 2),
                "last_price": None if last is None else round(last, 2),
                "priced_as_of": as_of,
                "value_idr": round(value, 2),
                "unrealized_idr": round((price - pos.entry_price) * pos.shares, 2),
                "unrealized_pct": round((price / pos.entry_price - 1) * 100, 2)
                if pos.entry_price
                else None,
                "stop": None if pos.stop is None else round(pos.stop, 2),
                "target": None if pos.target is None else round(pos.target, 2),
                "hold_bars": pos.hold_bars,
                "order_id": pos.order_id,
            }
        )

    closed = []
    for order in orders:
        bought = next(
            (f for f in fills if f["order_id"] == order["id"] and f["side"] == "BUY"), None
        )
        sold = next(
            (f for f in fills if f["order_id"] == order["id"] and f["side"] == "SELL"), None
        )
        if bought is None or sold is None:
            continue
        pnl = bought["cash_delta"] + sold["cash_delta"]
        closed.append(
            {
                "ticker": order["ticker"],
                "entry_date": bought["date"],
                "entry_price": bought["price"],
                "exit_date": sold["date"],
                "exit_price": sold["price"],
                "shares": bought["shares"],
                "pnl_idr": round(pnl, 2),
                "return_pct": round(pnl / abs(bought["cash_delta"]) * 100, 2)
                if bought["cash_delta"]
                else None,
                "reason": sold["note"],
            }
        )

    equity = cash + invested
    wins = [c for c in closed if (c["pnl_idr"] or 0) > 0]
    losses = [c for c in closed if (c["pnl_idr"] or 0) < 0]
    gains = sum(float(c["pnl_idr"] or 0) for c in wins)
    drawn = abs(sum(float(c["pnl_idr"] or 0) for c in losses))

    return {
        "hasBook": True,
        "capital_idr": round(capital, 2),
        "cash_idr": round(cash, 2),
        "invested_idr": round(invested, 2),
        "equity_idr": round(equity, 2),
        "pnl_idr": round(equity - capital, 2),
        "return_pct": round((equity / capital - 1) * 100, 2) if capital else None,
        "started": started,
        "settledThrough": watermark,
        "open_positions": open_positions,
        "closed_trades": list(reversed(closed)),
        "fills": fills,
        "pending_orders": [o for o in orders if o["status"] == "pending"],
        "stats": {
            "closed_count": len(closed),
            "open_count": len(open_positions),
            "win_rate_pct": round(len(wins) / len(closed) * 100, 1) if closed else None,
            "avg_win_idr": round(gains / len(wins), 2) if wins else None,
            "avg_loss_idr": round(-drawn / len(losses), 2) if losses else None,
            "profit_factor": round(gains / drawn, 2) if drawn else None,
            "costs": {
                "buy_fee_pct": 0.15,
                "sell_fee_pct": 0.25,
                "slippage_pct": 0.15,
            },
        },
    }
