"""
IHSG Composite Market Regime Filter.

Determines the overall market environment by analyzing the IHSG
composite index (^JKSE). The regime classification acts as a
master switch that gates which entry engines may fire.

Regime classifications:
  BULL    — Close > SMA(50) > SMA(200) — all engines active
  CAUTION — Close > SMA(200) but not a full bull — FVG + B.O.W. only
  BEAR    — Close < SMA(200) — only B.O.W. engine active
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum

import pandas as pd
import yfinance as yf

from config.settings import (
    IHSG_COMPOSITE_TICKER,
    REGIME_ATR_PERIOD,
    REGIME_SMA_LONG,
    REGIME_SMA_SHORT,
)
from core.indicators import atr, sma, hurst_exponent

logger = logging.getLogger(__name__)


class RegimeType(Enum):
    """Market regime classifications."""

    BULL = "BULL"
    CAUTION = "CAUTION"
    BEAR = "BEAR"


# Which engines are allowed in each regime
_ENGINE_PERMISSIONS: dict[RegimeType, set[str]] = {
    RegimeType.BULL: {
        "momentum_confluence",
        "gradient_boost_entry",
        "lstm_direction",
    },
    RegimeType.CAUTION: {
        "momentum_confluence",
        "gradient_boost_entry",
        "lstm_direction",
    },
    RegimeType.BEAR: {
        "gradient_boost_entry",
        "lstm_direction",
    },
}


@dataclass
class RegimeSnapshot:
    """Immutable snapshot of the current market regime state."""

    regime: RegimeType
    close: float
    sma_short: float
    sma_long: float
    atr_value: float
    hurst_value: float
    as_of_date: str

    # ML4T Enhancement 2: ML-based regime fields
    regime_ml: str = ""               # ML-predicted regime ("BULL", "CAUTION", "BEAR")
    regime_confidence: float = 0.0    # ML confidence score (0-1)
    regime_ml_method: str = ""        # Method used ("kmeans", "agglomerative", or "")

    def allows_engine(self, engine_name: str) -> bool:
        """Check if a specific engine is permitted under this regime."""
        return engine_name in _ENGINE_PERMISSIONS.get(self.regime, set())

    def __str__(self) -> str:
        base = (
            f"Regime: {self.regime.value} | "
            f"Close: {self.close:,.0f} | "
            f"SMA({REGIME_SMA_SHORT}): {self.sma_short:,.0f} | "
            f"SMA({REGIME_SMA_LONG}): {self.sma_long:,.0f} | "
            f"ATR({REGIME_ATR_PERIOD}): {self.atr_value:,.0f} | "
            f"Hurst(100): {self.hurst_value:.2f} | "
            f"As-of: {self.as_of_date}"
        )
        if self.regime_ml:
            base += (
                f" | ML: {self.regime_ml} "
                f"(conf={self.regime_confidence:.2f}, method={self.regime_ml_method})"
            )
        return base


# ── ML4T Enhancement 2: ML Regime Classifier ────────────────────────────────


class MLRegimeClassifier:
    """
    Unsupervised ML-based market regime classifier.

    Uses PCA for dimensionality reduction on rolling market features,
    then applies clustering (K-Means or Agglomerative) to identify
    hidden market regimes statistically.

    Features extracted from IHSG composite data:
      - Rolling returns (5d, 10d, 20d)
      - Rolling volatility (10d, 20d)
      - Volume trend (20d MA ratio)
      - Breadth proxy (close vs SMA distance)
    """

    def __init__(self) -> None:
        self._fitted = False

    def classify(
        self, df: pd.DataFrame, n_clusters: int = 3, method: str = "kmeans"
    ) -> tuple[str, float, str]:
        """
        Classify the current market regime using unsupervised learning.

        Parameters
        ----------
        df : pd.DataFrame
            IHSG composite OHLCV data (at least 120 bars).
        n_clusters : int
            Number of regime clusters (default 3).
        method : str
            Clustering algorithm ("kmeans" or "agglomerative").

        Returns
        -------
        tuple[str, float, str]
            (regime_label, confidence, method_used)
            regime_label: "BULL", "CAUTION", or "BEAR"
            confidence: 0-1 score
            method_used: clustering method applied
        """
        try:
            from sklearn.decomposition import PCA
            from sklearn.preprocessing import StandardScaler
        except ImportError:
            logger.debug("scikit-learn not available for ML regime classification.")
            return "", 0.0, ""

        from config.settings import REGIME_PCA_COMPONENTS, REGIME_FEATURE_WINDOW

        if len(df) < REGIME_FEATURE_WINDOW + 30:
            return "", 0.0, ""

        # ── Build feature matrix ──────────────────────────────────────
        close = df["Close"]
        volume = df["Volume"]
        high = df["High"]
        low = df["Low"]

        features = pd.DataFrame(index=df.index)

        # Returns at multiple horizons
        features["ret_5d"] = close.pct_change(5)
        features["ret_10d"] = close.pct_change(10)
        features["ret_20d"] = close.pct_change(20)

        # Volatility measures
        log_ret = np.log(close / close.shift(1))
        features["vol_10d"] = log_ret.rolling(10).std() * np.sqrt(252)
        features["vol_20d"] = log_ret.rolling(20).std() * np.sqrt(252)

        # Volume trend
        vol_ma = volume.rolling(20).mean()
        features["vol_trend"] = volume / vol_ma.replace(0, np.nan)

        # Trend strength: distance from SMA
        sma50 = close.rolling(50).mean()
        features["sma_dist"] = (close - sma50) / sma50.replace(0, np.nan)

        # Range compression: ATR relative to price
        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs(),
        ], axis=1).max(axis=1)
        atr_14 = tr.rolling(14).mean()
        features["atr_pct"] = atr_14 / close.replace(0, np.nan)

        # Drop NaN rows
        features = features.dropna()
        if len(features) < 30:
            return "", 0.0, ""

        # ── PCA dimensionality reduction ──────────────────────────────
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(features.values)

        n_components = min(REGIME_PCA_COMPONENTS, X_scaled.shape[1])
        pca = PCA(n_components=n_components)
        X_pca = pca.fit_transform(X_scaled)

        logger.debug(
            "PCA variance explained: %s (total=%.2f%%)",
            [f"{v:.1f}%" for v in pca.explained_variance_ratio_ * 100],
            sum(pca.explained_variance_ratio_) * 100,
        )

        # ── Clustering ────────────────────────────────────────────────
        if method == "agglomerative":
            from sklearn.cluster import AgglomerativeClustering
            clusterer = AgglomerativeClustering(n_clusters=n_clusters)
            labels = clusterer.fit_predict(X_pca)
        else:
            from sklearn.cluster import KMeans
            clusterer = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            labels = clusterer.fit_predict(X_pca)

        # ── Map clusters to regime labels ─────────────────────────────
        # Assign BULL to cluster with highest mean returns,
        # BEAR to lowest, CAUTION to middle
        cluster_returns = {}
        for c in range(n_clusters):
            mask = labels == c
            cluster_returns[c] = features["ret_20d"].iloc[mask].mean()

        sorted_clusters = sorted(cluster_returns, key=cluster_returns.get)
        regime_map = {
            sorted_clusters[0]: "BEAR",
            sorted_clusters[-1]: "BULL",
        }
        for c in sorted_clusters[1:-1]:
            regime_map[c] = "CAUTION"

        # Current regime = label of last observation
        current_label = labels[-1]
        current_regime = regime_map.get(current_label, "CAUTION")

        # Confidence: based on cluster center distance
        if method != "agglomerative" and hasattr(clusterer, "transform"):
            distances = clusterer.transform(X_pca[-1:])
            min_dist = distances[0, current_label]
            max_dist = distances[0].max()
            confidence = 1.0 - (min_dist / max_dist) if max_dist > 0 else 0.5
        else:
            # For agglomerative, use silhouette-like heuristic
            from sklearn.metrics import silhouette_samples
            if len(set(labels)) > 1:
                sil = silhouette_samples(X_pca, labels)
                confidence = float(max(0, sil[-1]))
            else:
                confidence = 0.5

        confidence = max(0.0, min(1.0, confidence))

        logger.info(
            "ML Regime: %s (confidence=%.2f, method=%s, clusters=%d)",
            current_regime, confidence, method, n_clusters,
        )

        return current_regime, round(confidence, 3), method


class MarketRegime:
    """
    Fetches IHSG composite data and classifies the market regime.

    This class makes a single yfinance call to download recent
    ^JKSE data, then computes SMA(50), SMA(200), and ATR(14)
    to determine the current regime state.

    ML4T Enhancement 2: Also runs ML-based regime classification
    (PCA + clustering) alongside the traditional Hurst-based method.

    Usage:
        regime = MarketRegime()
        snapshot = regime.get_snapshot()
        print(snapshot)
        if snapshot.allows_engine("fvg_pullback"):
            ...
    """

    def __init__(self, period: str = "1y") -> None:
        """
        Initialize and fetch IHSG composite data.

        Parameters
        ----------
        period : str
            yfinance period to download (default '1y').
            Must be long enough for SMA(200) — '1y' provides ~250 bars.
        """
        self._df: pd.DataFrame | None = None
        self._snapshot: RegimeSnapshot | None = None
        self._fetch(period)

    def _fetch(self, period: str) -> None:
        """Download ^JKSE data and compute regime indicators."""
        try:
            logger.info(
                "Fetching IHSG composite (%s) for regime analysis...",
                IHSG_COMPOSITE_TICKER,
            )
            raw = yf.download(
                IHSG_COMPOSITE_TICKER,
                period=period,
                interval="1d",
                progress=False,
                auto_adjust=True,
                timeout=30,
            )

            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = raw.columns.get_level_values(0)

            if raw.empty or len(raw) < REGIME_SMA_LONG:
                logger.error(
                    "Insufficient IHSG data: got %d bars, need %d for SMA(%d).",
                    len(raw), REGIME_SMA_LONG, REGIME_SMA_LONG,
                )
                # Fallback to CAUTION if data is insufficient
                self._snapshot = RegimeSnapshot(
                    regime=RegimeType.CAUTION,
                    close=0, sma_short=0, sma_long=0, atr_value=0, hurst_value=0.5,
                    as_of_date="N/A (insufficient data)",
                )
                return

            self._df = raw

            # Compute indicators
            sma_short = sma(raw["Close"], REGIME_SMA_SHORT)
            sma_long = sma(raw["Close"], REGIME_SMA_LONG)
            atr_series = atr(raw, REGIME_ATR_PERIOD)

            last_close = float(raw["Close"].iloc[-1])
            last_sma_short = float(sma_short.iloc[-1])
            last_sma_long = float(sma_long.iloc[-1])
            last_atr = float(atr_series.iloc[-1]) if not pd.isna(atr_series.iloc[-1]) else 0.0
            as_of = raw.index[-1].strftime("%Y-%m-%d")

            # Calculate Hurst exponent on last 100 days
            if len(raw) >= 100:
                hurst_val = hurst_exponent(raw["Close"].tail(100), max_lag=20)
            else:
                hurst_val = 0.5
                
            # Classify regime based on Hurst Exponent
            if 0.45 <= hurst_val <= 0.55:
                regime = RegimeType.BEAR
            elif hurst_val < 0.45:
                regime = RegimeType.CAUTION
            else:
                regime = RegimeType.BULL

            # ── ML4T Enhancement 2: ML-based regime classification ────
            ml_regime = ""
            ml_confidence = 0.0
            ml_method = ""

            from config.settings import REGIME_ML_ENABLED, REGIME_N_CLUSTERS, REGIME_CLUSTERING_METHOD
            if REGIME_ML_ENABLED:
                try:
                    ml_classifier = MLRegimeClassifier()
                    ml_regime, ml_confidence, ml_method = ml_classifier.classify(
                        raw, n_clusters=REGIME_N_CLUSTERS, method=REGIME_CLUSTERING_METHOD,
                    )

                    # Log disagreement between Hurst and ML
                    if ml_regime and ml_regime != regime.value:
                        logger.warning(
                            "Regime disagreement: Hurst=%s, ML=%s (conf=%.2f). "
                            "Using Hurst as ground truth.",
                            regime.value, ml_regime, ml_confidence,
                        )
                except Exception as e:
                    logger.warning("ML regime classification failed: %s", e)

            self._snapshot = RegimeSnapshot(
                regime=regime,
                close=round(last_close, 2),
                sma_short=round(last_sma_short, 2),
                sma_long=round(last_sma_long, 2),
                atr_value=round(last_atr, 2),
                hurst_value=round(hurst_val, 2),
                as_of_date=as_of,
                regime_ml=ml_regime,
                regime_confidence=ml_confidence,
                regime_ml_method=ml_method,
            )

            logger.info("Market regime: %s", self._snapshot)

        except Exception as e:
            logger.error("Failed to fetch IHSG composite: %s", e)
            # Fallback to CAUTION on error — conservative but not fully frozen
            self._snapshot = RegimeSnapshot(
                regime=RegimeType.CAUTION,
                close=0, sma_short=0, sma_long=0, atr_value=0, hurst_value=0.5,
                as_of_date=f"ERROR: {e}",
            )

    def get_snapshot(self) -> RegimeSnapshot:
        """Return the current regime snapshot."""
        assert self._snapshot is not None, "Regime not initialized"
        return self._snapshot

    @property
    def status(self) -> RegimeType:
        """Shortcut for the current regime classification."""
        return self.get_snapshot().regime
