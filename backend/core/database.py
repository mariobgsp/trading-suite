"""
Parquet-based local storage manager for OHLCV data.

Each ticker's data is stored as a separate Parquet file under DATA_DIR.
This avoids recalculating indicators via live API calls and provides
fast columnar reads for downstream analysis.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import pandas as pd

from config.settings import DATA_DIR

logger = logging.getLogger(__name__)


class ParquetStore:
    """
    Manages reading and writing per-ticker Parquet files.

    Directory layout:
        data/ohlcv/
            BBCA.parquet
            BBRI.parquet
            ...
    """

    def __init__(self, data_dir: Path | None = None) -> None:
        self._data_dir = data_dir or DATA_DIR
        self._data_dir.mkdir(parents=True, exist_ok=True)

    # ── Internal helpers ──────────────────────────────────────────────────

    def _path_for(self, ticker: str) -> Path:
        """Return the Parquet file path for a ticker (without .JK suffix)."""
        clean = ticker.replace(".JK", "").upper()
        return self._data_dir / f"{clean}.parquet"

    # ── Public API ────────────────────────────────────────────────────────

    def save(self, ticker: str, df: pd.DataFrame) -> None:
        """
        Persist a DataFrame to Parquet.

        Parameters
        ----------
        ticker : str
            Ticker code (with or without .JK suffix).
        df : pd.DataFrame
            Must contain columns: Open, High, Low, Close, Volume.
            Index should be a DatetimeIndex named 'Date'.
        """
        path = self._path_for(ticker)
        try:
            df.to_parquet(path, engine="pyarrow", index=True)
            logger.debug("Saved %s (%d bars) -> %s", ticker, len(df), path)
        except Exception:
            logger.exception("Failed to save %s to %s", ticker, path)
            raise

    def load(self, ticker: str) -> pd.DataFrame | None:
        """
        Load a ticker's OHLCV data from Parquet.

        Returns None if the file does not exist or is unreadable.
        """
        path = self._path_for(ticker)
        if not path.exists():
            return None
        try:
            df = pd.read_parquet(path, engine="pyarrow")
            logger.debug("Loaded %s (%d bars) from %s", ticker, len(df), path)
            return df
        except Exception:
            logger.exception("Failed to read %s from %s", ticker, path)
            return None

    def exists(self, ticker: str) -> bool:
        """Check whether stored data exists for this ticker."""
        return self._path_for(ticker).exists()

    def get_last_date(self, ticker: str) -> datetime | None:
        """
        Return the latest date in the stored data for incremental updates.

        Returns None if no data exists.
        """
        df = self.load(ticker)
        if df is None or df.empty:
            return None
        try:
            last_idx = df.index.max()
            if isinstance(last_idx, pd.Timestamp):
                return last_idx.to_pydatetime()
            return None
        except Exception:
            return None

    def list_tickers(self) -> list[str]:
        """Return a sorted list of all tickers that have stored data."""
        return sorted(
            p.stem for p in self._data_dir.glob("*.parquet")
        )

    def delete(self, ticker: str) -> None:
        """Remove a ticker's Parquet file if it exists."""
        path = self._path_for(ticker)
        if path.exists():
            path.unlink()
            logger.info("Deleted %s", path)
