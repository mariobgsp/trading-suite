"""The regime work the study did after the shipped chain (docs/25, docs/26).

The plan's verdict is cut on three breadth bands. The rounds those bands came
from - rounds 28-30 of the study - then measured what, if anything, is tradable
inside each band: 1,060 bearish cells, 820 sideways cells and 1,007
institutional-activity cells, each carried unchanged to unseen folds, then
re-measured on quarterly windows and under the survivorship haircut.

This module reads those measurements so the app can show:

  * the measured 5-session forward drift inside each band, aggregated from the
    study's own 262k-row diagnostic (three_regime_diagnostic.csv) - the numbers
    the band decision is cut on, shown where the decision is made;
  * the holdout ledger (regime_holdout.csv) - what the best cell in each regime
    did on folds the search never saw;
  * the frozen replays (regime_forward.csv) and their quarterly stress
    (regime_quarterly.csv, quarterly_three_regime_screen.csv,
    survivorship_bound.csv);
  * the tier-3 capitulation sweep (three_regime_sweep_*.csv) - the only
    non-trending rule the study measured anywhere near the bar, and the stress
    that stopped it;
  * the institutional-flow verdict (flow_forward_trending.csv) - 23 indicators
    measured against breadth and found to lag it;
  * the exit census (exit_method_oos.csv) - every exit the app can switch to,
    with the study's pooled out-of-sample numbers.

Nothing here is invented: every number is read from the study's artifacts at
request time, or aggregated from them, and `test_plan_regimes.py` fails the
build when an artifact stops containing what the UI quotes.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from . import citations as C
from . import method as M

log = logging.getLogger(__name__)

RESULTS = M.DOCS_DIR / "results"

# -- artifact paths -------------------------------------------------------
THREE_REGIME_DIAGNOSTIC = RESULTS / "three_regime_diagnostic.csv"
REGIME_HOLDOUT = RESULTS / "regime_holdout.csv"
REGIME_FORWARD = RESULTS / "regime_forward.csv"
REGIME_QUARTERLY = RESULTS / "regime_quarterly.csv"
QUARTERLY_TIERS = RESULTS / "quarterly_three_regime_screen.csv"
SURVIVORSHIP = RESULTS / "survivorship_bound.csv"
SWEEP_SCREEN = RESULTS / "three_regime_sweep_screen_flat.csv"
SWEEP_CONTROL = RESULTS / "three_regime_sweep_control1b_flat.csv"
FLOW_FORWARD = RESULTS / "flow_forward_trending.csv"
EXIT_CENSUS = RESULTS / "exit_method_oos.csv"

TRENDING = "trending"
SIDEWAYS = "sideways"
CAPITULATION = "capitulation"


def band_of(breadth: float) -> str:
    """Which of the app's three bands a breadth reading is in."""
    if breadth >= M.BREADTH_TRENDING:
        return TRENDING
    if breadth < M.BREADTH_CAPITULATION:
        return CAPITULATION
    return SIDEWAYS


def _read(path: Path) -> pd.DataFrame | None:
    """One artifact, or None when the study does not carry it (yet)."""
    try:
        return pd.read_csv(path)
    except Exception as exc:  # noqa: BLE001 - a missing artifact must not 500
        log.warning("regimes: could not read %s: %s", path.name, exc)
        return None


def clear_cache() -> None:
    """Forget every read artifact, on the same schedule as the plan itself."""
    _drift.cache_clear()
    _holdout.cache_clear()
    _frozen_replays.cache_clear()
    _tiers.cache_clear()
    _flow.cache_clear()
    _exits.cache_clear()
    _cap_sweep.cache_clear()


@lru_cache(maxsize=1)
def _drift() -> dict[str, dict[str, float | int]] | None:
    """Aggregate the study's cross-sectional diagnostic into the app's bands.

    `three_regime_diagnostic.csv` is one row per (fold, session, breadth): the
    unconditional 5-session forward return of the tradable universe on that
    session, 262,163 rows. Aggregated here by the *app's* band edges (not the
    study's buckets), so the number on screen answers the question the app
    asks: "when breadth read like tonight, what did the next five sessions
    do?" - measured over every session the study screened.
    """
    frame = _read(THREE_REGIME_DIAGNOSTIC)
    if frame is None or frame.empty:
        return None
    if not {"fold", "breadth", "fwd5"}.issubset(frame.columns):
        return None
    out: dict[str, dict[str, float | int]] = {}
    for band in (TRENDING, SIDEWAYS, CAPITULATION):
        band_rows = frame[frame["breadth"].map(band_of) == band]
        out[band] = {
            "sessions": int(len(band_rows)),
            "folds": int(band_rows["fold"].nunique()) if "fold" in frame.columns else 0,
            "mean_drift_5s_pct": (
                float(band_rows["fwd5"].mean()) if not band_rows.empty else None
            ),
            "median_drift_5s_pct": (
                float(band_rows["fwd5"].median()) if not band_rows.empty else None
            ),
        }
    return out


def band_drift(band: str) -> dict[str, float | int] | None:
    """The measured drift of one band, or None when the study lacks it."""
    table = _drift()
    if not table:
        return None
    return table.get(band)


# -- the regime holdout (folds the search never saw) ----------------------
@lru_cache(maxsize=1)
def _holdout() -> dict[str, object] | None:
    """What the top 25 cells per regime did on unseen folds (regime_holdout.csv).

    The study ranked every cell on the search half (folds 0-2, trade-weighted
    pooling of runs.csv), then re-ran the top 25 unchanged on folds 3-5. The
    HOLDS flag is the study's own: a cell holds only if it still clears both
    bars there. For bear and sideways the searches cleared 0 of 1,060 and 0 of
    820 cells to begin with, so "False" is the whole story.
    """
    frame = _read(REGIME_HOLDOUT)
    if frame is None or frame.empty:
        return None
    if not {"regime", "HOLDS", "search_n", "hold_n"}.issubset(frame.columns):
        return None
    regimes: dict[str, object] = {}
    for token, label in (
        ("bear", "Bearish"),
        ("sideways", "Sideways"),
        ("institutional", "Institutional"),
    ):
        rows = frame[frame["regime"] == token]
        if rows.empty:
            continue
        holds = rows[rows["HOLDS"].astype(bool)]
        best = rows.sort_values("hold_avg", ascending=False).iloc[0]
        regimes[token] = {
            "label": label,
            "cells_tested": int(len(rows)),
            "holds": int(len(holds)),
            "best_hold": {
                "family": str(best["family"]),
                "side": str(best["side"]),
                "n": int(best["hold_n"]),
                "win_rate": float(best["hold_win"]),
                "avg_ret_pct": float(best["hold_avg"]),
                "folds": int(best["hold_folds"]),
            },
            "hold_win_rate_lo": (
                float(best["hold_wr_lo"]) if "hold_wr_lo" in frame.columns else None
            ),
        }
    return {"regimes": regimes, "source": REGIME_HOLDOUT.name}


# -- the frozen replays and their stress ----------------------------------
@lru_cache(maxsize=1)
def _frozen_replays() -> dict[str, object] | None:
    """The frozen rank-1 spec per regime, projected and stressed.

    regime_forward.csv is the full-history projection (book total, CAGR, max
    drawdown) plus the same spec's win rate and average under the survivorship
    haircut. regime_quarterly.csv re-measures each frozen spec on 12 three-month
    windows with per-window range and the survivorship-corrected row. The study
    reports both, so the two are shown side by side: a replay that dies under
    either stress is not a strategy.
    """
    frame = _read(REGIME_FORWARD)
    if frame is None or frame.empty:
        return None
    rows: dict[str, object] = {}
    for _, r in frame.iterrows():
        token = str(r["regime"])
        rows[token] = {
            "family": str(r["family"]),
            "side": str(r["side"]),
            "trades": int(r["trades"]),
            "win_rate": float(r["win"]),
            "avg_ret_pct": float(r["avg"]),
            "book_total_pct": float(r["book_total"]),
            "book_cagr_pct": float(r["book_cagr"]),
            "book_max_dd_pct": float(r["book_maxdd"]),
            "survivorship_win_rate": float(r["surv_win"]),
            "survivorship_avg_ret_pct": float(r["surv_avg"]),
            "cost": str(r["cost"]),
        }
    quarterly = _read(REGIME_QUARTERLY)
    quarterly_rows: dict[str, object] = {}
    if quarterly is not None and not quarterly.empty:
        for _, r in quarterly.iterrows():
            token = str(r["regime"])
            quarterly_rows[token] = {
                "n": int(r["n"]),
                "win_rate": float(r["win"]),
                "avg_ret_pct": float(r["avg"]),
                "profit_factor": float(r["pf"]),
                "windows": int(r["windows"]),
                "win_rate_range": str(r["win_range"]),
                "losing_windows": int(r["losing"]),
                "survivorship_win_rate": float(r["surv_win"]),
                "survivorship_avg_ret_pct": float(r["surv_avg"]),
                "survivorship_n": int(r["surv_n"]),
            }
    return {
        "replays": rows,
        "quarterly": quarterly_rows,
        "source": REGIME_FORWARD.name,
        "quarterly_source": REGIME_QUARTERLY.name,
    }
# -- the three tiers, semi-annual vs quarterly vs survivorship ------------
@lru_cache(maxsize=1)
def _tiers() -> dict[str, object] | None:
    """Tiers 1-3 across the study's three lenses.

    Tier 1 is the shipped chain; tier 2 is the same rules forced to trade the
    sideways band; tier 3 is the capitulation bounce of docs/20 sec 7-8. The
    survivorship rows come from survivorship_bound.csv (full / survivorship /
    trend-folds-only / both), the quarterly rows from
    quarterly_three_regime_screen.csv. Showing tier 2 and tier 3 beside tier 1
    is what makes "flat" and "watch" read as measured decisions, not gaps.
    """
    survivorship = _read(SURVIVORSHIP)
    if survivorship is None or survivorship.empty:
        return None
    tiers: dict[str, object] = {}
    for tier in ("tier1", "tier2", "tier3"):
        rows = survivorship[survivorship["cell"] == tier]
        if rows.empty:
            continue
        by_bound = {}
        for _, r in rows.iterrows():
            by_bound[str(r["bound"])] = {
                "n": int(r["n"]),
                "tickers": int(r["tickers"]),
                "win_rate": float(r["win_rate"]),
                "avg_ret_pct": float(r["avg_ret"]),
                "profit_factor": float(r["profit_factor"]),
            }
        tiers[tier] = {"bounds": by_bound}
    quarterly = _read(QUARTERLY_TIERS)
    if quarterly is not None and not quarterly.empty:
        for _, r in quarterly.iterrows():
            name = "tier" + str(int(r["tier"]))
            if name in tiers:
                tiers[name]["quarterly"] = {
                    "n": int(r["n"]),
                    "win_rate": float(r["win"]),
                    "avg_ret_pct": float(r["avg"]),
                    "profit_factor": float(r["pf"]),
                    "folds": int(r["folds"]),
                }
    return {
        "tiers": tiers,
        "source": SURVIVORSHIP.name,
        "quarterly_source": QUARTERLY_TIERS.name,
    }


# -- the tier-3 sweep, the only lead near the bar --------------------------
@lru_cache(maxsize=1)
def _cap_sweep() -> dict[str, object] | None:
    """The tier-3 capitulation sweep (three_regime_sweep_*_flat.csv).

    Six two-tier configs over (cap_rsi2, cap_flush, cap_atr_stop), measured on
    the illiquid universe and the liquid control. The champion the study quotes
    is cfg 6: rsi2 <= 30, a 5-session flush of at least 5%, and an ATR-scaled
    stop. Every config's HIT flag is False - none cleared 80%/+5%, which is why
    this is a watch and not a ticket.
    """
    screen = _read(SWEEP_SCREEN)
    control = _read(SWEEP_CONTROL)
    if screen is None or screen.empty or control is None or control.empty:
        return None
    needed = {"cfg", "cap_rsi2", "cap_flush", "cap_atr_stop",
              "t3_n", "t3_win", "t3_avg", "t3_folds", "HIT"}
    if not needed.issubset(screen.columns):
        return None

    def _row(frame: pd.DataFrame) -> dict[str, object] | None:
        champion = frame[frame["cfg"] == 6]
        if champion.empty:
            return None
        r = champion.iloc[0]
        return {
            "cap_rsi2": float(r["cap_rsi2"]),
            "cap_flush_pct": float(r["cap_flush"]),
            "cap_atr_stop": bool(r["cap_atr_stop"]),
            "t3_n": int(r["t3_n"]),
            "t3_win_rate": float(r["t3_win"]),
            "t3_avg_ret_pct": float(r["t3_avg"]),
            "t3_folds": int(r["t3_folds"]),
            "hit": bool(r["HIT"]),
        }

    return {
        "illiquid": _row(screen),
        "liquid_control": _row(control),
        "configs": int(len(screen)),
        "source": SWEEP_SCREEN.name,
    }


# -- the flow verdict -----------------------------------------------------
@lru_cache(maxsize=1)
def _flow() -> dict[str, object] | None:
    """The forward-AUC census of the flow indicators against breadth.

    flow_forward_trending.csv measures each indicator's split-half AUC for the
    next session's direction. Every row carries its own two-half reading; this
    returns breadth's row, the best flow row, and how many indicators agree
    across halves. The study's verdict - volume flow lags price breadth - is
    carried by the numbers, not asserted here: if a flow indicator ever
    out-measures breadth, this block says so.
    """
    frame = _read(FLOW_FORWARD)
    if frame is None or frame.empty:
        return None
    if not {"indicator", "auc_full"}.issubset(frame.columns):
        return None
    rows = frame.sort_values("auc_full", ascending=False)
    breadth = rows[rows["indicator"] == "breadth"]
    if breadth.empty:
        return None
    breadth_auc = float(breadth.iloc[0]["auc_full"])
    best_flow = rows[rows["indicator"] != "breadth"].iloc[0]
    stable = (
        float(rows["stable"].astype(bool).mean()) if "stable" in frame.columns else None
    )
    return {
        "breadth_auc": breadth_auc,
        "best_flow": {
            "indicator": str(best_flow["indicator"]),
            "auc": float(best_flow["auc_full"]),
        },
        "indicators": int(len(rows) - 1),
        "stable_share": stable,
        "breadth_leads": bool(breadth_auc > float(best_flow["auc_full"])),
        "source": FLOW_FORWARD.name,
    }


# -- the exit census ------------------------------------------------------
@lru_cache(maxsize=1)
def _exits() -> dict[str, object] | None:
    """Every exit the app can switch to, with the study's pooled numbers.

    exit_method_oos.csv pools the out-of-sample trades of each exit method
    across the grid's entries. The rows the app's switch can actually quote are
    the ones the study measured; the app never totals a pool it did not measure.
    """
    frame = _read(EXIT_CENSUS)
    if frame is None or frame.empty:
        return None
    if not {"exit_method", "trades", "win_rate", "avg_ret_pct"}.issubset(frame.columns):
        return None
    rows = frame.sort_values("trades", ascending=False)
    return {
        "exits": [
            {
                "exit_method": str(r["exit_method"]),
                "target_pct": float(r["tp_pct"]) if "tp_pct" in frame.columns else None,
                "stop_pct": float(r["sl_pct"]) if "sl_pct" in frame.columns else None,
                "hold": int(r["hold"]) if "hold" in frame.columns else None,
                "shape": str(r["shape"]) if "shape" in frame.columns else None,
                "trades": int(r["trades"]),
                "win_rate": float(r["win_rate"]),
                "avg_ret_pct": float(r["avg_ret_pct"]),
                "median_ret_pct": (
                    float(r["median_ret_pct"]) if "median_ret_pct" in frame.columns else None
                ),
            }
            for _, r in rows.iterrows()
        ],
        "source": EXIT_CENSUS.name,
    }


# -- the one card the Method page shows -----------------------------------
def card() -> dict[str, object]:
    """Everything the app knows about the three regimes, as one object.

    Every block is None when the study does not carry the artifact, so a study
    round that stops writing one of these files degrades a section rather than
    breaking the page.
    """
    return {
        "bands": _drift(),
        # The bands table is a session-weighted aggregate of the study's own
        # diagnostic on the app's band edges. The study's prose table (docs/24)
        # quotes +0.77% / +0.14% / +2.11% for the same three bands from its own
        # sample, so the two can differ by a few tenths. Both are measurements;
        # the note is here so a reader who sees both numbers knows why.
        "bands_note": (
            "Session-weighted aggregate of results/three_regime_diagnostic.csv "
            "on the app's band edges. The study's prose table quotes +0.77% / "
            "+0.14% / +2.11% for the same bands from its own sample; the "
            "capitulation line matches exactly."
        ),
        "holdout": _holdout(),
        "replays": _frozen_replays(),
        "tiers": _tiers(),
        "cap_sweep": _cap_sweep(),
        "flow": _flow(),
        "exits": _exits(),
    }


# -- the evidence that travels with a capitulation watch -----------------
def capitulation_evidence() -> dict[str, object] | None:
    """The measured case for watching (never trading) tier-3 names.

    Built from the sweep, the tier bounds and the quarterly stress, so the
    panel's caveat is the study's own table rather than a paraphrase: the
    sweep's 79.4%/+7.3% on 131 illiquid trades, the same rule at 72.0%/+3.4%
    on the liquid control, the tier's full-pool 73.9%/+3.6%, and the quarterly
    windows where it reads 60.5%/+2.8%. The lead survives none of them.
    """
    sweep = _cap_sweep()
    tiers = _tiers()
    if sweep is None or tiers is None:
        return None
    tier = tiers["tiers"].get("tier3", {})
    bounds = tier.get("bounds", {})
    quarterly = tier.get("quarterly")
    return {
        "sweep": sweep,
        # The clean-universe re-measurement (docs/21), read through the app's own
        # citation layer: after the price-frozen repair the bounce reads
        # 53.15% / +0.15% - the study abandoned the tier on the clean universe.
        "clean_universe": {
            "win_rate": C.value("capitulation_win_rate"),
            "avg_ret_pct": C.value("capitulation_avg_ret_pct"),
        },
        "semi_annual": {
            "n": bounds.get("full", {}).get("n"),
            "win_rate": bounds.get("full", {}).get("win_rate"),
            "avg_ret_pct": bounds.get("full", {}).get("avg_ret_pct"),
            "survivorship_win_rate": bounds.get("survivorship", {}).get("win_rate"),
            "survivorship_avg_ret_pct": bounds.get("survivorship", {}).get("avg_ret_pct"),
        },
        "quarterly": quarterly,
        "lead_not_result": True,
        "why": (
            "The tier-3 bounce is the only non-trending rule the study measured "
            "anywhere near the bar, and none of its cells cleared 80%/+5% (every "
            "sweep config's HIT flag is False). Its apparent edge on semi-annual "
            "folds fell apart on quarterly windows and under the survivorship "
            "haircut, so the app carries it as a watch with its failures attached "
            "- never as a ticket.",
        ),
    }


__all__ = [
    "CAPITULATION",
    "RESULTS",
    "SIDEWAYS",
    "SWEEP_CONTROL",
    "SWEEP_SCREEN",
    "THREE_REGIME_DIAGNOSTIC",
    "TRENDING",
    "band_drift",
    "band_of",
    "capitulation_evidence",
    "card",
    "clear_cache",
]
