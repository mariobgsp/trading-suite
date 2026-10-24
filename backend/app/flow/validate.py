"""Accuracy protocol for the Flow proxy.

Accuracy is not a property of a line; it is a property of a rule, a horizon, a
universe and a cost model. This module therefore reports the pieces separately:

    direction hit rate   sign(proxy slope) vs sign(forward return)
    AUC                  proxy slope vs up/down forward return
    baseline             the same test on plain 5-day price momentum
    cross-section        rank IC and top-minus-bottom spread across names
    vendor parity        only when the user supplies a licensed CSV

It does not certify "same accuracy" as Bandarmetrics. It makes the proxy's own
record visible, with sample sizes and warnings.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.flow import cache as flow_cache
from app.flow import lpm as L
from app.flow import sources
from app.flow import technicals as T

LOOKBACK = 5
MAX_TICKERS = 30
VENDOR_ENV = "FLOW_VENDOR_CSV"


def _wilson(correct: int, n: int) -> tuple[float | None, float | None]:
    if n <= 0:
        return None, None
    p = correct / n
    z = 1.96
    denom = 1.0 + z * z / n
    centre = (p + z * z / (2.0 * n)) / denom
    margin = z * math.sqrt((p * (1.0 - p) + z * z / (4.0 * n)) / n) / denom
    return round(max(0.0, centre - margin) * 100.0, 2), round(min(1.0, centre + margin) * 100.0, 2)


def _auc(scores: list[float], labels: list[int]) -> float | None:
    """Rank-based AUC with average ranks for ties. No sklearn dependency."""
    pairs = [
        (float(score), int(label))
        for score, label in zip(scores, labels)
        if score is not None and math.isfinite(float(score))
    ]
    if not pairs:
        return None
    n_pos = sum(1 for _, label in pairs if label == 1)
    n_neg = sum(1 for _, label in pairs if label == 0)
    if n_pos == 0 or n_neg == 0:
        return None
    order = sorted(range(len(pairs)), key=lambda i: pairs[i][0])
    ranks = [0.0] * len(pairs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and pairs[order[j + 1]][0] == pairs[order[i]][0]:
            j += 1
        average_rank = (i + j + 2) / 2.0  # 1-based ranks
        for k in range(i, j + 1):
            ranks[order[k]] = average_rank
        i = j + 1
    rank_sum_pos = sum(ranks[i] for i, (_, label) in enumerate(pairs) if label == 1)
    return round((rank_sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg), 4)


def _hit(predicted: list[float], actual: list[float]) -> dict[str, Any]:
    pairs = [
        (int(np.sign(p)), int(np.sign(a)))
        for p, a in zip(predicted, actual)
        if p is not None and a is not None and math.isfinite(float(p)) and math.isfinite(float(a))
        and int(np.sign(p)) != 0
        and int(np.sign(a)) != 0
    ]
    n = len(pairs)
    if n == 0:
        return {"n": 0, "correct": 0, "hit_rate_pct": None, "wilson_low_pct": None, "wilson_high_pct": None}
    correct = sum(1 for p, a in pairs if p == a)
    low, high = _wilson(correct, n)
    return {
        "n": n,
        "correct": correct,
        "hit_rate_pct": round(correct / n * 100.0, 2),
        "wilson_low_pct": low,
        "wilson_high_pct": high,
    }


def evaluate_frame(frame: pd.DataFrame, horizon: int = 5) -> pd.DataFrame:
    """One ticker's observations: proxy signal, forward return, momentum baseline."""
    if frame is None or frame.empty:
        return pd.DataFrame()
    out = frame.copy()
    close = pd.to_numeric(out["Close"], errors="coerce")
    out["fwd"] = close.shift(-horizon) / close - 1.0
    out["signal"] = out["lpm_score"].diff(LOOKBACK)
    out["momentum"] = close / close.shift(LOOKBACK) - 1.0
    out["date"] = pd.to_datetime(out.index)
    return out[["date", "lpm_score", "signal", "fwd", "momentum"]]


def _metrics(obs: pd.DataFrame) -> dict[str, Any]:
    clean = obs.dropna(subset=["signal", "fwd"])
    if clean.empty:
        return {
            "n": 0,
            "hit": _hit([], []),
            "auc": None,
            "baseline": _hit([], []),
            "baseline_auc": None,
        }
    signal = clean["signal"].tolist()
    fwd = clean["fwd"].tolist()
    labels = [1 if value > 0 else 0 for value in fwd]
    momentum = clean["momentum"].tolist()
    return {
        "n": len(clean),
        "hit": _hit(signal, fwd),
        "auc": _auc(signal, labels),
        "baseline": _hit(momentum, fwd),
        "baseline_auc": _auc(momentum, labels),
    }


def _by_year(obs: pd.DataFrame) -> dict[str, Any]:
    if obs.empty:
        return {}
    work = obs.dropna(subset=["signal", "fwd"]).copy()
    work["year"] = pd.to_datetime(work["date"]).dt.year
    out: dict[str, Any] = {}
    for year, group in work.groupby("year"):
        metrics = _metrics(group)
        if metrics["n"]:
            out[str(year)] = {
                "n": metrics["n"],
                "hit_rate_pct": metrics["hit"]["hit_rate_pct"],
                "auc": metrics["auc"],
            }
    return out


def _cross_section(observations: list[pd.DataFrame]) -> dict[str, Any]:
    if not observations:
        return {"available": False}
    rows = []
    for obs in observations:
        if obs.empty:
            continue
        work = obs.dropna(subset=["signal", "fwd"]).copy()
        if work.empty:
            continue
        rows.append(work[["date", "signal", "fwd"]])
    if not rows:
        return {"available": False}
    pooled = pd.concat(rows, ignore_index=True)
    ics: list[float] = []
    spreads: list[float] = []
    for _, group in pooled.groupby("date"):
        if len(group) < 5 or group["signal"].nunique() < 2:
            continue
        ic = group["signal"].corr(group["fwd"], method="spearman")
        if ic is not None and math.isfinite(float(ic)):
            ics.append(float(ic))
        ranked = group.sort_values("signal")
        cut = max(1, int(len(ranked) * 0.2))
        top = ranked.tail(cut)["fwd"].mean()
        bottom = ranked.head(cut)["fwd"].mean()
        if pd.notna(top) and pd.notna(bottom):
            spreads.append(float(top - bottom) * 100.0)
    if not ics:
        return {"available": False, "n_dates": 0}
    return {
        "available": True,
        "n_dates": len(ics),
        "mean_rank_ic": round(float(np.mean(ics)), 4),
        "mean_top_bottom_pct": round(float(np.mean(spreads)), 3) if spreads else None,
    }


def _vendor_parity(observations: list[pd.DataFrame]) -> dict[str, Any]:
    path = os.getenv(VENDOR_ENV, "").strip()
    if not path:
        return {"available": False, "reason": f"{VENDOR_ENV} is not set"}
    file = Path(path).expanduser()
    if not file.exists():
        return {"available": False, "reason": f"vendor CSV not found: {file}"}
    try:
        vendor = pd.read_csv(file)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"could not read vendor CSV: {exc}"}
    vendor.columns = [str(c).strip().lower() for c in vendor.columns]
    required = {"date", "ticker", "lpm"}
    if not required.issubset(vendor.columns):
        return {
            "available": False,
            "reason": "vendor CSV must have date,ticker,lpm columns",
        }
    vendor["date"] = pd.to_datetime(vendor["date"], errors="coerce")
    vendor["ticker"] = vendor["ticker"].astype(str).str.upper().str.strip()
    vendor["vendor_lpm"] = pd.to_numeric(vendor["lpm"], errors="coerce")
    vendor = vendor.dropna(subset=["date", "ticker", "vendor_lpm"])

    rows = []
    for obs in observations:
        if obs.empty:
            continue
        work = obs.dropna(subset=["lpm_score"]).copy()
        if work.empty:
            continue
        if "ticker" not in work.columns:
            work["ticker"] = str(work.attrs.get("ticker") or "")
        rows.append(work[["date", "ticker", "lpm_score"]])
    if not rows:
        return {"available": False, "reason": "no proxy observations"}
    proxy = pd.concat(rows, ignore_index=True)
    merged = proxy.merge(vendor[["date", "ticker", "vendor_lpm"]], on=["date", "ticker"], how="inner")
    if merged.empty:
        return {"available": True, "sample": 0, "reason": "no overlapping date/ticker rows"}
    if merged["vendor_lpm"].nunique() < 2 or merged["lpm_score"].nunique() < 2:
        return {"available": True, "sample": len(merged), "reason": "constant series; parity undefined"}
    spearman = merged["lpm_score"].corr(merged["vendor_lpm"], method="spearman")
    raw_mae = (merged["lpm_score"] - merged["vendor_lpm"]).abs().mean()

    def _norm(s: pd.Series) -> pd.Series:
        span = s.max() - s.min()
        return (s - s.min()) / span if span else s * 0.0

    norm_mae = (_norm(merged["lpm_score"]) - _norm(merged["vendor_lpm"])).abs().mean()
    ordered = merged.sort_values(["ticker", "date"]).copy()
    ordered["proxy_diff"] = ordered.groupby("ticker")["lpm_score"].diff()
    ordered["vendor_diff"] = ordered.groupby("ticker")["vendor_lpm"].diff()
    comparable = ordered.dropna(subset=["proxy_diff", "vendor_diff"])
    sign_agreement = (
        np.sign(comparable["proxy_diff"]) == np.sign(comparable["vendor_diff"])
    ).mean() if not comparable.empty else None
    return {
        "available": True,
        "sample": len(merged),
        "spearman": round(float(spearman), 4) if pd.notna(spearman) else None,
        "mae_raw": round(float(raw_mae), 4),
        "mae_normalized": round(float(norm_mae), 4),
        "sign_agreement_pct": round(float(sign_agreement) * 100.0, 2) if pd.notna(sign_agreement) else None,
        "note": "Vendor LPM scale may differ; compare spearman and normalized MAE first.",
    }


def _canonical(tickers: list[str] | str) -> list[str]:
    if isinstance(tickers, str):
        tickers = tickers.split(",")
    codes: list[str] = []
    for raw in tickers or []:
        code = str(raw or "").upper().strip().replace(".JK", "")
        if code and code not in codes:
            codes.append(code)
    return codes[:MAX_TICKERS]


def validate(
    tickers: list[str] | str,
    horizon: int = 5,
    days: int = 250,
    source: str = "auto",
    refresh: bool = False,
) -> dict[str, Any]:
    """Run the accuracy report for one or more names, cached in SQLite.

    Historical IDX foreign flow is not available, so the default report measures
    the CMF-driven proxy. Stockbit broker history can be used explicitly for the
    recent window; it is slower and still not the vendor formula.
    """
    codes = _canonical(tickers)
    if not codes:
        return {"available": False, "error": "no tickers supplied"}
    chosen = source if source in {"auto", "idx", "stockbit", "ohlcv"} else "auto"
    key = flow_cache.make_key("validate", ",".join(codes), horizon, days, chosen)
    payload, meta = flow_cache.get_or_compute(
        key,
        lambda: _validate_impl(codes, horizon, days, chosen),
        ttl=flow_cache.VALIDATE_TTL,
        refresh=refresh,
    )
    payload["cache"] = meta.as_dict()
    if meta.warning:
        payload.setdefault("warnings", []).append(meta.warning)
    return payload


def _validate_impl(
    codes: list[str],
    horizon: int,
    days: int,
    source: str,
) -> dict[str, Any]:
    """The uncached report implementation."""
    if isinstance(codes, str):
        codes = codes.split(",")

    h = max(1, min(20, int(horizon or 5)))
    window = max(60, min(250, int(days or 250)))
    chosen = source if source in {"auto", "idx", "stockbit", "ohlcv"} else "auto"
    observations: list[pd.DataFrame] = []
    per_ticker: dict[str, Any] = {}
    warnings: list[str] = []

    for code in codes:
        df = sources.bars(code)
        if df is None or len(df) < 60:
            warnings.append(f"{code}: not enough history")
            continue
        frame = T.compute(df)
        broker = None
        if chosen == "stockbit":
            broker, broker_meta = sources.broker_series(code, days=min(window, 90))
            if broker is None:
                warnings.append(f"{code}: {broker_meta.get('warning')}")
        frame, flow_meta = L.score_frame(frame, broker_net_lots=broker)
        obs = evaluate_frame(frame.tail(window), h)
        if obs.empty:
            warnings.append(f"{code}: no evaluable bars")
            continue
        obs.attrs["ticker"] = code
        obs["ticker"] = code
        observations.append(obs)
        metrics = _metrics(obs)
        per_ticker[code] = {
            "n": metrics["n"],
            "hit_rate_pct": metrics["hit"]["hit_rate_pct"],
            "auc": metrics["auc"],
            "baseline_hit_rate_pct": metrics["baseline"]["hit_rate_pct"],
            "source": flow_meta.get("source"),
        }

    if not observations:
        return {
            "available": False,
            "error": "no evaluable observations",
            "warnings": warnings,
        }

    pooled = pd.concat(observations, ignore_index=True)
    metrics = _metrics(pooled)
    warnings.append(
        "Historical IDX foreign flow is not available; this report measures the CMF-driven proxy."
    )
    warnings.append(
        "A proxy score is not the vendor LPM. Use FLOW_VENDOR_CSV to compare against a licensed sample."
    )
    vendor = _vendor_parity(observations)
    return {
        "available": True,
        "tickers": codes,
        "horizon": h,
        "days": window,
        "source": "stockbit_broker+cmf" if chosen == "stockbit" else "ohlcv+cmf",
        "quality": "proxy",
        "n": metrics["n"],
        "hit_rate_pct": metrics["hit"]["hit_rate_pct"],
        "hit_wilson_low_pct": metrics["hit"]["wilson_low_pct"],
        "hit_wilson_high_pct": metrics["hit"]["wilson_high_pct"],
        "auc": metrics["auc"],
        "baseline_hit_rate_pct": metrics["baseline"]["hit_rate_pct"],
        "baseline_auc": metrics["baseline_auc"],
        "by_year": _by_year(pooled),
        "cross_section": _cross_section(observations),
        "per_ticker": per_ticker,
        "vendor_parity": vendor,
        "warnings": warnings,
    }
