"""
Throttled OHLCV data ingestion engine using yfinance.

Downloads daily OHLCV data for IHSG tickers with:
- Per-request delay to avoid overwhelming Yahoo Finance
- Batch pausing every N tickers
- Exponential backoff on rate-limit (HTTP 429) errors
- Graceful handling of delisted/invalid tickers
- Resume support (skip already-downloaded tickers)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import pandas as pd
import yfinance as yf

from config.settings import (
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    INTER_REQUEST_DELAY,
    MAX_RETRIES,
    RATE_LIMIT_BATCH_SIZE,
    RATE_LIMIT_PAUSE_SECONDS,
    RETRY_BASE_WAIT,
)
from core.data_cleaner import DataCleaner
from core.database import ParquetStore

logger = logging.getLogger(__name__)


@dataclass
class IngestionResult:
    """Summary of a batch ingestion run."""

    success: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[dict[str, str]] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"Ingestion complete: "
            f"{self.success} succeeded, "
            f"{self.failed} failed, "
            f"{self.skipped} skipped. "
            f"Total errors: {len(self.errors)}"
        )


class DataIngestor:
    """
    Production-grade OHLCV downloader for IHSG tickers.

    Orchestrates downloading, cleaning, and storing data while
    respecting Yahoo Finance's undocumented rate limits.

    Usage:
        store = ParquetStore()
        cleaner = DataCleaner()
        ingestor = DataIngestor(store, cleaner)

        # Download everything
        result = ingestor.download_all(tickers, period="5y")
        print(result)

        # Download one ticker
        ok = ingestor.download_ticker("BBCA", period="5y")
    """

    def __init__(
        self,
        store: ParquetStore,
        cleaner: DataCleaner,
    ) -> None:
        self._store = store
        self._cleaner = cleaner

    # ── Single Ticker Download ────────────────────────────────────────────

    def download_ticker(
        self,
        ticker: str,
        period: str = DEFAULT_PERIOD,
        interval: str = DEFAULT_INTERVAL,
    ) -> bool:
        """
        Download, clean, and store OHLCV data for a single ticker.

        Parameters
        ----------
        ticker : str
            IDX ticker code (e.g. 'BBCA'). The '.JK' suffix is
            appended automatically if not present.
        period : str
            yfinance period string (e.g. '5y', '1y', '6mo').
        interval : str
            Data interval (default '1d').

        Returns
        -------
        bool
            True if data was successfully downloaded and stored.
        """
        yf_ticker = self._ensure_jk_suffix(ticker)
        clean_code = ticker.replace(".JK", "").upper()

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                raw_df = yf.download(
                    yf_ticker,
                    period=period,
                    interval=interval,
                    progress=False,
                    auto_adjust=True,
                    timeout=30,
                )

                # Handle MultiIndex columns (yfinance returns this
                # when downloading a single ticker in some versions)
                if isinstance(raw_df.columns, pd.MultiIndex):
                    raw_df.columns = raw_df.columns.get_level_values(0)

                if raw_df.empty:
                    logger.warning(
                        "[%s] No data returned (possibly delisted or invalid).",
                        yf_ticker,
                    )
                    return False

                # Clean the data
                clean_df = self._cleaner.clean(raw_df, ticker=clean_code)

                if clean_df.empty:
                    logger.warning(
                        "[%s] All data removed during cleaning.", yf_ticker
                    )
                    return False

                # Store
                self._store.save(clean_code, clean_df)
                logger.info(
                    "[%s] OK — %d bars stored.", yf_ticker, len(clean_df)
                )
                return True

            except Exception as e:
                error_str = str(e).lower()

                # Detect rate limiting
                if "429" in error_str or "too many requests" in error_str:
                    wait = RETRY_BASE_WAIT * (2 ** (attempt - 1))
                    logger.warning(
                        "[%s] Rate limited (attempt %d/%d). "
                        "Backing off %.0fs...",
                        yf_ticker, attempt, MAX_RETRIES, wait,
                    )
                    time.sleep(wait)
                    continue

                # Non-rate-limit error: log and fail
                logger.error(
                    "[%s] Download failed (attempt %d/%d): %s",
                    yf_ticker, attempt, MAX_RETRIES, e,
                )
                if attempt < MAX_RETRIES:
                    time.sleep(INTER_REQUEST_DELAY * attempt)
                    continue
                return False

        logger.error("[%s] All %d retry attempts exhausted.", yf_ticker, MAX_RETRIES)
        return False

    # ── Batch Download ────────────────────────────────────────────────────

    def download_all(
        self,
        tickers: list[str],
        period: str = DEFAULT_PERIOD,
        interval: str = DEFAULT_INTERVAL,
        resume: bool = True,
    ) -> IngestionResult:
        """
        Download OHLCV data for all tickers with rate-limiting.

        Parameters
        ----------
        tickers : list[str]
            List of IDX ticker codes.
        period : str
            yfinance period string.
        interval : str
            Data interval.
        resume : bool
            If True, skip tickers that already have data in the store.

        Returns
        -------
        IngestionResult
            Summary with counts and error details.
        """
        result = IngestionResult()
        total = len(tickers)

        logger.info(
            "Starting batch ingestion: %d tickers, period=%s, resume=%s",
            total, period, resume,
        )

        start_time = time.time()

        for i, ticker in enumerate(tickers, start=1):
            clean_code = ticker.replace(".JK", "").upper()

            # ── Resume: skip if data already exists ───────────────────
            if resume and self._store.exists(clean_code):
                last_date = self._store.get_last_date(clean_code)
                logger.debug(
                    "[%d/%d] %s — skipped (data exists, last: %s)",
                    i, total, clean_code,
                    last_date.strftime("%Y-%m-%d") if last_date else "?",
                )
                result.skipped += 1
                continue

            # ── Batch pause ───────────────────────────────────────────
            if (i - 1) > 0 and (i - 1) % RATE_LIMIT_BATCH_SIZE == 0:
                logger.info(
                    "Batch pause: sleeping %.0fs after %d tickers...",
                    RATE_LIMIT_PAUSE_SECONDS, i - 1,
                )
                time.sleep(RATE_LIMIT_PAUSE_SECONDS)

            # ── Download ──────────────────────────────────────────────
            logger.info("[%d/%d] Downloading %s...", i, total, clean_code)
            success = self.download_ticker(clean_code, period=period, interval=interval)

            if success:
                result.success += 1
            else:
                result.failed += 1
                result.errors.append({
                    "ticker": clean_code,
                    "reason": "Download failed or returned empty data",
                })

            # ── Inter-request delay ───────────────────────────────────
            if i < total:
                time.sleep(INTER_REQUEST_DELAY)

        elapsed = time.time() - start_time
        logger.info(
            "Batch ingestion finished in %.1f minutes. %s",
            elapsed / 60, result,
        )

        return result

    # ── Helpers ───────────────────────────────────────────────────────────

    @staticmethod
    def _ensure_jk_suffix(ticker: str) -> str:
        """Append '.JK' suffix if not already present."""
        t = ticker.strip().upper()
        if not t.endswith(".JK"):
            t = f"{t}.JK"
        return t
