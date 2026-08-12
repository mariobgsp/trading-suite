"""
Global configuration constants for the IHSG Swing Trading Application.

All tunable parameters are centralized here to avoid magic numbers
scattered across the codebase. Paths are resolved relative to the
project root so the app works regardless of the working directory.
"""

from pathlib import Path

# ─── Project Paths ────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "ohlcv"
LOG_DIR = PROJECT_ROOT / "logs"

# ─── Data Ingestion ───────────────────────────────────────────────────────────

# Default historical period to download (5 years for backtesting headroom)
DEFAULT_PERIOD: str = "5y"

# Default data interval
DEFAULT_INTERVAL: str = "1d"

# ─── Rate Limiting (Yahoo Finance) ────────────────────────────────────────────

# Number of tickers to download before inserting a batch pause
RATE_LIMIT_BATCH_SIZE: int = 50

# Seconds to pause after each batch
RATE_LIMIT_PAUSE_SECONDS: float = 5.0

# Seconds to pause between individual ticker downloads
INTER_REQUEST_DELAY: float = 2.0

# Maximum retry attempts on transient errors (429, timeout, etc.)
MAX_RETRIES: int = 3

# Base wait time (seconds) for exponential backoff on retries
RETRY_BASE_WAIT: float = 30.0

# ─── Data Cleaning ────────────────────────────────────────────────────────────

# Volume spikes beyond this many standard deviations are capped
VOLUME_SPIKE_STD_THRESHOLD: float = 5.0

# Rolling window (trading days) for volume anomaly detection
VOLUME_ROLLING_WINDOW: int = 60

# Maximum consecutive missing trading days to forward-fill
MAX_FORWARD_FILL_DAYS: int = 5

# Minimum price change ratio to flag a potential stock split
# e.g., 0.40 means a 40%+ single-day move triggers split detection
SPLIT_DETECTION_THRESHOLD: float = 0.40

# ─── Logging ──────────────────────────────────────────────────────────────────

LOG_FORMAT: str = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
LOG_DATE_FORMAT: str = "%Y-%m-%d %H:%M:%S"

# ─── Phase 2: Scanner Thresholds ─────────────────────────────────────────────

# Minimum Average Daily Trading Value (IDR) to survive the Avoid filter
ADTV_MIN_IDR: float = 2_000_000_000  # IDR 2 Billion (relaxed from 10B)

# ADTV lookback period in trading days
ADTV_LOOKBACK: int = 20

# Minimum stock price (IDR) — below this is considered a penny stock
PENNY_STOCK_THRESHOLD: float = 50.0  # Relaxed from 100 to match README

# SMA lookback for trend filter
SMA_200_LOOKBACK: int = 200

# Tight consolidation detection
CONSOLIDATION_WINDOW: int = 14  # trading days
CONSOLIDATION_MAX_RANGE_PCT: float = 12.0  # max High-Low range as % of price (relaxed from 10)

# Fair Value Gap — how close price must be to an FVG zone (in ATR multiples)
FVG_ATR_PROXIMITY: float = 1.0

# ATR period used across the scanner
ATR_PERIOD: int = 14

# Maximum number of picks in the Trade bucket
TRADE_BUCKET_MAX_PICKS: int = 5

# Earnings proximity window (hours) for the Avoid filter
EARNINGS_PROXIMITY_HOURS: int = 48

# ─── Phase 3: Market Regime & Entry Engines ──────────────────────────────────

# IHSG composite index ticker on Yahoo Finance
IHSG_COMPOSITE_TICKER: str = "^JKSE"

# Regime filter SMA periods
REGIME_SMA_SHORT: int = 50
REGIME_SMA_LONG: int = 200
REGIME_ATR_PERIOD: int = 14

# Engine 1: FVG Pullback
FVG_LOW_VOLUME_RATIO: float = 0.8  # volume must be < 80% of avg for valid pullback

# Engine 2: Momentum Breakout
BREAKOUT_CONSOLIDATION_DAYS: int = 20
BREAKOUT_MAX_SPREAD_PCT: float = 8.0  # max price spread (relaxed from 5, adaptive overrides)
BREAKOUT_VOLUME_THRESHOLD: float = 1.1  # volume must be > 110% of average (further relaxed for sensitivity)

# Engine 3: Buying on Weakness (B.O.W.)
BOW_RSI_THRESHOLD: float = 35.0  # RSI below this = oversold (relaxed from 25, adaptive overrides)
BOW_BOLLINGER_PERIOD: int = 20
BOW_BOLLINGER_STD: float = 2.0
BOW_VOLUME_CLIMAX_RATIO: float = 1.2  # volume must be > 120% of average (further relaxed for sensitivity)

# New B.O.W. Alternative Validation Parameters
BOW_STOCH_RSI_PERIOD: int = 14
BOW_STOCH_RSI_OVERSOLD: float = 20.0
BOW_MACD_FAST: int = 12
BOW_MACD_SLOW: int = 26
BOW_MACD_SIGNAL: int = 9
BOW_MACD_DIVERGENCE_LOOKBACK: int = 20  # Lookback period for price lower low

# Engine 4: Wyckoff Phase C Spring
WYCKOFF_SPRING_LOOKBACK: int = 60
WYCKOFF_SPRING_VOLUME_RATIO: float = 1.2  # Relaxed from 2.0 to catch more Wyckoff springs

# Scanner Wait: Wyckoff Phase B Accumulation
WYCKOFF_PHASE_B_VAR_LOOKBACK: int = 60
WYCKOFF_PHASE_B_VAR_PERCENTILE: float = 10.0

# Scanner Wait: VSA Squat Candle
VSA_SQUAT_VOL_RATIO: float = 2.0
VSA_SQUAT_EFFICIENCY_PERCENTILE: float = 10.0
VSA_SQUAT_PERCENTILE_LOOKBACK: int = 60

# Predictor: Ridge Regression
RIDGE_CV_SPLITS: int = 5
RIDGE_LOOKAHEAD: int = 5
RIDGE_TRAIN_WINDOW: int = 252 # 1 year data roughly

# Engine 5: Volume Climax Reversal (VCLR)
VCLR_VOLUME_RATIO: float = 1.5           # Volume must be > 150% of 20-day avg (relaxed for sensitivity)
VCLR_CLOSING_RANGE_MAX: float = 0.25     # Closing range < 0.25 (closed near the low)
VCLR_MIN_BODY_PCT: float = 1.5           # Body size > 1.5% of price (not a doji)


# ─── Phase 4: Risk Management ────────────────────────────────────────────────

# Default starting capital (IDR)
DEFAULT_CAPITAL: float = 5_000_000  # IDR 5 Million

# Maximum risk per trade as % of total capital
MAX_RISK_PER_TRADE_PCT: float = 2.0

# Initial stop-loss distance in ATR multiples below entry
STOP_LOSS_ATR_MULTIPLIER: float = 1.5

# Chandelier trailing stop in ATR multiples from highest high
TRAILING_STOP_ATR_MULTIPLIER: float = 2.0
TRAILING_STOP_ATR_PERIOD: int = 14

# Maximum total portfolio heat (sum of all open risks as % of capital)
MAX_PORTFOLIO_HEAT_PCT: float = 6.0

# Maximum number of simultaneous open positions
MAX_OPEN_POSITIONS: int = 5

# Regime-adjusted risk multipliers (applied to MAX_RISK_PER_TRADE_PCT)
REGIME_RISK_MULTIPLIER: dict[str, float] = {
    "BULL": 1.0,      # full 2%
    "CAUTION": 0.5,   # 1%
    "BEAR": 0.25,     # 0.5%
}

# IDX lot size (shares must be bought in multiples of this)
IDX_LOT_SIZE: int = 100

# ─── Phase 6: Backtesting ─────────────────────────────────────────────────────

BACKTEST_YEARS: int = 5
BACKTEST_TRAIN_YEARS: float = 3.5
BACKTEST_SLIPPAGE_PCT: float = 0.15     # 0.15% per side
BACKTEST_FEE_BUY_PCT: float = 0.15      # IDX broker buy fee
BACKTEST_FEE_SELL_PCT: float = 0.25     # IDX broker sell fee (includes tax)
BACKTEST_INITIAL_CAPITAL: float = 5_000_000
MAX_DRAWDOWN_THRESHOLD: float = 15.0    # Report card red flag
MIN_PROFIT_FACTOR: float = 1.5          # Report card threshold

# ─── Phase 7: Live Execution ──────────────────────────────────────────────────

FAT_FINGER_MAX_SHARES: int = 1000           # Hard limit per order
FAT_FINGER_MAX_VALUE_IDR: float = 2_500_000  # Hard limit per order value
DAILY_DRAWDOWN_HALT_PCT: float = 3.0          # Halt trading if account drops 3%
EXECUTION_SCHEDULE_WIB: str = "15:50"         # Generate execution list at this time
BRACKET_ORDER_TP_ATR_MULTIPLIER: float = 2.0  # Take-profit at 2x ATR from entry (faster profit securing)

# ─── Adaptive Per-Stock Detector ──────────────────────────────────────────────

ADAPTIVE_MAX_YEARS: int = 2               # Max years of history to analyze per stock
ADAPTIVE_RSI_PERCENTILE: float = 10.0     # Percentile for oversold (per stock)
ADAPTIVE_VOLUME_PERCENTILE: float = 90.0  # Percentile for volume spike (per stock)
ADAPTIVE_TREND_LOOKBACK: int = 60         # Days for trend strength calculation

# ─── Reversal Exit (20-Day Window) ────────────────────────────────────────────

REVERSAL_EXIT_MAX_DAYS: int = 20           # Max holding days for reversal exit scan
REVERSAL_EXIT_PROFIT_THRESHOLD: float = 0.005  # 0.5% minimum unrealized profit to trigger (more sensitive)
REVERSAL_EXIT_BEARISH_CANDLES: int = 2     # N consecutive bearish candles = reversal signal
REVERSAL_EXIT_TRAILING_LOCK_PCT: float = 0.7  # Lock 70% of peak unrealized profit (protect more gains)

# ─── EMA Crossover Engine ─────────────────────────────────────────────────────

EMA_FAST_PERIOD: int = 9
EMA_SLOW_PERIOD: int = 21
EMA_CROSSOVER_VOLUME_THRESHOLD: float = 1.0  # 100% of average volume — just above average (adaptive overrides)
EMA_CROSSOVER_RSI_MIN: float = 40.0          # Lower RSI bound (adaptive overrides)
EMA_CROSSOVER_RSI_MAX: float = 70.0          # Upper RSI bound (adaptive overrides)

# ─── Quick Swing Trade Engine ─────────────────────────────────────────────────

QST_RSI_PERIOD: int = 7                       # Faster RSI for short-term momentum
QST_EMA_PERIOD: int = 10                      # Fast EMA for trend reclaim detection
QST_VOLUME_LOOKBACK: int = 10                 # 10-day volume average (shorter than default 20)
QST_VOLUME_THRESHOLD: float = 1.1             # 110% of 10-day average volume
QST_RSI_CROSS_LEVEL: float = 50.0             # RSI level for momentum shift

# ─── Paper Trading (Simulated Execution) ──────────────────────────────────────

PAPER_TRADING_ENABLED: bool = True
PAPER_TRADING_INITIAL_CAPITAL: float = 5_000_000  # Same as user: IDR 5 Million

# ─── ML4T Enhancement Settings ───────────────────────────────────────────────

# Model storage directory
ML_MODELS_DIR = PROJECT_ROOT / "data" / "models"

# Denoising (Enhancement 1)
DENOISING_ENABLED: bool = True
DENOISING_METHOD: str = "wavelet"           # "wavelet", "kalman", or "both"
WAVELET_FAMILY: str = "db4"                 # Daubechies-4 wavelet
WAVELET_LEVEL: int = 3                      # Decomposition level
WAVELET_THRESHOLD_MODE: str = "soft"        # Soft thresholding preserves signal shape
KALMAN_TRANSITION_COVARIANCE: float = 0.01  # Process noise (lower = smoother)
KALMAN_OBSERVATION_COVARIANCE: float = 1.0  # Measurement noise

# Formulaic Alphas (Enhancement 1)
ALPHA_MOMENTUM_PERIOD: int = 10             # Rate-of-change momentum lookback
ALPHA_MEAN_REVERSION_PERIOD: int = 20       # Bollinger z-score period
ALPHA_LIQUIDITY_VWAP_PERIOD: int = 20       # VWAP deviation period
ALPHA_VOLATILITY_WINDOW: int = 20           # Realized volatility window
ALPHA_MONEY_FLOW_PERIOD: int = 20           # Chaikin Money Flow period

# ML Market Regime (Enhancement 2)
REGIME_ML_ENABLED: bool = True
REGIME_PCA_COMPONENTS: int = 3              # Principal components for PCA
REGIME_N_CLUSTERS: int = 3                  # Number of clusters (BULL/CAUTION/BEAR)
REGIME_CLUSTERING_METHOD: str = "kmeans"    # "kmeans" or "agglomerative"
REGIME_FEATURE_WINDOW: int = 60             # Rolling window for regime features

# XGBoost Entry Engine (Enhancement 3)
ML_ENTRY_ENABLED: bool = True
ML_ENTRY_THRESHOLD: float = 0.55            # Minimum probability to trigger signal (lowered for more signals)
ML_ENTRY_MODEL_FILE: str = "xgb_entry_model.joblib"
ML_ENTRY_N_ESTIMATORS: int = 200
ML_ENTRY_MAX_DEPTH: int = 6
ML_ENTRY_LEARNING_RATE: float = 0.1
ML_ENTRY_TRAIN_WINDOW_YEARS: float = 3.5    # Training data window

# LSTM Direction Engine (Enhancement 4)
ML_LSTM_ENABLED: bool = True
ML_LSTM_SEQUENCE_LENGTH: int = 60           # Days of history as input sequence
ML_LSTM_PREDICTION_HORIZON: int = 20        # Forward prediction window (days)
ML_LSTM_THRESHOLD: float = 0.55             # Minimum probability for signal (lowered for more signals)
ML_LSTM_MODEL_FILE: str = "lstm_direction_model"  # TF SavedModel directory
ML_LSTM_UNITS: int = 64                     # LSTM hidden units per layer
ML_LSTM_DROPOUT: float = 0.2               # Dropout rate
ML_LSTM_EPOCHS: int = 15                    # Training epochs
ML_LSTM_BATCH_SIZE: int = 1024

# Bayesian Risk Management (Enhancement 5)
BAYESIAN_RISK_ENABLED: bool = True
BAYESIAN_SAMPLES: int = 1000                # MCMC samples (more = slower but better)
BAYESIAN_CHAINS: int = 2                    # MCMC chains
BAYESIAN_VOLATILITY_WINDOW: int = 60        # Lookback for stochastic volatility
BAYESIAN_MODEL_FILE: str = "bayesian_vol_params.joblib"

# ─── Enhancement v2: Minervini VCP / Breakout Filters ────────────────────────

# Volume must dry up (< 70% avg) in the tightest phase of the consolidation
VCP_VOLUME_DRYUP_RATIO: float = 0.7

# Number of days at the right side of the base to check for volume dryup
VCP_DRYUP_DAYS: int = 5

# Breakout volume spike: must be >= 250% of 20-day average volume
BREAKOUT_VOLUME_SPIKE_MIN: float = 1.5  # Relaxed from 2.5 — still requires meaningful spike but more achievable

# Minimum base formation duration in trading days (~3 weeks)
CONSOLIDATION_MIN_DAYS: int = 15

# Maximum base formation duration in trading days (~65 weeks)
CONSOLIDATION_MAX_DAYS: int = 325

# ─── Enhancement v2: Fundamental Screener (Code 33 + Graham) ─────────────────

# Gate: False by default (requires additional yfinance API calls)
FUNDAMENTAL_SCREENER_ENABLED: bool = False

# Minervini "Code 33": quarters of accelerating EPS growth required
CODE33_MIN_QUARTERS: int = 3

# Graham Defensive: minimum Current Ratio (Current Assets / Current Liabilities)
GRAHAM_CURRENT_RATIO_MIN: float = 2.0

# Graham Defensive: max ratio of Long-Term Debt to Net Current Assets
GRAHAM_DEBT_TO_WC_MAX: float = 1.0

# ─── Enhancement v2: Valuation Engine (Gordon / DDM) ─────────────────────────

# Gate: False by default (requires dividend data from yfinance)
VALUATION_ENABLED: bool = False

# Required discount rate for IHSG equities (Ke)
DDM_DISCOUNT_RATE: float = 0.12

# Price-to-fair-value ratio above which a stock is considered overvalued
DDM_OVERVALUED_RATIO: float = 2.0

# ─── Enhancement v2: Dynamic Risk (Cardinal Sin Stop-Loss) ───────────────────

# Enable dynamic stop-loss based on historical average gain
DYNAMIC_STOP_ENABLED: bool = True

# Max stop-loss = this fraction of the average gain per winning trade
CARDINAL_SIN_MAX_STOP_RATIO: float = 0.5

# Absolute hard ceiling for stop-loss as % of entry price
ABSOLUTE_MAX_STOP_PCT: float = 10.0

# ─── Bandarmology (Stockbit API) ──────────────────────────────────────────────

# Gate: Enable Stockbit API integration for bandarmology engines
STOCKBIT_ENABLED: bool = True

# Minimum percent the top 3 buyers must accumulate to be considered a signal
BANDARMOLOGY_TOP_BUY_PCT_THRESHOLD: float = 25.0  # Relaxed from 40% to catch more accumulation signals

# Minimum percent the top 1 buyer must accumulate
BANDARMOLOGY_TOP1_BUY_PCT_THRESHOLD: float = 10.0  # Relaxed from 20% for higher sensitivity

# Minimum volume ratio for bandarmology engine
BANDARMOLOGY_MIN_VOL_RATIO: float = 0.7  # Relaxed from 1.0 — allow below-average volume during quiet accumulation

# ─── Downtrend Trading: Short-Swing Bounce Settings ───────────────────────────

# Minimum RSI level for downtrend bounce detection (not too oversold)
DOWNTREND_BOUNCE_RSI_MIN: float = 25.0

# Maximum RSI level for downtrend bounce (already recovering)
DOWNTREND_BOUNCE_RSI_MAX: float = 50.0

# Minimum volume ratio for downtrend bounce confirmation
DOWNTREND_BOUNCE_MIN_VOL_RATIO: float = 1.0

# Minimum body size % for downtrend bounce candle
DOWNTREND_BOUNCE_MIN_BODY_PCT: float = 0.5

# How many days below SMA200 we still allow a downtrend bounce trade
DOWNTREND_BOUNCE_MAX_BELOW_SMA200_PCT: float = 30.0

# ─── Stock Cooldown (Avoid Repeat Failures) ───────────────────────────────────

# Days to suppress a stock from the Trade bucket after a losing trade
FAILED_TRADE_COOLDOWN_DAYS: int = 30

# File path to store cooldown records
FAILED_TRADE_COOLDOWN_FILE: str = "data/failed_trade_cooldown.json"

# ─── Momentum Confluence Engine ───────────────────────────────────────────────

# Minimum number of indicators that must agree (out of 10) before the
# Momentum Confluence Engine fires a trade signal.
# 6 = balanced (catches strong setups without being too strict)
# 7 = conservative (fewer trades, higher quality)
# 8 = ultra-conservative (rare signals, very high confidence)
MOMENTUM_MIN_CONFLUENCE: int = 6

# Minimum volume ratio (current / 20-day avg) for volume surge confirmation
MOMENTUM_VOLUME_SURGE_RATIO: float = 1.5

# RSI boundaries for momentum zone
MOMENTUM_RSI_MIN: float = 40.0
MOMENTUM_RSI_MAX: float = 70.0

# ADX minimum for confirmed trend
MOMENTUM_ADX_MIN: float = 20.0

# Williams %R oversold threshold
MOMENTUM_WILLIAMS_R_OVERSOLD: float = -80.0

# EMA periods for triple EMA alignment
MOMENTUM_EMA_FAST: int = 9
MOMENTUM_EMA_MID: int = 21
MOMENTUM_EMA_SLOW: int = 50

# Stochastic Oscillator periods
MOMENTUM_STOCH_K_PERIOD: int = 14
MOMENTUM_STOCH_D_PERIOD: int = 3

# ─── Stock Brain / AI Memory ──────────────────────────────────────────────────

# Master switch for the brain system
BRAIN_ENABLED: bool = True

# Storage directory for per-stock brain JSON files
BRAIN_DATA_DIR: Path = PROJECT_ROOT / "data" / "brain"

# Minimum number of closed trades before brain makes confident recommendations
BRAIN_MIN_TRADES_FOR_CONFIDENCE: int = 3

# Maximum additive score boost the brain can apply (positive or negative)
BRAIN_MAX_SCORE_BOOST: float = 1.5

# Negative score boost threshold for penalizing bad-fit engines
# Engines with win_rate below this get a score penalty
BRAIN_PENALTY_WIN_RATE_THRESHOLD: float = 0.35

# Win rate required for a positive boost
BRAIN_BOOST_WIN_RATE_THRESHOLD: float = 0.55

# Decay weight — recent trades are weighted more than old ones (0.0-1.0)
# 1.0 = no decay (all trades equal), 0.9 = 10% decay per trade back in time
BRAIN_LEARNING_DECAY: float = 0.92

# Whether to use LLM for generating human-readable insights
# Set True only if GEMINI_API_KEY is available in the environment
BRAIN_LLM_ENABLED: bool = False

# LLM model to use if BRAIN_LLM_ENABLED is True
BRAIN_LLM_MODEL: str = "gemini-2.0-flash"
