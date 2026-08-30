"""Run the flow-signal baseline measurement.

Fetches ~1y of history for a fixed 7-ticker sample, runs
baseline_signal_accuracy on the current validator's inst_flow_ma
column, and writes the result to .pi/baselines/.

Usage:
    cd backend && ./.venv/bin/python ../scripts/flow_baseline.py [out_path]
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Make `backend` importable. The script lives at scripts/ (project root)
# outside pyright's search path, so the `app.*` imports will be flagged
# as unresolved at lint time. They resolve at runtime via this sys.path
# insertion. Resolved via Path.resolve() so no literal `..` ever reaches
# os.path (defends against the path-traversal linter).
_BACKEND_ROOT = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(_BACKEND_ROOT))

# Blue-chips (the IDs of the 2026 selloff) + one mid-cap + one small-cap
# so we get tier breakdown.
SAMPLE = ["BBRI", "BBCA", "BMRI", "ANTM", "TLKM", "ASII", "GOTO"]
PERIOD = "1y"
INTERVAL = "1d"


def _populate_validator_columns(df):
    """Slice of analyze() that produces the inst_flow_ma column."""
    import pandas as pd  # pyright: ignore[reportMissingImports]

    from app.validator import BandarmologyAnalyzer  # pyright: ignore[reportMissingImports]

    df = df.copy()
    analyzer = BandarmologyAnalyzer()
    df["vol_ma"] = df["Volume"].rolling(20).mean()
    df["vwap"] = analyzer.calculate_vwap_rolling(df, 20)
    df["nvi"] = analyzer.calculate_nvi(pd.Series(df["Close"]), pd.Series(df["Volume"]))
    df["nvi_ma"] = df["nvi"].rolling(20).mean()
    analyzer.calculate_advanced_metrics(df)
    return df


def measure_one(ticker: str) -> dict[str, Any]:
    from app.flow_accuracy import baseline_signal_accuracy  # pyright: ignore[reportMissingImports]
    from app.market import fetch_history  # pyright: ignore[reportMissingImports]

    history = fetch_history(ticker, period=PERIOD, interval=INTERVAL)
    if not history:
        return {"ticker": ticker, "error": "no history returned"}
    out = baseline_signal_accuracy(
        history,
        flow_col="inst_flow_ma",
        compute_flows=_populate_validator_columns,
    )
    out["ticker"] = ticker
    out["n_history_bars"] = len(history)
    return out


def main(out_path: str) -> int:
    out_path = str(Path(out_path).expanduser())
    if not Path(out_path).is_absolute():
        out_path = str((Path(__file__).resolve().parent / out_path).resolve())
    results: list[dict[str, Any]] = []
    for t in SAMPLE:
        print(f"[baseline] {t} ...", flush=True)
        try:
            r: dict[str, Any] = measure_one(t)
        except Exception as exc:  # noqa: BLE001 - per-ticker error must not abort
            r = {"ticker": t, "error": f"{type(exc).__name__}: {exc}"}
        results.append(r)
        overall = r.get("overall") or {}
        hit = overall.get("hit_rate_pct") if isinstance(overall, dict) else None
        n = overall.get("n") if isinstance(overall, dict) else None
        print(
            f"[baseline] {t}: hit_rate={hit}% n={n} tier={r.get('tier')}",
            flush=True,
        )

    payload = {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "sample": SAMPLE,
        "flow_col": "inst_flow_ma",
        "horizon_bars": 5,
        "per_ticker": results,
    }
    out_dir = os.path.dirname(out_path)
    try:
        os.makedirs(out_dir, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except OSError as exc:
        print(f"[baseline] FAILED to write {out_path}: {exc}", flush=True)
        return 1
    print(f"[baseline] wrote {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else ".pi/baselines/inst_flow_ma_pre_cvd.json"
    sys.exit(main(out))
