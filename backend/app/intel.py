"""Free market-intelligence feeds: foreign flow, broker activity, announcements.

Data sources (all free, official-or-public):
  - IDX /primary/* JSON endpoints (www.idx.co.id) — foreign flow per stock
    (GetStockSummary ForeignBuy/ForeignSell), exchange-level broker summary
    (GetBrokerSummary), ownership (GetCompanyProfilesDetail), announcements
    (GetAnnouncement). Served behind Cloudflare TLS fingerprinting; the
    `app.idx` module bypasses it with curl_cffi Chrome impersonation.
  - TradingView Indonesia scanner (scanner.tradingview.com/indonesia/scan) —
    the ~885-ticker universe with sector, market cap, price, volume.

No Stockbit dependency. The one IDX data gap (per-stock broker attribution)
is handled honestly: Broker Intel shows exchange-level broker volume plus
per-stock foreign flow, not fabricated per-broker rows. Results are cached in
SQLite with a short TTL (movers.py pattern) so pages can poll.
"""

from __future__ import annotations

import logging
from typing import Any

from app import db, idx

logger = logging.getLogger(__name__)

FOREIGN_TTL = 1800  # 30 min
RADAR_TTL = 1800
ANNOUNCEMENT_TTL = 600  # 10 min

UNIVERSE_LIMIT = 40


def stockbit_available() -> bool:
    """Deprecated gate — IDX is always the source. Kept for router compat."""
    return True


# ─── Foreign flow ─────────────────────────────────────────────────────────────


def foreign_flow(ticker: str, force: bool = False) -> dict[str, Any]:
    """Net foreign flow for one ticker from the official IDX daily summary."""
    return idx.foreign_flow(ticker, force)


def foreign_flow_universe(force: bool = False) -> dict[str, Any]:
    """Net foreign flow across the whole IDX universe — one IDX call."""
    return idx.foreign_flow_universe(force)


# ─── Broker analysis / radar ──────────────────────────────────────────────────


def broker_analysis(ticker: str, force: bool = False) -> dict[str, Any]:
    """Per-ticker flow context: foreign flow + price.

    IDX does not publish per-stock broker attribution (GetBrokerSummary is
    exchange-level only), so the honest per-stock signal is the official
    foreign flow from GetStockSummary. No synthetic "broker" rows.
    """
    ticker = ticker.upper()
    cache_key = f"intel:broker:{ticker}"
    if not force:
        cached = db.get_fresh(cache_key, FOREIGN_TTL)
        if cached is not None:
            return cached
    ff = idx.foreign_flow(ticker, force)
    payload = {
        "ticker": ticker,
        "available": ff.get("available", True),
        "as_of": ff.get("as_of"),
        "note": (
            "IDX publishes broker activity exchange-level only; per-stock "
            "broker attribution is not public data. This view shows the "
            "official per-stock foreign flow instead."
        ),
        "price": ff.get("price"),
        "total_volume": ff.get("total_volume", 0),
        "net_foreign_lots": ff.get("net_foreign_lots", 0),
        "net_foreign_idr": ff.get("net_foreign_idr", 0),
        "foreign_buy_lots": ff.get("foreign_buy_lots", 0),
        "foreign_sell_lots": ff.get("foreign_sell_lots", 0),
        "foreign_buy_idr": ff.get("foreign_buy_idr", 0),
        "foreign_sell_idr": ff.get("foreign_sell_idr", 0),
    }
    if ff.get("error"):
        payload["error"] = ff["error"]
        payload["available"] = False
    else:
        db.set(cache_key, payload)
    return payload


def broker_radar(force: bool = False) -> dict[str, Any]:
    """Exchange-level broker volume/value ranking (whole IDX, one call)."""
    return idx.broker_summary(force)


# ─── Announcements ────────────────────────────────────────────────────────────


def announcements(limit: int = 30, force: bool = False) -> dict[str, Any]:
    """Official IDX announcements with attachment PDF links."""
    return idx.announcements(limit, force)
