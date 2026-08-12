"""
CLI entry point for OHLCV data ingestion.

Usage:
    # Download all IHSG tickers (5-year history, skip existing)
    python -m scripts.ingest

    # Download specific tickers
    python -m scripts.ingest --tickers BBCA BBRI TLKM

    # Full re-download (ignore existing data)
    python -m scripts.ingest --no-resume --period 5y

    # Dry run (show what would be downloaded)
    python -m scripts.ingest --dry-run
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

# Ensure project root is on sys.path when running as a module
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.settings import (
    DATA_DIR,
    DEFAULT_PERIOD,
    LOG_DATE_FORMAT,
    LOG_FORMAT,
)
from config.tickers import IHSG_TICKERS, get_ticker_count
from core.data_cleaner import DataCleaner
from core.database import ParquetStore
from core.ingestion import DataIngestor


def setup_logging(verbose: bool = False) -> None:
    """Configure logging for the ingestion script."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format=LOG_FORMAT,
        datefmt=LOG_DATE_FORMAT,
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )
    # Suppress noisy third-party loggers
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("peewee").setLevel(logging.WARNING)


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="IHSG OHLCV Data Ingestion Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python -m scripts.ingest\n"
            "  python -m scripts.ingest --tickers BBCA BBRI TLKM\n"
            "  python -m scripts.ingest --no-resume --period 2y\n"
            "  python -m scripts.ingest --dry-run\n"
        ),
    )
    parser.add_argument(
        "--tickers",
        nargs="+",
        default=None,
        help="Specific tickers to download (default: all IHSG tickers)",
    )
    parser.add_argument(
        "--period",
        type=str,
        default=DEFAULT_PERIOD,
        help=f"Download period (default: {DEFAULT_PERIOD})",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Force re-download even if data already exists",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be downloaded without fetching",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug-level logging",
    )
    return parser.parse_args()


def main() -> None:
    """Main entry point for the ingestion CLI."""
    args = parse_args()
    setup_logging(verbose=args.verbose)

    logger = logging.getLogger("scripts.ingest")

    # Resolve ticker list
    tickers = args.tickers if args.tickers else IHSG_TICKERS
    resume = not args.no_resume

    logger.info("=" * 70)
    logger.info("IHSG OHLCV Data Ingestion Engine")
    logger.info("=" * 70)
    logger.info("Tickers:    %d (of %d in universe)", len(tickers), get_ticker_count())
    logger.info("Period:     %s", args.period)
    logger.info("Resume:     %s", resume)
    logger.info("Data dir:   %s", DATA_DIR)
    logger.info("=" * 70)

    # ── Dry run ──────────────────────────────────────────────────────
    if args.dry_run:
        store = ParquetStore()
        existing = set(store.list_tickers())

        to_download = []
        to_skip = []
        for t in tickers:
            clean = t.replace(".JK", "").upper()
            if resume and clean in existing:
                to_skip.append(clean)
            else:
                to_download.append(clean)

        logger.info("[DRY RUN] Would download: %d tickers", len(to_download))
        logger.info("[DRY RUN] Would skip:     %d tickers", len(to_skip))

        if to_download:
            sample = to_download[:20]
            logger.info(
                "[DRY RUN] First 20: %s%s",
                ", ".join(sample),
                "..." if len(to_download) > 20 else "",
            )
        return

    # ── Real ingestion ───────────────────────────────────────────────
    store = ParquetStore()
    cleaner = DataCleaner()
    ingestor = DataIngestor(store, cleaner)

    start = time.time()

    result = ingestor.download_all(
        tickers=tickers,
        period=args.period,
        resume=resume,
    )

    elapsed = time.time() - start

    # ── Summary report ───────────────────────────────────────────────
    logger.info("")
    logger.info("=" * 70)
    logger.info("INGESTION REPORT")
    logger.info("=" * 70)
    logger.info("Succeeded:  %d", result.success)
    logger.info("Failed:     %d", result.failed)
    logger.info("Skipped:    %d", result.skipped)
    logger.info("Duration:   %.1f minutes", elapsed / 60)
    logger.info("Data dir:   %s", DATA_DIR)

    if result.errors:
        logger.info("")
        logger.info("Failed tickers:")
        for err in result.errors[:30]:  # Show first 30
            logger.info("  ✗ %s — %s", err["ticker"], err["reason"])
        if len(result.errors) > 30:
            logger.info("  ... and %d more", len(result.errors) - 30)

    logger.info("=" * 70)

    # In a universe of ~600 IHSG stocks, 50-80 will always fail
    # because they are delisted, suspended, or not tracked by Yahoo.
    # We only want to fail the CI/CD pipeline if a MASSIVE failure occurs
    # (e.g., Yahoo IP ban or no internet), like > 50% failure rate.
    total = result.success + result.failed + result.skipped
    if total > 0 and (result.failed / total) > 0.5:
        logger.error("CRITICAL: > 50%% of ticker downloads failed! Exiting with code 1.")
        sys.exit(1)
    
    # Otherwise, successful pipeline run
    sys.exit(0)


if __name__ == "__main__":
    main()
