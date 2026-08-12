"""
ML4T Model Training Script.

Trains all ML models used by the IHSG swing trading system:
  1. XGBoost entry model (Enhancement 3)
  2. LSTM direction model (Enhancement 4)
  3. Bayesian volatility calibration (Enhancement 5 — future)

Trained models are saved to ``data/models/`` and loaded by the daily
scan for inference. This script is designed to run weekly via the
``weekly-train.yml`` GitHub Actions workflow.

Usage:
    python -m scripts.train_models                 # Train all models
    python -m scripts.train_models --xgboost       # XGBoost only
    python -m scripts.train_models --lstm           # LSTM only
    python -m scripts.train_models --tickers BBCA BBRI TLKM  # Subset
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.settings import LOG_DATE_FORMAT, LOG_FORMAT, ML_MODELS_DIR


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level, format=LOG_FORMAT, datefmt=LOG_DATE_FORMAT,
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ML4T Model Training — Train all ML models for the IHSG system",
    )
    parser.add_argument(
        "--xgboost", action="store_true",
        help="Train only the XGBoost entry model",
    )
    parser.add_argument(
        "--lstm", action="store_true",
        help="Train only the LSTM direction model",
    )
    parser.add_argument(
        "--tickers", nargs="+", default=None,
        help="Train on specific tickers only (default: all stored)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
    )
    return parser.parse_args()


def load_all_data(tickers: list[str] | None = None) -> dict:
    """Load OHLCV data for all (or specified) tickers."""
    from core.database import ParquetStore
    from core.data_cleaner import DataCleaner

    store = ParquetStore()
    cleaner = DataCleaner()

    if tickers is None:
        tickers = store.list_tickers()

    logger = logging.getLogger("scripts.train_models")
    logger.info("Loading data for %d tickers...", len(tickers))

    all_data = {}
    for ticker in tickers:
        try:
            df = store.load(ticker)
            if df is not None and not df.empty:
                df = cleaner.clean(df, ticker)
                if len(df) >= 200:  # Need enough history for training
                    all_data[ticker] = df
        except Exception as e:
            logger.debug("[%s] Load error: %s", ticker, e)

    logger.info("Loaded %d tickers with sufficient data", len(all_data))
    return all_data


def compute_profiles(all_data: dict) -> dict:
    """Compute StockProfile for each ticker."""
    from core.adaptive import AdaptiveDetector

    logger = logging.getLogger("scripts.train_models")
    detector = AdaptiveDetector()

    profiles = {}
    for ticker, df in all_data.items():
        try:
            profile = detector.build_profile(ticker, df)
            if profile is not None:
                profiles[ticker] = profile
        except Exception as e:
            logger.debug("[%s] Profile error: %s", ticker, e)

    logger.info("Computed %d stock profiles", len(profiles))
    return profiles


def train_xgboost(all_data: dict, profiles: dict) -> bool:
    """Train the XGBoost entry model."""
    logger = logging.getLogger("scripts.train_models")
    logger.info("=" * 60)
    logger.info("Training XGBoost Entry Model")
    logger.info("=" * 60)

    try:
        from core.ml_engine import XGBoostTrainer
        trainer = XGBoostTrainer()
        model = trainer.train(all_data, profiles)
        if model is not None:
            logger.info("✅ XGBoost model trained successfully")
            return True
        else:
            logger.warning("❌ XGBoost training returned no model")
            return False
    except Exception as e:
        logger.error("❌ XGBoost training failed: %s", e)
        return False


def train_lstm(all_data: dict) -> bool:
    """Train the LSTM direction model."""
    logger = logging.getLogger("scripts.train_models")
    logger.info("=" * 60)
    logger.info("Training LSTM Direction Model")
    logger.info("=" * 60)

    try:
        from core.deep_engine import LSTMTrainer
        trainer = LSTMTrainer()
        model = trainer.train(all_data)
        if model is not None:
            logger.info("✅ LSTM model trained successfully")
            return True
        else:
            logger.warning("❌ LSTM training returned no model")
            return False
    except Exception as e:
        logger.error("❌ LSTM training failed: %s", e)
        return False


def main() -> None:
    args = parse_args()
    setup_logging(verbose=args.verbose)
    logger = logging.getLogger("scripts.train_models")

    logger.info("=" * 60)
    logger.info("ML4T Model Training Script")
    logger.info("=" * 60)

    start = time.time()

    # Ensure models directory exists
    ML_MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Parse ticker filter
    tickers = None
    if args.tickers:
        tickers = [t.replace(".JK", "").upper() for t in args.tickers]

    # Load data
    all_data = load_all_data(tickers)
    if not all_data:
        logger.error("No data available for training. Run ingestion first.")
        sys.exit(1)

    # Determine which models to train
    train_all = not args.xgboost and not args.lstm
    results = {}

    # Train XGBoost
    if train_all or args.xgboost:
        profiles = compute_profiles(all_data)
        results["xgboost"] = train_xgboost(all_data, profiles)

    # Train LSTM
    if train_all or args.lstm:
        results["lstm"] = train_lstm(all_data)

    # Summary
    elapsed = time.time() - start
    logger.info("=" * 60)
    logger.info("Training Summary")
    logger.info("=" * 60)
    for model_name, success in results.items():
        status = "✅ Success" if success else "❌ Failed"
        logger.info("  %s: %s", model_name.upper(), status)
    logger.info("Total time: %.1f seconds", elapsed)
    logger.info("Models saved to: %s", ML_MODELS_DIR)


if __name__ == "__main__":
    main()
