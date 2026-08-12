"""
Alert manager for the IHSG swing trading system.

Fires alerts for Trade bucket entries and logs them to
a dedicated alerts log file for audit trail.
"""

from __future__ import annotations

import logging
from pathlib import Path

from config.settings import LOG_DIR

logger = logging.getLogger(__name__)

# Dedicated alert logger
_alert_logger: logging.Logger | None = None


def _get_alert_logger() -> logging.Logger:
    """Initialize the alert logger with file handler on first use."""
    global _alert_logger
    if _alert_logger is not None:
        return _alert_logger

    _alert_logger = logging.getLogger("alerts")
    _alert_logger.setLevel(logging.DEBUG)

    # File handler
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(LOG_DIR / "alerts.log", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    _alert_logger.addHandler(fh)

    # Console handler at CRITICAL only
    ch = logging.StreamHandler()
    ch.setLevel(logging.CRITICAL)
    ch.setFormatter(logging.Formatter(
        "\n*** ALERT *** %(message)s\n"
    ))
    _alert_logger.addHandler(ch)

    return _alert_logger


def fire_trade_alert(ticker: str, signal: str, price: float,
                     details: dict) -> None:
    """
    Fire an alert for a Trade bucket entry.

    Logs at CRITICAL level (visible on console) and writes to alerts.log.
    """
    al = _get_alert_logger()

    stop = details.get("stop_loss", "?")
    size = details.get("position_size", "?")
    risk = details.get("risk_amount", "?")
    risk_pct = details.get("risk_pct", "?")

    msg = (
        f"TRADE SIGNAL: {ticker} | "
        f"Engine={signal} | "
        f"Entry=IDR {price:,.0f} | "
        f"Stop=IDR {stop:,.0f} | " if isinstance(stop, (int, float)) else
        f"TRADE SIGNAL: {ticker} | "
        f"Engine={signal} | "
        f"Entry=IDR {price:,.0f} | "
        f"Stop={stop} | "
    )
    msg += (
        f"Size={size:,} shares | " if isinstance(size, (int, float)) else
        f"Size={size} | "
    )
    msg += (
        f"Risk=IDR {risk:,.0f} ({risk_pct}%)" if isinstance(risk, (int, float)) else
        f"Risk={risk}"
    )

    al.critical(msg)


def fire_regime_alert(regime: str, close: float, sma50: float,
                      sma200: float) -> None:
    """Log the current regime status."""
    al = _get_alert_logger()
    al.info(
        "REGIME: %s | IHSG Close=%s SMA50=%s SMA200=%s",
        regime, f"{close:,.0f}", f"{sma50:,.0f}", f"{sma200:,.0f}",
    )


def fire_heat_warning(heat: float, max_heat: float) -> None:
    """Fire a warning if portfolio heat is near the limit."""
    al = _get_alert_logger()
    if heat >= max_heat * 0.8:
        al.warning(
            "HEAT WARNING: Portfolio heat at %.2f%% (limit: %.1f%%)",
            heat, max_heat,
        )
