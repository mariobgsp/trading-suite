#!/usr/bin/env python3
"""
Serverless Git-Ops Trading Simulator — Cloud Engine
====================================================
Executed by GitHub Actions. Reads journal.json & watchlist.json from `main`,
fetches live market data via yfinance, computes portfolio state with FIFO
capital gains in IDR, checks SL/TP/Trailing-Stop triggers, and publishes
computed JSON artifacts to the `data-cache` orphan branch.

All monetary values are normalised to IDR (Indonesian Rupiah).
"""

import json
import os
import subprocess
import sys
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf

# LPI Calculator integration
try:
    from lpi_calculator import run_lpi_capture
except ImportError:
    run_lpi_capture = None

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent
JOURNAL_PATH = REPO_ROOT / "journal.json"
WATCHLIST_PATH = REPO_ROOT / "watchlist.json"
PENDING_ORDERS_PATH = REPO_ROOT / "pending_orders.json"
OUTPUT_DIR = REPO_ROOT / "output"

FOREX_TICKER = "USDIDR=X"
DEFAULT_USDIDR_RATE = 16300.0  # fallback if yfinance fails

WIB = timezone(timedelta(hours=7))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_json(path: Path) -> list:
    """Load a JSON array from *path*, returning [] on failure."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"[WARN] Could not load {path}: {exc}")
        return []


def save_json(path: Path, data) -> None:
    """Pretty-print *data* as JSON to *path*."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False, default=str)


def fmt_idr(value: float) -> str:
    """Format a number as Rupiah string (Rp 10.000.000)."""
    neg = value < 0
    val = abs(value)
    formatted = f"{val:,.0f}".replace(",", ".")
    return f"{'-' if neg else ''}Rp {formatted}"

# ---------------------------------------------------------------------------
# Market-data layer
# ---------------------------------------------------------------------------

def fetch_live_forex_rate() -> float:
    """Return the latest USD→IDR exchange rate."""
    try:
        tk = yf.Ticker(FOREX_TICKER)
        hist = tk.history(period="5d")
        if hist.empty:
            raise ValueError("Empty history for USDIDR=X")
        return float(hist["Close"].dropna().iloc[-1])
    except Exception as exc:
        print(f"[WARN] Forex fetch failed ({exc}), using default {DEFAULT_USDIDR_RATE}")
        return DEFAULT_USDIDR_RATE


def fetch_historical_forex_rate(date_str: str) -> float:
    """Return the USD→IDR closing rate on a specific date (best-effort)."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        start = (dt - timedelta(days=5)).strftime("%Y-%m-%d")
        end = (dt + timedelta(days=2)).strftime("%Y-%m-%d")
        tk = yf.Ticker(FOREX_TICKER)
        hist = tk.history(start=start, end=end)
        if hist.empty:
            return DEFAULT_USDIDR_RATE
        # Find the closest date <= target
        hist.index = hist.index.tz_localize(None) if hist.index.tz is not None else hist.index
        target = dt
        valid = hist[hist.index <= target]
        if valid.empty:
            valid = hist  # fallback to nearest available
        return float(valid["Close"].dropna().iloc[-1])
    except Exception as exc:
        print(f"[WARN] Historical forex for {date_str} failed ({exc})")
        return DEFAULT_USDIDR_RATE


def fetch_ticker_data(ticker: str) -> dict:
    """
    Fetch latest price, previous close, daily change, and recent OHLCV
    for a single ticker.
    """
    result = {
        "ticker": ticker,
        "current_price": None,
        "previous_close": None,
        "daily_change_pct": None,
        "currency": "IDR",
        "ohlcv": [],
    }
    try:
        tk = yf.Ticker(ticker)
        info = tk.fast_info
        result["currency"] = getattr(info, "currency", "USD") or "USD"

        hist = tk.history(period="5d")
        if hist.empty:
            return result

        latest = hist.iloc[-1]
        result["current_price"] = float(latest["Close"])
        result["ohlcv"] = []
        for idx, row in hist.iterrows():
            result["ohlcv"].append({
                "date": idx.strftime("%Y-%m-%d"),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
            })

        if len(hist) >= 2:
            prev = float(hist.iloc[-2]["Close"])
            result["previous_close"] = prev
            if prev != 0:
                result["daily_change_pct"] = round(
                    (result["current_price"] - prev) / prev * 100, 2
                )
    except Exception as exc:
        print(f"[WARN] Ticker {ticker} fetch failed: {exc}")

    return result


def is_idr_ticker(ticker: str) -> bool:
    """Heuristic: tickers ending in .JK are IDR-denominated."""
    return ticker.upper().endswith(".JK")

# ---------------------------------------------------------------------------
# FIFO Engine
# ---------------------------------------------------------------------------

class FIFOEngine:
    """
    Processes journal entries in order, maintaining per-ticker FIFO queues
    for cost-basis tracking.  All money is normalised to IDR.
    """

    def __init__(self, live_forex: float):
        self.live_forex = live_forex
        self.cash_idr: float = 0.0
        # ticker -> list of lots: {"qty": float, "price_native": float,
        #   "price_idr": float, "date": str, "forex_rate": float}
        self.lots: dict[str, list] = defaultdict(list)
        self.realized_trades: list[dict] = []
        self.journal_dirty = False  # set True if phantom trades appended

    # ------------------------------------------------------------------
    def _to_idr(self, amount: float, currency: str, forex_rate: float) -> float:
        if currency.upper() == "IDR":
            return amount
        return amount * forex_rate

    # ------------------------------------------------------------------
    def process_entry(self, entry: dict, hist_forex_cache: dict) -> None:
        action = entry["action"].upper()
        ticker = entry["ticker"]
        qty = float(entry["qty"])
        price = float(entry["price"])
        currency = entry.get("currency", "USD").upper()
        date = entry["date"]

        # Determine forex rate for this entry
        if currency == "IDR":
            forex_rate = 1.0
        else:
            if date not in hist_forex_cache:
                hist_forex_cache[date] = fetch_historical_forex_rate(date)
            forex_rate = hist_forex_cache[date]

        price_idr = self._to_idr(price, currency, forex_rate)

        if action == "DEPOSIT":
            self.cash_idr += self._to_idr(price * qty, currency, forex_rate)
            return

        if action == "WITHDRAW":
            self.cash_idr -= self._to_idr(price * qty, currency, forex_rate)
            return

        if action == "BUY":
            cost = price_idr * qty
            self.cash_idr -= cost
            self.lots[ticker].append({
                "qty": qty,
                "price_native": price,
                "price_idr": price_idr,
                "date": date,
                "currency": currency,
                "forex_rate": forex_rate,
                "sl_price": float(entry.get("sl_price", 0)),
                "tp_price": float(entry.get("tp_price", 0)),
                "trailing_stop_pct": float(entry.get("trailing_stop_pct", 0)),
            })
            return

        if action == "SELL":
            proceeds_idr = price_idr * qty
            self.cash_idr += proceeds_idr
            remaining = qty
            cost_basis_idr = 0.0
            matched_lots = []

            lots = self.lots[ticker]
            while remaining > 0 and lots:
                lot = lots[0]
                take = min(remaining, lot["qty"])
                cost_basis_idr += take * lot["price_idr"]
                matched_lots.append({
                    "buy_date": lot["date"],
                    "buy_price_native": lot["price_native"],
                    "buy_price_idr": lot["price_idr"],
                    "qty": take,
                })
                lot["qty"] -= take
                remaining -= take
                if lot["qty"] <= 1e-12:
                    lots.pop(0)

            realized_pnl = proceeds_idr - cost_basis_idr
            self.realized_trades.append({
                "date": date,
                "ticker": ticker,
                "qty": qty,
                "sell_price_native": price,
                "sell_price_idr": price_idr,
                "currency": currency,
                "forex_rate": forex_rate,
                "cost_basis_idr": round(cost_basis_idr, 2),
                "proceeds_idr": round(proceeds_idr, 2),
                "realized_pnl_idr": round(realized_pnl, 2),
                "matched_lots": matched_lots,
                "system_generated": entry.get("system_generated", False),
                "reason": entry.get("reason", ""),
            })

    # ------------------------------------------------------------------
    def get_holdings(self) -> dict[str, list]:
        """Return a copy of current lots per ticker (non-zero only)."""
        result = {}
        for ticker, lots in self.lots.items():
            active = [l for l in lots if l["qty"] > 1e-12]
            if active:
                result[ticker] = deepcopy(active)
        return result

# ---------------------------------------------------------------------------
# Phantom Auto-Execution (SL / TP / Trailing Stop)
# ---------------------------------------------------------------------------

def check_phantom_triggers(
    engine: FIFOEngine,
    market_data: dict[str, dict],
    journal: list,
) -> list:
    """
    Check if any active holding's SL/TP/Trailing-Stop was breached by today's
    OHLCV data.  Returns new SELL entries to append to the journal.
    """
    new_entries = []
    today_str = datetime.now(tz=WIB).strftime("%Y-%m-%d")

    holdings = engine.get_holdings()
    for ticker, lots in holdings.items():
        mdata = market_data.get(ticker)
        if not mdata or not mdata.get("ohlcv"):
            continue

        # Use today's or latest candle
        latest_candle = mdata["ohlcv"][-1]
        high = latest_candle["high"]
        low = latest_candle["low"]
        close = latest_candle["close"]

        total_qty = sum(l["qty"] for l in lots)
        if total_qty <= 1e-12:
            continue

        # Aggregate SL/TP from the oldest lot (FIFO — the one at risk)
        oldest_lot = lots[0]
        sl = oldest_lot.get("sl_price", 0)
        tp = oldest_lot.get("tp_price", 0)
        trailing_pct = oldest_lot.get("trailing_stop_pct", 0)
        currency = oldest_lot.get("currency", "IDR")

        trigger = None
        sell_price = close  # default execution price

        # Stop-Loss hit
        if sl and sl > 0 and low <= sl:
            trigger = "STOP_LOSS"
            sell_price = sl  # assume execution at SL price

        # Take-Profit hit
        elif tp and tp > 0 and high >= tp:
            trigger = "TAKE_PROFIT"
            sell_price = tp

        # Trailing Stop: if price dropped trailing_pct% from the high
        elif trailing_pct and trailing_pct > 0:
            trail_trigger = high * (1 - trailing_pct / 100.0)
            if close <= trail_trigger and close < oldest_lot["price_native"]:
                trigger = "TRAILING_STOP"
                sell_price = close

        if trigger:
            entry = {
                "date": today_str,
                "ticker": ticker,
                "action": "SELL",
                "qty": total_qty,
                "price": round(sell_price, 4),
                "currency": currency,
                "sl_price": 0,
                "tp_price": 0,
                "trailing_stop_pct": 0,
                "reason": f"Auto-executed: {trigger}",
                "system_generated": True,
            }
            new_entries.append(entry)

    return new_entries


def check_pending_orders(
    market_data: dict[str, dict],
    pending_orders: list,
) -> tuple[list, list]:
    """
    Check pending/conditional orders against today's OHLCV data.
    Returns (new_journal_entries, updated_pending_orders).

    Conditions:
      - PRICE_AT_OR_BELOW: triggers when day's low <= trigger_price (support buy)
      - PRICE_AT_OR_ABOVE: triggers when day's high >= trigger_price (breakout buy)
    """
    new_entries = []
    today_str = datetime.now(tz=WIB).strftime("%Y-%m-%d")

    for order in pending_orders:
        if order.get("status") != "ACTIVE":
            continue

        ticker = order["ticker"]
        mdata = market_data.get(ticker)
        if not mdata or not mdata.get("ohlcv"):
            continue

        latest = mdata["ohlcv"][-1]
        high = latest["high"]
        low = latest["low"]
        trigger = float(order["trigger_price"])
        condition = order.get("condition", "PRICE_AT_OR_BELOW")

        triggered = False
        if condition == "PRICE_AT_OR_BELOW" and low <= trigger:
            triggered = True
        elif condition == "PRICE_AT_OR_ABOVE" and high >= trigger:
            triggered = True

        if triggered:
            entry = {
                "date": today_str,
                "ticker": ticker,
                "action": order.get("action", "BUY"),
                "qty": float(order["qty"]),
                "price": trigger,
                "currency": order.get("currency", "IDR"),
                "sl_price": float(order.get("sl_price", 0)),
                "tp_price": float(order.get("tp_price", 0)),
                "trailing_stop_pct": float(order.get("trailing_stop_pct", 0)),
                "reason": f"Pending order filled: {condition} @ {trigger}",
                "system_generated": True,
            }
            new_entries.append(entry)
            order["status"] = "FILLED"
            order["filled_at"] = today_str
            order["filled_price"] = trigger

    return new_entries, pending_orders

# ---------------------------------------------------------------------------
# Git helpers (for GitHub Actions environment)
# ---------------------------------------------------------------------------

def git_configure():
    """Configure git user for the Actions bot."""
    subprocess.run(
        ["git", "config", "user.name", "trading-bot[bot]"],
        cwd=str(REPO_ROOT), check=True
    )
    subprocess.run(
        ["git", "config", "user.email", "trading-bot[bot]@users.noreply.github.com"],
        cwd=str(REPO_ROOT), check=True
    )


def push_main_files(journal: list, pending_orders: list = None, msg: str = "🤖 Auto-execute trades") -> None:
    """Commit updated journal.json and pending_orders.json back to main."""
    save_json(JOURNAL_PATH, journal)
    if pending_orders is not None:
        save_json(PENDING_ORDERS_PATH, pending_orders)
    git_configure()
    subprocess.run(["git", "add", "journal.json", "pending_orders.json"], cwd=str(REPO_ROOT), check=True)

    result = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        cwd=str(REPO_ROOT),
    )
    if result.returncode == 0:
        print("[INFO] No main-branch changes to commit.")
        return

    subprocess.run(
        ["git", "commit", "-m", msg],
        cwd=str(REPO_ROOT), check=True,
    )
    subprocess.run(
        ["git", "push", "origin", "main"],
        cwd=str(REPO_ROOT), check=True,
    )
    print("[INFO] Updated files pushed to main.")


def push_to_data_cache(files: dict[str, any]) -> None:
    """
    Push computed JSON files to the `data-cache` orphan branch.
    *files* maps filename → Python object to serialise.
    """
    git_configure()

    # Fetch data-cache if it exists; create orphan otherwise
    fetch_result = subprocess.run(
        ["git", "fetch", "origin", "data-cache"],
        cwd=str(REPO_ROOT),
        capture_output=True,
    )

    if fetch_result.returncode == 0:
        subprocess.run(
            ["git", "checkout", "data-cache"],
            cwd=str(REPO_ROOT), check=True,
        )
    else:
        subprocess.run(
            ["git", "checkout", "--orphan", "data-cache"],
            cwd=str(REPO_ROOT), check=True,
        )
        subprocess.run(
            ["git", "rm", "-rf", "."],
            cwd=str(REPO_ROOT), check=True,
        )

    # Write files
    for fname, data in files.items():
        fpath = REPO_ROOT / fname
        save_json(fpath, data)
        subprocess.run(["git", "add", fname], cwd=str(REPO_ROOT), check=True)

    result = subprocess.run(
        ["git", "diff", "--cached", "--quiet"],
        cwd=str(REPO_ROOT),
    )
    if result.returncode == 0:
        print("[INFO] No changes to push to data-cache.")
    else:
        now_wib = datetime.now(tz=WIB).strftime("%Y-%m-%d %H:%M WIB")
        subprocess.run(
            ["git", "commit", "-m", f"📊 Update computed state — {now_wib}"],
            cwd=str(REPO_ROOT), check=True,
        )
        subprocess.run(
            ["git", "push", "--force", "origin", "data-cache"],
            cwd=str(REPO_ROOT), check=True,
        )
        print("[INFO] Computed state pushed to data-cache.")

    # Return to main
    subprocess.run(["git", "checkout", "main"], cwd=str(REPO_ROOT), check=True)

# ---------------------------------------------------------------------------
# Build output payloads
# ---------------------------------------------------------------------------

def build_portfolio_state(
    engine: FIFOEngine,
    market_data: dict[str, dict],
    live_forex: float,
) -> dict:
    """Assemble portfolio_state.json payload."""
    holdings = engine.get_holdings()
    positions = []
    total_portfolio_value_idr = 0.0

    for ticker, lots in holdings.items():
        mdata = market_data.get(ticker, {})
        current_price = mdata.get("current_price")
        native_currency = mdata.get("currency", "USD")

        total_qty = sum(l["qty"] for l in lots)
        avg_buy_native = sum(l["qty"] * l["price_native"] for l in lots) / total_qty if total_qty else 0
        avg_buy_idr = sum(l["qty"] * l["price_idr"] for l in lots) / total_qty if total_qty else 0
        total_cost_idr = sum(l["qty"] * l["price_idr"] for l in lots)

        if current_price is not None:
            if native_currency.upper() == "IDR":
                current_price_idr = current_price
            else:
                current_price_idr = current_price * live_forex
        else:
            current_price_idr = avg_buy_idr  # fallback

        total_value_idr = current_price_idr * total_qty
        unrealized_pnl_idr = total_value_idr - total_cost_idr
        total_portfolio_value_idr += total_value_idr

        positions.append({
            "ticker": ticker,
            "qty": round(total_qty, 8),
            "avg_buy_price_native": round(avg_buy_native, 4),
            "avg_buy_price_idr": round(avg_buy_idr, 2),
            "current_price_native": round(current_price, 4) if current_price else None,
            "current_price_idr": round(current_price_idr, 2),
            "native_currency": native_currency,
            "total_value_idr": round(total_value_idr, 2),
            "total_cost_idr": round(total_cost_idr, 2),
            "unrealized_pnl_idr": round(unrealized_pnl_idr, 2),
            "unrealized_pnl_pct": round(unrealized_pnl_idr / total_cost_idr * 100, 2) if total_cost_idr else 0,
            "daily_change_pct": mdata.get("daily_change_pct"),
        })

    return {
        "generated_at": datetime.now(tz=WIB).isoformat(),
        "live_forex_usdidr": round(live_forex, 2),
        "cash_idr": round(engine.cash_idr, 2),
        "total_portfolio_value_idr": round(total_portfolio_value_idr, 2),
        "net_worth_idr": round(engine.cash_idr + total_portfolio_value_idr, 2),
        "positions": positions,
    }


def build_performance_metrics(engine: FIFOEngine) -> dict:
    """Assemble performance_metrics.json payload."""
    total_realized = sum(t["realized_pnl_idr"] for t in engine.realized_trades)
    return {
        "generated_at": datetime.now(tz=WIB).isoformat(),
        "total_realized_pnl_idr": round(total_realized, 2),
        "total_trades_closed": len(engine.realized_trades),
        "trades": engine.realized_trades,
    }


def build_watchlist_data(
    watchlist: list,
    market_data: dict[str, dict],
    live_forex: float,
) -> dict:
    """Assemble watchlist_data.json payload."""
    items = []
    for ticker in watchlist:
        mdata = market_data.get(ticker, {})
        cur = mdata.get("currency", "USD")
        price = mdata.get("current_price")
        price_idr = None
        if price is not None:
            price_idr = price if cur.upper() == "IDR" else price * live_forex
        items.append({
            "ticker": ticker,
            "current_price_native": round(price, 4) if price else None,
            "current_price_idr": round(price_idr, 2) if price_idr else None,
            "native_currency": cur,
            "daily_change_pct": mdata.get("daily_change_pct"),
            "previous_close": mdata.get("previous_close"),
        })
    return {
        "generated_at": datetime.now(tz=WIB).isoformat(),
        "items": items,
    }

# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Trading Simulator Engine — IDR Base Currency")
    print("=" * 60)

    # 1. Load inputs --------------------------------------------------------
    journal = load_json(JOURNAL_PATH)
    watchlist = load_json(WATCHLIST_PATH)
    pending_orders = load_json(PENDING_ORDERS_PATH)
    print(f"[INFO] Loaded {len(journal)} journal entries, {len(watchlist)} watchlist tickers, {len(pending_orders)} pending orders.")

    # 2. Fetch live forex rate ----------------------------------------------
    live_forex = fetch_live_forex_rate()
    print(f"[INFO] Live USD→IDR rate: {live_forex:,.2f}")

    # 3. Collect all unique tickers -----------------------------------------
    journal_tickers = {e["ticker"] for e in journal if e["action"].upper() not in ("DEPOSIT", "WITHDRAW")}
    pending_tickers = {o["ticker"] for o in pending_orders if o.get("status") == "ACTIVE"}
    all_tickers = journal_tickers | set(watchlist) | pending_tickers
    print(f"[INFO] Fetching market data for {len(all_tickers)} tickers…")

    market_data: dict[str, dict] = {}
    for ticker in sorted(all_tickers):
        print(f"  → {ticker}")
        market_data[ticker] = fetch_ticker_data(ticker)

    # 3b. Capture LPI from orderbook (Stockbit) --------------------------------
    if run_lpi_capture:
        print(f"[INFO] Capturing Liquidity Pressure Intensity (LPI) for {len(all_tickers)} tickers…")
        try:
            run_lpi_capture(list(all_tickers))
        except Exception as e:
            print(f"[WARN] LPI capture failed: {e}")
    else:
        print("[INFO] LPI calculator not available (skipping)")

    # 4. Process journal through FIFO engine --------------------------------
    hist_forex_cache: dict[str, float] = {}
    engine = FIFOEngine(live_forex)

    for entry in journal:
        engine.process_entry(entry, hist_forex_cache)

    print(f"[INFO] Cash after journal replay: {fmt_idr(engine.cash_idr)}")
    print(f"[INFO] Active holdings: {list(engine.get_holdings().keys())}")
    print(f"[INFO] Realized trades: {len(engine.realized_trades)}")

    main_dirty = False

    # 5. Phantom auto-execution (SL / TP / Trailing) -----------------------
    phantom_entries = check_phantom_triggers(engine, market_data, journal)
    if phantom_entries:
        print(f"[INFO] 🤖 {len(phantom_entries)} phantom trade(s) triggered!")
        for pe in phantom_entries:
            journal.append(pe)
            engine.process_entry(pe, hist_forex_cache)
            print(f"  → {pe['ticker']} SELL @ {pe['price']} ({pe['reason']})")
        main_dirty = True

    # 5b. Pending / conditional orders --------------------------------------
    pending_entries, pending_orders = check_pending_orders(market_data, pending_orders)
    if pending_entries:
        print(f"[INFO] 📋 {len(pending_entries)} pending order(s) filled!")
        for pe in pending_entries:
            journal.append(pe)
            engine.process_entry(pe, hist_forex_cache)
            print(f"  → {pe['ticker']} {pe['action']} @ {pe['price']} ({pe['reason']})")
        main_dirty = True

    # Push changes to main if anything was auto-executed
    if main_dirty:
        if os.environ.get("GITHUB_ACTIONS") == "true":
            push_main_files(journal, pending_orders, "🤖 Auto-execute: phantom + pending orders")
        else:
            save_json(JOURNAL_PATH, journal)
            save_json(PENDING_ORDERS_PATH, pending_orders)
            print("[INFO] (Local mode) Saved updated journal + pending orders locally.")
    else:
        print("[INFO] No phantom triggers or pending orders detected.")

    # 6. Build output payloads ---------------------------------------------
    portfolio_state = build_portfolio_state(engine, market_data, live_forex)
    performance_metrics = build_performance_metrics(engine)
    watchlist_data = build_watchlist_data(watchlist, market_data, live_forex)

    print(f"\n[RESULT] Net Worth: {fmt_idr(portfolio_state['net_worth_idr'])}")
    print(f"[RESULT] Cash:      {fmt_idr(portfolio_state['cash_idr'])}")
    print(f"[RESULT] Holdings:  {fmt_idr(portfolio_state['total_portfolio_value_idr'])}")
    print(f"[RESULT] Realized:  {fmt_idr(performance_metrics['total_realized_pnl_idr'])}")

    # 7. Publish to data-cache branch (or save locally) --------------------
    output_files = {
        "portfolio_state.json": portfolio_state,
        "performance_metrics.json": performance_metrics,
        "watchlist_data.json": watchlist_data,
    }

    if os.environ.get("GITHUB_ACTIONS") == "true":
        push_to_data_cache(output_files)
    else:
        # Local dev: write to output/ directory
        for fname, data in output_files.items():
            save_json(OUTPUT_DIR / fname, data)
        print(f"\n[INFO] (Local mode) Output written to {OUTPUT_DIR}/")

    print("\n✅ Engine run complete.")


if __name__ == "__main__":
    main()
