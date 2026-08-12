# IHSG Swing Trading System (v5.0.0 — AI Brain & Memory)

A highly rigorous, accuracy-first swing trading application specifically designed for the Indonesian Stock Exchange (IHSG).

This system automates daily data ingestion, technical scanning, market regime detection, **adaptive per-stock signal detection**, entry signal generation, risk management, backtesting, **daily JSON tracking**, and live execution through a structured, 9-phase architecture. The system now includes an **AI Brain & Memory layer** that learns which trading method works best for each individual stock and adapts signal scoring accordingly.

## 🏗️ Architecture

1. **Infrastructure & Data Engineering (`core/ingestion.py`, `core/data_cleaner.py`)**
   - Ingests daily OHLCV data for 591 curated IHSG tickers.
   - Handles splits, NaN gaps, and extreme volume spikes.
   - Stores data locally in optimized Parquet format (`data/ohlcv/`).
   - Rate-limited `yfinance` integration to prevent IP bans.
   - ⭐ **ML4T**: Wavelet denoising (Daubechies-4) and Kalman filter smoothing for noise reduction.

2. **Master Scanner Engine (`core/scanner.py`)**
   - Scans the universe of stocks through a strict "Tri-Bucket" triage pipeline:
     - **Avoid Bucket**: Filters out illiquid stocks (< IDR 2B ADTV), penny stocks (< IDR 50), fundamentally broken stocks trading >35% below their SMA(200), and stocks reporting earnings within 48 hours. Also skips any stock currently under a **Failed Trade Cooldown**.
     - **Wait Bucket**: Parks stocks setting up for a trade (e.g., tight consolidation, high-probability momentum flags, or volume spikes).
     - **Trade Bucket**: The highest confidence, ready-to-execute signals (max 5 per day).
   - **Adaptive Detector Integration**: After passing Avoid filters, each stock gets a personalized `StockProfile` computed from its own 2-year history.

3. **Adaptive Per-Stock Detector (`core/adaptive.py`)** ⭐ NEW
   - Computes a statistical profile for each stock from up to 2 years of history.
   - Replaces fixed global thresholds with stock-specific ones:
     - **RSI Oversold/Overbought**: 10th/90th percentile of the stock's own RSI distribution.
     - **Volume Spike Threshold**: 90th percentile of the stock's own volume ratio.
     - **Typical Range**: Median of rolling 20-day price ranges.
     - **ATR%**: Normalized volatility (ATR/Close).
     - **Hurst Exponent**: Mean-reversion vs trending tendency.
     - **Trend Strength**: Linear regression slope over 60 days.
   - Makes the system MORE sensitive for stable blue-chip stocks and MORE conservative for volatile stocks.

4. **Market Regime, Entry Engines & AI Brain (`core/regime.py`, `core/engines.py`, `core/ml_engine.py`, `core/deep_engine.py`, `core/stock_brain.py`, `core/brain_inference.py`)**
   - **Regime Filter**: Classifies the broader IHSG composite (`^JKSE`) as `BULL`, `CAUTION`, or `BEAR` based on the Hurst exponent.
   - ⭐ **ML Regime**: PCA + K-Means clustering provides an unsupervised second opinion on the market regime with confidence scores.
   - **Entry Engines** (3 crossover engines):
     - _Priority 3: Stochastic Crossover_ — Triggers when Fast %K crosses above %D from below in oversold territory, with volume > SMA 20.
     - _Priority 2: MACD Crossover_ — Triggers when MACD Line crosses above Signal Line, with volume > SMA 20.
     - _Priority 1: MA Crossover_ — Triggers when SMA 50 crosses above SMA 200, with volume > SMA 20.
   - 🧠 **AI Brain & Memory** ⭐ NEW — Per-stock learning system that adapts signal scoring based on historical outcomes.

5. **Risk Management Engine (`core/risk.py`, `core/portfolio.py`)**
   - Deterministic ATR-based mathematics.
   - Calculates Stop-Loss (1.5x ATR) and Chandelier Trailing Stops (2.0x ATR).
   - Dynamic position sizing forcing equal risk across trades (default 2% of capital), rounding to IDX lot sizes (100 shares).
   - **Portfolio Heat tracking**: Caps maximum simultaneous open risk at 6% of total capital.
   - Regime-adjusted risk: Halves position sizes in CAUTION (1%), quarters them in BEAR (0.5%).
   - **20-Day Reversal Exit**: Monitors positions for profit-maximizing exits within the first 20 holding days.
   - ⭐ **ML4T**: Bayesian stochastic volatility estimation (PyMC) for dynamic risk sizing based on posterior vol distributions.

6. **Daily Output Dashboard (`core/report.py`, `scripts/daily.py`, `core/alerts.py`)**
   - Unified daily workflow combining all the above into a single execution step.
   - Generates formatted console reports and a dark-themed `.html` dashboard showing portfolio heat and actionable Trade Cards.
   - CRITICAL-level alert logging for new signals.
   - **Reversal exit checking** for open positions on each daily run.

7. **Backtesting Engine (`core/backtester.py`, `core/backtest_report.py`)**
   - Event-driven replay through the same scanner + engines + risk manager. Zero look-ahead bias.
   - Automatic 3.5-year Training / 1.5-year Blind Test split.
   - Hardcoded slippage (0.15% per side) and IDX broker fees (0.15% buy, 0.25% sell).
   - **20-Day Reversal Exit simulation** with profit-lock and bearish reversal detection.
   - **Report Card**: Win Rate, Expected Value, Max Drawdown (⚠️ >15%), Sharpe Ratio, Profit Factor (⚠️ <1.5), Win/Loss Streaks.

8. **Live Execution & Failsafes (`core/broker.py`, `core/failsafes.py`, `core/bracket_order.py`, `core/cooldown.py`)**
   - Abstract broker adapter with `SimulatedBroker` for testing.
   - **Fat Finger Guard**: Hard limit of 1,000 shares / IDR 2.5M per order.
   - **Daily Drawdown Breaker**: Halts all trading if the account drops 3% in a single day.
   - **Failed Trade Cooldown**: Prevents the bot from re-entering the same failing stock by enforcing a 30-day cooldown block after any stop-loss hit.
   - **Bracket Orders**: Sends Buy + Stop-Loss + Take-Profit (2x ATR) simultaneously.
   - Cron-ready execution CLI scheduled for 15:50 WIB.

## ⭐ Key Features (v5.0.0 — AI Brain & Memory)

### 🧠 AI Brain & Memory System ⭐ NEW

The most significant upgrade: the system now **learns from its own trade history** to determine the optimal trading approach for each individual stock.

**How it works:**
1. **Signal Recording** (`core/stock_brain.py`): Every time the paper trader enters a position, a `SignalRecord` is persisted to `data/brain/<TICKER>.json`, capturing full technical context (RSI, volume ratio, Hurst, confluence count, ML probability, regime).
2. **Outcome Recording**: When a trade closes (take-profit, stop-loss, or reversal exit), the outcome (P&L%, hold days, exit reason) is written back to the same record.
3. **Statistical Inference** (`core/brain_inference.py`): After accumulating 3+ trades per stock, the `BrainInferenceEngine` runs:
   - **Best Engine Selection**: Identifies which engine has the highest decay-weighted win rate (recent trades count more via `BRAIN_LEARNING_DECAY=0.92`).
   - **Score Boost Computation**: Calculates an additive `brain_score_boost` (range: ±1.5) that is applied in the scanner — preferred engines get boosted, historically-losing engines get penalized.
   - **Behavioral Tagging**: Auto-generates tags like `trending`, `mean_reverting`, `volume_spike_responder`, `deep_oversold_responder`, `high_confluence_required`, `ml_driven`.
   - **Insight Generation**: Produces a human-readable insight string per stock (LLM-powered if `BRAIN_LLM_ENABLED=True` and `GEMINI_API_KEY` is set; rule-based by default).
4. **Scanner Integration**: Before evaluating engines for each ticker, the scanner queries the brain (`StockBrain.query(ticker)`). The brain context then adjusts each competing engine's score, causing the system to **naturally prefer the historically-best method for that specific stock**.
5. **Daily Sync** (`scripts/brain_update.py`): After each daily workflow, `brain_update.py` syncs all new trade outcomes and re-runs inference on stocks with updated histories.

**Storage**: One JSON file per stock in `data/brain/`, committed to GitHub by the Actions workflow. Zero external dependencies.

**CLI Usage:**
```bash
python -m scripts.brain_update               # sync all closed trades
python -m scripts.brain_update --status       # print brain status table
python -m scripts.brain_update --infer-all    # re-run inference on all stocks
python -m scripts.brain_update --dry-run      # preview changes
```

### ML4T Enhancement 1: Advanced Feature Engineering & Denoising ⭐ NEW
- **Wavelet Denoising**: Daubechies-4 wavelet with soft thresholding removes high-frequency noise from Close prices while preserving trend structure.
- **Kalman Filter**: State-space model provides an optimally smoothed "true" price estimate.
- **Formulaic Alpha Factors** (WorldQuant-inspired, pure numpy/pandas — no TA-Lib):
  - **Momentum Alpha**: Normalized rate-of-change capturing short-term directional strength.
  - **Mean Reversion Alpha**: Bollinger Band z-score measuring distance from rolling mean.
  - **Liquidity Alpha**: VWAP deviation capturing position relative to volume-weighted price.
  - **Volatility Regime Alpha**: Realized vol z-score detecting regime shifts.
  - **Money Flow Alpha**: Chaikin Money Flow capturing buying/selling pressure.

### ML4T Enhancement 2: Unsupervised Market Regime Engine ⭐ NEW
- **PCA + K-Means clustering** on rolling market features (returns, volatility, volume, trend)
- Provides a regime confidence score alongside the traditional Hurst-based classification
- Logs regime disagreements for analysis (Hurst remains ground truth)

### ML4T Enhancement 3: XGBoost Entry Engine ⭐ NEW
- **Gradient Boosting Classifier** trained on all 591 tickers using formulaic alphas + technical indicators
- Predicts probability of successful trade (P&L > 2% in 20 days)
- Only fires when probability exceeds 60% (configurable threshold)
- Time-series cross-validated to avoid look-ahead bias
- Model saved to `data/models/xgb_entry_model.joblib`

### ML4T Enhancement 4: LSTM Direction Engine ⭐ NEW
- **Universal 2-layer LSTM** trained on 60-day OHLCV sequences across all tickers
- Predicts probability of upward price movement over next 20 days
- Only fires when probability exceeds 65%
- Architecture: LSTM(64)→Dropout→LSTM(64)→Dropout→Dense(32)→Dense(1, sigmoid)
- Model saved as TF SavedModel to `data/models/lstm_direction_model/`

### ML4T Enhancement 5: Bayesian Risk Management ⭐ NEW
- **PyMC stochastic volatility model** estimates posterior distribution of market volatility
- Dynamic risk sizing: reduces position sizes in high-volatility regimes, increases in low-vol
- Market-wide estimation (IHSG composite) to avoid per-ticker overhead
- Graceful fallback to static ATR-based risk if PyMC is unavailable

### Weekly Model Training ⭐ NEW
- Separate `weekly-train.yml` GitHub Actions workflow trains all ML models every Sunday
- Models improve automatically as new data accumulates
- Trained artifacts committed back to repo for daily scan consumption

### Markdown Reports ⭐ NEW
- `data/daily_tracking.md` — Human-readable daily scan and midday evaluation report
- `data/paper_portfolio.md` — Human-readable portfolio status, positions, and trade history
- Auto-generated from JSON data after every scan, committed by workflows
- Includes explanations of regimes, engines, exit reasons, and all trading concepts

### Adaptive Per-Stock Detection
Instead of fixed global thresholds, the system learns each stock's personality:
- **BBCA** (stable blue chip): RSI oversold at 38, volume spike at 1.6x → more sensitive detection
- **Mining stocks** (volatile): RSI oversold at 22, volume spike at 2.8x → more conservative detection

### 20-Day Reversal Exit (Profit Maximizer)
- **Within 20 days**: If position has unrealized profit and detects bearish reversal (2+ bearish candles), exit to lock in gains
- **Profit erosion protection**: If peak profit was high but has dropped to 50% of its peak, lock in remaining profit
- **After 20 days**: No forced exit — trailing stop manages the position naturally

### Paper Trading Simulator
Runs automatically alongside the daily scan, simulating real-money execution against the scanner's signals:
- Starts with a configured virtual balance (default IDR 5,000,000).
- Applies identical risk management logic as the backtester (slippage, fees, Chandelier trailing stops, bracket order TPs set to 2x ATR).
- Evaluates recent failures and triggers a 30-day cooldown for any stock that hits its stop loss, ensuring no repeat losses.
- Outputs a dedicated performance summary into both the console and the HTML daily report.
- Saves its exact state to `data/paper_portfolio.json` for session continuity.

### Momentum Confluence Upgrade (v4.2.0) ⭐ NEW
- **Momentum Confluence Engine**: A highly robust multi-indicator entry engine that evaluates 10 distinct technical indicators simultaneously. Fires a signal only when at least 6 out of 10 indicators align in bullish confluence. Active in `BULL` and `CAUTION` market regimes.
- **12 New Technical Indicators**: Comprehensive suite of momentum, volatility, volume, and candlestick pattern detectors:
  - Momentum: Stochastic Oscillator (`%K`/`%D`), Williams %R, RSI momentum zone.
  - Trend & Volatility: ADX (Average Directional Index), EMA alignment.
  - Volume: OBV (On-Balance Volume), OBV slope, VWAP, VWAP deviation.
  - Price Action: Hammer, Bullish Engulfing, Bearish Engulfing, Morning Star, Evening Star.
- **Wiped History & Reset**: Re-calibrated simulator starting equity back to a fresh `5,000,000 IDR` and wiped all old trade records.

### Quantitative Enhancements v2 ⭐ NEW
- **Minervini VCP Filters:** Strict volume dryup (last 5 days) and breakout volume spike (250%+) requirements. Rejects V-shaped recoveries using time compression metrics.
- **Code 33 & Graham Defensive:** Optional fundamental screener rejecting stocks without 3 quarters of accelerating EPS/Margin growth or weak balance sheets (Current Ratio < 2.0).
- **Valuation Engine:** Optional math-based valuation using Gordon Equation and Discounted Dividend Model (DDM) to penalize overvalued assets.
- **Cardinal Sin Stop-Loss:** Dynamic hard ceiling on stop-losses — mathematically prevents risking >50% of the historical average gain per winning trade. Max 10% hard cap. Anti-averaging down is strictly enforced.
- **Per-Date Daily Reports:** Each daily run generates a self-contained, date-stamped markdown file (e.g., `daily-report-17-04-2026.md`) instead of a single endlessly-growing file.

### Daily JSON Tracking ⭐ NEW
All scan results, trade signals, paper trading activity, and midday evaluation outcomes are persisted into `data/daily_tracking.json`:
- **Daily scan entries**: regime, scan summary (avoid/wait/trade counts), trade signal details, wait signals, and paper trading actions (entries with full position sizing, exits with P&L).
- **Midday evaluation entries**: macro veto status, IHSG daily change, gap-and-crap alerts, fakeout breakout vetoes.
- Each entry is date-stamped and type-tagged (`daily_scan` or `midday_eval`) for easy querying.
- Re-runs on the same day replace the existing entry (idempotent).

### GitHub Contribution Attribution ⭐ NEW
Workflow commits are now attributed to the repository owner's GitHub account instead of `github-actions[bot]`, ensuring every daily and midday run shows as a green contribution square on the GitHub profile.

## 🚀 Usage

### 1. Unified Daily Workflow (Start Here)

```bash
python -m scripts.daily
```

_Options:_

- `--tickers ASII BBCA TLKM` : Scan specific tickers only.
- `--check-earnings` : Fetch upcoming earnings dates (slower).
- `--no-html` : Skip generating the HTML dashboard.
- `--capital 200000000` : Custom portfolio capital.

### 2. Backtesting

```bash
python -m scripts.backtest
python -m scripts.backtest --tickers BBCA BBRI ASII TLKM UNVR
python -m scripts.backtest --capital 200000000
```

### 3. Live Execution

```bash
python -m scripts.execute --dry-run    # Simulate without placing orders
python -m scripts.execute              # Live mode (requires broker setup)
```

### 4. Individual Subsystems

```bash
python -m scripts.ingest               # Phase 1: Ingest OHLCV data
python -m scripts.scan                 # Phase 2: Raw scanner
python -m scripts.regime               # Phase 3: Market regime check
python -m scripts.risk --ticker ASII   # Phase 4: Risk calculator
```

## 🛠️ GitHub Actions Automation

The system is configured to run entirely hands-off via GitHub Actions:

- **Schedule**: Automatically runs the `daily.py` workflow at 03:00 AM WIB every weekday (Monday-Friday).
- **Midday Scan**: Runs mid-day evaluation at 12:15 WIB for macro veto and gap-and-crap detection.
- **Caching**: Parquet OHLCV data is cached across runs to vastly speed up ingestion.
- **Artifacts**: HTML reports and Alert Logs are uploaded as workflow artifacts (30-day retention).
- **Persistence**: Portfolio state (`data/portfolio.json`), paper portfolio (`data/paper_portfolio.json`), daily tracking log (`data/daily_tracking.json`), **Markdown reports** (`data/daily_tracking.md`, `data/paper_portfolio.md`), and **Brain memory files** (`data/brain/*.json`) are automatically committed back to the repository.
- **Model Training**: ML models are retrained weekly via `weekly-train.yml` and saved to `data/models/`.
- **Contribution Attribution**: All automated commits are attributed to the repository owner (`mariobgsp`) so they count toward GitHub contribution history.

To enable, simply push code to the `main` branch. You can also trigger a manual run with custom tickers from the "Actions" tab.

## 📦 Requirements

- Python 3.12+
- `pandas >= 2.0`
- `numpy >= 1.24`
- `yfinance >= 0.2.36`
- `pyarrow >= 14.0` (for Parquet storage)
- `scikit-learn >= 1.3` (for PCA, clustering, ML regime)
- `PyWavelets >= 1.5` (for wavelet denoising)
- `pykalman >= 0.9.7` (for Kalman filter denoising)
- `xgboost >= 2.0` (for gradient boosting entry engine)
- `joblib >= 1.3` (for model serialization)
- `tensorflow >= 2.15` _(optional — LSTM engine)_
- `pymc >= 5.10` _(optional — Bayesian risk)_

Install via:

```bash
pip install -r requirements.txt
```

## 📝 Changelog

- feat: replace ML/Momentum engines with Stochastic, MACD, and MA Crossover engines
- feat: v5.0.0 — AI Brain & Memory system: per-stock learning layer that records every signal and outcome, infers best trading method per stock, applies brain score boosts in the scanner, auto-generates behavioral tags and insights (`core/stock_brain.py`, `core/brain_inference.py`, `scripts/brain_update.py`)
- feat: v4.3.0 — Streamlined to pure momentum + ML4T stack (removed FVG, BOW, Wyckoff, EMA Crossover, Volume Climax, Bandarmology, Downtrend Bounce engines)
- feat: v4.2.0 — Momentum Confluence Upgrade (Momentum Confluence Engine, 12 new technical indicators including Stochastic, ADX, Williams %R, OBV, VWAP, price action candlesticks, and portfolio reset to 5,000,000 IDR)
- feat: v4.1.0 — Quantitative Enhancements v2 (Minervini VCP filters, Code 33/Graham screening, DDM Valuation, Cardinal Sin dynamic stop-loss, per-date daily reports)
- feat: v4.0.0 — ML4T architecture upgrade: wavelet/Kalman denoising, formulaic alphas, PCA/clustering regime, XGBoost entry engine, LSTM direction engine, Bayesian risk, markdown reports, weekly training workflow
- feat: v3.1.0 — daily JSON tracking for scan results / trade signals / paper trading / midday evaluations, GitHub contribution attribution for workflow commits
- feat: add paper trading simulator tracking trades directly from daily scan signals
- feat: v3.0.0 — adaptive per-stock detector, EMA crossover engine, 20-day reversal exit with profit maximization, relaxed thresholds, more sensitive signal generation
- feat: add midday scan github actions workflow (098339d)
- feat: complete Phase 2, 3, 5, 6.5 trading engine upgrades (ed5525a)
- chore: update scheduler to 11:30 PM WIB weekdays (ae9f086)
- fix(ci): gracefully handle missing portfolio file (4673050)
- fix: tolerate expected yfinance download failures in ingest script (6def7a1)
- feat: complete Phase 6 and 7 (Backtesting Engine and Live Execution) (2dbb44d)
- fix: remove nonexistent --resume flag from github actions (10384e3)
- feat: complete Phase 1-5 master architecture (v1.0.0) (fe9cf49)
- Initial commit (dfbc690)
