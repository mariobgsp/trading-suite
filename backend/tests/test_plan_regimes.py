"""The regime layer (docs/25, docs/26) is evidence, so it is under test.

The app's verdict is cut on three breadth bands. The rounds those bands came
from then measured what is tradable inside each band - bearish, sideways and
institutional-activity searches, capitulation sweeps, frozen replays, flow
and exit censuses - and refused nearly all of it. This module guards that
measurement the same way `test_plan_citations.py` guards the prose: the UI
quotes a number, so the artifact that carries it is checked on every run.
A study round that rewrites an artifact fails here until the app is updated
to say what the study now says.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
import pytest

from app.plan import method as M
from app.plan import plan
from app.plan import regimes as R
from app.plan import screen as S
from app.plan.bars import StudyBars

RESULTS = M.DOCS_DIR / "results"

pytestmark = pytest.mark.skipif(
    not RESULTS.exists(),
    reason=f"study results not found under {M.DOCS_DIR}; set TRADING_DOCS_DIR to enable",
)


# ------------------------------------------------------------------ drifts
def test_band_of_is_the_app_band_edges():
    assert R.band_of(0.24) == "capitulation"
    assert R.band_of(0.25) == "sideways"
    assert R.band_of(0.59) == "sideways"
    assert R.band_of(0.60) == "trending"


def test_drift_bands_cover_the_diagnostic_rows():
    """Every readable row of the 262k-row diagnostic belongs to exactly one band."""
    frame = pd.read_csv(R.THREE_REGIME_DIAGNOSTIC)
    assert frame["breadth"].notna().all(), "the diagnostic carries NaN breadth rows"
    drifts = R._drift()
    assert drifts is not None
    total = sum(int(drifts[b]["sessions"]) for b in ("trending", "sideways", "capitulation"))
    assert total == len(frame), f"{total} rows bucketed, {len(frame)} in the file"
    for band in ("trending", "sideways", "capitulation"):
        row = drifts[band]
        assert row["sessions"] > 0, f"{band} has no sessions"
        assert np.isfinite(row["mean_drift_5s_pct"]), f"{band} drift is not finite"


def test_drift_says_what_the_study_said():
    """The three bands must keep the measured order: capitulation positive and
    the highest, trending positive, sideways about zero.

    These are the numbers the band decision is cut on (docs/25): +2.109%,
    ~0 and +0.6..+0.8%. If the aggregation ever starts disagreeing with the
    study's own measurement of the same rows, something in the band edges or
    the aggregation moved, and the verdict would be lying about its basis.
    """
    drifts = R._drift()
    cap = float(drifts["capitulation"]["mean_drift_5s_pct"])
    flat = float(drifts["sideways"]["mean_drift_5s_pct"])
    trend = float(drifts["trending"]["mean_drift_5s_pct"])
    assert cap > 0.0, f"capitulation drift {cap} is not positive"
    assert trend > 0.0, f"trending drift {trend} is not positive"
    assert abs(flat) < 0.5, f"sideways drift {flat} is not about zero"
    assert cap > trend, f"capitulation {cap} should out-drift trending {trend}"


# ------------------------------------------------------------ holdout
def test_regime_holdout_survivors_are_counted():
    """The top-25 ledger per regime must carry a HOLDS verdict for every row."""
    holdout = R._holdout()
    assert holdout is not None
    regimes = holdout["regimes"]
    assert set(regimes) == {"bear", "sideways", "institutional"}
    for token, block in regimes.items():
        assert block["cells_tested"] >= 20, f"{token}: only {block['cells_tested']} cells"


def test_no_regime_cell_survived_the_holdout():
    """0 of 25 held in each regime (docs/25). If a future round changes that,
    the app's "watch, never trade" framing must be revisited here first.
    """
    holdout = R._holdout()
    for token, block in holdout["regimes"].items():
        assert block["holds"] == 0, f"{token}: {block['holds']} cells HOLDS=True"

# -------------------------------------------------- frozen replays
def test_frozen_replays_survive_nowhere():
    """Every frozen replay turns negative under the survivorship haircut."""
    replays = R._frozen_replays()
    assert replays is not None
    assert set(replays["replays"]) == {"bear", "sideways", "institutional"}
    for token, row in replays["replays"].items():
        assert row["survivorship_avg_ret_pct"] < 0.0, f"{token} survives the haircut"
        assert row["survivorship_avg_ret_pct"] < row["avg_ret_pct"]
        assert row["survivorship_win_rate"] < row["win_rate"]
    # The quarterly stress must exist and must have losing windows.
    for token, row in replays["quarterly"].items():
        assert row["losing_windows"] >= 1, f"{token}: no losing quarterly window"
        assert row["win_rate"] < 0.80, "a frozen regime cell clears the bar quarterly"


# ------------------------------------------------------------- tiers
def test_tiers_carry_all_three_lenses():
    """Tier 1-3 with their bound tables, and their quarterly rows."""
    tiers = R._tiers()
    assert tiers is not None
    assert set(tiers["tiers"]) == {"tier1", "tier2", "tier3"}
    for name in ("tier1", "tier2", "tier3"):
        bounds = tiers["tiers"][name]["bounds"]
        assert "full" in bounds and "survivorship" in bounds


def test_survivorship_only_ever_reduces_a_tier():
    """Within a tier, the survivorship bound must never beat the full panel.

    The `both` bound also restricts to trend folds, which changes the population
    rather than stressing it, so it is not compared here.
    """
    tiers = R._tiers()
    for name, block in tiers["tiers"].items():
        bounds = block["bounds"]
        full = bounds["full"]
        for stressed in ("survivorship",):
            row = bounds.get(stressed)
            if not row:
                continue
            assert row["avg_ret_pct"] <= full["avg_ret_pct"], f"{name} {stressed} beats full"
            assert row["win_rate"] <= full["win_rate"], f"{name} {stressed} beats full on wins"


def test_the_tiers_still_mean_what_the_verdict_says():
    """Tier 2 (trading the flat band) loses; tier 3 breaks under quarterly windows."""
    tiers = R._tiers()
    tier2 = tiers["tiers"]["tier2"]["bounds"]["full"]
    assert tier2["avg_ret_pct"] < 0.0, "trading the flat band must not read as profitable"
    assert tier2["win_rate"] < 0.80, "the flat band clears the win bar"
    t3_full = tiers["tiers"]["tier3"]["bounds"]["full"]
    t3_q = tiers["tiers"]["tier3"]["quarterly"]
    assert t3_q["avg_ret_pct"] < t3_full["avg_ret_pct"], "quarterly tier 3 beats its own semi-annual"
    assert t3_q["win_rate"] < 0.80, "tier 3 clears the bar on quarterly windows"


# --------------------------------------------------------- cap sweep
def test_cap_sweep_champion_is_the_quoted_cell():
    """The UI quotes cfg 6 on both universes; the artifact must still say so."""
    sweep = R._cap_sweep()
    assert sweep is not None
    assert sweep["configs"] == 6
    illiquid = sweep["illiquid"]
    liquid = sweep["liquid_control"]
    assert illiquid["cap_rsi2"] == 30.0 and illiquid["cap_flush_pct"] == 5.0
    assert illiquid["t3_n"] == 131
    assert illiquid["t3_win_rate"] == pytest.approx(0.7939, abs=1e-4)
    assert illiquid["t3_avg_ret_pct"] == pytest.approx(7.26, abs=1e-2)
    assert illiquid["hit"] is False, "the champion cell cleared the bar"
    assert liquid["t3_n"] == 125
    assert liquid["t3_win_rate"] == pytest.approx(0.72, abs=1e-4)
    assert liquid["hit"] is False


# --------------------------------------------------------------- flow
def test_flow_census_keeps_breadth_ahead():
    """The study's verdict - flow lags breadth - lives in the numbers."""
    flow = R._flow()
    assert flow is not None
    assert flow["indicators"] >= 22
    assert flow["breadth_leads"] is True, "a flow indicator now out-measures breadth"
    assert flow["breadth_auc"] > flow["best_flow"]["auc"]


# --------------------------------------------------------------- exits
def test_exit_census_is_sorted_and_measured():
    census = R._exits()
    assert census is not None
    rows = census["exits"]
    assert len(rows) >= 20
    counts = [r["trades"] for r in rows]
    assert counts == sorted(counts, reverse=True), "exits are not sorted by trade count"
    for row in rows:
        assert 0.0 <= row["win_rate"] <= 1.0


# ---------------------------------------------------- the plan carries it
def test_the_plan_carries_the_measured_regime():
    from app.plan import method_card, plan

    current = plan()
    assert current.regime.measured_drift is not None
    drift = R.band_drift(current.regime.band)
    assert current.regime.measured_drift["mean_drift_5s_pct"] == drift["mean_drift_5s_pct"]

    card = method_card()
    assert "regimes" in card and card["regimes"]["bands"] is not None
    assert "capitulation" in card and card["capitulation"]["lead_not_result"] is True


# ------------------------------------------- the capitulation watch
def test_capitulation_replay_produces_a_measured_watch():
    """On a real capitulation session the watch exists, and never as a ticket."""
    current = plan(as_of="2026-06-15")
    assert current.regime.band == "capitulation"
    assert current.regime.breadth < 0.25
    assert current.verdict["state"] == "NO_TRADE"
    assert len(current.capitulation_watch) >= 1, "the 2026-06-15 watch is empty"
    for item in current.capitulation_watch:
        assert item.passed_all is True
        assert item.rsi2 <= 30.0, f"{item.ticker}: rsi2 {item.rsi2}"
        assert item.ret5 <= -5.0, f"{item.ticker}: ret5 {item.ret5}"
        assert -30.0 <= item.dist_200_pct <= -5.0, f"{item.ticker}: dist {item.dist_200_pct}"
        assert item.atr14_pct >= 2.0, f"{item.ticker}: atr {item.atr14_pct}"
    # The watch never leaks into orders.
    assert not current.candidates


# -------------------------------------------- conformance with the study
STUDY_SRC = M.DOCS_DIR / "src"


@pytest.fixture(scope="module", autouse=True)
def _in_study_root():
    """The study resolves manifest paths relative to its own root."""
    previous = os.getcwd()
    os.chdir(M.DOCS_DIR)
    yield
    os.chdir(previous)


@pytest.fixture(scope="module")
def study():
    """The study's own modules under its name."""
    if str(STUDY_SRC) not in sys.path:
        sys.path.insert(0, str(STUDY_SRC))
    import indicators  # noqa: PLC0415
    import strategies  # noqa: PLC0415

    return strategies, indicators


@pytest.fixture(scope="module", autouse=True)
def _study_source():
    """Pin the study's own bars as the active plan source for this module.

    `plan.set_source` is module-global and a refresh job swaps it, so a refresh
    test running earlier in the suite leaves a synthetic two-ticker universe
    installed - which made these replay tests read a market of two names. The
    previous source is restored on teardown.
    """
    import app.plan as P

    previous = P._active
    P.set_source(StudyBars(), "regimes-test")
    yield
    P.set_source(previous[0], previous[1])


@pytest.fixture(scope="module")
def frames():
    return StudyBars().load(None)


@pytest.fixture(scope="module")
def cap_session(frames):
    """A session the app itself reads as capitulation, for the conformance check."""
    for day in frames.sessions()[::-8]:
        breadth, n = S._breadth(frames.bars, day)
        if breadth < 0.25 and n > 100:
            return day, breadth
    pytest.skip("no capitulation session found in the archive")


def test_cap_bounce_matches_the_study_signal(frames, study, cap_session):
    """The app's tier-3 conditions must equal the study's own `cap_bounce`.

    Same contract as test_plan_conformance's gate-chain check: the study's
    own family is run over the same bars and must agree name by name. The app
    adds its tradability filter (frozen names, sub-50 IDR, short history)
    before scoring, so the comparison is over the app-admissible set.
    """
    strategies, indicators = study
    session, breadth = cap_session

    study_spec = strategies._spec("cap_bounce", {"rsi2": 30.0, "flush": 5.0}, strategies.E("lt_14_40_95", 14, 40, 95), "long")

    # ret5/ret10 - two of the family conditions - are added by
    # `indicators.add_benchmark_rs`, not by `build_all`, so the benchmark frame
    # has to be built and merged exactly as the study pipeline does it.
    bench_all = frames.benchmark
    bench_f = indicators.build_all(bench_all[bench_all["date"] <= session].reset_index(drop=True))

    checked = 0
    mismatches: list[str] = []
    for code in sorted(frames.bars):
        frame = frames.bars[code]
        window = frame[frame["date"] <= session]
        if len(window) < M.MA_WINDOW + 1 or window["date"].iloc[-1] != session:
            continue
        if not S.tradable(window)[0]:
            continue
        close = float(window["close"].iloc[-1])
        if close <= 0:
            continue

        f = indicators.add_benchmark_rs(
            indicators.build_all(window.reset_index(drop=True)), bench_f
        )
        f["breadth"] = breadth
        theirs = bool(strategies.signals(f, study_spec)["entries"][-1])

        cond = S._cap_conditions(window, close)
        assert cond is not None
        ours = bool(cond["passed"])
        if ours is not theirs:
            mismatches.append(f"{code}: app={ours} study={theirs}")
        checked += 1
    assert checked > 20, f"only {checked} names comparable"
    assert not mismatches, "cap_bounce disagrees with the study:\n" + "\n".join(mismatches[:15])


# ------------------------------------------------------------ appendix
def test_card_degrades_gracefully_without_artifacts():
    """Missing artifacts must read as absent blocks, never raise."""
    import app.plan.regimes as R2
    missing = M.DOCS_DIR / "results" / "definitely-missing"
    paths = ("THREE_REGIME_DIAGNOSTIC", "REGIME_HOLDOUT", "REGIME_FORWARD",
             "REGIME_QUARTERLY", "QUARTERLY_TIERS", "SURVIVORSHIP",
             "SWEEP_SCREEN", "SWEEP_CONTROL", "FLOW_FORWARD", "EXIT_CENSUS")
    old = {name: getattr(R2, name) for name in paths}
    old_results = R2.RESULTS
    try:
        # The path constants are resolved at import, so they have to move too.
        for name in paths:
            setattr(R2, name, missing / old[name].name)
        R2.RESULTS = missing
        R2.clear_cache()
        card = R2.card()
        blocks = {k: v for k, v in card.items() if k != "bands_note"}
        assert all(v is None for v in blocks.values()), "a missing artifact read as present"
        assert R2.capitulation_evidence() is None
    finally:
        for name, value in old.items():
            setattr(R2, name, value)
        R2.RESULTS = old_results
        R2.clear_cache()


def test_replay_anchors_the_calendar_to_the_replayed_session():
    """A replay must judge itself against the session it replays.

    Before this, `plan(as_of=...)` compared the replayed bars against the
    archive's *last* exchange session and read zero coverage on the replayed
    one, so every replay came back DATA_UNSAFE by construction - which made the
    documented `?as_of=` check useless exactly when it was needed.
    """
    current = plan(as_of="2026-06-15")
    checks = {c["key"]: c for c in current.verdict["integrity"]}
    assert checks["exchange_calendar"]["ok"] is True
    assert checks["bars_current"]["ok"] is True
    assert checks["coverage"]["ok"] is True, checks["coverage"]["detail"]
    assert current.verdict["state"] != "DATA_UNSAFE"
    assert current.coverage["names_on_session"] > 100
