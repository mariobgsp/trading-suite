"""
Reusable technical indicator calculations for IHSG analysis.

All functions operate on Pandas Series or DataFrames and return
new columns/values — they never mutate the input. These are the
building blocks used by the scanner, engines, and backtester.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class FairValueGap:
    """Represents a single Fair Value Gap identified in price data."""

    date: pd.Timestamp
    gap_type: str  # "bullish" or "bearish"
    gap_high: float  # upper boundary of the gap
    gap_low: float  # lower boundary of the gap
    filled: bool = False  # whether price has revisited the gap

    @property
    def gap_size(self) -> float:
        """Absolute size of the gap in price units."""
        return abs(self.gap_high - self.gap_low)

    @property
    def midpoint(self) -> float:
        """Midpoint of the gap zone."""
        return (self.gap_high + self.gap_low) / 2.0


# ─── Moving Averages ─────────────────────────────────────────────────────────


def sma(series: pd.Series, period: int) -> pd.Series:
    """
    Simple Moving Average.

    Parameters
    ----------
    series : pd.Series
        Price series (typically Close).
    period : int
        Lookback window in bars.

    Returns
    -------
    pd.Series
        SMA values, with NaN for the first (period - 1) bars.
    """
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    """
    Exponential Moving Average.

    Parameters
    ----------
    series : pd.Series
        Price series.
    period : int
        Span for the EMA calculation.

    Returns
    -------
    pd.Series
        EMA values.
    """
    return series.ewm(span=period, adjust=False).mean()


# ─── Volatility ──────────────────────────────────────────────────────────────


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """
    Average True Range — measures daily volatility.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns: High, Low, Close.
    period : int
        Smoothing period (default 14).

    Returns
    -------
    pd.Series
        ATR values.
    """
    high = df["High"]
    low = df["Low"]
    prev_close = df["Close"].shift(1)

    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()

    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return true_range.rolling(window=period, min_periods=period).mean()


def bollinger_bands(
    series: pd.Series, period: int = 20, num_std: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    Bollinger Bands.

    Returns
    -------
    tuple[pd.Series, pd.Series, pd.Series]
        (upper_band, middle_band, lower_band)
    """
    middle = sma(series, period)
    rolling_std = series.rolling(window=period, min_periods=period).std()
    upper = middle + (num_std * rolling_std)
    lower = middle - (num_std * rolling_std)
    return upper, middle, lower


# ─── Momentum Oscillators ────────────────────────────────────────────────────


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """
    Relative Strength Index.

    Uses the Wilder smoothing method (exponential moving average).

    Parameters
    ----------
    series : pd.Series
        Price series (typically Close).
    period : int
        RSI lookback period (default 14).

    Returns
    -------
    pd.Series
        RSI values (0–100).
    """
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)

    # Wilder's smoothing (equivalent to EMA with alpha = 1/period)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100.0 - (100.0 / (1.0 + rs))


# ─── Volume & Liquidity ──────────────────────────────────────────────────────


def adtv(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """
    Average Daily Trading Value (Close x Volume).

    This is the primary liquidity metric for the IDX market.
    Stocks with ADTV < IDR 10B are considered illiquid.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns: Close, Volume.
    period : int
        Lookback window (default 20 trading days).

    Returns
    -------
    pd.Series
        ADTV values in IDR.
    """
    daily_value = df["Close"] * df["Volume"]
    return daily_value.rolling(window=period, min_periods=max(1, period // 2)).mean()


def volume_ratio(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """
    Current volume as a ratio of the N-day average volume.

    A ratio > 1.5 indicates significantly above-average volume.

    Returns
    -------
    pd.Series
        Volume ratio values (1.0 = average).
    """
    avg_vol = df["Volume"].rolling(window=period, min_periods=max(1, period // 2)).mean()
    return df["Volume"] / avg_vol.replace(0, np.nan)


# ─── Price Structure ─────────────────────────────────────────────────────────


def detect_fvg(df: pd.DataFrame) -> list[FairValueGap]:
    """
    Detect all Fair Value Gaps in the price data.

    A **bullish FVG** exists when candle[i]'s Low > candle[i-2]'s High,
    creating an unfilled gap between the two candles (candle[i-1] is the
    "impulse" candle that caused the gap).

    A **bearish FVG** exists when candle[i]'s High < candle[i-2]'s Low.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns: Open, High, Low, Close with DatetimeIndex.

    Returns
    -------
    list[FairValueGap]
        All detected FVGs, newest first.
    """
    gaps: list[FairValueGap] = []

    if len(df) < 3:
        return gaps

    highs = df["High"].values
    lows = df["Low"].values
    dates = df.index

    for i in range(2, len(df)):
        # Bullish FVG: candle[i] low > candle[i-2] high
        if lows[i] > highs[i - 2]:
            gaps.append(
                FairValueGap(
                    date=dates[i],
                    gap_type="bullish",
                    gap_high=float(lows[i]),    # upper edge = current candle's low
                    gap_low=float(highs[i - 2]),  # lower edge = 2-back candle's high
                )
            )

        # Bearish FVG: candle[i] high < candle[i-2] low
        elif highs[i] < lows[i - 2]:
            gaps.append(
                FairValueGap(
                    date=dates[i],
                    gap_type="bearish",
                    gap_high=float(lows[i - 2]),  # upper edge = 2-back candle's low
                    gap_low=float(highs[i]),       # lower edge = current candle's high
                )
            )

    # Mark FVGs as filled if price has revisited the zone
    closes = df["Close"].values
    for gap in gaps:
        gap_idx = df.index.get_loc(gap.date)
        if gap_idx + 1 < len(df):
            subsequent_lows = lows[gap_idx + 1:]
            subsequent_highs = highs[gap_idx + 1:]

            if gap.gap_type == "bullish":
                # Filled if price drops into the gap zone
                if len(subsequent_lows) > 0 and np.min(subsequent_lows) <= gap.gap_high:
                    gap.filled = True
            else:
                # Filled if price rises into the gap zone
                if len(subsequent_highs) > 0 and np.max(subsequent_highs) >= gap.gap_low:
                    gap.filled = True

    # Return newest first
    gaps.reverse()
    return gaps


def is_tight_consolidation(
    df: pd.DataFrame,
    window: int = 14,
    max_range_pct: float = 10.0,
) -> tuple[bool, float]:
    """
    Check if the stock is in a tight consolidation pattern.

    A stock is consolidating when the price range (highest high - lowest low)
    over the lookback window is less than max_range_pct of the current price.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns: High, Low, Close.
    window : int
        Number of trading days to check (default 14).
    max_range_pct : float
        Maximum range as a percentage of price (default 10%).

    Returns
    -------
    tuple[bool, float]
        (is_consolidating, range_pct)
    """
    if len(df) < window:
        return False, 0.0

    recent = df.tail(window)
    highest = recent["High"].max()
    lowest = recent["Low"].min()
    last_close = df["Close"].iloc[-1]

    if last_close <= 0:
        return False, 0.0

    range_pct = ((highest - lowest) / last_close) * 100.0
    return range_pct <= max_range_pct, float(range_pct)


def stoch_rsi(
    series: pd.Series,
    period: int = 14,
    smooth_k: int = 3,
    smooth_d: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """
    Calculate Stochastic RSI (%K and %D).

    Parameters
    ----------
    series : pd.Series
        Price series (usually Close).
    period : int
        RSI and Stochastic lookback period.
    smooth_k : int
        Periods to smooth %K (usually 3).
    smooth_d : int
        Periods to smooth %D (usually 3).

    Returns
    -------
    tuple[pd.Series, pd.Series]
        (stoch_rsi_k, stoch_rsi_d) as 0-100 scale series.
    """
    # 1. Calculate normal RSI
    rsi_vals = rsi(series, period)

    # 2. Calculate Stochastic of the RSI
    # StochRSI = (RSI - min(RSI)) / (max(RSI) - min(RSI))
    rolling_min = rsi_vals.rolling(window=period).min()
    rolling_max = rsi_vals.rolling(window=period).max()
    
    # Avoid division by zero
    stoch_rsi_raw = (rsi_vals - rolling_min) / (rolling_max - rolling_min).replace(0, 1e-10)
    
    # Scale to 0-100
    stoch_rsi_raw *= 100.0

    # 3. Apply smoothing for %K and %D
    stoch_k = stoch_rsi_raw.rolling(window=smooth_k).mean()
    stoch_d = stoch_k.rolling(window=smooth_d).mean()

    return stoch_k, stoch_d


def macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    Calculate Moving Average Convergence Divergence (MACD).

    Parameters
    ----------
    series : pd.Series
        Price series (usually Close).
    fast : int
        Fast EMA period.
    slow : int
        Slow EMA period.
    signal : int
        Signal line EMA period.

    Returns
    -------
    tuple[pd.Series, pd.Series, pd.Series]
        (macd_line, signal_line, macd_histogram)
    """
    ema_fast = ema(series, fast)
    ema_slow = ema(series, slow)
    
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal)
    macd_hist = macd_line - signal_line

    return macd_line, signal_line, macd_hist


def rolling_percentile(series: pd.Series, window: int) -> pd.Series:
    """
    Calculate the rolling rank percentile of the current value within its historical window.
    
    Returns 0-100 scale.
    """
    # Uses Pandas built-in rolling rank with pct=True
    return series.rolling(window=window).rank(pct=True) * 100.0


def cvd(df: pd.DataFrame) -> pd.Series:
    """
    Cumulative Volume Delta (CVD).
    
    Positive volume when close > prev_close, negative when close < prev_close.
    """
    prev_close = df["Close"].shift(1)
    direction = np.sign(df["Close"] - prev_close)
    vol_delta = df["Volume"] * direction
    return vol_delta.cumsum()


def efficiency_ratio(df: pd.DataFrame) -> pd.Series:
    """
    Efficiency Ratio = (High - Low) / Volume
    
    Measures how much volume is required to move the price.
    """
    hl_spread = df["High"] - df["Low"]
    vol = df["Volume"].replace(0, np.nan)
    return hl_spread / vol


def hurst_exponent(series: pd.Series, max_lag: int = 20) -> float:
    """
    Calculate the Hurst Exponent of a time series.
    
    H ~ 0.5: Random Walk
    H < 0.5: Mean Reverting
    H > 0.5: Trending
    """
    vals = series.values
    if len(vals) < max_lag * 2:
        return 0.5  # default to random walk if not enough data
        
    lags = range(2, max_lag)
    
    # Calculate the standard deviation of the difference
    tau = []
    for lag in lags:
        diff = np.subtract(vals[lag:], vals[:-lag])
        std = np.std(diff)
        tau.append(np.sqrt(std) if std > 0 else 1e-8)
        
    poly = np.polyfit(np.log(list(lags)), np.log(tau), 1)
    return poly[0] * 2.0


def closing_range(df: pd.DataFrame) -> pd.Series:
    """Closing Range = (Close - Low) / (High - Low)"""
    hl_range = (df["High"] - df["Low"]).replace(0, np.nan)
    return (df["Close"] - df["Low"]) / hl_range


def cmf(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """Chaikin Money Flow"""
    mfv = ((df["Close"] - df["Low"]) - (df["High"] - df["Close"])) / (df["High"] - df["Low"]).replace(0, np.nan)
    mf_vol = mfv * df["Volume"]
    return mf_vol.rolling(window=period).sum() / df["Volume"].rolling(window=period).sum()


def vpt(df: pd.DataFrame) -> pd.Series:
    """Volume Price Trend"""
    prev_close = df["Close"].shift(1).replace(0, np.nan)
    vpt_change = df["Volume"] * (df["Close"] - prev_close) / prev_close
    return vpt_change.cumsum()


def roc(series: pd.Series, period: int = 3) -> pd.Series:
    """Rate of Change"""
    prev = series.shift(period).replace(0, np.nan)
    return (series - prev) / prev


def detect_bearish_reversal(
    df: pd.DataFrame,
    n_candles: int = 2,
) -> bool:
    """
    Check if the last N candles form a bearish reversal pattern.

    A bearish reversal is confirmed when:
    1. Last N candles are all bearish (Close < Open)
    2. The most recent close is below the close from N candles ago

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns: Open, Close.
    n_candles : int
        Number of consecutive bearish candles required (default 2).

    Returns
    -------
    bool
        True if bearish reversal detected.
    """
    if len(df) < n_candles + 1:
        return False

    # Check last N candles are all bearish
    for i in range(-n_candles, 0):
        if float(df["Close"].iloc[i]) >= float(df["Open"].iloc[i]):
            return False

    # Additionally confirm downward movement
    recent_close = float(df["Close"].iloc[-1])
    pre_reversal_close = float(df["Close"].iloc[-(n_candles + 1)])
    return recent_close < pre_reversal_close


def detect_profit_peak(
    df: pd.DataFrame,
    entry_price: float,
    entry_idx: int,
) -> tuple[float, float]:
    """
    Calculate peak unrealized profit and current unrealized profit.

    Used by the reversal exit to determine if we should lock in gains.

    Parameters
    ----------
    df : pd.DataFrame
        Full OHLCV data.
    entry_price : float
        Price at which position was opened.
    entry_idx : int
        Index position in the DataFrame where the entry occurred.

    Returns
    -------
    tuple[float, float]
        (peak_profit_pct, current_profit_pct) — both as fractions.
    """
    if entry_idx >= len(df) or entry_price <= 0:
        return 0.0, 0.0

    # Slice from entry to now
    post_entry = df.iloc[entry_idx:]
    if len(post_entry) == 0:
        return 0.0, 0.0

    highest_high = float(post_entry["High"].max())
    current_close = float(post_entry["Close"].iloc[-1])

    peak_profit_pct = (highest_high - entry_price) / entry_price
    current_profit_pct = (current_close - entry_price) / entry_price

    return peak_profit_pct, current_profit_pct


# ── Momentum Indicators ──────────────────────────────────────────────────────


def stochastic_oscillator(
    df: pd.DataFrame,
    k_period: int = 14,
    d_period: int = 3,
    smooth_k: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """
    Classic Stochastic Oscillator (%K, %D).

    Different from StochRSI — this uses raw High/Low/Close price data.

    %K = SMA( (Close - Lowest Low) / (Highest High - Lowest Low) , smooth_k )
    %D = SMA(%K, d_period)

    Returns values on 0–100 scale.
    """
    lowest_low = df["Low"].rolling(k_period).min()
    highest_high = df["High"].rolling(k_period).max()

    raw_k = ((df["Close"] - lowest_low) / (highest_high - lowest_low)) * 100
    raw_k = raw_k.replace([float("inf"), float("-inf")], 50.0).fillna(50.0)

    # Smooth %K
    k = raw_k.rolling(smooth_k).mean()
    # %D is SMA of %K
    d = k.rolling(d_period).mean()

    return k, d


def adx(
    df: pd.DataFrame,
    period: int = 14,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    Average Directional Index (ADX) with +DI and -DI.

    ADX measures trend strength (not direction):
      - ADX > 25: strong trend
      - ADX > 40: extremely strong trend
      - ADX < 20: weak/no trend (ranging)

    +DI > -DI: bullish trend
    -DI > +DI: bearish trend

    Returns
    -------
    tuple[pd.Series, pd.Series, pd.Series]
        (adx_line, plus_di, minus_di)
    """
    high = df["High"]
    low = df["Low"]
    close = df["Close"]

    # True Range
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    # Directional Movement
    up_move = high - high.shift(1)
    down_move = low.shift(1) - low

    plus_dm = pd.Series(0.0, index=df.index)
    minus_dm = pd.Series(0.0, index=df.index)

    # +DM: up_move > down_move AND up_move > 0
    plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
    # -DM: down_move > up_move AND down_move > 0
    minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)

    # Wilder smoothing (EMA with alpha = 1/period)
    alpha = 1.0 / period
    atr_smooth = tr.ewm(alpha=alpha, adjust=False).mean()
    plus_dm_smooth = plus_dm.ewm(alpha=alpha, adjust=False).mean()
    minus_dm_smooth = minus_dm.ewm(alpha=alpha, adjust=False).mean()

    # +DI and -DI
    plus_di = (plus_dm_smooth / atr_smooth.replace(0, float("nan"))) * 100
    minus_di = (minus_dm_smooth / atr_smooth.replace(0, float("nan"))) * 100

    plus_di = plus_di.fillna(0)
    minus_di = minus_di.fillna(0)

    # DX and ADX
    di_sum = plus_di + minus_di
    dx = ((plus_di - minus_di).abs() / di_sum.replace(0, float("nan"))) * 100
    dx = dx.fillna(0)

    adx_line = dx.ewm(alpha=alpha, adjust=False).mean()

    return adx_line, plus_di, minus_di


def obv(df: pd.DataFrame) -> pd.Series:
    """
    On Balance Volume (OBV).

    Cumulative volume that adds on up-close days and subtracts on down-close.
    Rising OBV = money flowing in (accumulation).
    Falling OBV = money flowing out (distribution).
    """
    close = df["Close"]
    volume = df["Volume"]

    direction = close.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
    return (volume * direction).cumsum()


def obv_slope(df: pd.DataFrame, period: int = 10) -> float:
    """
    Slope of OBV over the last N periods (normalized by mean absolute OBV).

    Positive = money flowing in, Negative = money flowing out.
    """
    obv_series = obv(df)
    if len(obv_series) < period:
        return 0.0

    recent = obv_series.iloc[-period:]
    # Linear regression slope
    x = list(range(period))
    x_mean = sum(x) / period
    y_mean = float(recent.mean())
    numerator = sum((xi - x_mean) * (float(yi) - y_mean) for xi, yi in zip(x, recent))
    denominator = sum((xi - x_mean) ** 2 for xi in x)

    if denominator == 0:
        return 0.0

    slope = numerator / denominator

    # Normalize by mean absolute OBV to make comparable across stocks
    mean_abs = recent.abs().mean()
    if mean_abs > 0:
        return slope / float(mean_abs)
    return 0.0


def williams_r(
    df: pd.DataFrame,
    period: int = 14,
) -> pd.Series:
    """
    Williams %R oscillator.

    Scale: -100 to 0
      - Below -80: oversold
      - Above -20: overbought

    %R = (Highest High - Close) / (Highest High - Lowest Low) × -100
    """
    highest_high = df["High"].rolling(period).max()
    lowest_low = df["Low"].rolling(period).min()

    hh_ll = highest_high - lowest_low
    wr = ((highest_high - df["Close"]) / hh_ll.replace(0, float("nan"))) * -100
    return wr.fillna(-50)


def vwap(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """
    Rolling VWAP (Volume Weighted Average Price) over N periods.

    For intraday, this would be session VWAP. For daily data,
    we use a rolling window as an approximation.
    """
    typical_price = (df["High"] + df["Low"] + df["Close"]) / 3
    vol = df["Volume"]

    tp_vol = typical_price * vol
    cum_tp_vol = tp_vol.rolling(period).sum()
    cum_vol = vol.rolling(period).sum()

    return cum_tp_vol / cum_vol.replace(0, float("nan"))


def vwap_deviation(df: pd.DataFrame, period: int = 20) -> float:
    """
    Current price deviation from VWAP as a percentage.

    Positive = above VWAP (bullish), Negative = below VWAP.
    """
    vwap_series = vwap(df, period)
    if len(vwap_series) < period or pd.isna(vwap_series.iloc[-1]):
        return 0.0

    last_close = float(df["Close"].iloc[-1])
    last_vwap = float(vwap_series.iloc[-1])

    if last_vwap <= 0:
        return 0.0

    return ((last_close - last_vwap) / last_vwap) * 100


def is_bullish_engulfing(df: pd.DataFrame) -> bool:
    """
    Detect a bullish engulfing candlestick pattern on the last 2 candles.

    Criteria:
    1. Previous candle is bearish (close < open)
    2. Current candle is bullish (close > open)
    3. Current body engulfs previous body (open <= prev_close AND close >= prev_open)
    """
    if len(df) < 2:
        return False

    prev_open = float(df["Open"].iloc[-2])
    prev_close = float(df["Close"].iloc[-2])
    curr_open = float(df["Open"].iloc[-1])
    curr_close = float(df["Close"].iloc[-1])

    prev_bearish = prev_close < prev_open
    curr_bullish = curr_close > curr_open
    engulfs = curr_open <= prev_close and curr_close >= prev_open

    return prev_bearish and curr_bullish and engulfs


def is_hammer(df: pd.DataFrame, wick_ratio: float = 2.0) -> bool:
    """
    Detect a hammer candlestick pattern on the last candle.

    Criteria:
    1. Small real body (top 1/3 of candle range)
    2. Long lower shadow (>= wick_ratio × body)
    3. Little/no upper shadow
    """
    if len(df) < 1:
        return False

    o = float(df["Open"].iloc[-1])
    h = float(df["High"].iloc[-1])
    low = float(df["Low"].iloc[-1])
    c = float(df["Close"].iloc[-1])

    body = abs(c - o)
    candle_range = h - low

    if candle_range <= 0:
        return False

    body_top = max(c, o)
    body_bottom = min(c, o)

    lower_shadow = body_bottom - low
    upper_shadow = h - body_top

    # Body must be small (< 40% of range) and in top half
    body_pct = body / candle_range
    if body_pct > 0.40:
        return False

    # Lower shadow must be at least wick_ratio × body
    if body > 0 and lower_shadow < body * wick_ratio:
        return False

    # Upper shadow must be small (< 25% of range)
    if upper_shadow > candle_range * 0.25:
        return False

    return True


def is_bullish_candle(df: pd.DataFrame) -> bool:
    """Check if the latest candle is bullish (close > open) with decent body."""
    if len(df) < 1:
        return False

    o = float(df["Open"].iloc[-1])
    c = float(df["Close"].iloc[-1])
    h = float(df["High"].iloc[-1])
    low = float(df["Low"].iloc[-1])

    candle_range = h - low
    if candle_range <= 0:
        return False

    body = c - o
    # Bullish with body > 30% of range
    return body > 0 and (body / candle_range) >= 0.30


def is_higher_close(df: pd.DataFrame, periods: int = 2) -> bool:
    """Check if close has been rising over the last N periods."""
    if len(df) < periods + 1:
        return False

    for i in range(-periods, 0):
        if float(df["Close"].iloc[i]) <= float(df["Close"].iloc[i - 1]):
            return False
    return True


def momentum_confluence_score(
    df: pd.DataFrame,
    rsi_period: int = 14,
    macd_fast: int = 12,
    macd_slow: int = 26,
    macd_signal: int = 9,
    stoch_k: int = 14,
    stoch_d: int = 3,
    adx_period: int = 14,
    wr_period: int = 14,
    volume_avg_period: int = 20,
    ema_fast: int = 9,
    ema_mid: int = 21,
    ema_slow: int = 50,
) -> dict:
    """
    Compute a comprehensive momentum confluence score.

    Checks 10 independent momentum conditions and returns a dict with:
    - Individual condition results (bool)
    - Total confluence count (int, 0-10)
    - Weighted score (float)
    - All computed indicator values for transparency

    Only fires a trade signal when 6+ conditions align.

    Returns
    -------
    dict with keys:
        conditions: dict[str, bool]  — each condition name → True/False
        confluence_count: int        — how many conditions are met
        score: float                 — weighted score (0-10)
        indicators: dict             — raw indicator values for logging
    """
    result = {
        "conditions": {},
        "confluence_count": 0,
        "score": 0.0,
        "indicators": {},
    }

    if len(df) < max(ema_slow + 10, macd_slow + macd_signal + 5, 60):
        return result

    close = df["Close"]

    # ── 1. RSI Momentum Zone ─────────────────────────────────────────
    rsi_series = rsi(close, rsi_period)
    rsi_val = float(rsi_series.iloc[-1]) if not pd.isna(rsi_series.iloc[-1]) else 50
    rsi_prev = float(rsi_series.iloc[-2]) if len(rsi_series) > 1 and not pd.isna(rsi_series.iloc[-2]) else 50

    rsi_in_zone = 40 <= rsi_val <= 70
    rsi_rising = rsi_val > rsi_prev
    cond_rsi = rsi_in_zone and rsi_rising
    result["conditions"]["rsi_momentum"] = cond_rsi
    result["indicators"]["rsi"] = round(rsi_val, 2)
    result["indicators"]["rsi_rising"] = rsi_rising

    # ── 2. MACD Momentum ─────────────────────────────────────────────
    macd_line, signal_line, histogram = macd(close, macd_fast, macd_slow, macd_signal)
    hist_val = float(histogram.iloc[-1]) if not pd.isna(histogram.iloc[-1]) else 0
    hist_prev = float(histogram.iloc[-2]) if len(histogram) > 1 and not pd.isna(histogram.iloc[-2]) else 0
    macd_val = float(macd_line.iloc[-1]) if not pd.isna(macd_line.iloc[-1]) else 0
    signal_val = float(signal_line.iloc[-1]) if not pd.isna(signal_line.iloc[-1]) else 0

    cond_macd_hist = hist_val > 0 and hist_val > hist_prev  # positive & accelerating
    result["conditions"]["macd_momentum"] = cond_macd_hist
    result["indicators"]["macd_histogram"] = round(hist_val, 4)
    result["indicators"]["macd_accelerating"] = hist_val > hist_prev

    # ── 3. MACD Line Above Signal ────────────────────────────────────
    cond_macd_cross = macd_val > signal_val
    result["conditions"]["macd_bullish_cross"] = cond_macd_cross
    result["indicators"]["macd_line"] = round(macd_val, 4)
    result["indicators"]["signal_line"] = round(signal_val, 4)

    # ── 4. Stochastic Momentum ───────────────────────────────────────
    stoch_k_series, stoch_d_series = stochastic_oscillator(df, stoch_k, stoch_d)
    sk = float(stoch_k_series.iloc[-1]) if not pd.isna(stoch_k_series.iloc[-1]) else 50
    sd = float(stoch_d_series.iloc[-1]) if not pd.isna(stoch_d_series.iloc[-1]) else 50
    sk_prev = float(stoch_k_series.iloc[-2]) if len(stoch_k_series) > 1 and not pd.isna(stoch_k_series.iloc[-2]) else 50

    # %K crossed above %D from oversold (< 30), OR bullish in mid-zone
    stoch_cross_up = sk > sd and sk_prev <= sd
    stoch_oversold_bounce = sk > 20 and sk_prev < 20
    stoch_in_momentum = 30 < sk < 80 and sk > sd
    cond_stoch = stoch_cross_up or stoch_oversold_bounce or stoch_in_momentum
    result["conditions"]["stochastic_momentum"] = cond_stoch
    result["indicators"]["stoch_k"] = round(sk, 2)
    result["indicators"]["stoch_d"] = round(sd, 2)

    # ── 5. Volume Surge ──────────────────────────────────────────────
    vol_ratio = volume_ratio(df, volume_avg_period)
    vr = float(vol_ratio.iloc[-1]) if not pd.isna(vol_ratio.iloc[-1]) else 1.0

    cond_volume = vr >= 1.5  # 150% of average
    result["conditions"]["volume_surge"] = cond_volume
    result["indicators"]["volume_ratio"] = round(vr, 2)

    # ── 6. Triple EMA Alignment ──────────────────────────────────────
    ema_f = ema(close, ema_fast)
    ema_m = ema(close, ema_mid)
    ema_s = ema(close, ema_slow)

    ef = float(ema_f.iloc[-1]) if not pd.isna(ema_f.iloc[-1]) else 0
    em = float(ema_m.iloc[-1]) if not pd.isna(ema_m.iloc[-1]) else 0
    es = float(ema_s.iloc[-1]) if not pd.isna(ema_s.iloc[-1]) else 0
    last_close = float(close.iloc[-1])

    cond_ema = ef > em > es and last_close > ef
    result["conditions"]["ema_alignment"] = cond_ema
    result["indicators"]["ema9"] = round(ef, 2)
    result["indicators"]["ema21"] = round(em, 2)
    result["indicators"]["ema50"] = round(es, 2)

    # ── 7. ADX Trend Strength ────────────────────────────────────────
    adx_line, plus_di, minus_di = adx(df, adx_period)
    adx_val = float(adx_line.iloc[-1]) if not pd.isna(adx_line.iloc[-1]) else 0
    pdi = float(plus_di.iloc[-1]) if not pd.isna(plus_di.iloc[-1]) else 0
    mdi = float(minus_di.iloc[-1]) if not pd.isna(minus_di.iloc[-1]) else 0

    cond_adx = adx_val > 20 and pdi > mdi
    result["conditions"]["adx_trend_strength"] = cond_adx
    result["indicators"]["adx"] = round(adx_val, 2)
    result["indicators"]["plus_di"] = round(pdi, 2)
    result["indicators"]["minus_di"] = round(mdi, 2)

    # ── 8. Price Action (Bullish Candle + Higher Close) ──────────────
    bullish = is_bullish_candle(df)
    higher = is_higher_close(df, periods=2)
    cond_price_action = bullish or (higher and last_close > ef)
    result["conditions"]["price_action_bullish"] = cond_price_action
    result["indicators"]["is_bullish_candle"] = bullish
    result["indicators"]["is_higher_close"] = higher

    # ── 9. OBV Trend (money flowing in) ──────────────────────────────
    obv_sl = obv_slope(df, period=10)
    cond_obv = obv_sl > 0.01  # positive slope = accumulation
    result["conditions"]["obv_accumulation"] = cond_obv
    result["indicators"]["obv_slope"] = round(obv_sl, 4)

    # ── 10. Williams %R Oversold Recovery ────────────────────────────
    wr_series = williams_r(df, wr_period)
    wr_val = float(wr_series.iloc[-1]) if not pd.isna(wr_series.iloc[-1]) else -50
    wr_prev = float(wr_series.iloc[-2]) if len(wr_series) > 1 and not pd.isna(wr_series.iloc[-2]) else -50

    # Crossed above -80 from below (oversold exit) OR in bullish zone
    wr_oversold_exit = wr_val > -80 and wr_prev <= -80
    wr_bullish = wr_val > -50
    cond_wr = wr_oversold_exit or wr_bullish
    result["conditions"]["williams_r_bullish"] = cond_wr
    result["indicators"]["williams_r"] = round(wr_val, 2)

    # ── Confluence Count & Score ─────────────────────────────────────
    # Weighted scoring: core conditions get higher weight
    weights = {
        "rsi_momentum": 1.2,           # Core momentum
        "macd_momentum": 1.3,          # Trend acceleration
        "macd_bullish_cross": 1.0,     # Trend direction
        "stochastic_momentum": 1.1,    # Timing
        "volume_surge": 1.5,           # Institutional participation
        "ema_alignment": 1.2,          # Trend structure
        "adx_trend_strength": 1.0,     # Trend strength
        "price_action_bullish": 1.0,   # Candle confirmation
        "obv_accumulation": 0.8,       # Volume trend
        "williams_r_bullish": 0.9,     # Oversold recovery
    }

    count = sum(1 for v in result["conditions"].values() if v)
    weighted_score = sum(
        weights.get(k, 1.0) for k, v in result["conditions"].items() if v
    )

    result["confluence_count"] = count
    result["score"] = round(weighted_score, 2)

    return result

