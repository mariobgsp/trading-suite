"""The refresh job: what it refuses to screen, and what it reports.

No network and no study here: every fetch goes through `refresh._fetch` and the
base bars through `refresh._study_source`, so the whole sequence runs in
milliseconds. The rules pinned are the ones that make the button safe to press —
an unfinished session is never screened, and a partial pull cannot pass silently.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd
import pytest

from app.plan import bars as B
from app.plan import refresh as R

WIB = R.WIB
SESSION = date(2026, 10, 9)  # a Friday
NEXT = date(2026, 10, 12)  # the Monday after


def at(y: int, m: int, d: int, hh: int, mm: int = 0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=WIB)


def _sessions(end: date, n: int = 260) -> list[date]:
    out: list[date] = []
    day = end
    while len(out) < n:
        if day.weekday() < 5:
            out.append(day)
        day -= timedelta(days=1)
    return sorted(out)


def _frame(dates: list[date], start: float = 1_000.0) -> pd.DataFrame:
    close = [start * (1.0 + 0.0005 * i) for i in range(len(dates))]
    return pd.DataFrame(
        {
            "date": pd.to_datetime(dates),
            "open": close,
            "high": [c * 1.01 for c in close],
            "low": [c * 0.99 for c in close],
            "close": close,
            "volume": [2_000_000.0] * len(dates),
        }
    )


def _records(dates: list[date]) -> list[dict[str, object]]:
    return [
        {"date": d.isoformat(), "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1.0}
        for d in dates
    ]


class StubSource:
    """A BarsSource over frames a test built."""

    def __init__(self, frames: B.Frames) -> None:
        self._frames = frames

    def load(self, codes: list[str] | None = None) -> B.Frames:
        return self._frames


# ── the session clock ───────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("bar", "now", "final"),
    (
        (SESSION, at(2026, 10, 9, 9, 30), False),  # session I, mid-candle
        (SESSION, at(2026, 10, 9, 16, 1), False),  # closing match still running
        (SESSION, at(2026, 10, 9, 16, 2), True),  # post-trading
        (SESSION, at(2026, 10, 10, 7, 0), True),  # the next morning
        (NEXT, at(2026, 10, 9, 16, 2), False),  # a bar dated in the future
    ),
)
def test_a_session_is_only_final_after_the_close(bar: date, now: datetime, final: bool):
    assert R.session_is_final(bar, now) is final


def test_the_last_final_session_ignores_todays_unfinished_bar():
    records = _records([SESSION, NEXT])
    assert R._last_final_session(records, at(2026, 10, 12, 10, 0)) == SESSION
    assert R._last_final_session(records, at(2026, 10, 12, 16, 30)) == NEXT
    assert R._last_final_session([], at(2026, 10, 12, 16, 30)) is None


def test_bar_dates_arrive_in_every_shape_the_cache_uses():
    assert R._bar_date({"date": "2026-10-09T00:00:00"}) == SESSION
    assert R._bar_date({"date": SESSION}) == SESSION
    assert R._bar_date({"date": datetime(2026, 10, 9, 5, 0)}) == SESSION
    assert R._bar_date({}) is None
    assert R._bar_date("nonsense") is None


# ── the merge ───────────────────────────────────────────────────────────────
def test_merged_bars_appends_only_finished_sessions():
    study_dates = _sessions(SESSION)[-8:]
    live_dates = study_dates + [NEXT]
    study = StubSource(
        B.Frames(
            bars={"AAA": _frame(study_dates)},
            benchmark=_frame(study_dates),
            source="study",
        )
    )
    live = StubSource(
        B.Frames(bars={"AAA": _frame(live_dates)}, benchmark=_frame(live_dates))
    )
    # 11:00 on the live session: NEXT is today and still trading.
    merged = B.MergedBars(study, live, now=at(2026, 10, 12, 11, 0)).load(None)

    assert len(merged.bars["AAA"]) == len(study_dates), "an unfinished bar was screened"
    assert merged.live_appended == 0
    assert merged.partial_bars_rejected == 1

    # After the close the same pull is accepted.
    closed = B.MergedBars(study, live, now=at(2026, 10, 12, 16, 30)).load(None)
    assert closed.live_appended == 1
    assert closed.partial_bars_rejected == 0
    assert closed.bars["AAA"]["date"].iloc[-1].date() == NEXT
    assert closed.source.startswith("study+live")
    assert closed.as_of().date() == NEXT


def test_merged_bars_is_a_no_op_when_the_live_side_is_empty():
    study_dates = _sessions(SESSION)[-8:]
    study = StubSource(
        B.Frames(bars={"AAA": _frame(study_dates)}, benchmark=_frame(study_dates), source="study")
    )
    merged = B.MergedBars(study, StubSource(B.Frames()), now=at(2026, 10, 12, 16, 30)).load(None)
    assert merged.live_appended == 0
    assert len(merged.bars["AAA"]) == len(study_dates)


# ── the job ─────────────────────────────────────────────────────────────────
@pytest.fixture
def job_world(monkeypatch: pytest.MonkeyPatch):
    """A refresh that runs against synthetic bars and no network."""
    study_dates = _sessions(SESSION)[-260:]
    live_dates = _sessions(NEXT)[-260:]
    study = B.Frames(
        bars={"AAA": _frame(study_dates), "BBB": _frame(study_dates)},
        benchmark=_frame(study_dates),
        source="study",
    )
    live = B.Frames(
        bars={"AAA": _frame(live_dates), "BBB": _frame(study_dates)},
        benchmark=_frame(live_dates),
    )
    calls: dict[str, int] = {}

    def fetch(code: str, period: str, interval: str, force: bool) -> list[dict[str, object]]:
        calls[code] = calls.get(code, 0) + 1
        if code == "^JKSE":
            return _records(live_dates)
        if code == "BBB" and not force:
            return _records(study_dates)  # behind, so the job forces a second read
        if code == "BBB":
            return _records(live_dates)
        return _records(live_dates)

    monkeypatch.setattr(R, "_fetch", fetch)
    monkeypatch.setattr(R, "_study_source", lambda: StubSource(study))
    monkeypatch.setattr(R, "_RUNNING", None, raising=False)
    R._JOBS.clear()
    R._CANCEL.clear()
    return {"study": study, "live_dates": live_dates, "calls": calls, "study_dates": study_dates}


def test_the_job_pulls_the_stale_names_and_analyses_on_them(job_world):
    report = R.start(
        wait=True,
        now=at(2026, 10, 12, 16, 30),
        source_factory=lambda: StubSource(
            B.Frames(
                bars={
                    "AAA": _frame(job_world["live_dates"]),
                    "BBB": _frame(job_world["live_dates"]),
                },
                benchmark=_frame(job_world["live_dates"]),
                source="study+live:2 bars appended",
            )
        ),
    )
    assert report.state == "done", report.error
    assert report.names_total == 2
    assert report.names_failed == 0
    assert report.session_after == NEXT.isoformat()
    assert report.bars_basis == "study+live"
    assert report.degraded is False
    # 12 sessions of history are replayed for the candidates, so a plan exists.
    assert report.plan["as_of"] == NEXT.isoformat()
    assert report.plan["verdict_state"] in {"ENTER", "WAIT", "NO_TRADE", "DATA_UNSAFE"}
    # The stale name was read twice: once to discover, once forced.
    assert job_world["calls"]["BBB"] == 2
    assert job_world["calls"]["AAA"] == 1


def test_a_partial_pull_is_counted_and_flagged(job_world, monkeypatch: pytest.MonkeyPatch):
    def flaky(code: str, period: str, interval: str, force: bool) -> list[dict[str, object]]:
        if code == "BBB":
            raise RuntimeError("upstream said no")
        return _records(job_world["live_dates"])

    monkeypatch.setattr(R, "_fetch", flaky)
    report = R.start(
        wait=True,
        now=at(2026, 10, 12, 16, 30),
        source_factory=lambda: StubSource(job_world["study"]),
    )
    assert report.state == "done"
    assert report.names_failed == 1
    assert report.failed_sample == ["BBB"]
    assert report.failure_share == pytest.approx(0.5)
    assert report.degraded is True, "half a universe missing must not look like a clean pull"


def test_a_run_with_no_completed_session_fails_loudly(job_world, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(R, "_fetch", lambda *a, **k: [])
    report = R.start(wait=True, now=at(2026, 10, 12, 16, 30))
    assert report.state == "failed"
    assert report.error and "completed session" in report.error


def test_a_second_press_attaches_to_the_running_job(monkeypatch: pytest.MonkeyPatch):
    running = R.RefreshReport(id="abc123", state="running")
    monkeypatch.setattr(R, "_JOBS", {"abc123": running})
    monkeypatch.setattr(R, "_RUNNING", "abc123", raising=False)
    again = R.start(wait=True)
    assert again.id == "abc123"
    assert again.already_running is True


def test_cancel_only_affects_the_running_job(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(R, "_RUNNING", "abc123", raising=False)
    R._CANCEL.clear()
    assert R.cancel("nope") is False
    assert R.cancel("abc123") is True
    assert R._CANCEL.is_set()
    R._CANCEL.clear()


def test_the_report_keeps_the_old_endpoint_keys(job_world):
    """A caller that only knew the previous contract still reads something true."""
    report = R.RefreshReport(id="x", state="done", session_after="2026-10-12")
    report.plan = {"open": True}
    payload = report.as_dict()
    assert payload["refreshed"] is True
    assert payload["as_of"] == "2026-10-12"
    assert payload["open"] is True
