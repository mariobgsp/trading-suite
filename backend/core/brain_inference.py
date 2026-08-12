"""
Brain Inference Engine — Statistical Reasoning on Stock Memory.

Analyzes accumulated per-stock trade history to:
  1. Determine the statistically best trading engine for each stock
  2. Compute a confidence-weighted score boost for the scanner
  3. Extract behavioral tags describing the stock's personality
  4. Generate a human-readable insight string (rule-based or LLM-assisted)

No external ML frameworks required — uses pure statistical analysis
on the trade history stored in StockMemory.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Optional

from config.settings import (
    BRAIN_LLM_ENABLED,
    BRAIN_LLM_MODEL,
    BRAIN_MAX_SCORE_BOOST,
    BRAIN_MIN_TRADES_FOR_CONFIDENCE,
)

logger = logging.getLogger(__name__)


@dataclass
class InferenceResult:
    """Output of BrainInferenceEngine.analyze_stock()."""

    best_engine: Optional[str] = None
    best_engine_win_rate: float = 0.0
    confidence: float = 0.0           # 0.0–1.0
    score_boost: float = 0.0          # additive scanner score adjustment
    tags: list[str] = field(default_factory=list)
    insight: str = "No trade history yet — collecting data."


class BrainInferenceEngine:
    """
    Analyzes StockMemory to infer the best trading method for a stock.

    All inference is rule-based by default (no external APIs needed).
    LLM insight generation can be enabled via BRAIN_LLM_ENABLED=True.
    """

    def analyze_stock(
        self, ticker: str, memory: "StockMemory"
    ) -> InferenceResult:
        """
        Full analysis pipeline for one stock.

        Returns an InferenceResult with all recommendations.
        """
        result = InferenceResult()

        if not memory.engine_stats:
            return result

        # Step 1: Find best engine by decay-weighted win rate
        best_engine, best_stats, confidence = self._infer_best_engine(memory)
        result.best_engine = best_engine

        if best_engine and best_stats:
            result.best_engine_win_rate = best_stats.weighted_win_rate
            result.confidence = confidence

            # Step 2: Compute score boost
            result.score_boost = self._compute_score_boost(
                best_stats.weighted_win_rate,
                best_stats.total_trades,
            )

        # Step 3: Extract behavioral tags
        result.tags = self._extract_tags(ticker, memory)

        # Step 4: Generate insight string
        result.insight = self._generate_insight(ticker, memory, result)

        return result

    def _infer_best_engine(
        self, memory: "StockMemory"
    ) -> tuple[Optional[str], Optional["EngineStats"], float]:
        """
        Find the engine with the best weighted win rate.

        Requires at least BRAIN_MIN_TRADES_FOR_CONFIDENCE trades before
        making a recommendation.

        Returns (engine_name, stats, confidence) or (None, None, 0.0).
        """
        qualified = {
            engine: stats
            for engine, stats in memory.engine_stats.items()
            if stats.total_trades >= BRAIN_MIN_TRADES_FOR_CONFIDENCE
        }

        if not qualified:
            return None, None, 0.0

        best_engine = max(
            qualified,
            key=lambda e: qualified[e].weighted_win_rate,
        )
        best_stats = qualified[best_engine]

        # Confidence scales with sample size (saturates at 20 trades)
        confidence = min(best_stats.total_trades / 20.0, 1.0)

        return best_engine, best_stats, confidence

    def _compute_score_boost(
        self, win_rate: float, n_trades: int
    ) -> float:
        """
        Compute the additive score boost for the scanner.

        Formula: boost = (win_rate - 0.5) * 2.0 * sample_weight

        Where:
          - win_rate of 0.50 → boost = 0.0 (neutral, no effect)
          - win_rate of 0.75 → boost = +0.5 (significant uplift)
          - win_rate of 0.30 → boost = -0.4 (suppression)

        sample_weight saturates at 1.0 after BRAIN_MIN_TRADES_FOR_CONFIDENCE * 3 trades.
        """
        target = BRAIN_MIN_TRADES_FOR_CONFIDENCE * 3
        sample_weight = min(n_trades / target, 1.0)

        raw_boost = (win_rate - 0.5) * 2.0 * sample_weight
        return round(max(-BRAIN_MAX_SCORE_BOOST, min(BRAIN_MAX_SCORE_BOOST, raw_boost)), 3)

    def _extract_tags(self, ticker: str, memory: "StockMemory") -> list[str]:
        """
        Extract behavioral tags from the signal history and engine stats.

        Tags describe trading behavior patterns:
          - mean_reverting / trending (from Hurst)
          - low_volatility / high_volatility (from ATR%)
          - deep_oversold_responder (from avg RSI at winning trades)
          - volume_spike_responder (from avg volume ratio at wins)
          - high_confluence_required (best wins at confluence_count >= 7)
          - ml_driven (best engine is XGBoost or LSTM)
        """
        tags = []
        closed_signals = [s for s in memory.signal_history if s.is_closed]

        if not closed_signals:
            return tags

        winning_signals = [s for s in closed_signals if s.outcome_was_win]

        # Hurst-based character
        avg_hurst = sum(s.hurst for s in closed_signals) / len(closed_signals)
        if avg_hurst < 0.45:
            tags.append("mean_reverting")
        elif avg_hurst > 0.55:
            tags.append("trending")

        # Volatility character
        avg_atr = sum(s.atr_pct for s in closed_signals) / len(closed_signals)
        if avg_atr < 0.015:
            tags.append("low_volatility")
        elif avg_atr > 0.04:
            tags.append("high_volatility")

        # Deep oversold responder (wins happen at low RSI)
        if winning_signals:
            avg_rsi_wins = sum(s.rsi for s in winning_signals) / len(winning_signals)
            if avg_rsi_wins < 40.0 and len(winning_signals) >= 2:
                tags.append("deep_oversold_responder")
            elif avg_rsi_wins > 55.0 and len(winning_signals) >= 2:
                tags.append("momentum_zone_trader")

            # Volume spike responder
            avg_vol_wins = sum(s.volume_ratio for s in winning_signals) / len(winning_signals)
            if avg_vol_wins > 2.0 and len(winning_signals) >= 2:
                tags.append("volume_spike_responder")

            # Confluence lover (wins when high confluence)
            confluence_vals = [s.confluence_count for s in winning_signals if s.confluence_count > 0]
            if confluence_vals:
                avg_conf = sum(confluence_vals) / len(confluence_vals)
                if avg_conf >= 7.0:
                    tags.append("high_confluence_required")

        # ML-driven
        ml_engines = {"gradient_boost_entry", "lstm_direction"}
        if memory.best_engine in ml_engines:
            tags.append("ml_driven")

        # Best regime tag (from best performing engine)
        for engine, stats in memory.engine_stats.items():
            if stats.total_trades >= BRAIN_MIN_TRADES_FOR_CONFIDENCE:
                best_reg = stats.best_regime
                tag = f"performs_best_{best_reg.lower()}"
                if tag not in tags:
                    tags.append(tag)
                break

        return list(dict.fromkeys(tags))  # deduplicate preserving order

    def _generate_insight(
        self,
        ticker: str,
        memory: "StockMemory",
        result: InferenceResult,
    ) -> str:
        """
        Generate a human-readable insight string for this stock.

        Tries LLM generation first (if BRAIN_LLM_ENABLED), falls back
        to rule-based string generation.
        """
        if BRAIN_LLM_ENABLED:
            try:
                llm_insight = self._generate_llm_insight(ticker, memory, result)
                if llm_insight:
                    return llm_insight
            except Exception as e:
                logger.debug("[%s] LLM insight failed: %s. Using rule-based.", ticker, e)

        return self._generate_rule_insight(ticker, memory, result)

    def _generate_rule_insight(
        self,
        ticker: str,
        memory: "StockMemory",
        result: InferenceResult,
    ) -> str:
        """
        Generate a rule-based insight string from statistics.

        Produces concise, factual sentences about the stock's behavior.
        """
        parts = []
        closed_signals = [s for s in memory.signal_history if s.is_closed]
        n_total = len(closed_signals)

        if n_total == 0:
            return "No completed trades yet — brain is collecting data."

        # Overall performance
        overall_wr = memory.overall_win_rate
        parts.append(
            f"{ticker}: {n_total} trade(s) tracked, "
            f"overall win rate {overall_wr:.0%}."
        )

        # Best engine recommendation
        if result.best_engine and result.best_engine_win_rate > 0:
            engine_label = result.best_engine.replace("_", " ").title()
            n_engine = memory.engine_stats.get(result.best_engine, None)
            n_e = n_engine.total_trades if n_engine else 0
            parts.append(
                f"Best method: {engine_label} "
                f"({result.best_engine_win_rate:.0%} WR, {n_e} trade(s))."
            )

        # Entry context for winning trades
        winning_signals = [s for s in closed_signals if s.outcome_was_win]
        if winning_signals:
            avg_rsi = sum(s.rsi for s in winning_signals) / len(winning_signals)
            avg_vol = sum(s.volume_ratio for s in winning_signals) / len(winning_signals)
            parts.append(
                f"Winning entries: RSI ~{avg_rsi:.0f}, "
                f"volume ~{avg_vol:.1f}x avg."
            )

        # Score direction
        if result.score_boost > 0.1:
            parts.append(f"Brain boost: +{result.score_boost:.2f} (preferred).")
        elif result.score_boost < -0.1:
            parts.append(f"Brain caution: {result.score_boost:.2f} (historically poor fit).")

        # Tags summary
        if result.tags:
            parts.append(f"Character: {', '.join(result.tags[:3])}.")

        return " ".join(parts)

    def _generate_llm_insight(
        self,
        ticker: str,
        memory: "StockMemory",
        result: InferenceResult,
    ) -> str:
        """
        Generate an LLM-powered insight using the Gemini API.

        Requires GEMINI_API_KEY in environment and google-generativeai package.
        Returns empty string if unavailable.
        """
        try:
            import google.generativeai as genai
        except ImportError:
            return ""

        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            return ""

        genai.configure(api_key=api_key)

        # Build a structured summary for the LLM
        closed = [s for s in memory.signal_history if s.is_closed]
        summary = {
            "ticker": ticker,
            "total_trades": len(closed),
            "overall_win_rate": round(memory.overall_win_rate, 3),
            "best_engine": result.best_engine,
            "best_engine_win_rate": round(result.best_engine_win_rate, 3),
            "tags": result.tags,
            "engine_stats": {
                k: {
                    "total": v.total_trades,
                    "win_rate": round(v.weighted_win_rate, 3),
                    "avg_pnl_pct": round(v.avg_pnl_pct, 3),
                    "avg_hold_days": round(v.avg_hold_days, 1),
                    "best_regime": v.best_regime,
                }
                for k, v in memory.engine_stats.items()
            },
        }

        prompt = (
            f"You are a quantitative trading analyst for the Indonesian stock market (IDX). "
            f"Based on this stock's paper trading history, write a 2-3 sentence insight "
            f"about what trading approach works best for this stock and why.\n\n"
            f"Data: {summary}\n\n"
            f"Be specific with numbers. Focus on actionable patterns. "
            f"Do not use markdown formatting."
        )

        model = genai.GenerativeModel(BRAIN_LLM_MODEL)
        response = model.generate_content(prompt)
        return response.text.strip() if response.text else ""
