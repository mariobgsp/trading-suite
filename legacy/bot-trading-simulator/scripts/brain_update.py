"""
Brain Update Script — Sync trade outcomes to the Stock Brain.

Runs after the daily scan to:
  1. Sync all closed trades from the paper portfolio into brain memory
  2. Run inference on stocks that have accumulated new data
  3. Optionally generate LLM insights for stocks with enough history

Usage:
    python -m scripts.brain_update               # sync all closed trades
    python -m scripts.brain_update --ticker BBCA  # specific ticker
    python -m scripts.brain_update --infer-all    # re-run inference on all stocks
    python -m scripts.brain_update --dry-run      # show what would happen
    python -m scripts.brain_update --status       # print brain status report
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import BRAIN_DATA_DIR, BRAIN_ENABLED, BRAIN_MIN_TRADES_FOR_CONFIDENCE
from core.stock_brain import StockBrain

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Portfolio data path ──────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PORTFOLIO_STATE_FILE = PROJECT_ROOT / "data" / ".portfolio_state.json"


class BrainUpdater:
    """
    Orchestrates syncing paper trade outcomes into the Stock Brain.

    Reads closed trades from data/.portfolio_state.json and calls
    StockBrain.record_outcome() for any outcome not yet recorded.
    """

    def __init__(self, dry_run: bool = False) -> None:
        self._brain = StockBrain()
        self._dry_run = dry_run

    def sync_closed_trades_to_brain(self, tickers: list[str] | None = None) -> int:
        """
        Sync all closed trades from the portfolio to the brain.

        Idempotent: re-running won't double-count outcomes.
        Returns number of outcomes synced.
        """
        if not BRAIN_ENABLED:
            logger.info("Brain is disabled (BRAIN_ENABLED=False). Skipping.")
            return 0

        if not PORTFOLIO_STATE_FILE.exists():
            logger.warning("Portfolio state file not found: %s", PORTFOLIO_STATE_FILE)
            return 0

        try:
            state = json.loads(PORTFOLIO_STATE_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            logger.error("Failed to read portfolio state: %s", e)
            return 0

        closed_trades = state.get("closed_trades", [])
        if not closed_trades:
            logger.info("No closed trades found in portfolio state.")
            return 0

        # Filter by tickers if specified
        if tickers:
            closed_trades = [t for t in closed_trades if t.get("ticker") in tickers]

        logger.info("Processing %d closed trade(s) from portfolio...", len(closed_trades))

        if self._dry_run:
            for trade in closed_trades:
                logger.info(
                    "  [DRY RUN] Would sync: %s | %s | %.2f%% | %s",
                    trade.get("ticker"), trade.get("engine"),
                    trade.get("pnl_pct", 0), trade.get("exit_reason"),
                )
            return len(closed_trades)

        count = self._brain.sync_outcomes_from_portfolio(closed_trades)
        logger.info("Synced %d outcome(s) to brain.", count)
        return count

    def run_inference_for_all(
        self, min_trades: int = BRAIN_MIN_TRADES_FOR_CONFIDENCE
    ) -> list[str]:
        """
        Run inference on all stocks that have enough trade history.

        Returns list of tickers that were updated.
        """
        if not BRAIN_DATA_DIR.exists():
            logger.info("No brain data directory found. Run sync first.")
            return []

        updated = []
        brain_files = list(BRAIN_DATA_DIR.glob("*.json"))

        if not brain_files:
            logger.info("No brain files found. Run sync first.")
            return []

        logger.info("Running inference on %d stock(s)...", len(brain_files))

        for brain_file in brain_files:
            ticker = brain_file.stem  # filename without .json
            try:
                memory = self._brain.load(ticker)
                if memory.total_closed_trades >= min_trades:
                    if self._dry_run:
                        logger.info(
                            "  [DRY RUN] Would run inference for %s (%d trades)",
                            ticker, memory.total_closed_trades,
                        )
                    else:
                        self._brain.run_inference(ticker)
                    updated.append(ticker)
            except Exception as e:
                logger.warning("Failed to run inference for %s: %s", ticker, e)

        logger.info("Inference complete for %d stock(s).", len(updated))
        return updated

    def report_brain_status(self) -> None:
        """Print a status report of all stocks with brain data."""
        if not BRAIN_DATA_DIR.exists():
            print("No brain data found.")
            return

        brain_files = list(BRAIN_DATA_DIR.glob("*.json"))
        if not brain_files:
            print("No brain files found.")
            return

        print(f"\n{'='*75}")
        print(f"STOCK BRAIN STATUS — {len(brain_files)} stock(s) with memory")
        print(f"{'='*75}")
        print(
            f"{'Ticker':<8} {'Trades':<8} {'WinRate':<10} "
            f"{'BestEngine':<28} {'Boost':<8} {'Tags'}"
        )
        print("-" * 75)

        for brain_file in sorted(brain_files):
            ticker = brain_file.stem
            memory = self._brain.load(ticker)
            wr = f"{memory.overall_win_rate:.0%}" if memory.total_closed_trades > 0 else "N/A"
            engine = (memory.best_engine or "learning...")[:27]
            boost = f"{memory.brain_score_boost:+.2f}" if memory.brain_score_boost != 0 else " 0.00"
            tags_str = ", ".join(memory.tags[:2]) if memory.tags else ""
            print(
                f"{ticker:<8} {memory.total_closed_trades:<8} {wr:<10} "
                f"{engine:<28} {boost:<8} {tags_str}"
            )

        print(f"{'='*75}\n")


# ─── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync paper trade outcomes to the Stock Brain and run inference."
    )
    parser.add_argument(
        "--ticker", nargs="+",
        help="Sync only specific ticker(s). Default: all.",
    )
    parser.add_argument(
        "--infer-all", action="store_true",
        help="Re-run inference on all stocks with enough history.",
    )
    parser.add_argument(
        "--status", action="store_true",
        help="Print brain status report and exit.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would happen without writing anything.",
    )
    args = parser.parse_args()

    updater = BrainUpdater(dry_run=args.dry_run)

    if args.status:
        updater.report_brain_status()
        return

    # Step 1: Sync closed trades
    synced = updater.sync_closed_trades_to_brain(tickers=args.ticker)
    logger.info("Sync complete: %d outcomes processed.", synced)

    # Step 2: Run inference if requested or if we synced new outcomes
    if args.infer_all or synced > 0:
        updated = updater.run_inference_for_all()
        logger.info("Inference updated %d stock(s).", len(updated))

    # Always show status summary
    updater.report_brain_status()


if __name__ == "__main__":
    main()
