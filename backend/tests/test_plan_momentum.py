"""Conformance: the momentum scan must agree with the study's `momentum` family.

`app.plan.momentum` is a re-transcription of the study's `momentum` entry, so
this test imports the study's *own* `strategies.signals()` and compares it
against the app's gate on the study's bars, at a real session. The exit is never
compared here — it is an ATR-scaled take-profit read from the study's census, and
`signals()` only carries the entry side — but every measured row must stay below
the study's bar, because the scan is a watch, not a ticket.

If the study is not present the test skips rather than fails.
"""

from __future__ import annotations

import json
import sys
from typing import cast

import pytest

from app.plan import method as M
from app.plan import momentum as MO
from app.plan.bars import StudyBars

STUDY_SRC = M.DOCS_DIR / "src"

pytestmark = pytest.mark.skipif(
    not STUDY_SRC.exists(),
    reason=f"study not found at {M.DOCS_DIR}; set TRADING_DOCS_DIR to enable",
)


@pytest.fixture(scope="module", autouse=True)
def _in_study_root():
    """The study resolves manifest paths relative to its own working directory."""
    previous = __import__("os").getcwd()
    __import__("os").chdir(M.DOCS_DIR)
    yield
    __import__("os").chdir(previous)


@pytest.fixture(scope="module")
def study():
    if str(STUDY_SRC) not in sys.path:
        sys.path.insert(0, str(STUDY_SRC))
    import indicators  # type: ignore[reportMissingImports]
    import strategies  # type: ignore[reportMissingImports]
    from universe import load_ticker  # type: ignore[reportMissingImports]

    return strategies, indicators, load_ticker


@pytest.fixture(scope="module")
def manifest():
    with (M.DOCS_DIR / "data" / "meta" / "manifest.json").open() as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def frames():
    return StudyBars().load(None)


@pytest.fixture(scope="module")
def as_of(frames):
    stamp = frames.as_of()
    assert stamp is not None, "no session could be anchored"
    return stamp


def test_momentum_entry_matches_the_study(frames, manifest, study, as_of):
    """The app's momentum gate must equal `strategies.signals` for the family."""
    strategies, indicators, load_ticker = study
    study_spec = strategies._spec(
        "momentum",
        {"n": MO.MOM_N, "thr": MO.MOM_THR},
        strategies.E("signal_only", 999, 6, 60, sig=True),
        "long",
    )

    checked = 0
    mismatches: list[str] = []
    for code in sorted(frames.bars):
        df = load_ticker(manifest, code)
        if df is None or len(df) < MO.MOM_N + 1:
            continue
        window = df[df["date"] <= as_of].reset_index(drop=True)
        if window["date"].iloc[-1] != as_of or len(window) < MO.MOM_N + 1:
            continue

        theirs = bool(strategies.signals(indicators.build_all(window), study_spec)["entries"][-1])
        ours = MO.entry_conditions(frames.bars[code][frames.bars[code]["date"] <= as_of])
        if ours is None:
            continue
        if ours["passed"] is not theirs:
            mismatches.append(
                f"{code}: app={ours['passed']} study={theirs} mom={ours['mom_pct']:.2f}%"
            )
        checked += 1

    assert checked > 50, f"only {checked} names comparable"
    assert not mismatches, "momentum entry disagrees with the study:\n" + "\n".join(mismatches[:12])


def test_momentum_ledger_is_below_bar():
    """Every measured momentum row must stay below the study's bar.

    The scan may show these names only because it is labelled as a watch. A row
    that cleared the bar would mean the scan is presenting a ticket quietly.
    """
    ledger = MO.momentum_ledger()
    assert ledger, "the momentum census carried no rows"
    exits = {r["exit_method"] for r in ledger}
    assert MO.EXIT_NAME in exits, f"{MO.EXIT_NAME} missing from the momentum ledger"
    for r in ledger:
        assert not r["hit_bar"], f"{r['exit_method']} cleared the bar — must not be a scan"
        win = cast(float | None, r["win_rate"])
        avg = cast(float | None, r["avg_ret_pct"])
        if win is not None and avg is not None:
            assert not (win >= 0.80 and avg > 5.0), (
                f"{r['exit_method']} clears both bars — the scan must not hide it"
            )
