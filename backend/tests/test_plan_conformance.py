"""Conformance: the app's gate chain must agree with the study's.

`app/plan` is a re-transcription of one family out of
`trading-backtest-docs`. A re-transcription is a lie waiting to happen, so this
test imports the study's *own* `strategies.signals()` and compares it against
`app.plan` gate by gate, on the study's own bars, at a real session.

If the study is not present the test skips rather than fails: the app is still
useful against live bars, and the check is only meaningful with the study there.
Point `TRADING_DOCS_DIR` at a checkout to get the guarantee.
"""

from __future__ import annotations

import json
import sys

import pandas as pd
import pytest

from app.plan import method as M
from app.plan import screen as S
from app.plan.bars import StudyBars

STUDY_SRC = M.DOCS_DIR / "src"

pytestmark = pytest.mark.skipif(
    not STUDY_SRC.exists(),
    reason=f"study not found at {M.DOCS_DIR}; set TRADING_DOCS_DIR to enable",
)


@pytest.fixture(scope="module", autouse=True)
def _in_study_root():
    """The study resolves manifest paths relative to the working directory, so
    run from its root exactly as `run_all.sh` does."""
    previous = __import__("os").getcwd()
    __import__("os").chdir(M.DOCS_DIR)
    yield
    __import__("os").chdir(previous)


@pytest.fixture(scope="module")
def study():
    """The study's own modules, imported under its name."""
    if str(STUDY_SRC) not in sys.path:
        sys.path.insert(0, str(STUDY_SRC))
    import indicators  # noqa: PLC0415
    import strategies  # noqa: PLC0415
    from universe import load_ticker  # noqa: PLC0415

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


def test_breadth_matches_the_study(frames, manifest, study, as_of):
    """Our breadth must equal the study's, on the session the app plans from.

    Scored over the *tradable* set on both sides. The app counts a name only if
    it has history, a price worth trading and a series that moves; the reference
    here applies the identical filter, because otherwise this test would prove
    the app diverges from the study on a point where the app is deliberately
    closer to it (scripts/screen.py excludes the same frozen names).
    """
    _, _, load_ticker = study

    ours, size = S._breadth(frames.bars, as_of)

    above: dict[str, pd.Series] = {}
    for code in frames.bars:
        df = load_ticker(manifest, code)
        if df is None or len(df) < 220:
            continue
        window = df[df["date"] <= as_of]
        if window["date"].iloc[-1] != as_of:
            continue
        if not S.tradable(window)[0]:
            continue
        above[code] = pd.Series(
            (window["close"] > window["close"].rolling(200).mean()).to_numpy(float),
            index=pd.to_datetime(window["date"]),
        )
    theirs = float(pd.DataFrame(above).mean(axis=1).loc[as_of])

    assert size > 100, f"only {size} tradable names on {as_of.date()}"
    assert ours == pytest.approx(theirs, abs=1e-9), f"breadth {ours} vs study {theirs}"


def test_untradable_names_are_excluded_before_scoring(frames, as_of):
    """The frozen-price audit must actually remove names, not just be declared.

    The study found 7.0% of its trades came from names whose close does not move
    and dropped every headline as a result (docs/21). If this filter silently
    stopped working, the app would go back to recommending un-fillable breakouts
    and nothing else in the suite would notice.
    """
    rejected = 0
    frozen = 0
    for code, frame in frames.bars.items():
        window = frame[frame["date"] <= as_of]
        if len(window) < S.M.MA_WINDOW or window["date"].iloc[-1] != as_of:
            continue
        ok, why = S.tradable(window)
        if not ok:
            rejected += 1
            if why.startswith("price frozen"):
                frozen += 1

    assert rejected > 0, "no name was rejected - the tradability filter is inert"
    assert frozen > 0, "no frozen name was caught - the audit's main case is untested"


def test_relative_strength_matches_the_study(frames, manifest, study, as_of):
    """Our percentile must equal the study's, computed the study's way."""
    _, _, load_ticker = study

    ours = S._relative_strength(frames.bars, as_of)
    assert ours, "no relative-strength readings produced"

    panel: dict[str, pd.Series] = {}
    for code in frames.bars:
        df = load_ticker(manifest, code)
        if df is None or len(df) < 250:
            continue
        window = df[df["date"] <= as_of]
        if window["date"].iloc[-1] != as_of or len(window) < 121:
            continue
        panel[code] = pd.Series(
            (window["close"] / window["close"].shift(120) - 1.0).to_numpy(),
            index=pd.to_datetime(window["date"]),
        )
    theirs = (pd.DataFrame(panel).rank(axis=1, pct=True) * 100.0).loc[as_of]

    for code, value in ours.items():
        assert value == pytest.approx(float(theirs[code]), abs=1e-6), f"rs {code}"


def test_gate_chain_matches_study_signals(frames, manifest, study, as_of):
    """The whole chain, compared to `strategies.signals` for the same family.

    This is the test that keeps the app honest: if a constant or a comparison
    drifts, the app would keep quoting a win rate that no longer describes what
    it does, and only this catches it.
    """
    strategies, indicators, load_ticker = study

    study_spec = strategies._spec(
        M.DEFAULT_FAMILY,
        {"n": M.DONCHIAN_N},
        strategies.E(M.DEFAULT_EXIT, *M.exit_for(M.DEFAULT_EXIT)),
        "long",
    )
    spec = M.family_spec(M.DEFAULT_FAMILY)

    rs_ours = S._relative_strength(frames.bars, as_of)
    breadth_ours, _ = S._breadth(frames.bars, as_of)
    bench_state = S._benchmark_state(frames.benchmark, as_of)

    bench_df = load_ticker(manifest, "^JKSE")
    assert bench_df is not None
    bench_f = indicators.build_all(bench_df[bench_df["date"] <= as_of].reset_index(drop=True))

    checked = 0
    mismatches: list[str] = []
    for code in sorted(frames.bars):
        df = load_ticker(manifest, code)
        if df is None or len(df) < 250:
            continue
        window = df[df["date"] <= as_of].reset_index(drop=True)
        if window["date"].iloc[-1] != as_of or len(window) < 250:
            continue

        f = indicators.add_benchmark_rs(indicators.build_all(window), bench_f)
        f["rs_rating"] = rs_ours.get(code, float("nan"))
        f["breadth"] = breadth_ours

        theirs = bool(strategies.signals(f, study_spec)["entries"][-1])

        record = S._evaluate(
            code, frames.bars[code], as_of, rs_ours, breadth_ours, bench_state, spec
        )
        if record is None:
            continue
        # The app adds one guard the study does not have: a "breakout" of more
        # than MAX_BREAKOUT_PCT is a gap or a corporate action, not a breakout.
        gapped = float(record["breakout_pct"]) > S.MAX_BREAKOUT_PCT
        if gapped and not theirs:
            checked += 1
            continue
        if record["passed"] is not theirs:
            mismatches.append(
                f"{code}: app={record['passed']} study={theirs} "
                f"rs={record['rs_rating']:.1f} brk={record['breakout_pct']:.2f} "
                f"vol={record['vol20']:.2f}/{record['vol20_median']:.2f} "
                f"wup={record['gates']['weekly_trend'].passed}"
            )
        checked += 1

    assert checked > 50, f"only {checked} names comparable"
    assert not mismatches, "gate chain disagrees with the study:\n" + "\n".join(mismatches[:15])


def test_screener_ranks_the_universe_by_proximity(frames):
    """The screener's ordering must be honest about what it is ranking.

    Two properties, both of which the UI states to the user:
      * a row is a name that did NOT clear the chain — no buy signal leaks in;
      * proximity is measured on per-name gates only, because the market-wide
        ones (breadth, the index) fail identically for everyone and would make
        every distance the same number.
    """
    from app.plan import plan

    ranked = plan().ranked
    assert ranked, "the screener returned nothing to rank"

    for row in ranked:
        assert row["gates_passed"] < row["gates_total"], (
            f"{row['ticker']} cleared every condition and should not be in the screener"
        )
        if row["waiting_on_market"]:
            assert row["distance_pct"] is None, (
                f"{row['ticker']} waits only on the market but carries a distance"
            )
        else:
            assert row["distance_pct"] is not None

    # Sorted by conditions cleared, then nearest miss first.
    keys = [
        (r["gates_passed"], -(r["distance_pct"] if r["distance_pct"] is not None else -1e9))
        for r in ranked
    ]
    assert keys == sorted(keys, reverse=True), "rows are not in ranked order"


def test_market_gate_cannot_drive_the_ranking():
    """Breadth fails the same way for every name, so it must not set the order.

    If it did, every row would carry the same distance and the screener would
    look ranked while actually just listing the universe in whatever order the
    scan happened to produce.
    """
    from app.plan import method as M
    from app.plan import screen as S

    spec = M.family_spec(M.STUDY_PICK_FAMILY)
    # Two names differing only in how far each is from its own breakout.
    near = _record("breakout", False, -1.0)
    far = _record("breakout", False, -9.0)

    ranked = S.ladder([near, far], spec, limit=2)
    assert [r["ticker"] for r in ranked] == ["TEST", "TEST"]
    assert ranked[0]["distance_pct"] == 1.0, "the nearer miss must sort first"
    assert ranked[1]["distance_pct"] == 9.0


def _record(blocked_key: str, blocked_passed: bool, blocked_value: float) -> dict:
    """A scored name: every condition met except the one named."""
    from app.plan.model import Gate

    gates: dict[str, Gate] = {}
    for key in (
        "breakout",
        "relative_strength",
        "breadth",
        "quiet_vol",
        "weekly_trend",
        "index_above_200",
    ):
        if key == blocked_key:
            gates[key] = Gate(
                key=key, label=key, passed=blocked_passed, value=blocked_value,
                threshold=0.0, unit="", text="",
            )
        else:
            gates[key] = Gate(
                key=key, label=key, passed=True, value=1.0, threshold=0.0,
                unit="", text="",
            )
    return {
        "ticker": "TEST",
        "close": 100.0,
        "change_pct": 0.0,
        "rs_rating": 95.0,
        "vol20": 1.0,
        "vol20_median": 2.0,
        "breakout_pct": blocked_value,
        "gates": gates,
        "passed": False,
    }


def test_robustness_is_read_not_asserted():
    """The caveat numbers must come from the study's artifacts, or be absent.

    These are the numbers that qualify the headline. If they were ever hardcoded
    they would outlive the study revision they describe and quietly disagree
    with it — which is the one failure mode this whole app exists to prevent.
    """
    from app.plan import method as M

    r = M.robustness()

    for key, path in (
        ("quarterly", M.QUARTERLY_BOOKS_CSV),
        ("survivorship", M.SURVIVORSHIP_CSV),
        ("multiple_testing", M.MULTIPLE_TESTING_CSV),
    ):
        block = r[key]
        if not block.get("available"):
            continue
        assert path.exists(), f"{key} claims to be available but {path} is gone"
        assert block["source"], f"{key} does not name the artifact it read"

    # The quarterly pass is the one that can contradict the headline, so its
    # comparison must be made against the bar, not hardcoded to a verdict.
    q = r["quarterly"]
    if q.get("available") and q.get("pick_win_rate") is not None:
        expected = q["pick_win_rate"] / 100.0 < M.TARGET_WIN_RATE
        assert q["below_bar"] is expected, (
            f"below_bar={q['below_bar']} but {q['pick_win_rate']:.2f}% "
            f"vs a {M.TARGET_WIN_RATE:.0%} bar"
        )

    # Survivorship bias only runs one way: a cell rebuilt on the names that
    # survived must never look *better* than the same cell on the full panel.
    #
    # This used to be a monotone leave-out curve; the study rewrote the artifact
    # as explicit bounds (full / survivorship / trend / both), so the invariant is
    # now pairwise. Getting this backwards would quietly turn an upper bound into
    # an expected return, which is the single most consequential thing this
    # module could do wrong.
    s = r["survivorship"]
    curve = s.get("curve", []) if s.get("available") else []
    by_bound = {c["bound"]: c for c in curve if c.get("bound")}
    if "full" in by_bound:
        full = by_bound["full"]
        for stressed in ("survivorship", "both"):
            row = by_bound.get(stressed)
            if not row:
                continue
            if row["avg_ret_pct"] is not None and full["avg_ret_pct"] is not None:
                assert row["avg_ret_pct"] <= full["avg_ret_pct"], (
                    f"the {stressed} bound beats the full panel: "
                    f"{row['avg_ret_pct']} vs {full['avg_ret_pct']}"
                )
            if row["win_rate"] is not None and full["win_rate"] is not None:
                assert row["win_rate"] <= full["win_rate"], (
                    f"the {stressed} bound beats the full panel on win rate: "
                    f"{row['win_rate']} vs {full['win_rate']}"
                )


def test_plan_is_internally_consistent(frames):
    """Whatever the screen returns, every candidate must clear every gate."""
    from app.plan import plan

    current = plan()
    for candidate in current.candidates:
        failed = [g.key for g in candidate.gates if not g.passed]
        assert not failed, f"{candidate.ticker} cleared the plan but failed {failed}"
        assert candidate.geometry.target_price > candidate.close
        assert candidate.geometry.stop_price < candidate.close
    assert current.evidence.measured, "the plan quoted no measured evidence"


def test_every_family_spec_matches_its_study_signals(frames, manifest, study, as_of):
    """Each family the app can run must equal the study's own chain for it.

    `app/plan` can run three different families depending on what the study
    ranks highest. A spec that drifted for any one of them would be a screen
    quoting a win rate that no longer describes what it does, so each is checked
    against `strategies.signals` on its own.
    """
    strategies, indicators, load_ticker = study

    rs_ours = S._relative_strength(frames.bars, as_of)
    breadth_ours, _ = S._breadth(frames.bars, as_of)
    bench_state = S._benchmark_state(frames.benchmark, as_of)
    bench_df = load_ticker(manifest, "^JKSE")
    assert bench_df is not None
    bench_f = indicators.build_all(bench_df[bench_df["date"] <= as_of].reset_index(drop=True))

    for name, spec in M.FAMILY_SPECS.items():
        study_spec = strategies._spec(
            name,
            {"n": M.DONCHIAN_N},
            strategies.E(M.DEFAULT_EXIT, *M.exit_for(M.DEFAULT_EXIT)),
            "long",
        )

        checked = 0
        mismatches: list[str] = []
        for code in sorted(frames.bars):
            df = load_ticker(manifest, code)
            if df is None or len(df) < 250:
                continue
            window = df[df["date"] <= as_of].reset_index(drop=True)
            if window["date"].iloc[-1] != as_of or len(window) < 250:
                continue

            f = indicators.add_benchmark_rs(indicators.build_all(window), bench_f)
            f["rs_rating"] = rs_ours.get(code, float("nan"))
            f["breadth"] = breadth_ours
            theirs = bool(strategies.signals(f, study_spec)["entries"][-1])

            record = S._evaluate(
                code, frames.bars[code], as_of, rs_ours, breadth_ours, bench_state, spec
            )
            if record is None:
                continue
            gapped = float(record["breakout_pct"]) > S.MAX_BREAKOUT_PCT
            if gapped and not theirs:
                checked += 1
                continue
            if record["passed"] is not theirs:
                mismatches.append(
                    f"{name} {code}: app={record['passed']} study={theirs} "
                    f"brk={record['breakout_pct']:.2f} rs={record['rs_rating']:.1f} "
                    f"vol={record['vol20']:.2f}/{record['vol20_median']:.2f}"
                )
            checked += 1

        assert checked > 50, f"{name}: only {checked} names comparable"
        assert not mismatches, f"{name} disagrees with the study:\n" + "\n".join(mismatches[:12])

def test_the_holdout_travels_with_every_plan(frames):
    """The retraction must not be quietly removable.

    docs/22 answers the question the whole app exists to ask, and its answer is
    "no". The failure mode this guards against is not a crash: it is somebody
    deleting the holdout block because it makes the headline look worse. So the
    plan is required to carry it, and required to carry it truthfully — the
    winner count has to be whatever the study's artifact says, including when
    that number is unflattering.
    """
    import app.plan as build  # noqa: PLC0415

    result = build.plan()
    holdout = result.holdout
    assert holdout is not None, "the plan dropped the holdout - the headline is now unlabelled"
    assert holdout.search_cells, "the holdout carries no cell count"
    assert holdout.winners_tested, "the holdout carries no shortlist"

    # Read the artifact independently and demand the same numbers. If someone
    # edits the app's copy to be kinder, this fails.
    rows = M._rows(M.HOLDOUT_SEARCH_CSV)
    assert holdout.winners_tested == len(rows)
    surviving = sum(1 for r in rows if r.get("HOLDS", "").strip().lower() == "true")
    assert holdout.winners_surviving == surviving


def test_shipped_config_is_measured_not_asserted():
    """The app's own rule chain must have a measured row, and must show the range.

    Reporting the best of several census rows for one configuration would repeat
    exactly the error docs/22 corrects, so `shipped_config()` returns a span and
    this test refuses a single-number version.
    """
    shipped = M.shipped_config()
    assert shipped, "the app runs rules it has no measurement for"
    assert shipped.get("rows_matched", 0) >= 1
    assert "search_win_rate_lo" in shipped and "search_win_rate_hi" in shipped, (
        "the shipped config reports one number where the study measured a range"
    )
    lo, hi = shipped["search_win_rate_lo"], shipped["search_win_rate_hi"]
    assert lo is not None and hi is not None and lo <= hi


def test_regime_frequency_is_not_invented():
    """The census resolves 0.60, 0.50 and 0.45 — and nothing below that.

    The app's *actions* use a 0.25 capitulation line, but the study never counted
    sessions at that level, so the frequency block must not claim a share for it.
    """
    frequency = M.regime_frequency()
    assert frequency is not None
    assert frequency.sessions > 0
    # Monotone: a looser gate can only be met by more sessions.
    assert frequency.days_b60 <= frequency.days_b50 <= frequency.days_b45
    assert frequency.days_b45 <= frequency.sessions
    assert 0.0 <= frequency.share_trending <= 1.0
    assert not hasattr(frequency, "days_capitulation"), (
        "the frequency block claims a band the study's census does not measure"
    )


def test_phantom_bars_are_refused_before_screening():
    """A session the exchange never held must never reach the screen.

    `scripts/repair_phantom_bars.py` found 4,125 (ticker, date) rows on nine
    dates absent from the ^JKSE calendar - volume 0, close carried forward - all
    inside fold f5, a *scored out-of-sample* fold. A fabricated bar corrupts the
    three things this screen reads off price history: the 40-session high, the
    200-day average behind breadth, and the holding cap.

    The cache is repaired, so this will not fire in production today. It is here
    because the bug was in the *fetcher*: a re-fetch reintroduces those rows
    silently, and nothing else in the suite would notice.
    """
    from app.plan.bars import _drop_phantom  # noqa: PLC0415

    calendar = pd.DataFrame(
        {"date": pd.to_datetime(["2026-05-13", "2026-05-18", "2026-05-19"])}
    )

    # A holiday bar: off-calendar and no volume. This is the artefact.
    phantom = pd.DataFrame(
        {
            "date": pd.to_datetime(["2026-05-13", "2026-05-14", "2026-05-18"]),
            "close": [100.0, 100.0, 102.0],
            "volume": [500, 0, 400],
        }
    )
    cleaned, dropped, dates = _drop_phantom(phantom, calendar)
    assert dropped == 1, f"expected 1 phantom row dropped, got {dropped}"
    assert [d.strftime("%Y-%m-%d") for d in dates] == ["2026-05-14"]
    assert "2026-05-14" not in {str(d)[:10] for d in cleaned["date"]}

    # A real trading day that printed no volume must survive: the benchmark can
    # be stale, and deleting a genuine session would be worse than the bug.
    real = pd.DataFrame(
        {
            "date": pd.to_datetime(["2026-05-13", "2026-05-18"]),
            "close": [100.0, 102.0],
            "volume": [0, 400],
        }
    )
    kept, dropped_real, _ = _drop_phantom(real, calendar)
    assert dropped_real == 0, "a genuine zero-volume session was deleted"
    assert len(kept) == 2

    # No calendar to check against: keep everything rather than guess.
    _, dropped_blank, _ = _drop_phantom(phantom, None)
    assert dropped_blank == 0, "deleted history with no calendar to check it against"


def test_the_exchange_calendar_drives_the_next_session():
    """A public holiday must not be named as a trading day.

    The study's own repair script establishes ^JKSE as the authority on which
    dates were sessions - it found ticker caches carrying bars on dates the
    index did not, one of them a public holiday present in all 886 files. The app
    used to say "next weekday" and had no calendar at all.
    """
    from datetime import date as _date  # noqa: PLC0415

    from app.plan.screen import next_session, next_session_basis  # noqa: PLC0415

    # 2026-05-14 and 05-15 are excluded, exactly as the study found them.
    calendar = [pd.Timestamp(d) for d in ("2026-05-13", "2026-05-18", "2026-05-19")]

    assert next_session(_date(2026, 5, 13), calendar) == _date(2026, 5, 18)
    assert next_session_basis(_date(2026, 5, 13), calendar) == "exchange_calendar"

    # Past the last known session no calendar can help, and the app must admit it
    # rather than present a holiday as a trading day.
    assert next_session(_date(2026, 5, 19), calendar) == _date(2026, 5, 20)
    assert next_session_basis(_date(2026, 5, 19), calendar) == "next_weekday_unverified"

    # A weekend with no calendar still skips to Monday.
    assert next_session(_date(2026, 5, 15), None) == _date(2026, 5, 18)


def test_the_plan_reports_which_calendar_it_used():
    """The basis has to reach the payload, or the distinction is invisible."""
    import app.plan as build  # noqa: PLC0415

    coverage = build.plan().coverage
    assert "phantom_bars_dropped" in coverage, "the plan does not report phantom-bar refusals"
    assert "exchange_sessions" in coverage
    # Repaired cache: nothing should be dropped, and if something is, it is a fact
    # the UI needs rather than a rounding error.
    assert isinstance(coverage["phantom_bars_dropped"], int)
    assert coverage["phantom_bars_dropped"] >= 0


def test_the_shipped_chain_is_the_corrected_spec():
    """The chain on screen is the chain docs/21 §0a and docs/24 §7 ship.

    This is the assertion that keeps the app from drifting back to the searched
    pick by accident: 13/35/95 at breadth 0.60, RS 90, quiet volatility, and a
    40-session donchian window.
    """
    assert M.STUDY_PICK_EXIT == "lt_13_35_95"
    assert M.DEFAULT_EXIT == "lt_13_35_95"
    assert M.exit_for(M.STUDY_PICK_EXIT) == (13.0, 35.0, 95.0)
    assert M.STUDY_PICK_FAMILY == "breadth_quiet4_rs90_donchian"

    spec = M.family_spec(M.STUDY_PICK_FAMILY)
    assert spec.breadth == 0.60, "the regime gate is 0.60, not the 0.50 first searched"
    assert spec.rs_min == 90.0
    assert spec.quiet == "q40"
    assert spec.need_bench is False and spec.need_weekly is False
    assert M.DONCHIAN_N == 40

    # The corrected row is the one the UI leads with, and it is cited, not read.
    corrected = M.corrected_evidence()
    assert corrected.role == "walk_forward_corrected"
    assert corrected.measured is True
    assert corrected.provenance, "a cited row must carry its provenance"


def test_the_shipped_chain_has_a_census_row_and_says_so():
    """13/35/95 misses the +5% bar, so its row is in the census, not the top 10."""
    row = M.evidence_for(M.STUDY_PICK_FAMILY, M.STUDY_PICK_EXIT)
    assert row.measured is True
    assert row.source.endswith("method_table.csv")
    assert row.role == "searched_census"
    assert row.oos_trades == 528.0
    assert row.win_rate is not None and abs(row.win_rate - 0.7955) < 5e-4
    assert row.avg_ret_pct is not None and abs(row.avg_ret_pct - 4.16) < 0.01
    # Four donchian variants pooled into the family's published count; the app
    # runs one of them, and the single-spec figure is cited.
    assert row.n_specs == 4
    assert row.single_spec_trades == 108
