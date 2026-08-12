"""
Risk Management Engine for the IHSG swing trading system.

Provides ATR-based position sizing, stop-loss calculation, and
chandelier trailing stop management. All risk calculations are
deterministic and based on the ATR volatility measure.

Key rules:
  - Initial stop-loss: 1.5x ATR below entry price
  - Trailing stop: 2x ATR below highest high since entry (chandelier)
  - Position size: (Capital x Risk%) / Risk-per-share
  - Risk per share: Entry - Stop-loss
  - All share counts are rounded DOWN to IDX lot size (100 shares)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from config.settings import (
    IDX_LOT_SIZE,
    MAX_RISK_PER_TRADE_PCT,
    REGIME_RISK_MULTIPLIER,
    STOP_LOSS_ATR_MULTIPLIER,
    TRAILING_STOP_ATR_MULTIPLIER,
    DYNAMIC_STOP_ENABLED,
    CARDINAL_SIN_MAX_STOP_RATIO,
    ABSOLUTE_MAX_STOP_PCT,
)

logger = logging.getLogger(__name__)


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class TradeRisk:
    """Complete risk profile for a proposed trade."""

    ticker: str
    entry_price: float
    stop_loss: float
    trailing_stop: float
    position_size: int  # shares (rounded to lot size)
    risk_per_share: float
    risk_amount: float  # total IDR at risk
    risk_pct: float  # actual risk as % of capital
    capital: float
    regime: str
    regime_adjusted_risk_pct: float  # risk % after regime adjustment
    reward_target: float | None = None  # optional take-profit level
    reward_risk_ratio: float | None = None

    def __str__(self) -> str:
        lines = [
            f"--- Trade Risk: {self.ticker} ---",
            f"  Entry:          IDR {self.entry_price:>12,.0f}",
            f"  Stop-Loss:      IDR {self.stop_loss:>12,.0f}  "
            f"({self.risk_per_share:,.0f}/share)",
            f"  Trailing Stop:  IDR {self.trailing_stop:>12,.0f}",
            f"  Position Size:  {self.position_size:>12,} shares  "
            f"({self.position_size // IDX_LOT_SIZE} lots)",
            f"  Position Value: IDR {self.entry_price * self.position_size:>12,.0f}",
            f"  Risk Amount:    IDR {self.risk_amount:>12,.0f}  "
            f"({self.risk_pct:.2f}% of capital)",
            f"  Regime:         {self.regime}  "
            f"(risk adj: {self.regime_adjusted_risk_pct:.2f}%)",
        ]
        if self.reward_target and self.reward_risk_ratio:
            lines.append(
                f"  Target:         IDR {self.reward_target:>12,.0f}  "
                f"(R:R = {self.reward_risk_ratio:.1f})"
            )
        return "\n".join(lines)


# ─── Risk Manager ────────────────────────────────────────────────────────────


class RiskManager:
    """
    ATR-based risk management engine.

    All calculations are pure — they take inputs and return results
    without side effects. The Portfolio class handles state.

    Usage:
        rm = RiskManager()
        risk = rm.calculate_trade_risk(
            ticker="BBCA", entry_price=7000, atr_value=150,
            capital=100_000_000, regime="BULL",
        )
        print(risk)
    """

    # ── Stop-Loss ─────────────────────────────────────────────────────

    @staticmethod
    def calculate_stop_loss(
        entry_price: float,
        atr_value: float,
        multiplier: float = STOP_LOSS_ATR_MULTIPLIER,
        max_stop_pct: float | None = None,
    ) -> float:
        """
        Calculate the initial stop-loss level.

        Stop = Entry - (ATR x Multiplier)

        Parameters
        ----------
        entry_price : float
            Planned entry price.
        atr_value : float
            Current ATR(14) value.
        multiplier : float
            ATR multiplier (default 1.5).

        Returns
        -------
        float
            Stop-loss price level.
        """
        stop = entry_price - (atr_value * multiplier)
        stop = max(stop, 0)  # stop can't be negative

        # Enhancement v2: Dynamic stop-loss cap (Cardinal Sin Check)
        # If max_stop_pct is provided (from calculate_dynamic_max_stop),
        # clamp the stop-loss so it never exceeds that % of entry price.
        if max_stop_pct is not None and max_stop_pct > 0:
            max_stop_distance = entry_price * (max_stop_pct / 100.0)
            min_stop_price = entry_price - max_stop_distance
            if stop < min_stop_price:
                logger.debug(
                    "Cardinal Sin clamp: ATR stop=%s clamped to %s "
                    "(max %.1f%% of entry)",
                    f"{stop:,.0f}", f"{min_stop_price:,.0f}", max_stop_pct,
                )
                stop = min_stop_price

        return stop

    # ── Trailing Stop (Chandelier Exit) ───────────────────────────────

    @staticmethod
    def calculate_trailing_stop(
        highest_high: float,
        atr_value: float,
        multiplier: float = TRAILING_STOP_ATR_MULTIPLIER,
    ) -> float:
        """
        Calculate the chandelier trailing stop level.

        Trail = Highest High Since Entry - (ATR x Multiplier)

        The trailing stop only moves UP, never down. The caller is
        responsible for tracking whether the new stop is higher than
        the current stop.

        Parameters
        ----------
        highest_high : float
            Highest price since position was opened.
        atr_value : float
            Current ATR value.
        multiplier : float
            ATR multiplier (default 2.0).

        Returns
        -------
        float
            New trailing stop level.
        """
        trail = highest_high - (atr_value * multiplier)
        return max(trail, 0)

    # ── Position Sizing ───────────────────────────────────────────────

    @staticmethod
    def calculate_position_size(
        capital: float,
        entry_price: float,
        stop_loss: float,
        risk_pct: float,
        lot_size: int = IDX_LOT_SIZE,
    ) -> int:
        """
        Calculate the number of shares to buy.

        Shares = (Capital x Risk%) / Risk-per-share
        Result is rounded DOWN to the nearest lot size.

        Parameters
        ----------
        capital : float
            Total available capital.
        entry_price : float
            Planned entry price.
        stop_loss : float
            Stop-loss price level.
        risk_pct : float
            Risk as a percentage of capital (e.g., 2.0 for 2%).
        lot_size : int
            IDX lot size (default 100).

        Returns
        -------
        int
            Number of shares (rounded to lot size).
        """
        risk_per_share = entry_price - stop_loss
        if risk_per_share <= 0:
            logger.warning(
                "Invalid risk_per_share: %.2f (entry=%.2f, stop=%.2f)",
                risk_per_share, entry_price, stop_loss,
            )
            return 0

        risk_budget = capital * (risk_pct / 100.0)
        raw_shares = risk_budget / risk_per_share

        # Round down to lot size
        lots = int(raw_shares // lot_size)
        return lots * lot_size

    # ── Regime-Adjusted Risk ──────────────────────────────────────────

    @staticmethod
    def adjust_risk_for_regime(
        base_risk_pct: float = MAX_RISK_PER_TRADE_PCT,
        regime: str = "BULL",
    ) -> float:
        """
        Adjust risk percentage based on market regime.

        BULL:    100% of base risk (2.0%)
        CAUTION:  50% of base risk (1.0%)
        BEAR:     25% of base risk (0.5%)

        Returns
        -------
        float
            Regime-adjusted risk percentage.
        """
        multiplier = REGIME_RISK_MULTIPLIER.get(regime.upper(), 0.5)
        return base_risk_pct * multiplier

    # ── Reward:Risk Ratio ─────────────────────────────────────────────

    @staticmethod
    def calculate_reward_risk_ratio(
        entry_price: float,
        stop_loss: float,
        target_price: float,
    ) -> float:
        """
        Calculate the Reward:Risk ratio.

        Returns 0.0 if risk is zero or negative.
        """
        risk = entry_price - stop_loss
        reward = target_price - entry_price
        if risk <= 0:
            return 0.0
        return reward / risk

    # ── Complete Trade Risk Profile ───────────────────────────────────

    def calculate_trade_risk(
        self,
        ticker: str,
        entry_price: float,
        atr_value: float,
        capital: float,
        regime: str = "BULL",
        target_price: float | None = None,
    ) -> TradeRisk:
        """
        Calculate the complete risk profile for a proposed trade.

        This is the main entry point that combines all risk calculations
        into a single TradeRisk object.

        Parameters
        ----------
        ticker : str
            Stock ticker code.
        entry_price : float
            Planned entry price.
        atr_value : float
            Current ATR(14) value.
        capital : float
            Available capital.
        regime : str
            Current market regime ("BULL", "CAUTION", "BEAR").
        target_price : float | None
            Optional take-profit target for R:R calculation.

        Returns
        -------
        TradeRisk
            Complete risk profile.
        """
        # Regime-adjusted risk
        adjusted_risk_pct = self.adjust_risk_for_regime(
            MAX_RISK_PER_TRADE_PCT, regime
        )

        # Stop-loss
        stop_loss = self.calculate_stop_loss(entry_price, atr_value)

        # Trailing stop (initially same as stop-loss area, uses wider multiplier)
        trailing_stop = self.calculate_trailing_stop(entry_price, atr_value)

        # Position size
        position_size = self.calculate_position_size(
            capital, entry_price, stop_loss, adjusted_risk_pct
        )

        # Actual risk
        risk_per_share = entry_price - stop_loss
        risk_amount = position_size * risk_per_share
        actual_risk_pct = (risk_amount / capital * 100) if capital > 0 else 0

        # R:R ratio
        rr_ratio = None
        if target_price and target_price > entry_price:
            rr_ratio = self.calculate_reward_risk_ratio(
                entry_price, stop_loss, target_price
            )

        trade_risk = TradeRisk(
            ticker=ticker,
            entry_price=entry_price,
            stop_loss=round(stop_loss, 2),
            trailing_stop=round(trailing_stop, 2),
            position_size=position_size,
            risk_per_share=round(risk_per_share, 2),
            risk_amount=round(risk_amount, 2),
            risk_pct=round(actual_risk_pct, 4),
            capital=capital,
            regime=regime,
            regime_adjusted_risk_pct=adjusted_risk_pct,
            reward_target=target_price,
            reward_risk_ratio=round(rr_ratio, 2) if rr_ratio else None,
        )

        logger.debug(
            "[%s] Risk: entry=%s stop=%s size=%d risk=IDR %s (%.2f%%)",
            ticker, entry_price, stop_loss, position_size,
            f"{risk_amount:,.0f}", actual_risk_pct,
        )

        return trade_risk

    # ── Cardinal Sin Dynamic Stop-Loss ────────────────────────────────

    @staticmethod
    def calculate_dynamic_max_stop(
        closed_trades: list,
    ) -> float | None:
        """
        Calculate the dynamic maximum stop-loss percentage.

        Enhancement v2: "Cardinal Sin Check" — the stop-loss must NEVER
        exceed one-half (50%) of the historical average gain per winning
        trade. Even if the average gain is huge, the stop hits a hard
        ceiling at ABSOLUTE_MAX_STOP_PCT (10%).

        Parameters
        ----------
        closed_trades : list
            List of closed trade objects with a `pnl` and `entry_price`
            attribute or dict key.

        Returns
        -------
        float | None
            Maximum stop-loss as a percentage of entry price.
            Returns None if no winning trades exist (falls back to ATR).
        """
        if not DYNAMIC_STOP_ENABLED:
            return None

        # Extract winning trades
        winning_gains_pct = []
        for trade in closed_trades:
            # Support both dataclass objects and dicts
            if hasattr(trade, "pnl"):
                pnl = trade.pnl
                pnl_pct = getattr(trade, "pnl_pct", None)
            elif isinstance(trade, dict):
                pnl = trade.get("pnl", 0)
                pnl_pct = trade.get("pnl_pct")
            else:
                continue

            if pnl > 0 and pnl_pct is not None:
                winning_gains_pct.append(abs(pnl_pct))

        if not winning_gains_pct:
            return None  # No history — fall back to ATR-based stop

        avg_gain_pct = sum(winning_gains_pct) / len(winning_gains_pct)

        # Cardinal Sin: max stop = 50% of average gain
        max_stop = avg_gain_pct * CARDINAL_SIN_MAX_STOP_RATIO

        # Hard ceiling at 10% regardless
        max_stop = min(max_stop, ABSOLUTE_MAX_STOP_PCT)

        logger.debug(
            "Cardinal Sin: avg win = %.2f%%, max stop = %.2f%% "
            "(%.0f%% of avg, capped at %.0f%%)",
            avg_gain_pct, max_stop,
            CARDINAL_SIN_MAX_STOP_RATIO * 100,
            ABSOLUTE_MAX_STOP_PCT,
        )

        return max_stop


# ── ML4T Enhancement 5: Bayesian Risk Management ────────────────────────────


class BayesianRiskEstimator:
    """
    Bayesian stochastic volatility estimator (ML4T Enhancement 5).

    Uses PyMC to fit a Bayesian GARCH-like model that estimates the
    posterior distribution of volatility, providing:
      1. **Dynamic risk %**: Risk per trade adapts to current vol regime
      2. **Confidence intervals**: Instead of a point estimate, the model
         gives a distribution of possible volatilities
      3. **Regime-aware sizing**: Bayesian estimate replaces the static
         MAX_RISK_PER_TRADE_PCT when the posterior is informative

    The estimator operates on a per-scan basis using market-wide data
    (IHSG composite), NOT per-ticker. This avoids the 30s/ticker overhead.

    Usage:
        estimator = BayesianRiskEstimator()
        dynamic_risk = estimator.estimate_risk_pct(returns_series)
        # Use dynamic_risk instead of MAX_RISK_PER_TRADE_PCT
    """

    def __init__(self) -> None:
        self._cached_result: dict | None = None

    def estimate_risk_pct(
        self,
        returns: "pd.Series",
        base_risk_pct: float = MAX_RISK_PER_TRADE_PCT,
    ) -> dict:
        """
        Estimate dynamic risk percentage using Bayesian volatility model.

        Parameters
        ----------
        returns : pd.Series
            Daily log returns of the market index (IHSG composite).
        base_risk_pct : float
            Static base risk percentage (default 2.0%).

        Returns
        -------
        dict
            {
                "dynamic_risk_pct": float,   # Bayesian-adjusted risk %
                "vol_mean": float,           # Posterior mean volatility (annualized)
                "vol_std": float,            # Posterior std of volatility
                "vol_lower": float,          # 5th percentile
                "vol_upper": float,          # 95th percentile
                "risk_scaling_factor": float, # Multiplier applied to base risk
                "method": str,               # "bayesian" or "fallback"
            }
        """
        import numpy as np

        if self._cached_result is not None:
            return self._cached_result

        # Fallback result used when Bayesian estimation is unavailable
        fallback = {
            "dynamic_risk_pct": base_risk_pct,
            "vol_mean": 0.0,
            "vol_std": 0.0,
            "vol_lower": 0.0,
            "vol_upper": 0.0,
            "risk_scaling_factor": 1.0,
            "method": "fallback",
        }

        from config.settings import BAYESIAN_RISK_ENABLED
        if not BAYESIAN_RISK_ENABLED:
            return fallback

        try:
            import pymc as pm
        except ImportError:
            logger.debug("PyMC not installed, using ATR-based risk.")
            return fallback

        from config.settings import BAYESIAN_SAMPLES, BAYESIAN_CHAINS, BAYESIAN_VOLATILITY_WINDOW

        # Use last N days of returns
        if len(returns) < BAYESIAN_VOLATILITY_WINDOW:
            return fallback

        r = returns.tail(BAYESIAN_VOLATILITY_WINDOW).dropna().values
        if len(r) < 20:
            return fallback

        try:
            # Bayesian Stochastic Volatility Model
            # The log-volatility follows a random walk:
            #   h_t = mu + phi * (h_{t-1} - mu) + sigma * epsilon_t
            #   y_t = exp(h_t / 2) * nu_t
            with pm.Model() as vol_model:
                # Priors
                mu = pm.Normal("mu", mu=-10, sigma=5)
                phi = pm.Beta("phi", alpha=20, beta=1.5)  # Persistence
                sigma = pm.HalfNormal("sigma", sigma=1)

                # Stochastic volatility process
                h = pm.AR1("h", k=mu, rho=phi, sigma=sigma, shape=len(r))

                # Observed returns
                vol = pm.math.exp(h / 2)
                pm.Normal("obs", mu=0, sigma=vol, observed=r)

                # Sample
                trace = pm.sample(
                    BAYESIAN_SAMPLES,
                    chains=BAYESIAN_CHAINS,
                    return_inferencedata=True,
                    progressbar=False,
                    random_seed=42,
                )

            # Extract posterior volatility of the last observation
            h_posterior = trace.posterior["h"].values[:, :, -1].flatten()
            vol_posterior = np.exp(h_posterior / 2) * np.sqrt(252)  # Annualize

            vol_mean = float(np.mean(vol_posterior))
            vol_std = float(np.std(vol_posterior))
            vol_lower = float(np.percentile(vol_posterior, 5))
            vol_upper = float(np.percentile(vol_posterior, 95))

            # Risk scaling: if volatility is above historical average,
            # reduce risk; if below, slightly increase (within bounds)
            #
            # Typical annualized vol for IHSG: ~15-25%
            # If current vol > 25%, scale down; if < 15%, scale up
            typical_vol = 0.20  # 20% baseline
            scaling = typical_vol / vol_mean if vol_mean > 0 else 1.0
            scaling = max(0.25, min(1.5, scaling))  # Clamp to [0.25, 1.5]

            dynamic_risk = base_risk_pct * scaling

            result = {
                "dynamic_risk_pct": round(dynamic_risk, 4),
                "vol_mean": round(vol_mean, 4),
                "vol_std": round(vol_std, 4),
                "vol_lower": round(vol_lower, 4),
                "vol_upper": round(vol_upper, 4),
                "risk_scaling_factor": round(scaling, 4),
                "method": "bayesian",
            }

            logger.info(
                "Bayesian vol estimate: mean=%.2f%% [%.2f%%–%.2f%%], "
                "risk scaling=%.2f → dynamic risk=%.3f%%",
                vol_mean * 100, vol_lower * 100, vol_upper * 100,
                scaling, dynamic_risk,
            )

            self._cached_result = result
            return result

        except Exception as e:
            logger.warning("Bayesian estimation failed: %s. Using fallback.", e)
            return fallback
