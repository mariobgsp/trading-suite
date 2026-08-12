"""
Portfolio state tracker for the IHSG swing trading system.

Manages open positions, tracks portfolio-level heat (total risk),
and enforces the max 6% portfolio heat rule. Positions are
persisted to JSON for cross-session continuity.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from config.settings import (
    DEFAULT_CAPITAL,
    IDX_LOT_SIZE,
    MAX_OPEN_POSITIONS,
    MAX_PORTFOLIO_HEAT_PCT,
    PROJECT_ROOT,
    TRAILING_STOP_ATR_MULTIPLIER,
)
from core.risk import RiskManager

logger = logging.getLogger(__name__)

PORTFOLIO_FILE = PROJECT_ROOT / "data" / "portfolio.json"


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class Position:
    """A single open position in the portfolio."""

    ticker: str
    entry_price: float
    entry_date: str  # ISO format
    shares: int
    stop_loss: float
    trailing_stop: float
    highest_high: float  # for chandelier exit tracking
    risk_per_share: float
    risk_amount: float  # IDR at risk

    @property
    def position_value(self) -> float:
        """Current value based on entry price."""
        return self.entry_price * self.shares


@dataclass
class ClosedTrade:
    """A completed (closed) trade for P&L tracking."""

    ticker: str
    entry_price: float
    exit_price: float
    entry_date: str
    exit_date: str
    shares: int
    pnl: float  # profit/loss in IDR
    pnl_pct: float  # P&L as % of entry value
    exit_reason: str  # "stop_loss", "trailing_stop", "manual"


# ─── Portfolio ────────────────────────────────────────────────────────────────


class Portfolio:
    """
    Portfolio state tracker with heat management.

    Tracks open positions, enforces the 6% max portfolio heat rule,
    updates trailing stops, and records closed trades.

    Usage:
        portfolio = Portfolio(capital=100_000_000)
        portfolio.add_position("BBCA", entry=7000, stop=6775, shares=1300)
        print(f"Heat: {portfolio.heat:.2f}%")
        portfolio.save()
    """

    def __init__(self, capital: float = DEFAULT_CAPITAL) -> None:
        self._initial_capital = capital
        self._capital = capital
        self._positions: dict[str, Position] = {}
        self._closed_trades: list[ClosedTrade] = []
        self._risk_manager = RiskManager()

    # ── Properties ────────────────────────────────────────────────────

    @property
    def capital(self) -> float:
        """Total available capital (not invested)."""
        return self._capital

    @property
    def invested(self) -> float:
        """Total value of all open positions at entry price."""
        return sum(p.position_value for p in self._positions.values())

    @property
    def total_risk(self) -> float:
        """Total IDR at risk across all open positions."""
        return sum(p.risk_amount for p in self._positions.values())

    @property
    def heat(self) -> float:
        """Portfolio heat: total risk as % of initial capital."""
        if self._initial_capital <= 0:
            return 0.0
        return (self.total_risk / self._initial_capital) * 100.0

    @property
    def open_positions(self) -> list[Position]:
        """List of all open positions."""
        return list(self._positions.values())

    @property
    def num_positions(self) -> int:
        """Number of open positions."""
        return len(self._positions)

    @property
    def closed_trades(self) -> list[ClosedTrade]:
        """List of all closed trades."""
        return list(self._closed_trades)

    # ── Position Management ───────────────────────────────────────────

    def can_take_trade(self, risk_amount: float) -> tuple[bool, str]:
        """
        Check if a new trade is allowed under portfolio constraints.

        Returns (allowed, reason).
        """
        if self.num_positions >= MAX_OPEN_POSITIONS:
            return False, f"max positions reached ({MAX_OPEN_POSITIONS})"

        new_heat = ((self.total_risk + risk_amount) / self._initial_capital) * 100
        if new_heat > MAX_PORTFOLIO_HEAT_PCT:
            return False, (
                f"heat would be {new_heat:.2f}% > "
                f"{MAX_PORTFOLIO_HEAT_PCT}% limit"
            )

        return True, "ok"

    def add_position(
        self,
        ticker: str,
        entry_price: float,
        stop_loss: float,
        shares: int,
        trailing_stop: float | None = None,
        entry_date: str | None = None,
    ) -> Position:
        """
        Add a new position to the portfolio.

        Raises ValueError if the portfolio heat rule would be violated,
        or if the ticker already has an open position.
        """
        if ticker in self._positions:
            raise ValueError(f"Already have an open position in {ticker}")

        risk_per_share = entry_price - stop_loss
        risk_amount = shares * risk_per_share

        allowed, reason = self.can_take_trade(risk_amount)
        if not allowed:
            raise ValueError(f"Cannot take trade: {reason}")

        position = Position(
            ticker=ticker,
            entry_price=entry_price,
            entry_date=entry_date or datetime.now().strftime("%Y-%m-%d"),
            shares=shares,
            stop_loss=stop_loss,
            trailing_stop=trailing_stop or stop_loss,
            highest_high=entry_price,
            risk_per_share=round(risk_per_share, 2),
            risk_amount=round(risk_amount, 2),
        )

        self._positions[ticker] = position
        self._capital -= entry_price * shares

        logger.info(
            "Opened %s: %d shares @ %s, stop=%s, risk=IDR %s (heat: %.2f%%)",
            ticker, shares, f"{entry_price:,.0f}", f"{stop_loss:,.0f}",
            f"{risk_amount:,.0f}", self.heat,
        )

        return position

    def update_trailing_stop(
        self,
        ticker: str,
        current_high: float,
        current_atr: float,
    ) -> float | None:
        """
        Update the chandelier trailing stop for a position.

        The stop only moves UP, never down.
        Returns the new stop level, or None if no update.
        """
        if ticker not in self._positions:
            return None

        pos = self._positions[ticker]

        # Update highest high
        if current_high > pos.highest_high:
            pos.highest_high = current_high

        # Calculate new trailing stop
        new_stop = self._risk_manager.calculate_trailing_stop(
            pos.highest_high, current_atr, TRAILING_STOP_ATR_MULTIPLIER
        )

        # Stop only moves up
        if new_stop > pos.trailing_stop:
            old_stop = pos.trailing_stop
            pos.trailing_stop = round(new_stop, 2)

            # Update risk amount based on new stop distance
            pos.risk_per_share = round(pos.entry_price - pos.trailing_stop, 2)
            pos.risk_amount = round(pos.shares * max(pos.risk_per_share, 0), 2)

            logger.debug(
                "[%s] Trailing stop: %s -> %s (highest high: %s)",
                ticker, f"{old_stop:,.0f}", f"{new_stop:,.0f}",
                f"{pos.highest_high:,.0f}",
            )
            return pos.trailing_stop

        return None

    def close_position(
        self,
        ticker: str,
        exit_price: float,
        exit_reason: str = "manual",
    ) -> ClosedTrade:
        """
        Close a position and record the trade.

        Returns the ClosedTrade record.
        """
        if ticker not in self._positions:
            raise ValueError(f"No open position in {ticker}")

        pos = self._positions.pop(ticker)

        pnl = (exit_price - pos.entry_price) * pos.shares
        entry_value = pos.entry_price * pos.shares
        pnl_pct = (pnl / entry_value * 100) if entry_value > 0 else 0

        closed = ClosedTrade(
            ticker=ticker,
            entry_price=pos.entry_price,
            exit_price=exit_price,
            entry_date=pos.entry_date,
            exit_date=datetime.now().strftime("%Y-%m-%d"),
            shares=pos.shares,
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            exit_reason=exit_reason,
        )

        self._closed_trades.append(closed)
        self._capital += exit_price * pos.shares

        logger.info(
            "Closed %s: %d shares @ %s, PnL=IDR %s (%.2f%%), reason=%s",
            ticker, pos.shares, f"{exit_price:,.0f}",
            f"{pnl:,.0f}", pnl_pct, exit_reason,
        )

        return closed

    def check_stop_hits(
        self, price_data: dict[str, float]
    ) -> list[str]:
        """
        Check which positions have hit their trailing stop.

        Parameters
        ----------
        price_data : dict[str, float]
            Mapping of ticker -> current low price.

        Returns
        -------
        list[str]
            Tickers that should be closed (low <= trailing stop).
        """
        stopped_out = []
        for ticker, pos in self._positions.items():
            current_low = price_data.get(ticker)
            if current_low is not None and current_low <= pos.trailing_stop:
                stopped_out.append(ticker)
                logger.info(
                    "[%s] Stop hit: low=%s <= trailing_stop=%s",
                    ticker, f"{current_low:,.0f}", f"{pos.trailing_stop:,.0f}",
                )
        return stopped_out

    def check_reversal_exits(
        self,
        price_data: dict[str, dict],
        ohlcv_data: dict[str, "pd.DataFrame"] | None = None,
    ) -> list[tuple[str, str]]:
        """
        Check which positions should be exited via the 20-day reversal strategy.

        Within the first 20 days of holding:
        - If position has minimum profit AND bearish reversal pattern detected: EXIT
        - If position had peak profit that has eroded significantly: EXIT (profit lock)

        After 20 days: No forced exit (trailing stop manages).

        Parameters
        ----------
        price_data : dict[str, dict]
            Mapping of ticker -> {"close": float, "high": float, "entry_date": str}
        ohlcv_data : dict[str, pd.DataFrame] | None
            Full OHLCV data for reversal pattern detection.

        Returns
        -------
        list[tuple[str, str]]
            List of (ticker, exit_reason) for positions to close.
        """
        import pandas as pd
        from datetime import datetime
        from config.settings import (
            REVERSAL_EXIT_MAX_DAYS,
            REVERSAL_EXIT_PROFIT_THRESHOLD,
            REVERSAL_EXIT_BEARISH_CANDLES,
            REVERSAL_EXIT_TRAILING_LOCK_PCT,
        )
        from core.indicators import detect_bearish_reversal

        exits: list[tuple[str, str]] = []

        for ticker, pos in self._positions.items():
            data = price_data.get(ticker)
            if data is None:
                continue

            current_close = data.get("close", 0)
            if current_close <= 0:
                continue

            # Calculate holding days
            try:
                entry_dt = datetime.strptime(pos.entry_date, "%Y-%m-%d")
                now = datetime.now()
                holding_days = (now - entry_dt).days
            except (ValueError, TypeError):
                continue

            # Only apply within the 20-day window
            if holding_days > REVERSAL_EXIT_MAX_DAYS:
                continue

            # Calculate profit metrics
            current_profit_pct = (current_close - pos.entry_price) / pos.entry_price
            peak_profit_pct = (pos.highest_high - pos.entry_price) / pos.entry_price

            # Must have minimum profit
            if current_profit_pct <= REVERSAL_EXIT_PROFIT_THRESHOLD:
                continue

            # Check for bearish reversal pattern
            has_reversal = False
            if ohlcv_data and ticker in ohlcv_data:
                df = ohlcv_data[ticker]
                has_reversal = detect_bearish_reversal(
                    df, n_candles=REVERSAL_EXIT_BEARISH_CANDLES
                )

            # Check profit erosion (peak was high, now dropping)
            profit_erosion = (
                peak_profit_pct > REVERSAL_EXIT_PROFIT_THRESHOLD * 2
                and current_profit_pct < peak_profit_pct * REVERSAL_EXIT_TRAILING_LOCK_PCT
            )

            if has_reversal:
                logger.info(
                    "[%s] Reversal exit: holding %d days, profit=%.2f%%, peak=%.2f%%",
                    ticker, holding_days, current_profit_pct * 100, peak_profit_pct * 100,
                )
                exits.append((ticker, "reversal_exit"))
            elif profit_erosion:
                logger.info(
                    "[%s] Profit lock exit: holding %d days, profit=%.2f%% (peak was %.2f%%)",
                    ticker, holding_days, current_profit_pct * 100, peak_profit_pct * 100,
                )
                exits.append((ticker, "profit_lock_exit"))

        return exits

    # ── Summary ───────────────────────────────────────────────────────

    def summary(self) -> str:
        """Human-readable portfolio summary."""
        lines = [
            "=" * 60,
            "PORTFOLIO SUMMARY",
            "=" * 60,
            f"  Initial Capital:  IDR {self._initial_capital:>14,.0f}",
            f"  Available Cash:   IDR {self._capital:>14,.0f}",
            f"  Invested:         IDR {self.invested:>14,.0f}",
            f"  Open Positions:   {self.num_positions} / {MAX_OPEN_POSITIONS}",
            f"  Total Risk:       IDR {self.total_risk:>14,.0f}",
            f"  Portfolio Heat:   {self.heat:>13.2f}%  "
            f"(max {MAX_PORTFOLIO_HEAT_PCT}%)",
        ]

        if self._positions:
            lines.append("")
            lines.append("  --- Open Positions ---")
            for pos in self._positions.values():
                lines.append(
                    f"  {pos.ticker:8s} {pos.shares:>6,} shares @ "
                    f"{pos.entry_price:>10,.0f}  "
                    f"stop={pos.trailing_stop:>10,.0f}  "
                    f"risk=IDR {pos.risk_amount:>10,.0f}"
                )

        if self._closed_trades:
            total_pnl = sum(t.pnl for t in self._closed_trades)
            wins = sum(1 for t in self._closed_trades if t.pnl > 0)
            losses = sum(1 for t in self._closed_trades if t.pnl <= 0)
            lines.append("")
            lines.append("  --- Closed Trades ---")
            lines.append(f"  Total P&L:    IDR {total_pnl:>12,.0f}")
            lines.append(f"  Win/Loss:     {wins}W / {losses}L")

        lines.append("=" * 60)
        return "\n".join(lines)

    # ── Persistence ───────────────────────────────────────────────────

    def save(self, path: Path | None = None) -> None:
        """Save portfolio state to JSON."""
        path = path or PORTFOLIO_FILE
        path.parent.mkdir(parents=True, exist_ok=True)

        state = {
            "initial_capital": self._initial_capital,
            "capital": self._capital,
            "positions": {
                k: asdict(v) for k, v in self._positions.items()
            },
            "closed_trades": [asdict(t) for t in self._closed_trades],
        }

        path.write_text(json.dumps(state, indent=2, default=str))
        logger.info("Portfolio saved to %s", path)

    @classmethod
    def load(cls, path: Path | None = None) -> Portfolio:
        """Load portfolio state from JSON."""
        path = path or PORTFOLIO_FILE

        if not path.exists():
            logger.info("No saved portfolio found, creating new one")
            return cls()

        try:
            state = json.loads(path.read_text())
            portfolio = cls(capital=state.get("initial_capital", DEFAULT_CAPITAL))
            portfolio._capital = state.get("capital", portfolio._initial_capital)

            for ticker, pos_data in state.get("positions", {}).items():
                portfolio._positions[ticker] = Position(**pos_data)

            for trade_data in state.get("closed_trades", []):
                portfolio._closed_trades.append(ClosedTrade(**trade_data))

            logger.info(
                "Portfolio loaded: %d positions, %.2f%% heat",
                portfolio.num_positions, portfolio.heat,
            )
            return portfolio

        except Exception as e:
            logger.error("Failed to load portfolio from %s: %s", path, e)
            return cls()
