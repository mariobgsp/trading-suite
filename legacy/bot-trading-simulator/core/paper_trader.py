"""
Paper Trading Simulator for the IHSG swing trading system.

Automatically executes trades based on scanner signals using identical
position sizing, stop-loss, take-profit, and trailing stop rules as
the backtester. Starts from IDR 5,000,000 (same starting capital as
the user).

This creates a parallel track record: "If you followed every scanner
signal exactly, here's what would have happened."

Key features:
  - Same cost model as backtester (slippage + IDX broker fees)
  - Same risk management (ATR-based stop-loss, Chandelier trailing stop)
  - Same take-profit logic (2x ATR bracket order — faster profit securing)
  - Same portfolio heat / max positions constraints
  - Persists state to JSON for cross-session continuity
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import pandas as pd

from config.settings import (
    ATR_PERIOD,
    BACKTEST_FEE_BUY_PCT,
    BACKTEST_FEE_SELL_PCT,
    BACKTEST_SLIPPAGE_PCT,
    BRACKET_ORDER_TP_ATR_MULTIPLIER,
    MAX_OPEN_POSITIONS,
    MAX_PORTFOLIO_HEAT_PCT,
    MAX_RISK_PER_TRADE_PCT,
    PAPER_TRADING_INITIAL_CAPITAL,
    PROJECT_ROOT,
    REVERSAL_EXIT_BEARISH_CANDLES,
    REVERSAL_EXIT_MAX_DAYS,
    REVERSAL_EXIT_PROFIT_THRESHOLD,
    REVERSAL_EXIT_TRAILING_LOCK_PCT,
    TRAILING_STOP_ATR_MULTIPLIER,
)
from core.indicators import atr, detect_bearish_reversal
from core.risk import RiskManager
from core.cooldown import CooldownManager
from config.settings import BRAIN_ENABLED

logger = logging.getLogger(__name__)

PAPER_PORTFOLIO_FILE = PROJECT_ROOT / "data" / ".portfolio_state.json"


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class PaperPosition:
    """An open position in the paper trading portfolio."""

    ticker: str
    engine: str
    entry_price: float       # after slippage + fees
    raw_entry_price: float   # before costs
    entry_date: str          # ISO format
    shares: int
    stop_loss: float
    take_profit: float
    trailing_stop: float
    highest_high: float
    risk_per_share: float
    risk_amount: float
    regime: str

    # ── Live position tracking (updated each scan) ────────────────
    current_price: float = 0.0          # Latest market close price
    unrealized_pnl: float = 0.0         # IDR profit/loss vs entry
    unrealized_pnl_pct: float = 0.0     # P&L as % of entry value
    last_updated: str = ""              # ISO date of last price update

    @property
    def position_value(self) -> float:
        """Current value based on entry price."""
        return self.entry_price * self.shares

    @property
    def market_value(self) -> float:
        """Current market value based on current_price."""
        if self.current_price > 0:
            return self.current_price * self.shares
        return self.position_value

    @property
    def distance_to_stop_pct(self) -> float:
        """How far current price is from trailing stop (positive = safe)."""
        if self.current_price > 0 and self.trailing_stop > 0:
            return ((self.current_price - self.trailing_stop) / self.current_price) * 100
        return 0.0

    @property
    def distance_to_tp_pct(self) -> float:
        """How far current price is from take profit (positive = not yet hit)."""
        if self.current_price > 0 and self.take_profit > 0:
            return ((self.take_profit - self.current_price) / self.current_price) * 100
        return 0.0


@dataclass
class PaperTrade:
    """A completed (closed) paper trade for P&L tracking."""

    ticker: str
    engine: str
    entry_price: float
    exit_price: float
    raw_entry_price: float
    raw_exit_price: float
    entry_date: str
    exit_date: str
    shares: int
    pnl: float              # profit/loss in IDR (after all costs)
    pnl_pct: float           # P&L as % of entry value
    exit_reason: str         # "trailing_stop", "take_profit", "reversal_exit", "profit_lock_exit"
    regime: str
    holding_days: int
    slippage_entry: float
    slippage_exit: float
    fee_entry: float
    fee_exit: float


# ─── Paper Portfolio ──────────────────────────────────────────────────────────


class PaperPortfolio:
    """
    Paper trading portfolio that executes scanner signals in simulation.

    Mirrors the exact logic of the backtester: same position sizing,
    same costs, same stop/trailing/TP rules, same heat constraints.

    Usage:
        paper = PaperPortfolio.load()
        paper.process_signals(scan_result.trade, regime, price_data)
        paper.save()
        print(paper.summary())
    """

    def __init__(
        self,
        capital: float = PAPER_TRADING_INITIAL_CAPITAL,
    ) -> None:
        self._initial_capital = capital
        self._equity = capital
        self._positions: dict[str, PaperPosition] = {}
        self._closed_trades: list[PaperTrade] = []
        self._risk_mgr = RiskManager()
        self._cooldown = CooldownManager()

        # Cost model (same as backtester)
        self._slippage_pct = BACKTEST_SLIPPAGE_PCT / 100.0
        self._fee_buy_pct = BACKTEST_FEE_BUY_PCT / 100.0
        self._fee_sell_pct = BACKTEST_FEE_SELL_PCT / 100.0

    # ── Cost Application ─────────────────────────────────────────────

    def _apply_buy_costs(self, price: float) -> float:
        """Apply slippage (buy higher) and broker fee to entry price."""
        slipped = price * (1.0 + self._slippage_pct)
        with_fee = slipped * (1.0 + self._fee_buy_pct)
        return round(with_fee, 2)

    def _apply_sell_costs(self, price: float) -> float:
        """Apply slippage (sell lower) and broker fee to exit price."""
        slipped = price * (1.0 - self._slippage_pct)
        with_fee = slipped * (1.0 - self._fee_sell_pct)
        return round(with_fee, 2)

    # ── Properties ────────────────────────────────────────────────────

    @property
    def initial_capital(self) -> float:
        return self._initial_capital

    @property
    def equity(self) -> float:
        return self._equity

    @property
    def invested(self) -> float:
        """Total value of all open positions at entry price."""
        return sum(p.position_value for p in self._positions.values())

    @property
    def available_cash(self) -> float:
        """Cash available for new trades."""
        return self._equity - self.invested

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
    def num_positions(self) -> int:
        return len(self._positions)

    @property
    def open_positions(self) -> list[PaperPosition]:
        return list(self._positions.values())

    @property
    def closed_trades(self) -> list[PaperTrade]:
        return list(self._closed_trades)

    @property
    def total_pnl(self) -> float:
        return sum(t.pnl for t in self._closed_trades)

    @property
    def total_return_pct(self) -> float:
        if self._initial_capital <= 0:
            return 0.0
        final = self._initial_capital + self.total_pnl
        return ((final / self._initial_capital) - 1.0) * 100.0

    @property
    def win_count(self) -> int:
        return sum(1 for t in self._closed_trades if t.pnl > 0)

    @property
    def loss_count(self) -> int:
        return sum(1 for t in self._closed_trades if t.pnl <= 0)

    @property
    def win_rate(self) -> float:
        total = len(self._closed_trades)
        if total == 0:
            return 0.0
        return (self.win_count / total) * 100.0

    # ── Trade Entry ───────────────────────────────────────────────────

    def enter_trade(
        self,
        trade_entry,
        regime_value: str,
    ) -> PaperPosition | None:
        """
        Enter a paper trade based on a TradeEntry from the scanner.

        Uses the same sizing logic as the backtester: ATR-based stop,
        regime-adjusted risk, lot-rounded position size.

        Returns the PaperPosition if entered, or None if rejected.
        """
        ticker = trade_entry.ticker
        details = trade_entry.details

        # Anti-Averaging Down: NEVER add capital to a losing position.
        # Scaling in is only permitted if the initial purchase shows a profit.
        # (Enhancement v2: Cardinal Sin — averaging down is strictly forbidden)
        if ticker in self._positions:
            existing = self._positions[ticker]
            if existing.current_price > 0 and existing.unrealized_pnl < 0:
                logger.warning(
                    "🚫 [Paper] ANTI-AVERAGING DOWN: %s is at a LOSS "
                    "(P&L: IDR %s). Refusing to add more capital.",
                    ticker, f"{existing.unrealized_pnl:,.0f}",
                )
            else:
                logger.debug("[Paper] Already holding %s, skip", ticker)
            return None

        # Max positions check
        if self.num_positions >= MAX_OPEN_POSITIONS:
            logger.debug("[Paper] Max positions reached (%d), skip %s",
                         MAX_OPEN_POSITIONS, ticker)
            return None

        # Get ATR for stop-loss / take-profit
        atr_value = details.get("atr", 0)
        if atr_value <= 0:
            logger.debug("[Paper] No ATR for %s, skip", ticker)
            return None

        raw_entry = trade_entry.price
        actual_entry = self._apply_buy_costs(raw_entry)

        # Enhancement v2: Calculate dynamic max stop from trade history
        dynamic_max_stop = self._risk_mgr.calculate_dynamic_max_stop(
            self._closed_trades
        )

        # Calculate stop-loss (1.5x ATR below entry, clamped by Cardinal Sin)
        stop = self._risk_mgr.calculate_stop_loss(
            actual_entry, atr_value, max_stop_pct=dynamic_max_stop,
        )
        risk_per_share = actual_entry - stop
        if risk_per_share <= 0:
            logger.debug("[Paper] Invalid risk for %s, skip", ticker)
            return None

        # Regime-adjusted position sizing
        adj_risk = self._risk_mgr.adjust_risk_for_regime(
            MAX_RISK_PER_TRADE_PCT, regime_value
        )
        shares = self._risk_mgr.calculate_position_size(
            self._equity, actual_entry, stop, adj_risk
        )
        if shares <= 0:
            logger.debug("[Paper] Position size 0 for %s, skip", ticker)
            return None

        risk_amount = risk_per_share * shares

        # Heat check
        new_heat = ((self.total_risk + risk_amount) / self._initial_capital) * 100.0
        if new_heat > MAX_PORTFOLIO_HEAT_PCT:
            logger.debug("[Paper] Heat would be %.2f%% > %.2f%%, skip %s",
                         new_heat, MAX_PORTFOLIO_HEAT_PCT, ticker)
            return None

        # Can we afford it?
        cost = actual_entry * shares
        if cost > self.available_cash:
            logger.debug("[Paper] Insufficient cash for %s (need IDR %s, have IDR %s)",
                         ticker, f"{cost:,.0f}", f"{self.available_cash:,.0f}")
            return None

        # Take-profit (3x ATR above entry, same as bracket order)
        take_profit = round(
            actual_entry + (atr_value * BRACKET_ORDER_TP_ATR_MULTIPLIER), 2
        )

        # Trailing stop (initially max of stop-loss and chandelier)
        trailing = self._risk_mgr.calculate_trailing_stop(
            raw_entry, atr_value, TRAILING_STOP_ATR_MULTIPLIER
        )

        position = PaperPosition(
            ticker=ticker,
            engine=trade_entry.signal,
            entry_price=actual_entry,
            raw_entry_price=raw_entry,
            entry_date=datetime.now().strftime("%Y-%m-%d"),
            shares=shares,
            stop_loss=round(stop, 2),
            take_profit=take_profit,
            trailing_stop=round(max(stop, trailing), 2),
            highest_high=raw_entry,
            risk_per_share=round(risk_per_share, 2),
            risk_amount=round(risk_amount, 2),
            regime=regime_value,
        )

        self._positions[ticker] = position

        logger.info(
            "📝 [Paper] BOUGHT %s: %d shares @ IDR %s "
            "(raw: %s) | SL: %s | TP: %s | Risk: IDR %s (%.2f%%)",
            ticker, shares, f"{actual_entry:,.0f}", f"{raw_entry:,.0f}",
            f"{position.stop_loss:,.0f}", f"{take_profit:,.0f}", f"{risk_amount:,.0f}",
            (risk_amount / self._initial_capital) * 100,
        )

        # ── Brain: record signal at entry time ────────────────────────
        if BRAIN_ENABLED:
            try:
                from core.stock_brain import StockBrain
                brain = StockBrain()
                brain.record_signal(
                    ticker=ticker,
                    engine=trade_entry.signal,
                    price=raw_entry,
                    score=trade_entry.score,
                    regime=regime_value,
                    signal_details=details,
                )
            except Exception as _brain_e:
                logger.debug("[%s] Brain record_signal error: %s", ticker, _brain_e)

        return position

    # ── Position Updates ──────────────────────────────────────────────

    def update_positions(
        self,
        price_data: dict[str, pd.DataFrame],
    ) -> list[PaperTrade]:
        """
        Update all open positions with current price data.

        For each position:
        1. Update trailing stop (Chandelier exit)
        2. Check stop-loss hit → CUT LOSS
        3. Check take-profit hit → TAKE PROFIT
        4. Check 20-day reversal exit → EXIT
        5. Update highest high

        Parameters
        ----------
        price_data : dict[str, pd.DataFrame]
            Mapping of ticker -> OHLCV DataFrame (recent data).

        Returns
        -------
        list[PaperTrade]
            List of trades closed during this update.
        """
        closed_this_update: list[PaperTrade] = []
        tickers_to_close: list[tuple[str, float, str]] = []

        for ticker, pos in list(self._positions.items()):
            if ticker not in price_data:
                continue

            df = price_data[ticker]
            if df.empty:
                continue

            # Flatten MultiIndex if present
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            current_high = float(df["High"].iloc[-1])
            current_low = float(df["Low"].iloc[-1])
            current_close = float(df["Close"].iloc[-1])
            current_open = float(df["Open"].iloc[-1])

            # ── Update live position tracking ─────────────────────
            pos.current_price = round(current_close, 2)
            pos.unrealized_pnl = round(
                (current_close - pos.entry_price) * pos.shares, 2
            )
            entry_value = pos.entry_price * pos.shares
            pos.unrealized_pnl_pct = round(
                (pos.unrealized_pnl / entry_value * 100) if entry_value > 0 else 0, 2
            )
            pos.last_updated = datetime.now().strftime("%Y-%m-%d")

            # Update highest high
            if current_high > pos.highest_high:
                pos.highest_high = current_high

            # Update trailing stop (Chandelier) — only ratchets UP when in profit
            atr_series = atr(df, period=ATR_PERIOD)
            if len(atr_series) > 0 and not pd.isna(atr_series.iloc[-1]):
                current_atr = float(atr_series.iloc[-1])
                new_stop = pos.highest_high - (
                    current_atr * TRAILING_STOP_ATR_MULTIPLIER
                )
                if new_stop > pos.trailing_stop:
                    old_ts = pos.trailing_stop
                    pos.trailing_stop = round(new_stop, 2)
                    logger.info(
                        "📈 [Paper] %s trailing stop raised: IDR %s → %s",
                        ticker,
                        f"{old_ts:,.0f}",
                        f"{pos.trailing_stop:,.0f}",
                    )

            # ── Check exits (same priority as backtester) ─────────

            # 1. Stop Loss / Trailing Stop Hit → CUT LOSS or LOCK PROFIT
            if current_low <= pos.trailing_stop:
                exit_price = min(pos.trailing_stop, current_open)
                reason = (
                    "trailing_stop" if pos.trailing_stop > pos.stop_loss
                    else "stop_loss"
                )
                tickers_to_close.append((ticker, exit_price, reason))
                continue

            # 2. Take Profit Hit
            if current_high >= pos.take_profit:
                exit_price = max(pos.take_profit, current_open)
                tickers_to_close.append((ticker, exit_price, "take_profit"))
                continue

            # 3. Reversal Exit (20-day window)
            try:
                entry_dt = datetime.strptime(pos.entry_date, "%Y-%m-%d")
                holding_days = (datetime.now() - entry_dt).days
            except (ValueError, TypeError):
                continue

            if holding_days <= REVERSAL_EXIT_MAX_DAYS:
                current_profit_pct = (current_close - pos.entry_price) / pos.entry_price
                peak_profit_pct = (pos.highest_high - pos.entry_price) / pos.entry_price

                if current_profit_pct > REVERSAL_EXIT_PROFIT_THRESHOLD:
                    has_reversal = detect_bearish_reversal(
                        df, n_candles=REVERSAL_EXIT_BEARISH_CANDLES
                    )

                    profit_erosion = (
                        peak_profit_pct > REVERSAL_EXIT_PROFIT_THRESHOLD * 2
                        and current_profit_pct < peak_profit_pct * REVERSAL_EXIT_TRAILING_LOCK_PCT
                    )

                    if has_reversal:
                        tickers_to_close.append((ticker, current_close, "reversal_exit"))
                    elif profit_erosion:
                        tickers_to_close.append((ticker, current_close, "profit_lock_exit"))

        # Close positions
        for ticker, raw_exit, reason in tickers_to_close:
            trade = self._close_position(ticker, raw_exit, reason)
            if trade:
                closed_this_update.append(trade)

        return closed_this_update

    def _close_position(
        self,
        ticker: str,
        raw_exit_price: float,
        exit_reason: str,
    ) -> PaperTrade | None:
        """Close a paper position and record the trade."""
        if ticker not in self._positions:
            return None

        pos = self._positions.pop(ticker)
        actual_exit = self._apply_sell_costs(raw_exit_price)

        pnl = (actual_exit - pos.entry_price) * pos.shares
        entry_value = pos.entry_price * pos.shares
        pnl_pct = (pnl / entry_value * 100) if entry_value > 0 else 0

        try:
            entry_dt = datetime.strptime(pos.entry_date, "%Y-%m-%d")
            holding_days = (datetime.now() - entry_dt).days
        except (ValueError, TypeError):
            holding_days = 0

        trade = PaperTrade(
            ticker=ticker,
            engine=pos.engine,
            entry_price=pos.entry_price,
            exit_price=actual_exit,
            raw_entry_price=pos.raw_entry_price,
            raw_exit_price=raw_exit_price,
            entry_date=pos.entry_date,
            exit_date=datetime.now().strftime("%Y-%m-%d"),
            shares=pos.shares,
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            exit_reason=exit_reason,
            regime=pos.regime,
            holding_days=holding_days,
            slippage_entry=round(pos.raw_entry_price * self._slippage_pct, 2),
            slippage_exit=round(raw_exit_price * self._slippage_pct, 2),
            fee_entry=round(pos.raw_entry_price * self._fee_buy_pct, 2),
            fee_exit=round(raw_exit_price * self._fee_sell_pct, 2),
        )

        self._closed_trades.append(trade)
        self._equity += pnl

        entry_cost = pos.entry_price * pos.shares
        net_exit = actual_exit * pos.shares
        logger.info(
            "%s [Paper] CLOSED %s: %d shares @ IDR %s → %s | P&L: IDR %s (%+.2f%%) | Reason: %s | Held: %d days",
            "✅" if pnl > 0 else "❌",
            ticker,
            pos.shares,
            f"{entry_cost:,.0f}",
            f"{net_exit:,.0f}",
            f"{pnl:,.0f}",
            pnl_pct,
            exit_reason,
            holding_days,
        )

        # ── Brain: record trade outcome ───────────────────────────────
        if BRAIN_ENABLED:
            try:
                from core.stock_brain import StockBrain
                brain = StockBrain()
                brain.record_outcome(
                    ticker=ticker,
                    engine=pos.engine,
                    entry_date=pos.entry_date,
                    pnl_pct=round(pnl_pct, 4),
                    exit_reason=exit_reason,
                    hold_days=holding_days,
                    exit_date=datetime.now().strftime("%Y-%m-%d"),
                    regime=pos.regime,
                )
                # Run inference if stock has enough trades
                from config.settings import BRAIN_MIN_TRADES_FOR_CONFIDENCE
                memory = brain.load(ticker)
                if memory.total_closed_trades >= BRAIN_MIN_TRADES_FOR_CONFIDENCE:
                    brain.run_inference(ticker)
            except Exception as _brain_e:
                logger.debug("[%s] Brain record_outcome error: %s", ticker, _brain_e)

        # ── Cooldown: Suppress repeated entries on losing trades ───────
        # Only trigger cooldown if the trade was actually a loss AND
        # it was stopped out (not a profitable trailing stop exit).
        is_losing_stop = (
            exit_reason in ("stop_loss", "trailing_stop")
            and pnl < 0
        )
        if is_losing_stop:
            self._cooldown.record_failure(
                ticker,
                reason=f"{exit_reason} | PnL: IDR {pnl:,.0f} ({pnl_pct:+.2f}%)",
            )
            logger.info(
                "🚫 [Cooldown] %s added to 30-day suppression list after losing stop.",
                ticker,
            )

        return trade

    # ── Summary ───────────────────────────────────────────────────────

    def summary(self) -> str:
        """Human-readable paper trading summary."""
        # Calculate total unrealized P&L
        total_unrealized = sum(
            p.unrealized_pnl for p in self._positions.values()
            if p.current_price > 0
        )

        lines = [
            "",
            "=" * 72,
            "  📝 PAPER TRADING SIMULATOR",
            "=" * 72,
            f"  Starting Capital:  IDR {self._initial_capital:>14,.0f}",
            f"  Current Equity:    IDR {self._equity:>14,.0f}",
            f"  Realized P&L:      IDR {self.total_pnl:>14,.0f}  "
            f"({self.total_return_pct:+.2f}%)",
            f"  Unrealized P&L:    IDR {total_unrealized:>14,.0f}",
            f"  Available Cash:    IDR {self.available_cash:>14,.0f}",
            f"  Portfolio Heat:    {self.heat:>13.2f}%  "
            f"(max {MAX_PORTFOLIO_HEAT_PCT}%)",
            f"  Open Positions:    {self.num_positions} / {MAX_OPEN_POSITIONS}",
        ]

        if self._positions:
            lines.append("")
            lines.append("  --- Open Paper Positions ---")
            for pos in self._positions.values():
                # P&L display
                if pos.current_price > 0:
                    pnl_emoji = "🟢" if pos.unrealized_pnl >= 0 else "🔴"
                    price_info = (
                        f"Now={pos.current_price:>10,.0f}  "
                        f"{pnl_emoji} P&L={pos.unrealized_pnl:>+10,.0f} "
                        f"({pos.unrealized_pnl_pct:>+.2f}%)"
                    )
                else:
                    price_info = "Now=  (pending)"

                # Trailing stop status
                ts_label = "TS" if pos.trailing_stop > pos.stop_loss else "SL"

                lines.append(
                    f"  {pos.ticker:8s} {pos.shares:>6,} shares @ "
                    f"{pos.entry_price:>10,.0f}  {price_info}"
                )
                lines.append(
                    f"           "
                    f"{ts_label}={pos.trailing_stop:>10,.0f}  "
                    f"TP={pos.take_profit:>10,.0f}  "
                    f"SL={pos.stop_loss:>10,.0f}  "
                    f"[{pos.engine}]"
                )

        if self._closed_trades:
            wins = self.win_count
            losses = self.loss_count
            lines.append("")
            lines.append("  --- Closed Paper Trades ---")
            lines.append(
                f"  Total Trades:  {len(self._closed_trades)}  |  "
                f"Win: {wins}  Loss: {losses}  |  "
                f"Win Rate: {self.win_rate:.1f}%"
            )

            # Show recent trades (last 5)
            recent = self._closed_trades[-5:]
            for t in reversed(recent):
                emoji = "✅" if t.pnl > 0 else "❌"
                lines.append(
                    f"  {emoji} {t.ticker:8s} {t.pnl:>+10,.0f} IDR  "
                    f"({t.pnl_pct:>+6.2f}%)  "
                    f"{t.exit_reason:16s}  "
                    f"{t.holding_days:>3d}d  "
                    f"[{t.engine}]"
                )
            if len(self._closed_trades) > 5:
                lines.append(
                    f"  ... and {len(self._closed_trades) - 5} more trades"
                )

        elif not self._positions:
            lines.append("")
            lines.append("  No trades yet. Waiting for scanner signals...")

        lines.append("=" * 72)
        lines.append("")

        return "\n".join(lines)

    # ── Persistence ───────────────────────────────────────────────────

    def save(self, path: Path | None = None) -> None:
        """Save paper portfolio state to JSON."""
        path = path or PAPER_PORTFOLIO_FILE
        path.parent.mkdir(parents=True, exist_ok=True)

        # Calculate portfolio-level unrealized P&L
        total_unrealized = sum(
            p.unrealized_pnl for p in self._positions.values()
            if p.current_price > 0
        )
        total_market_value = sum(
            p.market_value for p in self._positions.values()
        )

        state = {
            "initial_capital": self._initial_capital,
            "equity": self._equity,
            "total_realized_pnl": round(self.total_pnl, 2),
            "total_unrealized_pnl": round(total_unrealized, 2),
            "total_market_value": round(total_market_value, 2),
            "portfolio_heat_pct": round(self.heat, 2),
            "win_rate": round(self.win_rate, 1),
            "total_return_pct": round(self.total_return_pct, 2),
            "positions": {
                k: asdict(v) for k, v in self._positions.items()
            },
            "closed_trades": [asdict(t) for t in self._closed_trades],
        }

        path.write_text(json.dumps(state, indent=2, default=str))
        logger.info("Paper portfolio saved to %s", path)

        try:
            from core.md_reporter import generate_daily_report
            generate_daily_report()
        except Exception as exc:
            logger.warning("Failed to generate daily markdown report: %s", exc)

    @classmethod
    def load(cls, path: Path | None = None) -> PaperPortfolio:
        """Load paper portfolio state from JSON."""
        path = path or PAPER_PORTFOLIO_FILE

        if not path.exists():
            logger.info("No saved paper portfolio, creating new (IDR %s)",
                        f"{PAPER_TRADING_INITIAL_CAPITAL:,.0f}")
            return cls()

        try:
            state = json.loads(path.read_text())
            portfolio = cls(
                capital=state.get("initial_capital", PAPER_TRADING_INITIAL_CAPITAL),
            )
            portfolio._equity = state.get("equity", portfolio._initial_capital)

            for ticker, pos_data in state.get("positions", {}).items():
                portfolio._positions[ticker] = PaperPosition(**pos_data)

            for trade_data in state.get("closed_trades", []):
                portfolio._closed_trades.append(PaperTrade(**trade_data))

            logger.info(
                "Paper portfolio loaded: %d positions, %d closed trades, "
                "equity IDR %s",
                portfolio.num_positions, len(portfolio._closed_trades),
                f"{portfolio._equity:,.0f}",
            )
            return portfolio

        except Exception as e:
            logger.error("Failed to load paper portfolio from %s: %s", path, e)
            return cls()

    # ── Process Scanner Signals (Main Entry Point) ────────────────────

    def process_signals(
        self,
        trade_entries: list,
        regime_value: str,
        price_data: dict[str, pd.DataFrame],
    ) -> dict:
        """
        Full paper trading pipeline for a daily scan run.

        1. Update existing positions (check stops, TPs, reversals)
        2. Enter new trades from scanner signals

        Parameters
        ----------
        trade_entries : list[TradeEntry]
            Trade signals from the scanner.
        regime_value : str
            Current market regime ("BULL", "CAUTION", "BEAR").
        price_data : dict[str, pd.DataFrame]
            Current OHLCV data for all relevant tickers.

        Returns
        -------
        dict
            Summary of actions taken.
        """
        actions = {
            "closed": [],
            "entered": [],
            "skipped": [],
        }

        # Step 1: Update existing positions
        closed_trades = self.update_positions(price_data)
        for t in closed_trades:
            actions["closed"].append({
                "ticker": t.ticker,
                "reason": t.exit_reason,
                "pnl": t.pnl,
                "pnl_pct": t.pnl_pct,
            })

        # Step 2: Enter new trades from scanner signals
        for entry in trade_entries:
            # Double-check cooldown before entry (scanner may not have the latest state)
            if self._cooldown.is_cooling_down(entry.ticker):
                logger.debug(
                    "[Paper] Skipping %s — still under cooldown suppression.",
                    entry.ticker,
                )
                actions["skipped"].append(entry.ticker)
                continue

            pos = self.enter_trade(entry, regime_value)
            if pos:
                actions["entered"].append({
                    "ticker": pos.ticker,
                    "shares": pos.shares,
                    "entry_price": pos.entry_price,
                    "stop_loss": pos.stop_loss,
                    "take_profit": pos.take_profit,
                })
            else:
                actions["skipped"].append(entry.ticker)

        return actions
