"""
CLI entry point for the Master Scanner Engine.

Runs the tri-bucket scanner against locally-cached OHLCV data
and prints a categorized report.

Usage:
    # Scan all stored tickers
    python -m scripts.scan

    # Scan specific tickers
    python -m scripts.scan --tickers BBCA BBRI TLKM ASII UNVR

    # Include earnings proximity check (slower, requires network)
    python -m scripts.scan --check-earnings

    # Verbose output
    python -m scripts.scan -v
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

# Ensure project root is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.settings import LOG_DATE_FORMAT, LOG_FORMAT
from core.database import ParquetStore
from core.scanner import MasterScanner


def setup_logging(verbose: bool = False) -> None:
    """Configure logging for the scanner."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format=LOG_FORMAT,
        datefmt=LOG_DATE_FORMAT,
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="IHSG Master Scanner -- Avoid / Wait / Trade Triage",
    )
    parser.add_argument(
        "--tickers", nargs="+", default=None,
        help="Specific tickers to scan (default: all stored tickers)",
    )
    parser.add_argument(
        "--check-earnings", action="store_true",
        help="Check for upcoming earnings (requires network, slower)",
    )
    parser.add_argument(
        "--no-regime", action="store_true",
        help="Skip regime detection (defaults to CAUTION)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable debug-level logging",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    setup_logging(verbose=args.verbose)
    logger = logging.getLogger("scripts.scan")

    store = ParquetStore()
    scanner = MasterScanner(store)

    # Resolve ticker list
    if args.tickers:
        tickers = [t.replace(".JK", "").upper() for t in args.tickers]
    else:
        tickers = store.list_tickers()

    if not tickers:
        logger.error("No tickers to scan. Run the ingestion script first.")
        sys.exit(1)

    logger.info("=" * 70)
    logger.info("IHSG Master Scanner")
    logger.info("=" * 70)
    logger.info("Tickers:          %d", len(tickers))
    logger.info("Earnings check:   %s", args.check_earnings)
    logger.info("=" * 70)

    # Resolve regime
    regime = None
    if args.no_regime:
        from core.regime import RegimeSnapshot, RegimeType
        regime = RegimeSnapshot(
            regime=RegimeType.CAUTION,
            close=0, sma_short=0, sma_long=0, atr_value=0,
            hurst_value=0.5,
            as_of_date="skipped (--no-regime)",
        )

    start = time.time()
    result = scanner.scan_universe(
        tickers, check_earnings=args.check_earnings, regime=regime,
    )
    elapsed = time.time() - start

    # ── Report ────────────────────────────────────────────────────────
    print()
    print("=" * 70)
    print("SCAN REPORT")
    print("=" * 70)

    # Stats
    stats = result.stats
    print(f"\nTotal scanned:   {stats.get('total_scanned', 0)}")
    print(f"With data:       {stats.get('total_with_data', 0)}")
    print(f"Duration:        {elapsed:.1f}s")

    # Regime status
    regime_status = stats.get('regime', 'N/A')
    regime_detail = stats.get('regime_detail', '')
    print(f"\n--- REGIME: {regime_status} ---")
    if regime_detail:
        print(f"  {regime_detail}")

    # Avoid breakdown
    avoid_bk = stats.get("avoid_breakdown", {})
    if avoid_bk:
        print(f"\n--- AVOID ({len(result.avoid)} stocks) ---")
        print(f"  Low ADTV:          {avoid_bk.get('low_adtv', 0)}")
        print(f"  Penny stocks:      {avoid_bk.get('penny_stock', 0)}")
        print(f"  Below SMA(200):    {avoid_bk.get('below_sma200', 0)}")
        print(f"  Earnings nearby:   {avoid_bk.get('earnings_proximity', 0)}")
        print(f"  Insufficient data: {avoid_bk.get('insufficient_data', 0)}")

    # Wait
    if result.wait:
        print(f"\n--- WAIT ({len(result.wait)} stocks) ---")
        for entry in result.wait:
            detail_str = ""
            if entry.condition == "tight_consolidation":
                detail_str = (
                    f"range={entry.details.get('range_pct', '?')}% "
                    f"over {entry.details.get('window', '?')}d, "
                    f"price={entry.details.get('price', '?')}"
                )
            elif entry.condition == "fvg_approach":
                detail_str = (
                    f"FVG [{entry.details.get('gap_low', '?')}-"
                    f"{entry.details.get('gap_high', '?')}] "
                    f"on {entry.details.get('fvg_date', '?')}, "
                    f"dist={entry.details.get('distance', '?')}"
                )
            elif entry.condition == "trade_overflow":
                detail_str = (
                    f"signal={entry.details.get('signal', '?')}, "
                    f"score={entry.details.get('score', '?')}"
                )
            print(f"  {entry.ticker:10s} [{entry.condition}] {detail_str}")
    else:
        print(f"\n--- WAIT (0 stocks) ---")
        print("  No stocks in Wait bucket.")

    # Trade
    if result.trade:
        print(f"\n--- TRADE ({len(result.trade)} stocks) ---")
        for rank, entry in enumerate(result.trade, start=1):
            print(
                f"  #{rank} {entry.ticker:10s} "
                f"signal={entry.signal:25s} "
                f"score={entry.score:6.2f}  "
                f"price={entry.price}  "
                f"vol_ratio={entry.details.get('volume_ratio', '?')}  "
                f"rsi={entry.details.get('rsi', '?')}"
            )
    else:
        print(f"\n--- TRADE (0 stocks) ---")
        print("  No entry signals triggered today.")

    # Skipped
    if result.skipped:
        print(f"\n--- SKIPPED ({len(result.skipped)} tickers, no data) ---")
        if len(result.skipped) <= 20:
            print(f"  {', '.join(result.skipped)}")
        else:
            print(f"  {', '.join(result.skipped[:20])}... and {len(result.skipped)-20} more")

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()
