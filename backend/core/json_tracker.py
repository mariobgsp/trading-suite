"""
JSON-based daily tracking for the IHSG swing trading system.

Persists scan results, trade signals, paper trading activity, and
midday evaluation outcomes into a single ``data/daily_tracking.json``
file so that the full history is preserved across workflow runs.

Each entry in the file carries a ``type`` field:
  - ``daily_scan``  — appended by the daily workflow
  - ``midday_eval`` — appended by the midday workflow

If an entry with the same ``date`` + ``type`` already exists it is
**replaced** (re-run idempotency).

Usage (daily scan)::

    from core.json_tracker import update_daily_tracking
    update_daily_tracking(scan_result, regime, paper_portfolio)

Usage (midday evaluation)::

    from core.json_tracker import update_midday_tracking
    update_midday_tracking(
        macro_veto=False,
        ihsg_change_pct=-0.35,
        gap_crap_alerts=[],
        fakeout_alerts=[],
    )
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from config.settings import PROJECT_ROOT

logger = logging.getLogger(__name__)

TRACKING_FILE = PROJECT_ROOT / "data" / ".tracking_state.json"

# Maximum wait-bucket entries to persist per day (prevent file bloat)
_MAX_WAIT_ENTRIES = 20


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _load_tracking() -> dict:
    """Load existing tracking data or return a fresh skeleton."""
    if TRACKING_FILE.exists():
        try:
            return json.loads(TRACKING_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Could not read tracking file, starting fresh: %s", exc)
    return {"last_updated": None, "entries": []}


def _save_tracking(data: dict) -> None:
    """Atomically write tracking data to disk."""
    TRACKING_FILE.parent.mkdir(parents=True, exist_ok=True)
    data["last_updated"] = datetime.now().astimezone().isoformat()
    TRACKING_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    logger.info("Tracking data saved to %s", TRACKING_FILE)

    try:
        from core.md_reporter import generate_daily_report
        generate_daily_report()
    except Exception as exc:
        logger.warning("Failed to generate daily markdown report: %s", exc)


def _upsert_entry(data: dict, entry: dict) -> None:
    """Insert or replace an entry matched on (date, type)."""
    key = (entry["date"], entry["type"])
    for idx, existing in enumerate(data["entries"]):
        if (existing["date"], existing["type"]) == key:
            data["entries"][idx] = entry
            logger.info("Replaced existing %s entry for %s", entry["type"], entry["date"])
            return
    data["entries"].append(entry)
    logger.info("Added new %s entry for %s", entry["type"], entry["date"])


# ─── Daily Scan Tracking ────────────────────────────────────────────────────


def update_daily_tracking(
    scan_result,
    regime_snapshot,
    paper_portfolio=None,
) -> None:
    """
    Persist today's daily scan results into the tracking JSON.

    Parameters
    ----------
    scan_result : ScanResult
        Output of ``MasterScanner.scan_universe()``.
    regime_snapshot : RegimeSnapshot
        Current market regime snapshot.
    paper_portfolio : PaperPortfolio | None
        Paper trading portfolio (if enabled).
    """
    today = datetime.now().strftime("%Y-%m-%d")

    # ── Regime detail ────────────────────────────────────────────────
    regime_detail = {
        "close": regime_snapshot.close,
        "sma_short": regime_snapshot.sma_short,
        "sma_long": regime_snapshot.sma_long,
        "atr_value": regime_snapshot.atr_value,
        "hurst": getattr(regime_snapshot, "hurst_value", None),
    }

    # ── Scan summary ─────────────────────────────────────────────────
    stats = scan_result.stats
    scan_summary = {
        "total_scanned": stats.get("total_scanned", 0),
        "total_with_data": stats.get("total_with_data", 0),
        "avoid_count": len(scan_result.avoid),
        "wait_count": len(scan_result.wait),
        "trade_count": len(scan_result.trade),
        "skipped_count": len(scan_result.skipped),
    }

    # ── Trade signals ────────────────────────────────────────────────
    trade_signals = []
    for entry in scan_result.trade:
        d = entry.details
        signal_dict = {
            "ticker": entry.ticker,
            "engine": entry.signal,
            "score": round(entry.score, 2),
            "price": entry.price,
            "stop_loss": d.get("stop_loss"),
            "position_size": d.get("position_size"),
            "risk_pct": d.get("risk_pct"),
        }
        # Embed brain intelligence fields if present
        for brain_key in (
            "brain_best_engine", "brain_best_engine_wr", "brain_score_boost",
            "brain_total_trades", "brain_insight", "brain_last_outcome", "brain_tags",
        ):
            if brain_key in d:
                signal_dict[brain_key] = d[brain_key]
        trade_signals.append(signal_dict)

    # ── Wait signals (capped) ────────────────────────────────────────
    wait_signals = []
    for entry in scan_result.wait[:_MAX_WAIT_ENTRIES]:
        wait_signals.append({
            "ticker": entry.ticker,
            "condition": entry.condition,
            "price": entry.details.get("price"),
        })

    # ── Paper trading ────────────────────────────────────────────────
    paper_data = None
    if paper_portfolio is not None:
        # Collect recent actions from the last process_signals call
        trades_entered = []
        trades_closed = []

        # Scan open positions entered today
        for pos in paper_portfolio.open_positions:
            if pos.entry_date == today:
                trades_entered.append({
                    "ticker": pos.ticker,
                    "engine": pos.engine,
                    "shares": pos.shares,
                    "entry_price": pos.entry_price,
                    "stop_loss": pos.stop_loss,
                    "take_profit": pos.take_profit,
                    "risk_amount": pos.risk_amount,
                })

        # Scan closed trades from today
        for trade in paper_portfolio.closed_trades:
            if trade.exit_date == today:
                trades_closed.append({
                    "ticker": trade.ticker,
                    "engine": trade.engine,
                    "pnl": trade.pnl,
                    "pnl_pct": trade.pnl_pct,
                    "exit_reason": trade.exit_reason,
                    "holding_days": trade.holding_days,
                })

        paper_data = {
            "equity": paper_portfolio.equity,
            "total_return_pct": round(paper_portfolio.total_return_pct, 2),
            "open_positions": paper_portfolio.num_positions,
            "trades_entered": trades_entered,
            "trades_closed": trades_closed,
        }

    # ── Build entry ──────────────────────────────────────────────────
    entry = {
        "date": today,
        "type": "daily_scan",
        "regime": regime_snapshot.regime.value,
        "regime_detail": regime_detail,
        "scan_summary": scan_summary,
        "trade_signals": trade_signals,
        "wait_signals": wait_signals,
        "paper_trading": paper_data,
    }

    data = _load_tracking()
    _upsert_entry(data, entry)
    _save_tracking(data)


# ─── Midday Evaluation Tracking ─────────────────────────────────────────────


def update_midday_tracking(
    macro_veto: bool,
    ihsg_change_pct: float | None = None,
    gap_crap_alerts: list[dict] | None = None,
    fakeout_alerts: list[dict] | None = None,
) -> None:
    """
    Persist today's midday evaluation results into the tracking JSON.

    Parameters
    ----------
    macro_veto : bool
        Whether the macro veto was triggered (IHSG down > 1.5%).
    ihsg_change_pct : float | None
        IHSG intraday percentage change.
    gap_crap_alerts : list[dict] | None
        List of gap-and-crap alerts fired.
    fakeout_alerts : list[dict] | None
        List of fakeout breakout vetoes.
    """
    today = datetime.now().strftime("%Y-%m-%d")

    entry = {
        "date": today,
        "type": "midday_eval",
        "macro_veto": macro_veto,
        "ihsg_daily_change_pct": round(ihsg_change_pct, 2) if ihsg_change_pct is not None else None,
        "gap_and_crap_alerts": gap_crap_alerts or [],
        "fakeout_alerts": fakeout_alerts or [],
    }

    data = _load_tracking()
    _upsert_entry(data, entry)
    _save_tracking(data)
