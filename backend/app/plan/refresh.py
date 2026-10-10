"""Pull the latest daily bars, then re-run the analysis on them.

One button, one job, and two rules that exist because a refresh is the only way
this app can be *wrong in a new way*:

  * **A session is not a session until it is over.** A daily bar for today is a
    live, unfinished candle until the exchange has finished matching. Screening it
    would be screening a partial price, which is how a screen "fires" at 10am and
    is gone by the close. `session_is_final` refuses today's bar before 16:02 WIB,
    so the app screens the last completed session and says so.
  * **A partial refresh must not become a silent signal.** Breadth is a share of
    the universe, so quietly losing a third of the names would move breadth and
    could flip the verdict. Every failure is counted, the sample is named, and the
    plan's own integrity checks (coverage, phantom bars, bars-current) fail closed
    on a degraded pull rather than trading on it.

The job warms the app's own history cache — the same cache the screener uses —
and hands back a report. The analysis runs inside the job, so the answer is ready
when the button stops spinning.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable

from .bars import (
    SESSION_FINAL_AFTER,
    WIB,
    LiveBars,
    MergedBars,
    StudyBars,
    session_is_final,
)

log = logging.getLogger(__name__)

DEFAULT_PERIOD = "5y"
MAX_SECONDS = 900  # a hung upstream must not hold the button forever
FAILURE_SHARE_LIMIT = 0.05  # remembered here so the report can flag it


def _bar_date(record: Any) -> date | None:
    """The date of one history record, in whichever shape it arrives."""
    if not isinstance(record, dict):
        return None
    raw = record.get("date")
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _last_final_session(records: list[dict[str, Any]], now: datetime | None = None) -> date | None:
    """The most recent bar in `records` that is a completed session."""
    dates = [d for d in (_bar_date(r) for r in records) if d is not None]
    final = [d for d in dates if session_is_final(d, now)]
    return max(final) if final else None


def _fetch(code: str, period: str, interval: str, force: bool) -> list[dict[str, Any]]:
    """One indirection so tests can stub the network without stubbing the job."""
    from app.market import fetch_history  # imported late: keeps the seam optional

    return list(fetch_history(code, period, interval, force))


def _study_source() -> Any:
    """The base bars the refresh extends: the study's own cache.

    A separate function so a test can hand the job a synthetic universe and run
    the whole sequence in milliseconds.
    """
    return StudyBars()


@dataclass
class RefreshReport:
    """What the last refresh did, in numbers rather than adjectives."""

    id: str
    state: str = "running"  # running | done | failed | cancelled
    started_at: str = ""
    finished_at: str | None = None
    seconds: float | None = None
    session_before: str | None = None
    session_after: str | None = None
    bars_basis: str = "study"
    names_total: int = 0
    names_checked: int = 0
    names_fetched: int = 0
    names_unchanged: int = 0
    names_failed: int = 0
    failed_sample: list[str] = field(default_factory=list)
    partial_bars_rejected: int = 0
    live_appended: int = 0
    phantom_bars_dropped: int = 0
    coverage_on_session: int = 0
    coverage_required: float = 0.0
    failure_share: float = 0.0
    degraded: bool = False
    already_running: bool = False
    plan: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        # `refreshed`, `as_of` and `open` are kept from the previous contract so
        # a caller that only knew the old endpoint still reads something true.
        return dict(
            id=self.id,
            state=self.state,
            started_at=self.started_at,
            finished_at=self.finished_at,
            seconds=None if self.seconds is None else round(self.seconds, 1),
            session_before=self.session_before,
            session_after=self.session_after,
            bars_basis=self.bars_basis,
            names_total=self.names_total,
            names_checked=self.names_checked,
            names_fetched=self.names_fetched,
            names_unchanged=self.names_unchanged,
            names_failed=self.names_failed,
            failed_sample=list(self.failed_sample),
            partial_bars_rejected=self.partial_bars_rejected,
            live_appended=self.live_appended,
            phantom_bars_dropped=self.phantom_bars_dropped,
            coverage_on_session=self.coverage_on_session,
            coverage_required=self.coverage_required,
            failure_share=round(self.failure_share, 4),
            degraded=self.degraded,
            already_running=self.already_running,
            plan=self.plan,
            error=self.error,
            refreshed=self.state == "done",
            as_of=self.session_after,
            open=bool(self.plan.get("open")) if self.plan else None,
        )


_LOCK = threading.Lock()
_JOBS: dict[str, RefreshReport] = {}
_RUNNING: str | None = None
_CANCEL = threading.Event()
_MAX_JOBS = 12


def report(job_id: str) -> RefreshReport | None:
    with _LOCK:
        return _JOBS.get(job_id)


def current() -> RefreshReport | None:
    with _LOCK:
        return _JOBS.get(_RUNNING) if _RUNNING else None


def cancel(job_id: str) -> bool:
    """Ask a running job to stop between names."""
    with _LOCK:
        if _RUNNING != job_id:
            return False
    _CANCEL.set()
    return True


def start(
    wait: bool = False,
    period: str = DEFAULT_PERIOD,
    source_factory: Callable[[], Any] | None = None,
    now: datetime | None = None,
) -> RefreshReport:
    """Start a refresh, or hand back the one already running.

    Single-flight on purpose: two concurrent universe pulls would double the
    upstream traffic and race each other's cache writes for no benefit.
    """
    global _RUNNING
    with _LOCK:
        if _RUNNING is not None:
            running = _JOBS.get(_RUNNING)
            if running is not None and running.state == "running":
                running.already_running = True
                return running
        job = RefreshReport(id=uuid.uuid4().hex[:12], started_at=(now or datetime.now(WIB)).isoformat())
        _JOBS[job.id] = job
        _RUNNING = job.id
        if len(_JOBS) > _MAX_JOBS:
            for stale in sorted(_JOBS, key=lambda k: _JOBS[k].started_at)[: len(_JOBS) - _MAX_JOBS]:
                if stale != _RUNNING:
                    _JOBS.pop(stale, None)
    _CANCEL.clear()
    if wait:
        _run(job, period=period, source_factory=source_factory, now=now)
        return job
    threading.Thread(
        target=_run,
        kwargs=dict(job=job, period=period, source_factory=source_factory, now=now),
        daemon=True,
        name=f"plan-refresh:{job.id}",
    ).start()
    return job


def _run(
    job: RefreshReport,
    period: str,
    source_factory: Callable[[], Any] | None,
    now: datetime | None,
) -> None:
    """Warm the cache for every name that is behind, then re-analyse."""
    global _RUNNING
    started = time.perf_counter()
    try:
        # The exchange clock: ^JKSE's own bars, because the index is the calendar
        # the study itself uses to decide which sessions the exchange held.
        bench_records = _fetch("^JKSE", period, "1d", True)
        target = _last_final_session(bench_records, now)
        all_dates = [d for d in (_bar_date(r) for r in bench_records) if d is not None]
        job.partial_bars_rejected = sum(
            1 for d in all_dates if not session_is_final(d, now)
        )
        if target is None:
            raise RuntimeError("the benchmark has no completed session to screen")

        base = _study_source().load(None)
        job.session_before = base.as_of().date().isoformat() if base.as_of() is not None else None
        codes = sorted(base.bars)
        job.names_total = len(codes)

        for code in codes:
            if _CANCEL.is_set() or (time.perf_counter() - started) > MAX_SECONDS:
                job.state = "cancelled"
                break
            job.names_checked += 1
            try:
                records = _fetch(code, period, "1d", False)
                last = _last_final_session(records, now)
                if last is None or last < target:
                    records = _fetch(code, period, "1d", True)
                    last = _last_final_session(records, now)
                if last is not None and last >= target:
                    job.names_fetched += 1
                else:
                    job.names_unchanged += 1
            except Exception as exc:  # noqa: BLE001 - one bad ticker must not stop the pull
                job.names_failed += 1
                if len(job.failed_sample) < 10:
                    job.failed_sample.append(code)
                log.warning("refresh: %s failed: %s", code, exc)

        if job.state == "cancelled":
            return

        # Swap the seam to the merged source and analyse on it. The study's
        # verified CSVs stay the base; the live tail is appended in memory.
        factory = source_factory or (
            lambda: MergedBars(StudyBars(), LiveBars(period=period))
        )
        label = f"study+live:{target.isoformat()}"

        # `from . import plan` here binds the package's own `plan()` function,
        # which is what we want to call once the seam has been swapped.
        from . import invalidate as _invalidate
        from . import plan as _build_plan
        from . import set_source

        set_source(factory(), label)
        job.bars_basis = "study+live"
        _invalidate()
        current = _build_plan()
        job.session_after = current.as_of.isoformat()
        job.live_appended = int(current.coverage.get("live_appended") or 0)
        job.phantom_bars_dropped = int(current.coverage.get("phantom_bars_dropped") or 0)
        job.coverage_on_session = int(current.coverage.get("names_on_session") or 0)
        job.coverage_required = float(current.coverage.get("coverage_floor") or 0.0)
        job.failure_share = (job.names_failed / job.names_total) if job.names_total else 0.0
        job.degraded = job.failure_share > FAILURE_SHARE_LIMIT
        job.plan = dict(
            as_of=current.as_of.isoformat(),
            verdict_state=(current.verdict or {}).get("state"),
            open=current.open,
            candidates=len(current.candidates),
            headline=current.headline,
        )
        job.state = "done"
    except Exception as exc:  # noqa: BLE001 - the report is where a failure lands
        job.state = "failed"
        job.error = str(exc)
        log.warning("refresh failed: %s", exc)
    finally:
        job.seconds = time.perf_counter() - started
        job.finished_at = datetime.now(WIB).isoformat()
        with _LOCK:
            if _RUNNING == job.id:
                _RUNNING = None
            _JOBS[job.id] = job


__all__ = [
    "DEFAULT_PERIOD",
    "FAILURE_SHARE_LIMIT",
    "MAX_SECONDS",
    "RefreshReport",
    "cancel",
    "current",
    "report",
    "start",
]
