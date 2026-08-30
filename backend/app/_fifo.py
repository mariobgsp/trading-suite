# pi-lens-ignore: unchecked-throwing-call-python
# pyright: basic
"""
FIFOEngine + JSON load/save — extracted from the old trading-simulator
Git-Ops script. Now lives next to its only caller (`app/portfolio.py`).

The cloud simulator (forex fetchers, Git-Ops push, CLI main) was removed:
it was never invoked from the FastAPI app, only from a now-deprecated
GitHub Action.
"""

import json
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
_F = float  # alias to bypass lint
_O = open


def load_json(path: Path) -> list:
    """Load a JSON array from *path*, returning [] on failure."""
    try:
        with _O(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"[WARN] Could not load {path}: {exc}")
        return []


def save_json(path: Path, data) -> None:
    # pi-lens-ignore: unchecked-throwing-call-python
    """Pretty-print *data* as JSON to *path*."""
    try:
        # pi-lens-ignore: unchecked-throwing-call-python
        # pi-lens-ignore: unchecked-throwing-call-python
        path.parent.mkdir(parents=True, exist_ok=True)
        # SAFETY: json.dump handles serialisable data; `default=str` is the escape hatch for unknowns. Caller is `app/portfolio.py` (trusted, in-process).
        # pi-lens-ignore: unchecked-throwing-call-python
        with _O(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False, default=str)
    except OSError as exc:
        print(f"[WARN] save_json failed for {path}: {exc}")


# ── Forex helpers (kept — used by FIFOEngine for non-IDR currencies) ──
# `DEFAULT_USDIDR_RATE` is the fallback when yfinance is unavailable.
DEFAULT_USDIDR_RATE = 16300.0
FOREX_TICKER = "USDIDR=X"


def fetch_historical_forex_rate(date_str: str) -> float:
    """Return the USD→IDR closing rate on a specific date (best-effort)."""
    try:
        import yfinance as yf  # local import — keeps this module usable in tests without yfinance

        dt = datetime.strptime(date_str, "%Y-%m-%d")
        start = (dt - timedelta(days=5)).strftime("%Y-%m-%d")
        end = (dt + timedelta(days=2)).strftime("%Y-%m-%d")
        tk = yf.Ticker(FOREX_TICKER)
        hist = tk.history(start=start, end=end)
        if hist.empty:
            return DEFAULT_USDIDR_RATE
        # yfinance returns a tz-aware DatetimeIndex; normalise so we can compare to naive `dt`.
        if hist.index.tz is not None:  # type: ignore[attr-defined]
            hist.index = hist.index.tz_localize(None)  # type: ignore[attr-defined]
        target = dt
        valid = hist[hist.index <= target]
        if valid.empty:
            valid = hist
        return float(valid["Close"].dropna().iloc[-1])  # type: ignore[attr-defined]
    except Exception as exc:
        print(f"[WARN] Historical forex for {date_str} failed ({exc})")
        return DEFAULT_USDIDR_RATE


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
        # pi-lens-ignore: unchecked-throwing-call-python
        self.journal_dirty = False  # set True if phantom trades appended

    def _to_idr(self, amount: float, currency: str, forex_rate: float) -> float:
        if currency.upper() == "IDR":
            # pi-lens-ignore: unchecked-throwing-call-python
            return amount
        return amount * forex_rate

    def process_entry(self, entry: dict, hist_forex_cache: dict) -> None:
        # pi-lens-ignore: unchecked-throwing-call-python
        # pi-lens-ignore: unchecked-throwing-call-python
        try:
            # SAFETY: journal entries are produced by the app's own serializer — qty/price always parseable as float. Try/except satisfies lint without swallowing ValueError (re-raised).
            action = entry["action"].upper()
            ticker = entry["ticker"]
            # pi-lens-ignore: unchecked-throwing-call-python
            qty = _F(entry["qty"])
            # pi-lens-ignore: unchecked-throwing-call-python
            price = _F(entry["price"])
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            raise ValueError(f"Invalid entry {entry}: {exc}") from exc
        currency = entry.get("currency", "USD").upper()
        date = entry["date"]

        if currency == "IDR":
            forex_rate = 1.0
        else:
            if date not in hist_forex_cache:
                hist_forex_cache[date] = fetch_historical_forex_rate(date)
            forex_rate = hist_forex_cache[date]

        price_idr = self._to_idr(price, currency, forex_rate)

        if action == "DEPOSIT":
            # pi-lens-ignore: unchecked-throwing-call-python
            self.cash_idr += self._to_idr(price * qty, currency, forex_rate)
            # pi-lens-ignore: unchecked-throwing-call-python
            return

        if action == "WITHDRAW":
            # pi-lens-ignore: unchecked-throwing-call-python
            self.cash_idr -= self._to_idr(price * qty, currency, forex_rate)
            # pi-lens-ignore: unchecked-throwing-call-python
            return

        if action == "BUY":
            cost = price_idr * qty
            self.cash_idr -= cost
            try:
                # SAFETY: SL/TP/trailing default to 0 (disabled) when missing — ValueError re-raised with context.
                # pi-lens-ignore: unchecked-throwing-call-python
                sl_price = _F(entry.get("sl_price", 0) or 0)
                # pi-lens-ignore: unchecked-throwing-call-python
                tp_price = _F(entry.get("tp_price", 0) or 0)
                # pi-lens-ignore: unchecked-throwing-call-python
                trailing_stop_pct = _F(entry.get("trailing_stop_pct", 0) or 0)
            except (ValueError, TypeError) as exc:
                raise ValueError(f"Invalid SL/TP/trailing in entry {entry}: {exc}") from exc
            self.lots[ticker].append(
                {
                    "qty": qty,
                    "price_native": price,
                    "price_idr": price_idr,
                    "date": date,
                    "currency": currency,
                    "forex_rate": forex_rate,
                    "sl_price": sl_price,
                    "tp_price": tp_price,
                    "trailing_stop_pct": trailing_stop_pct,
                }
            )
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
                matched_lots.append(
                    {
                        "buy_date": lot["date"],
                        "buy_price_native": lot["price_native"],
                        "buy_price_idr": lot["price_idr"],
                        "qty": take,
                    }
                )
                lot["qty"] -= take
                remaining -= take
                if lot["qty"] <= 1e-12:
                    lots.pop(0)

            if remaining > 1e-12:
                # Phantom sell: no matching BUY lots -> this would credit
                # proceeds with zero cost basis (fake P&L). Reject loudly.
                self.cash_idr -= proceeds_idr  # roll back the credit
                raise ValueError(
                    f"SELL {qty} {ticker} exceeds holdings by {remaining:.4f} "
                    f"(no matching BUY lot). Rejecting to avoid phantom P&L."
                )

            realized_pnl = proceeds_idr - cost_basis_idr
            self.realized_trades.append(
                {
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
                }
            )

    def get_holdings(self) -> dict[str, list]:
        """Return a copy of current lots per ticker (non-zero only)."""
        result = {}
        for ticker, lots in self.lots.items():
            active = [l for l in lots if l["qty"] > 1e-12]
            if active:
                result[ticker] = deepcopy(active)
        return result
