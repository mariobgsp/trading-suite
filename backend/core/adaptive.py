"""
Adaptive Per-Stock Detector for the IHSG swing trading system.

Computes a statistical profile for each stock from its last 2 years
of history, replacing fixed global thresholds with personalized ones.

Each stock has its own:
  - RSI oversold / overbought levels (based on its own percentiles)
  - Volume spike threshold (based on its own volume distribution)
  - Typical consolidation range (based on its own price action)
  - Volatility profile (normalized ATR)
  - Mean-reversion vs trending tendency (Hurst exponent)
  - Trend strength (linear regression slope)

This makes the system MORE sensitive for stable blue-chip stocks
(whose RSI rarely goes below 40) and MORE conservative for volatile
stocks (whose RSI routinely hits 20).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from config.settings import (
    ADAPTIVE_MAX_YEARS,
    ADAPTIVE_RSI_PERCENTILE,
    ADAPTIVE_TREND_LOOKBACK,
    ADAPTIVE_VOLUME_PERCENTILE,
    ALPHA_MEAN_REVERSION_PERIOD,
    ALPHA_MOMENTUM_PERIOD,
    ALPHA_MONEY_FLOW_PERIOD,
    ALPHA_LIQUIDITY_VWAP_PERIOD,
    ALPHA_VOLATILITY_WINDOW,
    BOW_RSI_THRESHOLD,
    BOW_VOLUME_CLIMAX_RATIO,
    BREAKOUT_MAX_SPREAD_PCT,
    VCLR_VOLUME_RATIO,
)
from core.indicators import atr, hurst_exponent, rsi, volume_ratio, cmf, roc

logger = logging.getLogger(__name__)


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class StockProfile:
    """Statistical profile of a single stock computed from historical data.

    All threshold fields are personalized for this specific stock based
    on its own distribution of indicators over the last 2 years.
    """

    ticker: str

    # RSI-based thresholds (from the stock's own RSI distribution)
    rsi_oversold: float       # e.g., 10th percentile of RSI → 35 for BBCA, 22 for MDKA
    rsi_overbought: float     # e.g., 90th percentile of RSI → 72 for BBCA, 80 for MDKA

    # Volume-based thresholds (from the stock's own volume ratio distribution)
    volume_spike_threshold: float  # e.g., 90th percentile → 1.6 for BBCA, 2.8 for MDKA

    # Price action characteristics
    typical_range_pct: float  # Median of rolling 20-day (H-L)/C range → consolidation baseline
    atr_pct: float            # ATR(14) / Close — normalized volatility measure

    # Character classification
    mean_reversion_score: float  # Hurst exponent: <0.5 = mean-reverting, >0.5 = trending
    trend_strength: float        # Slope of linear regression (normalized)

    # ── ML4T Formulaic Alpha Factors (Enhancement 1) ──────────────────────
    alpha_momentum: float         # Rate-of-change momentum factor (WQ Alpha #12 inspired)
    alpha_mean_reversion: float   # Bollinger Band z-score factor (WQ Alpha #98 inspired)
    alpha_liquidity: float        # VWAP deviation factor (WQ Alpha #32 inspired)
    alpha_volatility_regime: float  # Realized vol z-score factor (WQ Alpha #54 inspired)
    alpha_money_flow: float       # Chaikin Money Flow factor (WQ Alpha #45 inspired)

    # Metadata
    data_days: int            # How many days of data were used
    computed_at: str          # Timestamp when profile was computed

    @property
    def is_mean_reverting(self) -> bool:
        """Stock tends to mean-revert (good for BOW/Wyckoff engines)."""
        return self.mean_reversion_score < 0.45

    @property
    def is_trending(self) -> bool:
        """Stock tends to trend (good for breakout/EMA engines)."""
        return self.mean_reversion_score > 0.55

    @property
    def is_low_volatility(self) -> bool:
        """Stock has relatively low volatility (ATR% < 2%)."""
        return self.atr_pct < 0.02

    @property
    def alpha_vector(self) -> list[float]:
        """Return all alpha factors as a feature vector for ML models."""
        return [
            self.alpha_momentum,
            self.alpha_mean_reversion,
            self.alpha_liquidity,
            self.alpha_volatility_regime,
            self.alpha_money_flow,
        ]

    def __str__(self) -> str:
        return (
            f"StockProfile({self.ticker}): "
            f"RSI=[{self.rsi_oversold:.0f}-{self.rsi_overbought:.0f}] "
            f"VolSpike={self.volume_spike_threshold:.1f}x "
            f"Range={self.typical_range_pct:.1f}% "
            f"ATR%={self.atr_pct*100:.1f}% "
            f"Hurst={self.mean_reversion_score:.2f} "
            f"TrendSlope={self.trend_strength:.4f} "
            f"Alphas=[M={self.alpha_momentum:.3f} MR={self.alpha_mean_reversion:.3f} "
            f"L={self.alpha_liquidity:.3f} V={self.alpha_volatility_regime:.3f} "
            f"MF={self.alpha_money_flow:.3f}] "
            f"({self.data_days} days)"
        )


# ─── Adaptive Detector ───────────────────────────────────────────────────────


class AdaptiveDetector:
    """
    Builds per-stock statistical profiles from historical data.

    Usage:
        detector = AdaptiveDetector()
        profile = detector.build_profile(df, ticker="BBCA")

        # Use in engines:
        if current_rsi < profile.rsi_oversold:
            # This stock is at its OWN oversold level
            ...
    """

    def build_profile(
        self,
        df: pd.DataFrame,
        ticker: str = "UNKNOWN",
        max_years: int = ADAPTIVE_MAX_YEARS,
    ) -> StockProfile:
        """
        Compute a complete statistical profile for a stock.

        Parameters
        ----------
        df : pd.DataFrame
            Full OHLCV data with DatetimeIndex.
        ticker : str
            Ticker code for logging.
        max_years : int
            Maximum years of history to analyze (default 2).

        Returns
        -------
        StockProfile
            Personalized thresholds based on this stock's behavior.
        """
        # Limit to max_years of data (roughly 252 trading days per year)
        max_bars = max_years * 252
        analysis_df = df.tail(max_bars) if len(df) > max_bars else df

        if len(analysis_df) < 60:
            # Not enough data — return conservative defaults
            logger.debug(
                "[%s] Insufficient data (%d bars) for adaptive profile, using defaults",
                ticker, len(analysis_df),
            )
            return self._default_profile(ticker, len(analysis_df))

        # ── Compute RSI distribution ──────────────────────────────────
        rsi_series = rsi(analysis_df["Close"], period=14).dropna()
        if len(rsi_series) > 20:
            rsi_oversold = float(np.percentile(rsi_series, ADAPTIVE_RSI_PERCENTILE))
            rsi_overbought = float(np.percentile(rsi_series, 100 - ADAPTIVE_RSI_PERCENTILE))
        else:
            rsi_oversold = BOW_RSI_THRESHOLD
            rsi_overbought = 70.0

        # ── Compute Volume distribution ───────────────────────────────
        vol_ratio_series = volume_ratio(analysis_df, period=20).dropna()
        if len(vol_ratio_series) > 20:
            vol_spike = float(np.percentile(vol_ratio_series, ADAPTIVE_VOLUME_PERCENTILE))
        else:
            vol_spike = BOW_VOLUME_CLIMAX_RATIO

        # ── Compute typical price range ───────────────────────────────
        if len(analysis_df) >= 20:
            rolling_range = (
                analysis_df["High"].rolling(20).max()
                - analysis_df["Low"].rolling(20).min()
            ) / analysis_df["Close"] * 100.0
            rolling_range_clean = rolling_range.dropna()
            typical_range = float(rolling_range_clean.median()) if len(rolling_range_clean) > 0 else BREAKOUT_MAX_SPREAD_PCT
        else:
            typical_range = BREAKOUT_MAX_SPREAD_PCT

        # ── Compute normalized ATR ────────────────────────────────────
        atr_series = atr(analysis_df, period=14)
        last_atr = float(atr_series.iloc[-1]) if not pd.isna(atr_series.iloc[-1]) else 0.0
        last_close = float(analysis_df["Close"].iloc[-1])
        atr_pct = (last_atr / last_close) if last_close > 0 else 0.02

        # ── Compute Hurst exponent (mean-reversion vs trending) ───────
        if len(analysis_df) >= 100:
            hurst = hurst_exponent(analysis_df["Close"].tail(100), max_lag=20)
        else:
            hurst = 0.5

        # ── Compute trend strength (linear regression slope) ──────────
        trend_lookback = min(ADAPTIVE_TREND_LOOKBACK, len(analysis_df))
        if trend_lookback >= 20:
            close_tail = analysis_df["Close"].tail(trend_lookback).values
            x = np.arange(len(close_tail))
            # Normalize slope by mean price so it's comparable across stocks
            try:
                slope = np.polyfit(x, close_tail, 1)[0]
                mean_price = np.mean(close_tail)
                norm_slope = (slope / mean_price) if mean_price > 0 else 0.0
            except (np.linalg.LinAlgError, ValueError):
                norm_slope = 0.0
        else:
            norm_slope = 0.0

        # ── Compute Formulaic Alpha Factors (ML4T Enhancement 1) ────
        alphas = self._compute_formulaic_alphas(analysis_df, ticker)

        # ── Clamp values to sensible ranges ───────────────────────────
        rsi_oversold = max(15.0, min(45.0, rsi_oversold))
        rsi_overbought = max(55.0, min(85.0, rsi_overbought))
        vol_spike = max(1.2, min(5.0, vol_spike))
        hurst = max(0.0, min(1.0, hurst))

        profile = StockProfile(
            ticker=ticker,
            rsi_oversold=round(rsi_oversold, 1),
            rsi_overbought=round(rsi_overbought, 1),
            volume_spike_threshold=round(vol_spike, 2),
            typical_range_pct=round(typical_range, 2),
            atr_pct=round(atr_pct, 4),
            mean_reversion_score=round(hurst, 3),
            trend_strength=round(norm_slope, 6),
            alpha_momentum=round(alphas["momentum"], 4),
            alpha_mean_reversion=round(alphas["mean_reversion"], 4),
            alpha_liquidity=round(alphas["liquidity"], 4),
            alpha_volatility_regime=round(alphas["volatility_regime"], 4),
            alpha_money_flow=round(alphas["money_flow"], 4),
            data_days=len(analysis_df),
            computed_at=pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"),
        )

        logger.debug("[%s] Adaptive profile: %s", ticker, profile)
        return profile

    def _default_profile(self, ticker: str, data_days: int) -> StockProfile:
        """Return a conservative default profile when data is insufficient."""
        return StockProfile(
            ticker=ticker,
            rsi_oversold=BOW_RSI_THRESHOLD,
            rsi_overbought=70.0,
            volume_spike_threshold=BOW_VOLUME_CLIMAX_RATIO,
            typical_range_pct=BREAKOUT_MAX_SPREAD_PCT,
            atr_pct=0.02,
            mean_reversion_score=0.5,
            trend_strength=0.0,
            alpha_momentum=0.0,
            alpha_mean_reversion=0.0,
            alpha_liquidity=0.0,
            alpha_volatility_regime=0.0,
            alpha_money_flow=0.0,
            data_days=data_days,
            computed_at=pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"),
        )

    # ── Formulaic Alpha Computation (ML4T Enhancement 1) ──────────────

    def _compute_formulaic_alphas(
        self,
        df: pd.DataFrame,
        ticker: str,
    ) -> dict[str, float]:
        """
        Compute WorldQuant-inspired formulaic alpha factors.

        All computations use pure numpy/pandas — no TA-Lib dependency.
        These alphas capture orthogonal dimensions of stock behavior
        and serve as features for the ML entry engines.

        Alpha Factors:
          1. Momentum (WQ #12 inspired): Normalized rate-of-change
          2. Mean Reversion (WQ #98 inspired): Bollinger Band z-score
          3. Liquidity (WQ #32 inspired): VWAP deviation
          4. Volatility Regime (WQ #54 inspired): Realized vol z-score
          5. Money Flow (WQ #45 inspired): Chaikin Money Flow

        Returns dict of alpha name → value (last observation).
        """
        defaults = {
            "momentum": 0.0,
            "mean_reversion": 0.0,
            "liquidity": 0.0,
            "volatility_regime": 0.0,
            "money_flow": 0.0,
        }

        if len(df) < 60 or "Close" not in df.columns:
            return defaults

        try:
            close = df["Close"]
            high = df["High"]
            low = df["Low"]
            volume = df["Volume"]

            # ── Alpha 1: Momentum (Normalized ROC) ────────────────────
            # Rate-of-change over ALPHA_MOMENTUM_PERIOD, normalized by
            # rolling std to make it comparable across stocks
            roc_raw = roc(close, period=ALPHA_MOMENTUM_PERIOD)
            roc_std = roc_raw.rolling(60).std()
            alpha_momentum = roc_raw / roc_std.replace(0, np.nan)
            last_momentum = float(alpha_momentum.iloc[-1]) if not pd.isna(alpha_momentum.iloc[-1]) else 0.0

            # ── Alpha 2: Mean Reversion (Bollinger Z-Score) ───────────
            # How many std devs price is from its moving average
            sma_mr = close.rolling(ALPHA_MEAN_REVERSION_PERIOD).mean()
            std_mr = close.rolling(ALPHA_MEAN_REVERSION_PERIOD).std()
            z_score = (close - sma_mr) / std_mr.replace(0, np.nan)
            last_mr = float(z_score.iloc[-1]) if not pd.isna(z_score.iloc[-1]) else 0.0

            # ── Alpha 3: Liquidity (VWAP Deviation) ───────────────────
            # How far price deviates from its VWAP
            typical_price = (high + low + close) / 3.0
            cum_tp_vol = (typical_price * volume).rolling(ALPHA_LIQUIDITY_VWAP_PERIOD).sum()
            cum_vol = volume.rolling(ALPHA_LIQUIDITY_VWAP_PERIOD).sum()
            vwap = cum_tp_vol / cum_vol.replace(0, np.nan)
            vwap_dev = (close - vwap) / vwap.replace(0, np.nan)
            last_liquidity = float(vwap_dev.iloc[-1]) if not pd.isna(vwap_dev.iloc[-1]) else 0.0

            # ── Alpha 4: Volatility Regime (Realized Vol Z-Score) ─────
            # Current realized vol relative to its own history
            log_returns = np.log(close / close.shift(1))
            realized_vol = log_returns.rolling(ALPHA_VOLATILITY_WINDOW).std() * np.sqrt(252)
            vol_mean = realized_vol.rolling(120).mean()
            vol_std = realized_vol.rolling(120).std()
            vol_z = (realized_vol - vol_mean) / vol_std.replace(0, np.nan)
            last_vol = float(vol_z.iloc[-1]) if not pd.isna(vol_z.iloc[-1]) else 0.0

            # ── Alpha 5: Money Flow (Chaikin Money Flow) ──────────────
            cmf_series = cmf(df, period=ALPHA_MONEY_FLOW_PERIOD)
            last_mf = float(cmf_series.iloc[-1]) if not pd.isna(cmf_series.iloc[-1]) else 0.0

            # Clamp extreme values
            last_momentum = max(-5.0, min(5.0, last_momentum))
            last_mr = max(-5.0, min(5.0, last_mr))
            last_liquidity = max(-1.0, min(1.0, last_liquidity))
            last_vol = max(-5.0, min(5.0, last_vol))
            last_mf = max(-1.0, min(1.0, last_mf))

            return {
                "momentum": last_momentum,
                "mean_reversion": last_mr,
                "liquidity": last_liquidity,
                "volatility_regime": last_vol,
                "money_flow": last_mf,
            }

        except Exception as e:
            logger.debug("[%s] Alpha computation error: %s", ticker, e)
            return defaults

    # ── Convenience query methods ─────────────────────────────────────

    @staticmethod
    def is_oversold(df: pd.DataFrame, profile: StockProfile) -> bool:
        """Check if the stock's current RSI is at its own oversold level."""
        rsi_series = rsi(df["Close"], period=14)
        last_rsi = float(rsi_series.iloc[-1]) if not pd.isna(rsi_series.iloc[-1]) else 50.0
        return last_rsi < profile.rsi_oversold

    @staticmethod
    def is_volume_climax(df: pd.DataFrame, profile: StockProfile) -> bool:
        """Check if current volume exceeds the stock's own spike threshold."""
        vol_ratio_series = volume_ratio(df, period=20)
        last_vol = float(vol_ratio_series.iloc[-1]) if not pd.isna(vol_ratio_series.iloc[-1]) else 1.0
        return last_vol >= profile.volume_spike_threshold

    @staticmethod
    def is_tight_consolidation(df: pd.DataFrame, profile: StockProfile) -> bool:
        """Check if current range is below the stock's typical range (stock-relative consolidation)."""
        if len(df) < 20:
            return False
        recent = df.tail(20)
        highest = recent["High"].max()
        lowest = recent["Low"].min()
        last_close = float(df["Close"].iloc[-1])
        if last_close <= 0:
            return False
        current_range = ((highest - lowest) / last_close) * 100.0
        # Consolidating if current range is less than 80% of the stock's typical range
        return current_range <= (profile.typical_range_pct * 0.8)

    @staticmethod
    def get_adapted_thresholds(profile: StockProfile) -> dict:
        """Return a dict of engine-specific thresholds personalized for this stock."""
        return {
            "bow_rsi_threshold": profile.rsi_oversold,
            "bow_volume_climax_ratio": profile.volume_spike_threshold,
            "breakout_max_spread_pct": profile.typical_range_pct,
            "breakout_volume_threshold": max(1.2, profile.volume_spike_threshold * 0.7),
            "vclr_volume_ratio": max(2.0, profile.volume_spike_threshold * 1.2),
            "ema_rsi_min": max(30.0, profile.rsi_oversold + 5.0),
            "ema_rsi_max": min(80.0, profile.rsi_overbought - 5.0),
        }
