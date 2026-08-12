# Operational Workflows

The Bot Trading Simulator is fully automated using GitHub Actions and local cron-based orchestrations. This document outlines the distinct operational pipelines that keep the trading bot functioning, tracking data, and retraining models.

## 1. Daily Unified Workflow (`scripts/daily.py`)

This is the primary script that runs the end-to-end simulation cycle.
- **Trigger:** Automated via GitHub Actions (03:00 AM WIB, Weekdays) or executed manually.
- **Pipeline:**
  1. **Ingestion (Phase 1):** Scrapes OHLCV data from Yahoo Finance and Bandarmology data from Stockbit. Syncs to Parquet cache.
  2. **Regime Evaluation (Phase 2):** Assesses composite indices to set global BULL/CAUTION/BEAR state and updates ML clustering.
  3. **Master Scan (Phase 3):** Triages 591 stocks using adaptive thresholds, passing qualified candidates through 3 active entry engines (pure momentum + ML4T stack).
  4. **Risk Calculation (Phase 4):** Calculates precise position sizing based on ATR, regime, and Bayesian market volatility.
  5. **Paper Trading execution:** Automatically records the highest-conviction signals as virtual positions in `data/paper_portfolio.json`. Evaluates exits for current open positions (e.g., 20-Day Reversal Profit Maximizer, Trailing Stops).
  6. **Reporting:** Generates the date-stamped HTML dashboard and exports the results to `data/daily_tracking.json` and Markdown reports (`data/daily_tracking.md`, `data/paper_portfolio.md`).
- **Git-Ops Persistence:** Workflows automatically commit updated JSON state and Markdown reports back to the `main` branch under the user's GitHub attribution to keep the contribution graph active.

```bash
# Manual run examples:
python -m scripts.daily
python -m scripts.daily --tickers ASII BBCA TLKM # Targeted scan
python -m scripts.daily --check-earnings         # Slower run with fundamental checks
```

## 2. Midday Evaluation Workflow (`scripts/midday.py`)

An interim scan executed while the market is still open.
- **Trigger:** Automated via GitHub Actions (12:15 PM WIB, Weekdays).
- **Purpose:**
  - Evaluates macro veto statuses to check if the broader market is tanking intraday.
  - Conducts "Gap-and-Crap" detection (identifying false breakouts).
  - Appends vetoes and warnings to `data/daily_tracking.json`. This ensures that aggressive end-of-day entries can be canceled manually if intraday behavior is highly bearish.

## 3. Machine Learning Weekly Training Workflow (`scripts/train_models.py`)

A decoupled pipeline strictly for updating predictive models without interrupting daily scanning.
- **Trigger:** Automated via `weekly-train.yml` GitHub Actions (Every Sunday).
- **Pipeline:**
  1. Compiles the complete historical dataset from the local Parquet cache.
  2. Calculates required feature sets (Wavelet/Kalman denoising, formulaic alphas).
  3. **Trains XGBoost Model:** Generates probability targets for 20-day returns > 2%.
  4. **Trains LSTM Model:** Retrains deep learning sequences for 60-day directional prediction.
  5. Persists resulting artifacts to `data/models/xgb_entry_model.joblib` and `data/models/lstm_direction_model/`.
- **Git-Ops Persistence:** Trained models are automatically committed to the repository, ready to be consumed by Monday's `daily.py` run.

## 4. Backtesting Workflow (`scripts/backtest.py`)

Used for historical strategy validation when modifying engines or thresholds.
- **Usage:** Run entirely manually by the developer locally.
- **Mechanism:**
  - Implements an event-driven loop that feeds historical slices into the identical Scanner and Risk Manager used in production.
  - Ensures strictly no look-ahead bias.
  - Replays trades under hardcoded IDX slip and fee environments.
  - Generates comprehensive tear-sheets including Win Rate, Max Drawdown, Sharpe Ratio, Profit Factor, and EV.

```bash
# Manual run examples:
python -m scripts.backtest
python -m scripts.backtest --tickers BBCA BBRI ASII TLKM UNVR
```

## 5. Live Execution Pipeline (`scripts/execute.py`)

The interface for moving from paper trading to live real-money environments.
- **Purpose:** Wraps generated signals into actual broker API payloads.
- **Features:** 
  - Submits strict **Bracket Orders** (Buy + SL + TP).
  - **Fat Finger Guards:** Strict hard limits rejecting orders > 1000 shares or > IDR 2.5M.
  - **Circuit Breaker:** Will refuse to fire any buy orders if the simulated portfolio indicates a drop of > 3% on the current day.

```bash
# Manual run examples:
python -m scripts.execute --dry-run
python -m scripts.execute
```
