"""
CLI tool for calculating trade risk profiles.

Usage:
    # Calculate risk for a specific ticker
    python -m scripts.risk --ticker ASII

    # Custom capital
    python -m scripts.risk --ticker BBCA --capital 200000000

    # With a target price
    python -m scripts.risk --ticker ASII --target 7000

    # Show portfolio summary
    python -m scripts.risk --portfolio
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.settings import (
    ATR_PERIOD,
    DEFAULT_CAPITAL,
    LOG_DATE_FORMAT,
    LOG_FORMAT,
)
from core.database import ParquetStore
from core.indicators import atr, sma
from core.portfolio import Portfolio
from core.regime import MarketRegime
from core.risk import RiskManager

import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="IHSG Trade Risk Calculator",
    )
    parser.add_argument(
        "--ticker", type=str, default=None,
        help="Ticker to calculate risk for",
    )
    parser.add_argument(
        "--capital", type=float, default=DEFAULT_CAPITAL,
        help=f"Total capital (default: IDR {DEFAULT_CAPITAL:,.0f})",
    )
    parser.add_argument(
        "--target", type=float, default=None,
        help="Optional target price for R:R calculation",
    )
    parser.add_argument(
        "--regime", type=str, default=None,
        choices=["BULL", "CAUTION", "BEAR"],
        help="Override regime (default: auto-detect from IHSG)",
    )
    parser.add_argument(
        "--portfolio", action="store_true",
        help="Show current portfolio summary",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format=LOG_FORMAT, datefmt=LOG_DATE_FORMAT,
                        handlers=[logging.StreamHandler(sys.stdout)])
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    logger = logging.getLogger("scripts.risk")

    # Portfolio summary mode
    if args.portfolio:
        portfolio = Portfolio.load()
        print(portfolio.summary())
        return

    if not args.ticker:
        logger.error("Please specify --ticker or --portfolio")
        sys.exit(1)

    ticker = args.ticker.replace(".JK", "").upper()

    # Load data
    store = ParquetStore()
    df = store.load(ticker)
    if df is None or df.empty:
        logger.error("No data for %s. Run ingestion first.", ticker)
        sys.exit(1)

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    # Get current values
    last_close = float(df["Close"].iloc[-1])
    atr_series = atr(df, period=ATR_PERIOD)
    last_atr = float(atr_series.iloc[-1]) if not pd.isna(atr_series.iloc[-1]) else 0

    if last_atr <= 0:
        logger.error("Cannot calculate ATR for %s", ticker)
        sys.exit(1)

    # Resolve regime
    if args.regime:
        regime_name = args.regime.upper()
    else:
        try:
            regime = MarketRegime(period="1y")
            regime_name = regime.status.value
        except Exception:
            regime_name = "CAUTION"
            logger.warning("Could not detect regime, defaulting to CAUTION")

    # Calculate risk
    rm = RiskManager()
    risk = rm.calculate_trade_risk(
        ticker=ticker,
        entry_price=last_close,
        atr_value=last_atr,
        capital=args.capital,
        regime=regime_name,
        target_price=args.target,
    )

    # Display
    print()
    print(risk)

    # Portfolio heat check
    portfolio = Portfolio.load()
    allowed, reason = portfolio.can_take_trade(risk.risk_amount)
    print()
    if allowed:
        print(f"  Portfolio: ALLOWED (current heat: {portfolio.heat:.2f}%)")
    else:
        print(f"  Portfolio: BLOCKED - {reason}")
    print()


if __name__ == "__main__":
    main()
