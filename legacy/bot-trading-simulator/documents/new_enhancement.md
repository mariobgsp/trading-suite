# AI Developer Instructions: Upgrading "sturdy-octo-couscous" via ML4T Methodology

**Context:**
The target repository, `mariobgsp/sturdy-octo-couscous`, is currently a highly rigorous, rule-based swing trading system for the Indonesian Stock Exchange (IHSG) [1, 2]. It relies on standard OHLCV data, statistical feature derivation (like adaptive thresholds, RSI, and Hurst exponent), and fixed-rule entry engines (e.g., EMA crossovers, FVG pullbacks) [2-4]. 

**Objective:**
Evolve the repository from a strict rules-based architecture into a predictive, machine learning-driven system based on Stefan Jansen's ML4T framework [5].

Please implement the following methods and integrate them into the existing codebase architecture:

## 1. Implement Advanced Feature Engineering & Denoising
**Target File:** `core/data_cleaner.py` and `core/adaptive.py`
**ML4T Method to Add:** 
*   **Denoising:** The current system uses raw price data. Implement **wavelets and the Kalman filter** to reduce noise in the daily IHSG price data before feeding it into the scanner [6]. 
*   **Formulaic Alphas:** Expand the `StockProfile` generation. Instead of just computing basic RSI or ATR bounds, use `NumPy`, `pandas`, and `TA-Lib` to compute complex alpha factors, specifically drawing from **WorldQuant's 101 Formulaic Alphas** [7]. 

## 2. Upgrade the Market Regime Engine with Unsupervised Learning
**Target File:** `core/regime.py`
**ML4T Method to Add:** 
*   **Current State:** The system classifies the broader market as BULL, CAUTION, or BEAR using a basic Hurst exponent [2]. 
*   **Enhancement:** Implement unsupervised learning techniques for dimensionality reduction and clustering. Use **Principal Component Analysis (PCA)** to extract data-driven risk factors from the index components [8, 9]. Apply clustering algorithms (like k-means or agglomerative clustering) to statistically identify hidden market regimes instead of relying on fixed Hurst thresholds [8, 9].

## 3. Introduce Tree-Based Ensemble Entry Engines
**Target File:** `core/engines.py`
**ML4T Method to Add:** 
*   **Current State:** The system uses 6 hardcoded entry engines (e.g., *Priority 2: EMA Crossover*, *Priority 1: Buying on Weakness*) [2].
*   **Enhancement:** Build a new predictive entry engine using **Gradient Boosting Machines (XGBoost, LightGBM, or CatBoost)** or **Random Forests** [10, 11]. Train these models to evaluate stocks entering the "Trade Bucket" [2]. Instead of triggering on a simple EMA cross, the model should output a probability of a successful trade by evaluating the cumulative decision trees based on the newly engineered alpha factors [10, 11].

## 4. Add Deep Learning for Sequential OHLCV Modeling
**Target File:** `core/engines.py` (New Priority Engine)
**ML4T Method to Add:**
*   **Enhancement:** To capture long-range dependencies in the multi-year history of the 591 IHSG tickers [2], implement a **Recurrent Neural Network (RNN)** equipped with **Long Short-Term Memory (LSTM)** or **Gated Recurrent Units (GRU)** [12, 13]. Format the daily OHLCV multivariate time series as sequences to train the model to forecast the direction of the asset over the 20-day reversal exit window [2, 12].

## 5. Upgrade Risk Management with Bayesian Machine Learning
**Target File:** `core/risk.py`
**ML4T Method to Add:**
*   **Current State:** Position sizing and stop-losses are deterministic, relying on fixed 1.5x/2.0x ATR multipliers [2].
*   **Enhancement:** Incorporate **Bayesian Machine Learning** (using libraries like PyMC3) to continuously estimate stochastic volatility and compute **dynamic Sharpe ratios** [14]. Use these probabilistic outputs to dynamically scale the portfolio risk weightings (currently capped at 2% per trade / 6% portfolio heat) based on real-time market uncertainty rather than static ATR rules [2, 14].