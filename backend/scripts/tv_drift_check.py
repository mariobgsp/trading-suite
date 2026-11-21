"""TradingView drift check (dev-only, no prod dependency).

Compares the unofficial TradingView Indonesia scanner against nothing local:
it just dumps today's top movers + sector labels so a human can eyeball
whether movers.py / universe.py joins still line up after a TV column rename.

Usage:
    python -m backend.scripts.tv_drift_check [--limit 10]

Needs a paid TradingView plan only for the official MCP; this hits the same
public scanner endpoint the app already scrapes. Never call from request path
(rate-limited, beta, unauthenticated drift risk) — cron or manual only.
"""

from __future__ import annotations

import argparse
import json
import sys

import requests

SCAN_URL = "https://scanner.tradingview.com/indonesia/scan"
COLUMNS = ["name", "close", "change", "sector", "market_cap_basic"]


def fetch(columns: list[str] | None = None, limit: int = 50) -> list[dict]:
    payload = {"symbols": {"tickers": [], "query": {"types": []}}, "columns": columns or COLUMNS}
    resp = requests.post(SCAN_URL, json=payload, timeout=20)
    resp.raise_for_status()
    data = resp.json().get("data", [])
    return [
        {
            "symbol": row.get("s"),
            "values": {c: v for c, v in zip(columns or COLUMNS, row.get("d", []))},
        }
        for row in data[:limit]
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Dump TV Indonesia scan for drift eyeballing.")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    try:
        rows = fetch(limit=args.limit)
    except Exception as exc:  # noqa: BLE001 - dev script, print and exit
        print(f"tv_drift_check: fetch failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(rows, indent=2, ensure_ascii=False))
    print(
        f"\n# {len(rows)} rows. Compare sector/close against movers.py + overview/universe.py.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
