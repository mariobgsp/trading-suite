"""Portfolio service: FIFO engine wrapper + JSON persistence.

Wraps the FIFOEngine (app/_fifo.py — extracted from the old trading-simulator)
as a service, with journal/watchlist/pending_orders stored under the
backend data directory instead of the repo root.
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, datetime
from typing import Any

from app import db
from app.config import DATA_DIR
from app.market import fetch_forex, fetch_quote
from app._fifo import FIFOEngine, load_json, save_json

logger = logging.getLogger(__name__)

JOURNAL_PATH = DATA_DIR / "journal.json"
WATCHLIST_PATH = DATA_DIR / "watchlist.json"
PENDING_ORDERS_PATH = DATA_DIR / "pending_orders.json"

# Curated from the NYAHAM vault watchlist (00_hub/NYAHAM Watchlist - IDX Swing Scan.md)
DEFAULT_WATCHLIST = [
    "BBCA",
    "BMRI",
    "ADRO",
    "ADMR",
    "AMMN",
    "ANTM",
    "ASRM",
    "AVIA",
    "BULL",
    "BUMI",
    "ELSA",
    "GTSI",
    "HUMI",
    "INCO",
    "INET",
    "ISAT",
    "MBMA",
    "MEDC",
    "NRCA",
    "PTRO",
    "TPIA",
    "TLKM",
    "ASII",
    "BBRI",
]


def _ensure_files() -> None:
    if not JOURNAL_PATH.exists():
        save_json(JOURNAL_PATH, [])
    if not WATCHLIST_PATH.exists():
        save_json(WATCHLIST_PATH, DEFAULT_WATCHLIST)
    if not PENDING_ORDERS_PATH.exists():
        save_json(PENDING_ORDERS_PATH, [])


def get_journal() -> list[dict[str, Any]]:
    _ensure_files()
    return load_json(JOURNAL_PATH)


def get_watchlist() -> list[str]:
    _ensure_files()
    return load_json(WATCHLIST_PATH)


def get_pending_orders() -> list[dict[str, Any]]:
    _ensure_files()
    return load_json(PENDING_ORDERS_PATH)


def add_journal_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Append a trade to the journal (immutable ledger).

    Validates the entry by dry-running the FIFO engine over the journal
    (including the candidate entry): a phantom SELL (no matching BUY lot)
    is rejected at write time instead of silently booking fake P&L.
    """
    _ensure_files()
    journal = get_journal()
    entry = dict(entry)
    now = datetime.now(UTC)
    entry.setdefault("date", now.isoformat())
    try:
        tx_id = f"tx-{len(journal) + 1}-{int(now.timestamp())}"
    except (OverflowError, ValueError):
        tx_id = f"tx-{len(journal) + 1}"
    entry.setdefault("id", tx_id)

    # Dry-run FIFO validation before persisting
    candidate_journal = [*journal, entry]
    _validate_journal(candidate_journal)

    journal.append(entry)
    save_json(JOURNAL_PATH, journal)
    return entry


def _validate_journal(journal: list[dict[str, Any]]) -> None:
    """Replay the FIFO engine over a journal; raise ValueError on invalid entries."""
    from app.market import fetch_forex  # local import to avoid cycle

    live_forex = fetch_forex() or 16300.0
    engine = FIFOEngine(live_forex=live_forex)
    hist_forex_cache: dict[str, float] = {}
    for entry in journal:
        try:
            engine.process_entry(entry, hist_forex_cache)
        except ValueError:
            raise  # phantom sell / bad entry -> reject
        except (KeyError, TypeError, AttributeError) as exc:
            raise ValueError(f"invalid journal entry: {exc}") from exc


def update_watchlist(tickers: list[str]) -> list[str]:
    _ensure_files()
    cleaned = [t.strip().upper() for t in tickers if t and t.strip()]
    save_json(WATCHLIST_PATH, cleaned)
    return cleaned


def add_pending_order(order: dict[str, Any]) -> dict[str, Any]:
    _ensure_files()
    orders = get_pending_orders()
    order = dict(order)
    order.setdefault("created_at", datetime.now(UTC).isoformat())
    order.setdefault("status", "active")
    orders.append(order)
    save_json(PENDING_ORDERS_PATH, orders)
    return order


def portfolio_state(force_forex: bool = False) -> dict[str, Any]:
    """Recompute the FIFO portfolio from the journal + live forex."""
    journal = get_journal()
    live_forex = fetch_forex(force=force_forex) or 0.0

    engine = FIFOEngine(live_forex=live_forex)
    hist_forex_cache: dict[str, float] = {}
    for entry in journal:
        try:
            engine.process_entry(entry, hist_forex_cache)
        except Exception as exc:  # noqa: BLE001 - one bad entry must not kill the ledger
            logger.warning("journal entry skipped: %s", exc)

    holdings = engine.get_holdings()
    positions = []
    for ticker, lots in holdings.items():
        total_qty = sum(lot["qty"] for lot in lots)
        avg_cost = (
            sum(lot["qty"] * lot["price_idr"] for lot in lots) / total_qty if total_qty else 0
        )
        # Currency: follow what the journal actually recorded per lot
        # (IDR entries are already IDR; USD entries need live forex).
        lot_currencies = {lot.get("currency", "USD") for lot in lots}
        needs_forex = lot_currencies == {"USD"}

        # Mark-to-market: current price from the (cached) market service;
        # falls back to avg cost when upstream is unavailable.
        quote = fetch_quote(ticker)
        last_price = (quote or {}).get("price")
        if last_price is not None:
            price_idr = last_price * (live_forex if needs_forex else 1)
            market_value = price_idr * total_qty
            unrealized = market_value - avg_cost * total_qty
        else:
            market_value = avg_cost * total_qty
            unrealized = 0.0
        positions.append(
            {
                "ticker": ticker,
                "qty": round(total_qty, 4),
                "avg_cost_idr": round(avg_cost, 2),
                "last_price": round(last_price, 2) if last_price is not None else None,
                "market_value_idr": round(market_value, 2) if total_qty else 0,
                "unrealized_pnl_idr": round(unrealized, 2) if total_qty else 0,
                "lots": lots,
            }
        )

    realized_pnl = sum(t["realized_pnl_idr"] for t in engine.realized_trades)
    return {
        "generated_at": db.utcnow_iso(),
        "live_forex_usdidr": live_forex,
        "cash_idr": round(engine.cash_idr, 2),
        "positions": positions,
        "total_market_value_idr": round(sum(p["market_value_idr"] for p in positions), 2),
        "net_worth_idr": round(engine.cash_idr + sum(p["market_value_idr"] for p in positions), 2),
        "realized_pnl_idr": round(realized_pnl, 2),
        "total_trades": len(engine.realized_trades),
        "recent_trades": list(reversed(engine.realized_trades[-10:])),
        "currency": "IDR",
    }


def journal_stats() -> dict[str, Any]:
    """Performance analytics over the trade journal: win rate, profit factor,
    average win/loss, and a monthly P&L series.

    Trades are the realized_trades produced by replaying the FIFO engine over
    the journal — the same accounting `portfolio_state` uses, so analytics and
    the ledger never disagree. An empty journal yields an honest empty result
    rather than zeros dressed up as signals.
    """
    journal = get_journal()
    if not journal:
        return {
            "trade_count": 0,
            "note": "journal is empty — add trades in the Portfolio tool first",
            "win_rate_pct": None,
            "profit_factor": None,
            "avg_win_idr": None,
            "avg_loss_idr": None,
            "total_pnl_idr": 0,
            "monthly": [],
            "by_ticker": [],
            "recent": [],
        }

    live_forex = fetch_forex() or 0.0
    engine = FIFOEngine(live_forex=live_forex)
    hist_forex_cache: dict[str, float] = {}
    for entry in journal:
        try:
            engine.process_entry(entry, hist_forex_cache)
        except Exception as exc:  # noqa: BLE001 - one bad entry must not kill the ledger
            logger.warning("journal entry skipped: %s", exc)

    trades = engine.realized_trades
    wins = [t for t in trades if t.get("pnl_idr", 0) > 0]
    losses = [t for t in trades if t.get("pnl_idr", 0) < 0]
    closed = wins + losses
    total_pnl = sum(t.get("pnl_idr", 0) for t in trades)

    win_rate = (len(wins) / len(closed) * 100) if closed else None
    avg_win = sum(t.get("pnl_idr", 0) for t in wins) / len(wins) if wins else None
    avg_loss = abs(sum(t.get("pnl_idr", 0) for t in losses)) / len(losses) if losses else None
    gross_win = sum(t.get("pnl_idr", 0) for t in wins)
    gross_loss = abs(sum(t.get("pnl_idr", 0) for t in losses))
    try:
        profit_factor = gross_win / gross_loss if gross_loss > 0 else None
        if profit_factor is None and gross_win > 0:
            profit_factor = float("inf")
    except (TypeError, ValueError, ZeroDivisionError):
        profit_factor = None
    # Represent an infinite profit factor (wins, zero losses) as 999.0 for the API.
    pf_display = None
    if profit_factor is not None:
        pf_display = 999.0 if math.isinf(profit_factor) else round(profit_factor, 2)

    # Monthly P&L series (realized only), oldest first.
    monthly_map: dict[str, float] = {}
    for t in trades:
        d = t.get("exit_date") or t.get("date") or ""
        month = str(d)[:7]
        if len(month) == 7:
            try:
                pnl = float(t.get("pnl_idr", 0))
            except (TypeError, ValueError):
                pnl = 0.0
            monthly_map[month] = monthly_map.get(month, 0.0) + pnl
    monthly = [{"month": m, "pnl_idr": round(v, 2)} for m, v in sorted(monthly_map.items())]

    # Per-ticker realized P&L.
    by_ticker_map: dict[str, dict[str, float]] = {}
    for t in trades:
        sym = t.get("ticker") or t.get("symbol") or "?"
        row = by_ticker_map.setdefault(sym, {"pnl_idr": 0.0, "count": 0})
        try:
            pnl = float(t.get("pnl_idr", 0))
        except (TypeError, ValueError):
            pnl = 0.0
        row["pnl_idr"] += pnl
        row["count"] += 1
    by_ticker = [
        {"ticker": k, "pnl_idr": round(v["pnl_idr"], 2), "count": v["count"]}
        for k, v in sorted(by_ticker_map.items(), key=lambda kv: kv[1]["pnl_idr"], reverse=True)
    ]

    return {
        "trade_count": len(trades),
        "closed_count": len(closed),
        "win_rate_pct": round(win_rate, 1) if win_rate is not None else None,
        "profit_factor": pf_display,
        "avg_win_idr": round(avg_win, 2) if avg_win is not None else None,
        "avg_loss_idr": round(avg_loss, 2) if avg_loss is not None else None,
        "total_pnl_idr": round(total_pnl, 2),
        "monthly": monthly,
        "by_ticker": by_ticker,
        "recent": list(reversed(trades[-10:])),
    }
