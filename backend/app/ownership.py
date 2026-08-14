"""Ownership & disclosures — shareholder structure from IDX directly.

IDX's GetCompanyProfilesDetail returns PemegangSaham[] (name, shares,
percentage, category, controlling flag) plus board and subsidiary data for
every listed issuer, with no auth — it is the official source that Stockbit's
emiten info was mirroring. Access goes through `app.idx` (curl_cffi Chrome
impersonation) because the /primary endpoints sit behind Cloudflare
fingerprinting. No fabricated ownership data: if IDX is unreachable the page
says so.
"""

from __future__ import annotations

import logging
from typing import Any

from app import idx

logger = logging.getLogger(__name__)


def stockbit_available() -> bool:
    """Deprecated gate — IDX is the source. Kept for router compat."""
    return True


def ownership_structure(ticker: str, force: bool = False) -> dict[str, Any]:
    """Shareholder / board structure for a ticker from IDX company profiles."""
    return idx.ownership_structure(ticker, force)


def ownership_history(ticker: str) -> dict[str, Any]:
    """Ownership-change history: snapshots + latest period-over-period diff."""
    return idx.ownership_history(ticker)
