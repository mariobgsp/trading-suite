"""
Stock Brain — Per-Stock AI Memory and Intelligence Layer.

The Stock Brain is a persistent memory system that tracks every signal
fired on every stock, records trade outcomes, and uses statistical
inference to determine which trading method works best for each stock.

Data is stored as individual JSON files in data/brain/<TICKER>.json,
one per stock. These files accumulate over time and are committed to
the repository via the existing GitHub Actions workflow.

Core components:
  SignalRecord   — One entry per signal fired (before outcome known)
  EngineStats    — Running win/loss stats per engine per stock
  StockMemory    — Complete persistent state for one stock
  BrainContext   — Lightweight query result for the scanner
  StockBrain     — Main interface: load/save/query/record
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from config.settings import (
    BRAIN_DATA_DIR,
    BRAIN_ENABLED,
    BRAIN_LEARNING_DECAY,
    BRAIN_MAX_SCORE_BOOST,
    BRAIN_MIN_TRADES_FOR_CONFIDENCE,
    BRAIN_PENALTY_WIN_RATE_THRESHOLD,
    BRAIN_BOOST_WIN_RATE_THRESHOLD,
)

logger = logging.getLogger(__name__)


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class SignalRecord:
    """
    A single signal fired on a stock — captures full technical context
    at signal time and outcome once the trade closes.

    Fields prefixed with `outcome_` are None until the trade closes.
    """

    # Signal identity
    signal_id: str           # unique: "<TICKER>_<DATE>_<ENGINE>"
    date: str                # ISO date of signal: "YYYY-MM-DD"
    engine: str              # e.g. "momentum_confluence"
    price: float             # raw signal price
    score: float             # signal score at time of firing
    regime: str              # "BULL", "CAUTION", "BEAR"

    # Technical context at signal time (from StockProfile)
    rsi: float = 0.0
    volume_ratio: float = 0.0
    atr_pct: float = 0.0
    hurst: float = 0.5
    trend_strength: float = 0.0
    alpha_momentum: float = 0.0
    alpha_mean_reversion: float = 0.0
    alpha_liquidity: float = 0.0
    alpha_volatility_regime: float = 0.0
    alpha_money_flow: float = 0.0
    confluence_count: int = 0   # for momentum_confluence engine
    ml_probability: float = 0.0 # for ML engines

    # Outcome — filled in when trade closes
    outcome_pnl_pct: Optional[float] = None
    outcome_days_held: Optional[int] = None
    outcome_exit_reason: Optional[str] = None
    outcome_was_win: Optional[bool] = None
    outcome_date: Optional[str] = None

    @property
    def is_closed(self) -> bool:
        """True if this signal's trade has been closed."""
        return self.outcome_pnl_pct is not None


@dataclass
class EngineStats:
    """
    Running win/loss statistics for ONE engine on ONE stock.

    Tracks weighted win rate (recent trades weighted more via BRAIN_LEARNING_DECAY)
    so the brain adapts as market conditions evolve.
    """

    engine: str
    total_trades: int = 0
    wins: int = 0
    losses: int = 0

    # Weighted statistics (decay-weighted, more recent trades count more)
    weighted_win_rate: float = 0.0
    avg_pnl_pct: float = 0.0
    avg_hold_days: float = 0.0

    # Context breakdown
    bull_trades: int = 0
    bull_wins: int = 0
    caution_trades: int = 0
    caution_wins: int = 0
    bear_trades: int = 0
    bear_wins: int = 0

    # Entry context averages
    avg_rsi_at_entry: float = 0.0
    avg_volume_ratio_at_entry: float = 0.0
    avg_confluence_at_entry: float = 0.0
    avg_ml_prob_at_entry: float = 0.0

    # Timestamps
    first_trade_date: Optional[str] = None
    last_trade_date: Optional[str] = None

    @property
    def simple_win_rate(self) -> float:
        """Simple (unweighted) win rate."""
        if self.total_trades == 0:
            return 0.0
        return self.wins / self.total_trades

    @property
    def best_regime(self) -> str:
        """The regime in which this engine has the best win rate."""
        rates = {}
        if self.bull_trades > 0:
            rates["BULL"] = self.bull_wins / self.bull_trades
        if self.caution_trades > 0:
            rates["CAUTION"] = self.caution_wins / self.caution_trades
        if self.bear_trades > 0:
            rates["BEAR"] = self.bear_wins / self.bear_trades
        if not rates:
            return "UNKNOWN"
        return max(rates, key=rates.get)


@dataclass
class StockMemory:
    """
    Complete persistent memory for ONE stock.

    Serialized to data/brain/<TICKER>.json.
    """

    ticker: str
    last_updated: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    # Full signal history (includes both open and closed signals)
    signal_history: list[SignalRecord] = field(default_factory=list)

    # Per-engine performance statistics
    engine_stats: dict[str, EngineStats] = field(default_factory=dict)

    # AI-inferred recommendations (updated by BrainInferenceEngine)
    best_engine: Optional[str] = None
    best_engine_win_rate: float = 0.0
    best_engine_confidence: float = 0.0  # 0.0–1.0 based on sample size
    brain_score_boost: float = 0.0       # additive score adjustment for scanner

    # Behavioral tags (e.g. ["trending", "low_volatility", "volume_spike_responder"])
    tags: list[str] = field(default_factory=list)

    # Human-readable insight string
    last_insight: str = ""
    last_insight_date: str = ""

    @property
    def total_closed_trades(self) -> int:
        """Total number of closed trades across all engines."""
        return sum(
            s.total_trades for s in self.engine_stats.values()
        )

    @property
    def overall_win_rate(self) -> float:
        """Portfolio-level win rate across all engines."""
        total = sum(s.total_trades for s in self.engine_stats.values())
        wins = sum(s.wins for s in self.engine_stats.values())
        return wins / total if total > 0 else 0.0

    @property
    def recent_outcome(self) -> Optional[str]:
        """"win", "loss", or None based on most recent closed trade."""
        closed = [s for s in self.signal_history if s.is_closed]
        if not closed:
            return None
        latest = max(closed, key=lambda s: s.date)
        return "win" if latest.outcome_was_win else "loss"


@dataclass
class BrainContext:
    """
    Lightweight query result returned to the scanner.

    The scanner uses this to:
    1. Boost/penalize signal scores based on historical fit
    2. Add brain metadata to TradeEntry details
    3. Surface insights in daily reports
    """

    ticker: str
    has_memory: bool = False
    total_closed_trades: int = 0

    # Engine preference
    best_engine: Optional[str] = None
    best_engine_win_rate: float = 0.0
    best_engine_confidence: float = 0.0

    # Per-engine win rates (populated if memory exists)
    engine_win_rates: dict[str, float] = field(default_factory=dict)
    engine_trade_counts: dict[str, int] = field(default_factory=dict)

    # Score adjustment for the scanner
    brain_score_boost: float = 0.0

    # Enrichment for reports
    tags: list[str] = field(default_factory=list)
    last_insight: str = ""
    recent_outcome: Optional[str] = None

    def get_engine_win_rate(self, engine: str) -> float:
        """Return the historical win rate for a specific engine on this stock."""
        return self.engine_win_rates.get(engine, 0.5)  # default to neutral

    def get_engine_boost(self, engine: str) -> float:
        """
        Return the score boost/penalty for a specific engine.

        If this engine is the historical best, return the full brain_score_boost.
        If this engine has a bad win rate, return a penalty.
        Otherwise return 0.0.
        """
        if not self.has_memory:
            return 0.0

        win_rate = self.get_engine_win_rate(engine)
        count = self.engine_trade_counts.get(engine, 0)

        if count < BRAIN_MIN_TRADES_FOR_CONFIDENCE:
            return 0.0  # Not enough data

        if engine == self.best_engine and win_rate >= BRAIN_BOOST_WIN_RATE_THRESHOLD:
            return self.brain_score_boost
        elif win_rate <= BRAIN_PENALTY_WIN_RATE_THRESHOLD:
            # Penalize engines that historically lose on this stock
            penalty = (BRAIN_PENALTY_WIN_RATE_THRESHOLD - win_rate) * 2.0
            return -min(penalty, BRAIN_MAX_SCORE_BOOST)
        return 0.0


# ─── Main StockBrain Interface ───────────────────────────────────────────────


class StockBrain:
    """
    Main interface for the per-stock AI memory system.

    Usage in scanner:
        brain = StockBrain()
        ctx = brain.query("BBCA")
        # use ctx.brain_score_boost and ctx.best_engine

    Usage in paper_trader (on entry):
        brain.record_signal(ticker, entry_signal, profile, regime)

    Usage in paper_trader (on exit):
        brain.record_outcome(ticker, signal_date, pnl_pct, exit_reason, hold_days)

    Usage in brain_update script:
        brain.run_inference(ticker)  # updates best_engine, tags, insight
    """

    def __init__(self, data_dir: Path | None = None) -> None:
        self._data_dir = data_dir or BRAIN_DATA_DIR
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, StockMemory] = {}  # in-memory cache

    # ── Persistence ──────────────────────────────────────────────────────

    def _brain_path(self, ticker: str) -> Path:
        """Returns the path to this stock's brain file."""
        return self._data_dir / f"{ticker}.json"

    def load(self, ticker: str) -> StockMemory:
        """Load a stock's memory from disk (or return empty if not found)."""
        if ticker in self._cache:
            return self._cache[ticker]

        path = self._brain_path(ticker)
        if not path.exists():
            memory = StockMemory(ticker=ticker)
            self._cache[ticker] = memory
            return memory

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            memory = self._deserialize(raw)
            self._cache[ticker] = memory
            return memory
        except Exception as e:
            logger.warning("[%s] Failed to load brain: %s. Creating fresh.", ticker, e)
            memory = StockMemory(ticker=ticker)
            self._cache[ticker] = memory
            return memory

    def save(self, memory: StockMemory) -> None:
        """Save a stock's memory to disk."""
        memory.last_updated = datetime.utcnow().isoformat()
        path = self._brain_path(memory.ticker)
        try:
            path.write_text(
                json.dumps(self._serialize(memory), indent=2, default=str),
                encoding="utf-8",
            )
        except Exception as e:
            logger.error("[%s] Failed to save brain: %s", memory.ticker, e)

    def _serialize(self, memory: StockMemory) -> dict:
        """Convert StockMemory to a JSON-serializable dict."""
        d = asdict(memory)
        return d

    def _deserialize(self, raw: dict) -> StockMemory:
        """Reconstruct StockMemory from raw JSON dict."""
        # Rebuild signal_history
        signals = [
            SignalRecord(**{k: v for k, v in s.items() if k in SignalRecord.__dataclass_fields__})
            for s in raw.get("signal_history", [])
        ]

        # Rebuild engine_stats
        engine_stats = {
            k: EngineStats(**{ek: ev for ek, ev in v.items() if ek in EngineStats.__dataclass_fields__})
            for k, v in raw.get("engine_stats", {}).items()
        }

        return StockMemory(
            ticker=raw["ticker"],
            last_updated=raw.get("last_updated", ""),
            signal_history=signals,
            engine_stats=engine_stats,
            best_engine=raw.get("best_engine"),
            best_engine_win_rate=raw.get("best_engine_win_rate", 0.0),
            best_engine_confidence=raw.get("best_engine_confidence", 0.0),
            brain_score_boost=raw.get("brain_score_boost", 0.0),
            tags=raw.get("tags", []),
            last_insight=raw.get("last_insight", ""),
            last_insight_date=raw.get("last_insight_date", ""),
        )

    # ── Query (for scanner) ───────────────────────────────────────────────

    def query(self, ticker: str) -> BrainContext:
        """
        Query the brain for context on a stock before scanning.

        Returns a BrainContext with boost/penalty info for the scanner.
        Safe to call even if no memory exists (returns neutral context).
        """
        if not BRAIN_ENABLED:
            return BrainContext(ticker=ticker)

        try:
            memory = self.load(ticker)

            if not memory.engine_stats and not memory.signal_history:
                return BrainContext(ticker=ticker, has_memory=False)

            # Build per-engine win rate map
            engine_win_rates = {
                engine: stats.weighted_win_rate
                for engine, stats in memory.engine_stats.items()
            }
            engine_trade_counts = {
                engine: stats.total_trades
                for engine, stats in memory.engine_stats.items()
            }

            return BrainContext(
                ticker=ticker,
                has_memory=True,
                total_closed_trades=memory.total_closed_trades,
                best_engine=memory.best_engine,
                best_engine_win_rate=memory.best_engine_win_rate,
                best_engine_confidence=memory.best_engine_confidence,
                engine_win_rates=engine_win_rates,
                engine_trade_counts=engine_trade_counts,
                brain_score_boost=memory.brain_score_boost,
                tags=memory.tags,
                last_insight=memory.last_insight,
                recent_outcome=memory.recent_outcome,
            )

        except Exception as e:
            logger.debug("[%s] Brain query error: %s", ticker, e)
            return BrainContext(ticker=ticker)

    # ── Record Signal (called on trade entry) ─────────────────────────────

    def record_signal(
        self,
        ticker: str,
        engine: str,
        price: float,
        score: float,
        regime: str,
        signal_date: str | None = None,
        profile: "object | None" = None,
        signal_details: dict | None = None,
    ) -> str:
        """
        Record a new signal being fired on a stock.

        Should be called when the paper trader enters a position.
        Returns the signal_id for later outcome recording.
        """
        if not BRAIN_ENABLED:
            return ""

        try:
            today = signal_date or datetime.utcnow().strftime("%Y-%m-%d")
            signal_id = f"{ticker}_{today}_{engine}"

            memory = self.load(ticker)

            # Check if this signal is already recorded (idempotency)
            existing = [s for s in memory.signal_history if s.signal_id == signal_id]
            if existing:
                return signal_id

            # Extract context from profile if available
            rsi = volume_ratio = atr_pct = hurst = trend_strength = 0.0
            alpha_momentum = alpha_mean_reversion = alpha_liquidity = 0.0
            alpha_volatility_regime = alpha_money_flow = 0.0

            if profile is not None:
                try:
                    rsi = getattr(profile, "rsi_oversold", 0.0)
                    volume_ratio = getattr(profile, "volume_spike_threshold", 1.0)
                    atr_pct = getattr(profile, "atr_pct", 0.0)
                    hurst = getattr(profile, "mean_reversion_score", 0.5)
                    trend_strength = getattr(profile, "trend_strength", 0.0)
                    alpha_momentum = getattr(profile, "alpha_momentum", 0.0)
                    alpha_mean_reversion = getattr(profile, "alpha_mean_reversion", 0.0)
                    alpha_liquidity = getattr(profile, "alpha_liquidity", 0.0)
                    alpha_volatility_regime = getattr(profile, "alpha_volatility_regime", 0.0)
                    alpha_money_flow = getattr(profile, "alpha_money_flow", 0.0)
                except Exception:
                    pass

            # Extract engine-specific context from signal_details
            confluence_count = 0
            ml_probability = 0.0
            if signal_details:
                confluence_count = signal_details.get("confluence_count", 0)
                ml_probability = signal_details.get("ml_probability", 0.0)
                # Override volume_ratio from engine details if available
                if "volume_ratio" in signal_details:
                    volume_ratio = signal_details["volume_ratio"]
                if "rsi" in signal_details:
                    rsi = signal_details["rsi"]

            record = SignalRecord(
                signal_id=signal_id,
                date=today,
                engine=engine,
                price=price,
                score=score,
                regime=regime,
                rsi=round(rsi, 2),
                volume_ratio=round(volume_ratio, 3),
                atr_pct=round(atr_pct, 4),
                hurst=round(hurst, 3),
                trend_strength=round(trend_strength, 6),
                alpha_momentum=round(alpha_momentum, 4),
                alpha_mean_reversion=round(alpha_mean_reversion, 4),
                alpha_liquidity=round(alpha_liquidity, 4),
                alpha_volatility_regime=round(alpha_volatility_regime, 4),
                alpha_money_flow=round(alpha_money_flow, 4),
                confluence_count=int(confluence_count),
                ml_probability=round(ml_probability, 4),
            )

            memory.signal_history.append(record)
            self.save(memory)

            logger.debug("[%s] Brain: recorded signal %s", ticker, signal_id)
            return signal_id

        except Exception as e:
            logger.debug("[%s] Brain record_signal error: %s", ticker, e)
            return ""

    # ── Record Outcome (called on trade exit) ─────────────────────────────

    def record_outcome(
        self,
        ticker: str,
        engine: str,
        entry_date: str,
        pnl_pct: float,
        exit_reason: str,
        hold_days: int,
        exit_date: str | None = None,
        regime: str = "",
    ) -> None:
        """
        Record the outcome of a closed trade back into the signal record.

        Should be called when the paper trader exits a position.
        Automatically updates EngineStats.
        """
        if not BRAIN_ENABLED:
            return

        try:
            today = exit_date or datetime.utcnow().strftime("%Y-%m-%d")
            signal_id = f"{ticker}_{entry_date}_{engine}"

            memory = self.load(ticker)

            # Find the matching signal record
            matching = [
                s for s in memory.signal_history
                if s.signal_id == signal_id
            ]

            was_win = pnl_pct > 0

            if matching:
                record = matching[0]
                # Only update if not already closed
                if not record.is_closed:
                    record.outcome_pnl_pct = round(pnl_pct, 4)
                    record.outcome_days_held = hold_days
                    record.outcome_exit_reason = exit_reason
                    record.outcome_was_win = was_win
                    record.outcome_date = today
                    entry_regime = record.regime
            else:
                # Signal wasn't pre-recorded (e.g. system restart) — create minimal record
                record = SignalRecord(
                    signal_id=signal_id,
                    date=entry_date,
                    engine=engine,
                    price=0.0,
                    score=0.0,
                    regime=regime,
                    outcome_pnl_pct=round(pnl_pct, 4),
                    outcome_days_held=hold_days,
                    outcome_exit_reason=exit_reason,
                    outcome_was_win=was_win,
                    outcome_date=today,
                )
                memory.signal_history.append(record)
                entry_regime = regime

            # Update EngineStats
            self._update_engine_stats(
                memory, engine, was_win, pnl_pct, hold_days,
                entry_date, entry_regime,
                record.rsi, record.volume_ratio,
                record.confluence_count, record.ml_probability,
            )

            self.save(memory)
            logger.info(
                "[%s] Brain: recorded outcome for %s — %s (%.2f%%)",
                ticker, engine, "WIN" if was_win else "LOSS", pnl_pct,
            )

        except Exception as e:
            logger.warning("[%s] Brain record_outcome error: %s", ticker, e)

    def _update_engine_stats(
        self,
        memory: StockMemory,
        engine: str,
        was_win: bool,
        pnl_pct: float,
        hold_days: int,
        trade_date: str,
        regime: str,
        rsi: float,
        volume_ratio: float,
        confluence_count: int,
        ml_probability: float,
    ) -> None:
        """Update or create EngineStats after a trade closes."""
        if engine not in memory.engine_stats:
            memory.engine_stats[engine] = EngineStats(engine=engine)

        stats = memory.engine_stats[engine]
        n = stats.total_trades

        stats.total_trades += 1
        if was_win:
            stats.wins += 1
        else:
            stats.losses += 1

        # Regime tracking
        regime_upper = regime.upper()
        if regime_upper == "BULL":
            stats.bull_trades += 1
            if was_win:
                stats.bull_wins += 1
        elif regime_upper == "CAUTION":
            stats.caution_trades += 1
            if was_win:
                stats.caution_wins += 1
        elif regime_upper == "BEAR":
            stats.bear_trades += 1
            if was_win:
                stats.bear_wins += 1

        # Rolling averages (running mean)
        def _rolling_mean(old: float, new_val: float, count: int) -> float:
            return (old * (count - 1) + new_val) / count if count > 0 else new_val

        new_n = stats.total_trades
        stats.avg_pnl_pct = _rolling_mean(stats.avg_pnl_pct, pnl_pct, new_n)
        stats.avg_hold_days = _rolling_mean(stats.avg_hold_days, float(hold_days), new_n)
        stats.avg_rsi_at_entry = _rolling_mean(stats.avg_rsi_at_entry, rsi, new_n)
        stats.avg_volume_ratio_at_entry = _rolling_mean(stats.avg_volume_ratio_at_entry, volume_ratio, new_n)
        stats.avg_confluence_at_entry = _rolling_mean(stats.avg_confluence_at_entry, float(confluence_count), new_n)
        stats.avg_ml_prob_at_entry = _rolling_mean(stats.avg_ml_prob_at_entry, ml_probability, new_n)

        # Compute decay-weighted win rate
        # Weight each trade: most recent = 1.0, each prior trade *= BRAIN_LEARNING_DECAY
        closed_for_engine = [
            s for s in memory.signal_history
            if s.engine == engine and s.is_closed
        ]
        # Sort chronologically (oldest first)
        closed_for_engine.sort(key=lambda s: s.date)

        if closed_for_engine:
            total_weight = 0.0
            weighted_wins = 0.0
            n_trades = len(closed_for_engine)
            for i, sig in enumerate(closed_for_engine):
                # More recent trades (higher index) get higher weight
                age = n_trades - 1 - i
                weight = BRAIN_LEARNING_DECAY ** age
                total_weight += weight
                if sig.outcome_was_win:
                    weighted_wins += weight

            stats.weighted_win_rate = (
                weighted_wins / total_weight if total_weight > 0 else 0.0
            )
        else:
            stats.weighted_win_rate = stats.simple_win_rate

        # Timestamps
        if stats.first_trade_date is None:
            stats.first_trade_date = trade_date
        stats.last_trade_date = trade_date

    # ── Inference Update (called by brain_update.py) ──────────────────────

    def run_inference(self, ticker: str) -> None:
        """
        Run the inference engine to update best_engine, tags, and insight.

        Imports BrainInferenceEngine to avoid circular imports.
        Safe to call at any time — reads from existing memory.
        """
        try:
            from core.brain_inference import BrainInferenceEngine
            memory = self.load(ticker)
            engine = BrainInferenceEngine()
            result = engine.analyze_stock(ticker, memory)
            memory.best_engine = result.best_engine
            memory.best_engine_win_rate = result.best_engine_win_rate
            memory.best_engine_confidence = result.confidence
            memory.brain_score_boost = result.score_boost
            memory.tags = result.tags
            memory.last_insight = result.insight
            memory.last_insight_date = datetime.utcnow().strftime("%Y-%m-%d")
            self.save(memory)
            logger.info(
                "[%s] Brain inference: best=%s (%.0f%% WR, boost=%.2f) | %s",
                ticker, result.best_engine, result.best_engine_win_rate * 100,
                result.score_boost, result.insight[:60],
            )
        except Exception as e:
            logger.warning("[%s] Brain run_inference error: %s", ticker, e)

    def sync_outcomes_from_portfolio(self, closed_trades: list) -> int:
        """
        Batch-sync closed trade outcomes from portfolio state.

        Called by scripts/brain_update.py to process newly-closed trades.
        Returns number of outcomes recorded.
        """
        count = 0
        for trade in closed_trades:
            try:
                ticker = trade.get("ticker") or getattr(trade, "ticker", None)
                engine = trade.get("engine") or getattr(trade, "engine", None)
                entry_date = trade.get("entry_date") or getattr(trade, "entry_date", None)
                exit_date = trade.get("exit_date") or getattr(trade, "exit_date", None)
                pnl_pct = trade.get("pnl_pct") or getattr(trade, "pnl_pct", 0.0)
                exit_reason = trade.get("exit_reason") or getattr(trade, "exit_reason", "unknown")
                holding_days = trade.get("holding_days") or getattr(trade, "holding_days", 0)
                regime = trade.get("regime") or getattr(trade, "regime", "")

                if not ticker or not engine or not entry_date:
                    continue

                self.record_outcome(
                    ticker=ticker,
                    engine=engine,
                    entry_date=entry_date,
                    pnl_pct=float(pnl_pct),
                    exit_reason=str(exit_reason),
                    hold_days=int(holding_days),
                    exit_date=exit_date,
                    regime=str(regime),
                )
                count += 1
            except Exception as e:
                logger.debug("Brain sync error for trade %s: %s", trade, e)
        return count
