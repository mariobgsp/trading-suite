"""
Failed Trade Cooldown Manager.

Prevents the bot from repeatedly entering the same stocks that
previously failed (stopped out or hit maximum loss). Once a ticker
records a losing trade, it is suppressed from the Trade bucket for
FAILED_TRADE_COOLDOWN_DAYS days.

Usage:
    cooldown = CooldownManager()
    if cooldown.is_cooling_down("BBCA"):
        return  # Skip this ticker

    # After a losing trade:
    cooldown.record_failure("BBCA", reason="stop_loss_hit")
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config.settings import FAILED_TRADE_COOLDOWN_DAYS, FAILED_TRADE_COOLDOWN_FILE, PROJECT_ROOT

logger = logging.getLogger(__name__)


class CooldownManager:
    """
    Manages a JSON-backed store of tickers under trade cooldown.

    A ticker enters cooldown when:
    - Its stop loss was hit (losing trade)
    - It was manually blocked by the user

    A ticker exits cooldown automatically after FAILED_TRADE_COOLDOWN_DAYS.
    """

    def __init__(self) -> None:
        self._path = PROJECT_ROOT / FAILED_TRADE_COOLDOWN_FILE
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._records: dict[str, dict] = self._load()
        self._purge_expired()

    # ── Persistence ────────────────────────────────────────────────────────

    def _load(self) -> dict[str, dict]:
        """Load cooldown records from disk."""
        if not self._path.exists():
            return {}
        try:
            with open(self._path, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.warning("Could not load cooldown file: %s", e)
            return {}

    def _save(self) -> None:
        """Persist cooldown records to disk."""
        try:
            with open(self._path, "w") as f:
                json.dump(self._records, f, indent=2)
        except Exception as e:
            logger.error("Could not save cooldown file: %s", e)

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def _purge_expired(self) -> None:
        """Remove expired cooldown entries."""
        now = datetime.now(timezone.utc)
        expired = [
            ticker
            for ticker, rec in self._records.items()
            if datetime.fromisoformat(rec["expires_at"]) <= now
        ]
        for ticker in expired:
            logger.debug("Cooldown expired for %s — removing from suppression list", ticker)
            del self._records[ticker]
        if expired:
            self._save()

    # ── Public API ─────────────────────────────────────────────────────────

    def is_cooling_down(self, ticker: str) -> bool:
        """Return True if this ticker is still under cooldown suppression."""
        self._purge_expired()
        rec = self._records.get(ticker)
        if rec is None:
            return False
        expires = datetime.fromisoformat(rec["expires_at"])
        now = datetime.now(timezone.utc)
        if now < expires:
            logger.debug(
                "[%s] Under cooldown until %s (reason: %s)",
                ticker, expires.strftime("%Y-%m-%d"), rec.get("reason", "unknown"),
            )
            return True
        return False

    def record_failure(
        self,
        ticker: str,
        reason: str = "stop_loss_hit",
        cooldown_days: int | None = None,
    ) -> None:
        """
        Add a ticker to the cooldown list after a losing trade.

        Parameters
        ----------
        ticker : str
            The ticker symbol (without .JK suffix).
        reason : str
            Human-readable reason for the cooldown (e.g., 'stop_loss_hit').
        cooldown_days : int | None
            Override the default cooldown period. Defaults to FAILED_TRADE_COOLDOWN_DAYS.
        """
        days = cooldown_days or FAILED_TRADE_COOLDOWN_DAYS
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=days)

        self._records[ticker] = {
            "ticker": ticker,
            "failed_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "reason": reason,
            "cooldown_days": days,
        }
        logger.info(
            "[%s] Entered cooldown for %d days (reason: %s) — expires %s",
            ticker, days, reason, expires_at.strftime("%Y-%m-%d"),
        )
        self._save()

    def remove(self, ticker: str) -> None:
        """Manually remove a ticker from cooldown (e.g., after manual review)."""
        if ticker in self._records:
            del self._records[ticker]
            self._save()
            logger.info("[%s] Removed from cooldown list.", ticker)

    def list_cooling_down(self) -> list[dict]:
        """Return all currently cooling-down tickers with their metadata."""
        self._purge_expired()
        now = datetime.now(timezone.utc)
        return [
            {
                **rec,
                "days_remaining": max(
                    0,
                    (datetime.fromisoformat(rec["expires_at"]) - now).days,
                ),
            }
            for rec in self._records.values()
        ]
