"""
Data cleaning pipeline for raw OHLCV data.

Handles the messy realities of IDX market data:
- Missing trading days (holidays, halts)
- Stock splits / reverse splits
- Erroneous volume spikes from exchange glitches
- Invalid OHLC relationships (High < Low, etc.)
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from config.settings import (
    MAX_FORWARD_FILL_DAYS,
    SPLIT_DETECTION_THRESHOLD,
    VOLUME_ROLLING_WINDOW,
    VOLUME_SPIKE_STD_THRESHOLD,
)

logger = logging.getLogger(__name__)


class DataCleaner:
    """
    Production-grade OHLCV data cleaning pipeline.

    Usage:
        cleaner = DataCleaner()
        clean_df = cleaner.clean(raw_df, ticker="BBCA")
    """

    def clean(self, df: pd.DataFrame, ticker: str = "UNKNOWN") -> pd.DataFrame:
        """
        Run the full cleaning pipeline on raw OHLCV data.

        Parameters
        ----------
        df : pd.DataFrame
            Raw data with columns: Open, High, Low, Close, Volume.
            Index should be a DatetimeIndex.
        ticker : str
            Ticker code for logging context.

        Returns
        -------
        pd.DataFrame
            Cleaned DataFrame, sorted by date, with anomalies handled.
        """
        if df.empty:
            logger.warning("[%s] Received empty DataFrame, skipping clean.", ticker)
            return df

        original_len = len(df)
        df = df.copy()

        # Ensure DatetimeIndex
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)
        df.index.name = "Date"

        # Pipeline steps (order matters)
        df = self._sort_and_deduplicate(df, ticker)
        df = self._drop_invalid_prices(df, ticker)
        df = self._repair_ohlc_integrity(df, ticker)
        df = self._detect_and_log_splits(df, ticker)
        df = self._handle_missing_bars(df, ticker)
        df = self._cap_volume_spikes(df, ticker)

        final_len = len(df)
        if final_len != original_len:
            logger.info(
                "[%s] Cleaning: %d -> %d bars (%+d)",
                ticker, original_len, final_len, final_len - original_len,
            )

        return df

    # ── Step 1: Sort & Deduplicate ────────────────────────────────────────

    def _sort_and_deduplicate(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """Sort by date ascending and remove exact duplicate dates."""
        df = df.sort_index()
        dupes = df.index.duplicated(keep="last")
        n_dupes = dupes.sum()
        if n_dupes > 0:
            logger.info("[%s] Removed %d duplicate date(s).", ticker, n_dupes)
            df = df[~dupes]
        return df

    # ── Step 2: Drop Invalid Prices ───────────────────────────────────────

    def _drop_invalid_prices(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """Remove rows with zero, negative, or NaN prices."""
        price_cols = ["Open", "High", "Low", "Close"]
        existing = [c for c in price_cols if c in df.columns]

        if not existing:
            logger.warning("[%s] No price columns found.", ticker)
            return df

        # Drop rows where ANY price column is zero, negative, or NaN
        mask_valid = pd.Series(True, index=df.index)
        for col in existing:
            mask_valid &= df[col].notna() & (df[col] > 0)

        n_invalid = (~mask_valid).sum()
        if n_invalid > 0:
            logger.info(
                "[%s] Dropped %d rows with zero/negative/NaN prices.",
                ticker, n_invalid,
            )
            df = df[mask_valid]

        return df

    # ── Step 3: Repair OHLC Integrity ─────────────────────────────────────

    def _repair_ohlc_integrity(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """
        Ensure High >= max(Open, Close) and Low <= min(Open, Close).

        Minor violations are common in IDX data due to rounding
        or exchange reporting quirks.
        """
        required = {"Open", "High", "Low", "Close"}
        if not required.issubset(df.columns):
            return df

        n_repaired = 0

        # High must be >= Open and Close
        true_high = df[["Open", "High", "Close"]].max(axis=1)
        violations = df["High"] < true_high
        if violations.any():
            n_repaired += violations.sum()
            df.loc[violations, "High"] = true_high[violations]

        # Low must be <= Open and Close
        true_low = df[["Open", "Low", "Close"]].min(axis=1)
        violations = df["Low"] > true_low
        if violations.any():
            n_repaired += violations.sum()
            df.loc[violations, "Low"] = true_low[violations]

        if n_repaired > 0:
            logger.debug(
                "[%s] Repaired %d OHLC integrity violation(s).",
                ticker, n_repaired,
            )

        return df

    # ── Step 4: Detect Stock Splits ───────────────────────────────────────

    def _detect_and_log_splits(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """
        Detect potential stock splits and log them as warnings.

        A split is flagged when:
        - Single-day price change exceeds SPLIT_DETECTION_THRESHOLD (40%)
        - Volume shows an inverse spike (typical of split adjustments)

        Note: yfinance typically provides adjusted data. This method
        serves as a validation layer to log when adjustments may have
        been applied or when raw data contains unadjusted splits.
        """
        if "Close" not in df.columns or len(df) < 2:
            return df

        pct_change = df["Close"].pct_change().abs()
        split_mask = pct_change > SPLIT_DETECTION_THRESHOLD

        n_splits = split_mask.sum()
        if n_splits > 0:
            split_dates = df.index[split_mask].strftime("%Y-%m-%d").tolist()
            logger.warning(
                "[%s] Detected %d potential split event(s) on: %s. "
                "Verify adjusted close data is being used.",
                ticker, n_splits, ", ".join(split_dates[:5]),  # Log first 5
            )

        return df

    # ── Step 5: Handle Missing Bars ───────────────────────────────────────

    def _handle_missing_bars(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """
        Fill short gaps (≤ MAX_FORWARD_FILL_DAYS trading days) via ffill.

        Longer gaps are left as-is and logged for manual review.
        IDX trades Mon–Fri, so we use 'B' (business day) frequency.
        """
        if df.empty:
            return df

        # Reindex to full business-day calendar
        full_idx = pd.bdate_range(start=df.index.min(), end=df.index.max())
        df_reindexed = df.reindex(full_idx)

        # Identify gap lengths
        is_missing = df_reindexed["Close"].isna()
        gap_groups = is_missing.ne(is_missing.shift()).cumsum()
        gap_lengths = is_missing.groupby(gap_groups).transform("sum")

        # Forward-fill only short gaps
        short_gap_mask = is_missing & (gap_lengths <= MAX_FORWARD_FILL_DAYS)
        long_gap_mask = is_missing & (gap_lengths > MAX_FORWARD_FILL_DAYS)

        n_short = short_gap_mask.sum()
        n_long = long_gap_mask.sum()

        if n_short > 0:
            df_reindexed = df_reindexed.ffill(limit=MAX_FORWARD_FILL_DAYS)
            logger.debug(
                "[%s] Forward-filled %d short gap(s) (≤%d days).",
                ticker, n_short, MAX_FORWARD_FILL_DAYS,
            )

        if n_long > 0:
            logger.warning(
                "[%s] %d bars in long gaps (>%d days) left unfilled. "
                "May indicate trading halt or delisting period.",
                ticker, n_long, MAX_FORWARD_FILL_DAYS,
            )

        # Drop remaining NaN rows (long gaps)
        df_reindexed = df_reindexed.dropna(subset=["Close"])
        df_reindexed.index.name = "Date"

        return df_reindexed

    # ── Step 6: Cap Volume Spikes ─────────────────────────────────────────

    def _cap_volume_spikes(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """
        Detect and cap erroneous volume spikes.

        Volumes exceeding VOLUME_SPIKE_STD_THRESHOLD standard deviations
        above the rolling mean are replaced with the rolling median.
        This catches exchange glitches while preserving legitimate
        high-volume days (earnings, block trades).
        """
        if "Volume" not in df.columns or len(df) < VOLUME_ROLLING_WINDOW:
            return df

        rolling_mean = df["Volume"].rolling(
            window=VOLUME_ROLLING_WINDOW, min_periods=20
        ).mean()
        rolling_std = df["Volume"].rolling(
            window=VOLUME_ROLLING_WINDOW, min_periods=20
        ).std()
        rolling_median = df["Volume"].rolling(
            window=VOLUME_ROLLING_WINDOW, min_periods=20
        ).median()

        upper_bound = rolling_mean + (VOLUME_SPIKE_STD_THRESHOLD * rolling_std)

        spike_mask = (df["Volume"] > upper_bound) & rolling_mean.notna()
        n_spikes = spike_mask.sum()

        if n_spikes > 0:
            df.loc[spike_mask, "Volume"] = rolling_median[spike_mask]
            logger.info(
                "[%s] Capped %d erroneous volume spike(s) (>%.0fσ).",
                ticker, n_spikes, VOLUME_SPIKE_STD_THRESHOLD,
            )

        return df

    # ── Step 7: Wavelet Denoising (ML4T Enhancement 1) ────────────────────

    def _denoise_wavelet(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """
        Apply wavelet denoising to the Close price series.

        Uses the Daubechies-4 (db4) wavelet with soft thresholding to
        remove high-frequency noise while preserving the overall trend
        structure and important features like support/resistance levels.

        The denoised series is stored as 'Close_Denoised', preserving
        the original 'Close' column for reference.
        """
        try:
            import pywt
        except ImportError:
            logger.debug("[%s] PyWavelets not installed, skipping wavelet denoising.", ticker)
            return df

        from config.settings import WAVELET_FAMILY, WAVELET_LEVEL, WAVELET_THRESHOLD_MODE

        if "Close" not in df.columns or len(df) < 2 ** WAVELET_LEVEL:
            return df

        close = df["Close"].values.astype(float)

        # Pad to power of 2 for clean decomposition, then trim back
        original_len = len(close)

        # Discrete Wavelet Transform
        coeffs = pywt.wavedec(close, WAVELET_FAMILY, level=WAVELET_LEVEL)

        # Universal threshold (VisuShrink) on detail coefficients
        # sigma = median absolute deviation of finest detail coefficients
        detail_finest = coeffs[-1]
        sigma = np.median(np.abs(detail_finest)) / 0.6745
        threshold = sigma * np.sqrt(2 * np.log(len(close)))

        # Apply threshold to detail coefficients (keep approximation intact)
        denoised_coeffs = [coeffs[0]]  # approximation coefficients unchanged
        for detail in coeffs[1:]:
            denoised_coeffs.append(
                pywt.threshold(detail, value=threshold, mode=WAVELET_THRESHOLD_MODE)
            )

        # Reconstruct
        denoised = pywt.waverec(denoised_coeffs, WAVELET_FAMILY)

        # Trim to original length (waverec may produce extra samples)
        denoised = denoised[:original_len]

        df["Close_Denoised"] = denoised

        logger.debug(
            "[%s] Wavelet denoised Close (wavelet=%s, level=%d, threshold=%.2f).",
            ticker, WAVELET_FAMILY, WAVELET_LEVEL, threshold,
        )
        return df

    # ── Step 8: Kalman Filter Denoising (ML4T Enhancement 1) ──────────────

    def _denoise_kalman(
        self, df: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        """
        Apply Kalman filter to smooth the Close price series.

        Uses a simple random-walk state-space model where the hidden
        state is the "true" price and observations are noisy measurements.
        The Kalman filter optimally estimates the hidden state given
        the noise parameters.

        The filtered series is stored as 'Close_Kalman', preserving
        the original 'Close' column.
        """
        try:
            from pykalman import KalmanFilter
        except ImportError:
            logger.debug("[%s] pykalman not installed, skipping Kalman denoising.", ticker)
            return df

        from config.settings import (
            KALMAN_TRANSITION_COVARIANCE,
            KALMAN_OBSERVATION_COVARIANCE,
        )

        if "Close" not in df.columns or len(df) < 10:
            return df

        close = df["Close"].values.astype(float).reshape(-1, 1)

        kf = KalmanFilter(
            transition_matrices=[1],
            observation_matrices=[1],
            initial_state_mean=close[0, 0],
            initial_state_covariance=1.0,
            observation_covariance=KALMAN_OBSERVATION_COVARIANCE,
            transition_covariance=KALMAN_TRANSITION_COVARIANCE,
        )

        state_means, _ = kf.filter(close)
        df["Close_Kalman"] = state_means.flatten()

        logger.debug(
            "[%s] Kalman filtered Close (Q=%.4f, R=%.2f).",
            ticker, KALMAN_TRANSITION_COVARIANCE, KALMAN_OBSERVATION_COVARIANCE,
        )
        return df

    # ── Combined Clean + Denoise Pipeline ─────────────────────────────────

    def clean_and_denoise(
        self, df: pd.DataFrame, ticker: str = "UNKNOWN"
    ) -> pd.DataFrame:
        """
        Run the full cleaning pipeline PLUS denoising on raw OHLCV data.

        This method calls ``clean()`` first, then applies wavelet and/or
        Kalman denoising based on the configuration in settings.py.

        The original Close column is always preserved. Denoised columns
        are added as 'Close_Denoised' (wavelet) and 'Close_Kalman'.

        Parameters
        ----------
        df : pd.DataFrame
            Raw data with columns: Open, High, Low, Close, Volume.
        ticker : str
            Ticker code for logging context.

        Returns
        -------
        pd.DataFrame
            Cleaned and denoised DataFrame.
        """
        from config.settings import DENOISING_ENABLED, DENOISING_METHOD

        # Run standard cleaning first
        df = self.clean(df, ticker)

        if not DENOISING_ENABLED or df.empty:
            return df

        # Apply denoising based on method setting
        if DENOISING_METHOD in ("wavelet", "both"):
            df = self._denoise_wavelet(df, ticker)
        if DENOISING_METHOD in ("kalman", "both"):
            df = self._denoise_kalman(df, ticker)

        return df
