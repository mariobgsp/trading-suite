"""MSCI Indonesia Watch — constituents + live TradingView enrichment.

There is no free MSCI membership API: MSCI publishes quarterly review PDFs
only. This module keeps the current MSCI Indonesia constituents as a curated
table (sourced from the May/Nov index-review announcements and IDX press
releases) and enriches it with live price/sector/market-cap data from the
TradingView Indonesia scanner so the watchlist is useful without any paid
feed. Membership changes land in the table manually, twice a year, the same
cadence MSCI actually updates the index.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app import db
from app.movers import fetch_universe

# Curated MSCI Indonesia constituents (standard-index membership per the
# quarterly review announcements; float-adjusted caps move a handful in/out
# each review). Review and update this table at each MSCI index review
# (Feb/May/Aug/Nov).
MSCI_INDONESIA = [
    "AMMN",
    "ANTM",
    "ASII",
    "BBCA",
    "BBRI",
    "BBNI",
    "BMRI",
    "CPIN",
    "GOTO",
    "ICBP",
    "INDF",
    "ITMG",
    "KLBF",
    "MDKA",
    "MEDC",
    "PGAS",
    "PTBA",
    "SMGR",
    "TLKM",
    "TPIA",
    "UNTR",
    "ADRO",
    "BRPT",
    "AKRA",
]


def msci_watch(force: bool = False) -> dict[str, Any]:
    """MSCI constituents enriched with live TradingView data, ranked by cap."""
    cache_key = "msci:watch"
    if not force:
        cached = db.get_fresh(cache_key, 300)
        if cached is not None:
            return cached
    universe = fetch_universe(force=force)
    by_symbol = {r["symbol"]: r for r in universe}
    rows = []
    missing = []
    for sym in MSCI_INDONESIA:
        u = by_symbol.get(sym)
        if u is None:
            missing.append(sym)
            continue
        rows.append(
            {
                "ticker": sym,
                "name": u["name"],
                "sector": u["sector"],
                "price": u["price"],
                "change_percent": u["change_percent"],
                "market_cap": u["market_cap"],
                "volume": u["volume"],
            }
        )
    rows.sort(key=lambda r: r["market_cap"] or 0, reverse=True)
    payload = {
        "count": len(rows),
        "missing": missing,
        "as_of": datetime.now(UTC).isoformat(),
        "rows": rows,
    }
    db.set(cache_key, payload)
    return payload
