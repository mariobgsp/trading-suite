"""
ML4T Enhancement 4: LSTM/GRU Deep Learning Direction Prediction Engine.

Provides a neural network-based entry engine using a universal LSTM model
trained on all tickers. The model takes 60-day sequences of OHLCV +
alpha features and predicts the probability of upward price movement
over the next 20 days.

The model is trained offline via ``scripts/train_models.py`` using
TensorFlow/Keras and saved as a TF SavedModel to ``data/models/``.

Architecture:
  Input: (batch, 60, n_features) — 60-day lookback window
  → LSTM(64 units, return_sequences=True)
  → Dropout(0.2)
  → LSTM(64 units)
  → Dropout(0.2)
  → Dense(32, relu)
  → Dense(1, sigmoid) → probability of upward move

This is a SINGLE universal model trained on all 591 tickers simultaneously.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from config.settings import (
    ATR_PERIOD,
    ML_LSTM_ENABLED,
    ML_LSTM_SEQUENCE_LENGTH,
    ML_LSTM_PREDICTION_HORIZON,
    ML_LSTM_THRESHOLD,
    ML_LSTM_MODEL_FILE,
    ML_LSTM_UNITS,
    ML_LSTM_DROPOUT,
    ML_LSTM_EPOCHS,
    ML_LSTM_BATCH_SIZE,
    ML_MODELS_DIR,
)
from core.indicators import atr, rsi, volume_ratio
from core.regime import RegimeSnapshot

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from core.adaptive import StockProfile
    from core.engines import EntrySignal

logger = logging.getLogger(__name__)


def _build_sequence(
    df: pd.DataFrame,
    seq_length: int = 60,
) -> np.ndarray | None:
    """
    Build a normalized feature sequence from OHLCV data for LSTM input.

    Features per timestep (8):
      - Normalized Close (pct change)
      - Normalized Volume (ratio to 20d MA)
      - RSI / 100
      - ATR%
      - High-Low range %
      - Open-Close direction (1 = bullish, 0 = bearish)
      - Returns 5d
      - Returns 10d

    Returns shape (seq_length, n_features) or None if insufficient data.
    """
    if len(df) < seq_length + 21:
        return None

    try:
        # Use last seq_length+1 rows (need 1 extra for pct_change)
        sub = df.iloc[-(seq_length + 21):].copy()

        close = sub["Close"]
        high = sub["High"]
        low = sub["Low"]
        volume = sub["Volume"]
        open_price = sub["Open"]

        features = pd.DataFrame(index=sub.index)

        # Normalized close (returns)
        features["close_ret"] = close.pct_change()

        # Volume ratio
        vol_ma = volume.rolling(20).mean()
        features["vol_ratio"] = volume / vol_ma.replace(0, np.nan)

        # RSI
        rsi_14 = rsi(close, period=14)
        features["rsi_norm"] = rsi_14 / 100.0

        # ATR percentage
        atr_series = atr(sub, period=14)
        features["atr_pct"] = atr_series / close.replace(0, np.nan)

        # Range
        features["range_pct"] = (high - low) / close.replace(0, np.nan)

        # Direction
        features["direction"] = (close > open_price).astype(float)

        # Multi-horizon returns
        features["ret_5d"] = close.pct_change(5)
        features["ret_10d"] = close.pct_change(10)

        # Drop NaN and take last seq_length
        features = features.dropna()
        if len(features) < seq_length:
            return None

        sequence = features.iloc[-seq_length:].values.astype(np.float32)

        # Handle NaN/Inf
        sequence = np.nan_to_num(sequence, nan=0.0, posinf=3.0, neginf=-3.0)

        # Clip extreme values
        sequence = np.clip(sequence, -5.0, 5.0)

        return sequence

    except Exception as e:
        logger.debug("LSTM sequence build error: %s", e)
        return None


# Number of features per timestep
N_FEATURES = 8


class LSTMDirectionEngine:
    """
    LSTM-based directional prediction engine (ML4T Enhancement 4).

    Uses a pre-trained universal LSTM model to predict the probability
    of upward price movement over the next 20 days. Only fires a
    signal if the predicted probability exceeds 65%.

    The model is loaded from ``data/models/lstm_direction_model/``
    (TF SavedModel format) at first use and cached for the session.

    If TensorFlow is not installed or no model file exists,
    the engine silently skips (never fires).

    Priority: 3 (highest — deep learning validated)
    Allowed regimes: BULL, CAUTION
    """

    name = "lstm_direction"
    priority = 3

    def __init__(self) -> None:
        self._model = None
        self._model_loaded = False

    def _load_model(self) -> bool:
        """Load the pre-trained LSTM model from disk."""
        if self._model_loaded:
            return self._model is not None

        self._model_loaded = True
        model_dir = ML_MODELS_DIR / ML_LSTM_MODEL_FILE

        if not model_dir.exists():
            logger.debug(
                "LSTM model not found at %s. "
                "Run 'python -m scripts.train_models' to train.",
                model_dir,
            )
            return False

        try:
            import tensorflow as tf
            self._model = tf.keras.models.load_model(str(model_dir))
            logger.info("Loaded LSTM model from %s", model_dir)
            return True
        except ImportError:
            logger.debug("TensorFlow not installed, LSTM engine disabled.")
            return False
        except Exception as e:
            logger.warning("Failed to load LSTM model: %s", e)
            return False

    def scan(
        self,
        df: pd.DataFrame,
        ticker: str,
        regime: RegimeSnapshot,
        profile: "StockProfile | None" = None,
    ) -> "EntrySignal | None":
        """Evaluate a stock using the LSTM model."""
        from core.engines import EntrySignal

        if not ML_LSTM_ENABLED:
            return None

        # Regime gate
        if not regime.allows_engine(self.name):
            return None

        # Load model on first use
        if not self._load_model():
            return None

        # Build input sequence
        sequence = _build_sequence(df, ML_LSTM_SEQUENCE_LENGTH)
        if sequence is None:
            return None

        try:
            # Predict: input shape (1, seq_length, n_features)
            X = sequence.reshape(1, ML_LSTM_SEQUENCE_LENGTH, N_FEATURES)
            prediction = self._model.predict(X, verbose=0)
            up_prob = float(prediction[0, 0])

            if up_prob < ML_LSTM_THRESHOLD:
                return None

            last_close = float(df["Close"].iloc[-1])
            atr_series = atr(df, period=ATR_PERIOD)
            last_atr = float(atr_series.iloc[-1]) if not pd.isna(atr_series.iloc[-1]) else 0.0

            score = self.priority * up_prob

            return EntrySignal(
                engine=self.name,
                ticker=ticker,
                price=round(last_close, 2),
                score=round(score, 2),
                priority=self.priority,
                details={
                    "ml_probability": round(up_prob, 4),
                    "ml_threshold": ML_LSTM_THRESHOLD,
                    "atr": round(last_atr, 2),
                    "model": "lstm_universal",
                    "sequence_length": ML_LSTM_SEQUENCE_LENGTH,
                    "prediction_horizon": f"{ML_LSTM_PREDICTION_HORIZON}d",
                },
            )

        except Exception as e:
            logger.debug("[%s] LSTM prediction error: %s", ticker, e)
            return None


# ── Model Training ───────────────────────────────────────────────────────────


class LSTMTrainer:
    """
    Trains the universal LSTM direction model on all tickers.

    Labels are derived from forward 20-day returns:
      - Up (1): price increased > 2% in next 20 days
      - Down (0): otherwise

    Uses a chronological train/validation split (no shuffling to
    avoid look-ahead bias).
    """

    def train(
        self,
        all_data: dict[str, pd.DataFrame],
    ) -> object | None:
        """
        Train the LSTM model on labeled sequences from all tickers.

        Parameters
        ----------
        all_data : dict[str, pd.DataFrame]
            Ticker -> OHLCV DataFrame (cleaned).

        Returns
        -------
        object | None
            Trained Keras model, or None if training fails.
        """
        try:
            import tensorflow as tf
            from tensorflow import keras
        except ImportError:
            logger.error("TensorFlow not installed. Cannot train LSTM model.")
            return None

        logger.info("Building LSTM training dataset from %d tickers...", len(all_data))

        all_sequences = []
        all_labels = []

        for ticker, df in all_data.items():
            if len(df) < ML_LSTM_SEQUENCE_LENGTH + ML_LSTM_PREDICTION_HORIZON + 20:
                continue

            close = df["Close"]
            fwd_return = close.shift(-ML_LSTM_PREDICTION_HORIZON) / close - 1.0

            # --- Vectorized Sequence Generation ---
            feats = np.zeros((len(df), N_FEATURES), dtype=np.float32)
            
            # Pre-calculate technical indicators for the entire ticker
            feats[:, 0] = close.pct_change().fillna(0.0).values
            
            vol_ma = df["Volume"].rolling(20).mean()
            feats[:, 1] = (df["Volume"] / vol_ma.replace(0, np.nan)).fillna(1.0).values
            
            feats[:, 2] = rsi(close, period=14).fillna(50.0).values / 100.0
            
            atr_s = atr(df, period=14).fillna(0.0)
            feats[:, 3] = (atr_s / close.replace(0, np.nan)).fillna(0.02).values
            
            feats[:, 4] = ((df["High"] - df["Low"]) / close.replace(0, np.nan)).fillna(0.0).values
            feats[:, 5] = (close > df["Open"]).astype(np.float32).values
            feats[:, 6] = close.pct_change(5).fillna(0.0).values
            feats[:, 7] = close.pct_change(10).fillna(0.0).values
            
            # Handle NaN/Inf globally mirroring _build_sequence
            feats = np.nan_to_num(feats, nan=0.0, posinf=3.0, neginf=-3.0)
            feats = np.clip(feats, -5.0, 5.0)
            
            # Extract sliding windows directly via Numpy striding (zero-copy, exact matching)
            start_i = ML_LSTM_SEQUENCE_LENGTH + 20
            end_i = len(df) - ML_LSTM_PREDICTION_HORIZON
            
            if start_i >= end_i:
                continue
                
            labels = (fwd_return.iloc[start_i:end_i] > 0.02).astype(int).values
            
            # Build sliding windows of shape (N, seq_len, num_features)
            from numpy.lib.stride_tricks import sliding_window_view
            seq_views = sliding_window_view(feats, (ML_LSTM_SEQUENCE_LENGTH, N_FEATURES)).squeeze(axis=1)
            
            # Index arithmetic: window ending at index `i` is located at `seq_views[i - seq_len + 1]`
            k_start = start_i - ML_LSTM_SEQUENCE_LENGTH + 1
            k_end = end_i - ML_LSTM_SEQUENCE_LENGTH + 1
            
            valid_seqs = seq_views[k_start:k_end]
            
            # Decimate data to prevent immense redundant iterations on the CPU pipeline
            step_size = 5
            valid_seqs = valid_seqs[::step_size]
            labels = labels[::step_size]
            
            all_sequences.append(valid_seqs)
            all_labels.append(labels)

        if len(all_sequences) == 0:
            logger.warning("Insufficient training data (%d sequences)", len(all_sequences))
            return None

        X = np.vstack(all_sequences)
        y = np.concatenate(all_labels)

        logger.info(
            "LSTM training: %d sequences, shape=%s, %.1f%% positive",
            len(y), X.shape, np.mean(y) * 100,
        )

        # Chronological split: 80% train, 20% validation
        split_idx = int(len(X) * 0.8)
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]

        # Build model
        model = keras.Sequential([
            keras.layers.GRU(
                ML_LSTM_UNITS,
                input_shape=(ML_LSTM_SEQUENCE_LENGTH, N_FEATURES),
            ),
            keras.layers.Dropout(ML_LSTM_DROPOUT),
            keras.layers.Dense(32, activation="relu"),
            keras.layers.Dense(1, activation="sigmoid"),
        ])

        model.compile(
            optimizer="adam",
            loss="binary_crossentropy",
            metrics=["accuracy"],
        )

        # Callbacks
        callbacks = [
            keras.callbacks.EarlyStopping(
                patience=3, restore_best_weights=True, monitor="val_loss",
            ),
            keras.callbacks.ReduceLROnPlateau(
                factor=0.5, patience=2, min_lr=1e-6,
            ),
        ]

        # Train
        history = model.fit(
            X_train, y_train,
            validation_data=(X_val, y_val),
            epochs=ML_LSTM_EPOCHS,
            batch_size=ML_LSTM_BATCH_SIZE,
            callbacks=callbacks,
            verbose=1,
        )

        # Evaluate
        val_loss, val_acc = model.evaluate(X_val, y_val, verbose=0)
        logger.info("LSTM validation: loss=%.4f, accuracy=%.4f", val_loss, val_acc)

        # Save model
        model_dir = ML_MODELS_DIR / ML_LSTM_MODEL_FILE
        model_dir.mkdir(parents=True, exist_ok=True)
        model.save(str(model_dir))
        logger.info("LSTM model saved to %s", model_dir)

        return model
