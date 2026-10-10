"""Where daily bars come from. This is the seam.

Two adapters satisfy it, which is what makes it a real seam rather than
indirection:

  * `StudyBars`  - the study's own `data/raw/*.csv` and its manifest. This is
                   what the proof was measured on, so it is what the
                   conformance test and any audit use.
  * `LiveBars`   - yfinance through the existing `app.market.fetch_history`
                   cache, so a screen run tonight uses tonight's bars.

Both return the same thing: a `Frames` object holding one OHLCV frame per code
plus the benchmark, sorted ascending by date, with no NaN closes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import pandas as pd

from .method import DOCS_DIR

BENCHMARK = "^JKSE"
OHLCV = ["date", "open", "high", "low", "close", "volume"]
MIN_BARS = 250  # the study drops anything shorter before building features
# A session needs this share of a normal session's names before the plan will be
# anchored on it.
COVERAGE_FLOOR = 0.60


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _drop_phantom(
    frame: pd.DataFrame, bench: pd.DataFrame | None
) -> tuple[pd.DataFrame, int, set[pd.Timestamp]]:
    """Remove sessions the exchange never held. Returns (frame, count, dates).

    The study found 4,125 (ticker, date) rows on nine dates absent from the ^JKSE
    calendar - volume 0, close carried forward - four of which appeared in *every*
    one of 886 files. Those were pipeline artefacts of days the exchange was shut,
    including a public holiday, and all nine fell inside fold f5: a scored
    out-of-sample fold. A fabricated bar distorts exactly the three things this
    screen computes from price history: the 40-session high, the 200-day
    average behind breadth, and the holding cap.

    The cache has been repaired once already, but the failure is in the fetcher,
    so a re-fetch reintroduces them silently. Rather than trust that, the app
    re-checks on every load and reports how many rows it refused.

    Both conditions are required before a row is dropped - off-calendar *and*
    no volume - so a real trading day missing from a stale benchmark survives.
    """
    if bench is None or bench.empty or frame.empty:
        return frame, 0, set()

    calendar = {pd.Timestamp(d).normalize() for d in bench["date"]}
    dates = frame["date"].map(lambda d: pd.Timestamp(d).normalize())
    off_calendar = ~dates.isin(calendar)

    volume = frame["volume"] if "volume" in frame.columns else None
    if volume is None:
        # No volume column: off-calendar alone is not enough evidence to delete
        # history, so keep everything and report nothing.
        return frame, 0, set()
    degenerate = volume <= 0

    bad = off_calendar & degenerate
    if not bool(bad.any()):
        return frame, 0, set()

    dropped_dates = set(dates[bad])
    return frame[~bad].reset_index(drop=True), int(bad.sum()), dropped_dates


@dataclass
class Frames:
    """Every frame the screen needs, aligned on date."""

    bars: dict[str, pd.DataFrame] = field(default_factory=dict)
    benchmark: pd.DataFrame | None = None
    source: str = "none"
    # Bars dropped because they were sessions the exchange never held. Kept as a
    # count so the caller can say so out loud rather than quietly screening on
    # data it has decided not to trust.
    phantom_dropped: int = 0
    phantom_dates: tuple[str, ...] = ()

    @property
    def codes(self) -> list[str]:
        return sorted(self.bars)

    def sessions(self) -> list[pd.Timestamp]:
        """The exchange calendar, from the benchmark.

        This is the same series the study used to detect phantom bars
        (`scripts/repair_phantom_bars.py`): a date on which ^JKSE has no bar is a
        date IDX did not trade, whatever any single ticker's cache claims.
        """
        if self.benchmark is None or self.benchmark.empty:
            return []
        return [pd.Timestamp(d) for d in self.benchmark["date"]]

    def as_of(self) -> pd.Timestamp | None:
        """The most recent session the data is actually complete for.

        Anchoring on the newest bar is wrong: a fetch in progress leaves a
        handful of tickers stamped with today while the rest of the universe
        stops at yesterday. Breadth and relative strength are cross-sectional, so
        a session holding 3 names out of 887 does not say the market is 67%
        strong - it says the download is unfinished. The anchor is therefore the
        last session covered by at least `COVERAGE_FLOOR` of the universe.
        """
        last = self.last_session()
        if last is None:
            return None
        counts = self.coverage()
        if not counts:
            return last
        typical = float(_median(list(counts.values())))
        floor = typical * COVERAGE_FLOOR
        for session in sorted(counts, reverse=True):
            if counts[session] >= floor:
                return session
        return last

    def last_session(self) -> pd.Timestamp | None:
        """The newest session any frame has a bar for, however thin."""
        last: pd.Timestamp | None = None
        frames: list[pd.DataFrame] = list(self.bars.values())
        if self.benchmark is not None and not self.benchmark.empty:
            frames.append(self.benchmark)
        for frame in frames:
            if frame.empty:
                continue
            stamp = pd.Timestamp(frame["date"].iloc[-1])
            if last is None or stamp > last:
                last = stamp
        return last

    def coverage(self, sessions: int = 90) -> dict[pd.Timestamp, int]:
        """How many names have a bar on each of the last `sessions` sessions."""
        counts: dict[pd.Timestamp, int] = {}
        for frame in self.bars.values():
            if frame.empty:
                continue
            for stamp in pd.to_datetime(frame["date"]).tail(sessions):
                counts[stamp] = counts.get(stamp, 0) + 1
        return counts

    def coverage_on(self, session: pd.Timestamp) -> int:
        """How many names have a bar on exactly this session."""
        return sum(
            1
            for frame in self.bars.values()
            if not frame.empty and pd.Timestamp(frame["date"].iloc[-1]) >= session
            and pd.Timestamp(frame["date"].iloc[-1]) == session
        )

    def __len__(self) -> int:
        return len(self.bars)


def _clean(df: pd.DataFrame | None) -> pd.DataFrame | None:
    """The study's own loading rule (src/universe.py:43-49)."""
    if df is None or df.empty:
        return None
    out = df.copy()
    out["date"] = pd.to_datetime(out["date"])
    out = (
        out.dropna(subset=["close"])
        .drop_duplicates("date")
        .sort_values("date")
        .reset_index(drop=True)
    )
    return out if len(out) else None


class BarsSource(Protocol):
    """The seam: given a universe, return its daily bars."""

    def load(self, codes: list[str]) -> Frames: ...


class StudyBars:
    """The study's cached CSVs, read through its manifest.

    `codes=None` means every code in the manifest. The manifest is also the
    provenance: it carries the per-file sha256 the study verified.
    """

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root else DOCS_DIR
        self.manifest_path = self.root / "data" / "meta" / "manifest.json"

    def _manifest(self) -> dict:
        with self.manifest_path.open(encoding="utf-8") as fh:
            return json.load(fh)

    def _read(self, entries: dict[str, dict], code: str) -> pd.DataFrame | None:
        """One CSV, resolved against the study root.

        The manifest stores paths relative to the study's own directory, so a
        checkout elsewhere would otherwise resolve them against the process CWD.
        A missing file is skipped rather than fatal: the study records fetch
        failures in the manifest and a screen should survive them.
        """
        entry = entries.get(code)
        if not entry:
            return None
        raw = Path(entry["file"])
        path = raw if raw.is_absolute() else (self.root / raw)
        if not path.exists():
            return None
        try:
            return _clean(pd.read_csv(path, parse_dates=["date"]))
        except (OSError, ValueError, KeyError):
            return None

    def load(self, codes: list[str] | None = None) -> Frames:
        manifest = self._manifest()
        entries: dict[str, dict] = manifest.get("tickers", {})
        wanted = sorted(codes) if codes else sorted(entries)

        # Read the benchmark first: it *is* the exchange calendar, and the ticker
        # files are validated against it below.
        bench = self._read(entries, BENCHMARK)

        out: dict[str, pd.DataFrame] = {}
        dropped = 0
        phantom: set[pd.Timestamp] = set()
        for code in wanted:
            frame = self._read(entries, code)
            if frame is None:
                continue
            frame, n, bad = _drop_phantom(frame, bench)
            dropped += n
            phantom |= bad
            if len(frame) >= MIN_BARS:
                out[code] = frame

        return Frames(
            bars=out,
            benchmark=bench,
            source=f"study:{self.root}",
            phantom_dropped=dropped,
            phantom_dates=tuple(sorted(d.strftime("%Y-%m-%d") for d in phantom)),
        )


class LiveBars:
    """yfinance through the app's cached `fetch_history`.

    Fan-out is the same `ThreadPoolExecutor` shape the screener already uses,
    so a universe scan costs the cache and not the upstream.
    """

    def __init__(self, period: str = "5y", workers: int = 8) -> None:
        self.period = period
        self.workers = workers

    def load(self, codes: list[str]) -> Frames:
        from concurrent.futures import ThreadPoolExecutor

        from app.market import fetch_history  # imported late: keeps the seam optional

        def one(code: str) -> tuple[str, pd.DataFrame | None]:
            try:
                return code, _clean(pd.DataFrame(fetch_history(code, self.period, "1d")))
            except Exception:  # noqa: BLE001 - one bad ticker must not sink the scan
                return code, None

        out: dict[str, pd.DataFrame] = {}
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            for code, frame in pool.map(one, codes):
                if frame is not None and len(frame) >= MIN_BARS:
                    out[code] = frame

        bench = None
        try:
            bench = _clean(pd.DataFrame(fetch_history(BENCHMARK, self.period, "1d")))
        except Exception:  # noqa: BLE001
            pass
        return Frames(bars=out, benchmark=bench, source="live:yfinance")


@lru_cache(maxsize=1)
def default_source() -> BarsSource:
    """Prefer the study's data; fall back to live bars when it is absent."""
    study = StudyBars()
    if study.manifest_path.exists():
        return study
    return LiveBars()