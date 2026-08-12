# Crossover Trading Engines Design Spec

## Overview
This document specifies the design for replacing the existing swing trading engines in `core/engines.py` with three new strategy engines based on indicator crossings. These new engines will fully integrate with the AI Brain and Memory system.

## 1. Architecture Changes
The existing engines (`FVGPullbackEngine`, `MomentumBreakoutEngine`, `BuyingOnWeaknessEngine`) will be entirely removed from `core/engines.py`.
They will be replaced by:
1. `StochasticEngine` (Priority 3)
2. `MACDEngine` (Priority 2)
3. `MACrossingEngine` (Priority 1)

These engines adhere to the same `engine.scan(df, ticker, regime) -> EntrySignal | None` interface, allowing the existing `core/scanner.py` and `core/backtester.py` pipelines to function without modification.

## 2. Engine Logic Details

### Common Filters
All three engines share a **Volume Confirmation Filter**:
*   The volume on the day of the cross must be strictly greater than the 20-day Simple Moving Average (SMA) of volume.
*   This ensures that breakouts/crossings are supported by market participation.

### 2.1 StochasticEngine
*   **Indicators**: Fast Stochastic Oscillator (%K and %D). Typically %K=14, %D=3.
*   **Trigger**:
    1.  %K crosses above %D today.
    2.  The crossing occurs in oversold territory (e.g., %K < 20).
    3.  Volume confirmation passes.

### 2.2 MACDEngine
*   **Indicators**: MACD Line (12, 26) and Signal Line (9).
*   **Trigger**:
    1.  MACD Line crosses above the Signal Line today.
    2.  Volume confirmation passes.

### 2.3 MACrossingEngine
*   **Indicators**: SMA 20 (Short-term), SMA 50 (Medium-term), SMA 200 (Long-term trend).
*   **Trigger**:
    1.  SMA 20 crosses above SMA 50 today.
    2.  The Closing price today is strictly greater than the SMA 200.
    3.  Volume confirmation passes.

## 3. Data and Indicator Requirements
The `core/indicators.py` file must provide or be updated to provide:
*   `stochastic(df, k_period=14, d_period=3)`
*   `macd(df, fast=12, slow=26, signal=9)`
*   `sma(df, period)`

If these do not exist in `core/indicators.py`, they will be added.

## 4. Testing
*   Ensure that the `test_integration.py` or backtesting pipeline continues to run cleanly.
*   The AI Brain system should transparently start scoring and optimizing these three new engines as trades complete.
