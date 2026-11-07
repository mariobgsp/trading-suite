"""One normalized local store for the daily bars the app screens on.

The study's `data/raw/*.csv` + manifest stay the provenance of record. This
module imports that snapshot into a single SQLite database so the backend can
read 5 years of OHLCV for ~900 names without walking 900 files, and so the plan
can be keyed to one immutable data snapshot.

Design choices:

* **SQLite, one file.** The app already runs SQLite in WAL mode and the row
  count is ~1.1M; a normalized table is smaller and faster to query than the
  old per-period JSON `hist:` entries, with no extra service.
* **One current `bars` table.** A weekly 5-year copy per snapshot would grow
  the file by ~50MB every week. The `snapshots` table keeps the provenance
  history, while the bars are replaced atomically inside one transaction; a
  reader sees the previous snapshot until the new one commits.
* **Yahoo symbols are normalized once.** The study's plain codes (`BBCA`) and
  the app's Yahoo symbols (`BBCA.JK`) both resolve against the same row.
* **The store is read-only to the app.** Only the sync writes it.

The plan uses `plan.bars.StoreBars`; `market.fetch_history` checks the store
before its old JSON cache. A missing store or a missing ticker falls back to the
existing behaviour, so the app keeps working before the first sync.

Codes: manifest_missing, no_tickers, parse_error, write_failed, no_store,
no_rows. A bad ticker becomes one `issues` row; only an unreadable manifest or
a failed transaction aborts the snapshot.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from app.config import DATA_DIR

MARKET_DB = Path(os.getenv("MARKET_DB", str(DATA_DIR / "market.db")))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT NOT NULL,
    generated_at TEXT,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT NOT NULL,
    symbols      INTEGER NOT NULL DEFAULT 0,
    rows         INTEGER NOT NULL DEFAULT 0,
    as_of        TEXT,
    detail       TEXT
);

CREATE TABLE IF NOT EXISTS bars (
    ticker       TEXT NOT NULL,
    trade_date   TEXT NOT NULL,
    yahoo_symbol TEXT NOT NULL,
    open         REAL,
    high         REAL,
    low          REAL,
    close        REAL NOT NULL,
    adj_close    REAL,
    volume       INTEGER,
    PRIMARY KEY (ticker, trade_date)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS bars_yahoo_date ON bars(yahoo_symbol, trade_date);
CREATE INDEX IF NOT EXISTS bars_trade_date ON bars(trade_date);

CREATE TABLE IF NOT EXISTS issues (
    snapshot_id INTEGER NOT NULL,
    ticker      TEXT NOT NULL,
    reason      TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ticker)
);
"""

_write_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else MARKET_DB
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.executescript(_SCHEMA)
    return conn


def yahoo_symbol(ticker: str) -> str:
    """The app's Yahoo symbol for a study code. Mirrors app.market normalization
    for the IDX cases the study stores, without importing yfinance."""
    t = str(ticker).strip().upper()
    if not t:
        return t
    if t.startswith("^") or "." in t or "=" in t or "-" in t:
        return t
    return f"{t}.JK"


def _read_csv(path: Path) -> pd.DataFrame | None:
    try:
        frame = pd.read_csv(path)
    except (OSError, ValueError, pd.errors.ParserError):
        return None
    if frame.empty:
        return None
    columns = {str(c).strip().lower(): c for c in frame.columns}
    needed = {"date", "open", "high", "low", "close", "volume"}
    if not needed.issubset(columns):
        return None
    out = pd.DataFrame(
        {
            "date": pd.to_datetime(frame[columns["date"]], errors="coerce"),
            "open": pd.to_numeric(frame[columns["open"]], errors="coerce"),
            "high": pd.to_numeric(frame[columns["high"]], errors="coerce"),
            "low": pd.to_numeric(frame[columns["low"]], errors="coerce"),
            "close": pd.to_numeric(frame[columns["close"]], errors="coerce"),
            "adj_close": (
                pd.to_numeric(frame[columns["adjclose"]], errors="coerce")
                if "adjclose" in columns
                else pd.NA
            ),
            "volume": pd.to_numeric(frame[columns["volume"]], errors="coerce"),
        }
    )
    out = out.dropna(subset=["date", "close"])
    out = out[out["close"] > 0]
    out = out.drop_duplicates("date").sort_values("date")
    if out.empty:
        return None
    return out


def import_study(
    study_root: Path | str,
    *,
    db_path: Path | str | None = None,
    source: str = "study",
) -> dict[str, Any]:
    """Import a study manifest snapshot into the current bar table.

    The whole replacement is one transaction: if any fatal error escapes, the
    previous snapshot remains intact. Individual bad tickers become rows in
    `issues` and do not abort the run.
    """
    root = Path(study_root).resolve()
    manifest_path = root / "data" / "meta" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"cannot read the study manifest at {manifest_path}: {exc}") from exc
    tickers = manifest.get("tickers")
    if not isinstance(tickers, dict) or not tickers:
        raise RuntimeError("the study manifest has no tickers")
    generated_at = str(manifest.get("generated_at") or "")
    started = _now()

    path = Path(db_path) if db_path else MARKET_DB
    with _write_lock:
        conn = _connect(path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                "INSERT INTO snapshots (source, generated_at, started_at, status) VALUES (?, ?, ?, 'running')",
                (source, generated_at, started),
            )
            snapshot_id = int(cursor.lastrowid)
            conn.execute("DELETE FROM bars")
            conn.execute("DELETE FROM issues WHERE snapshot_id = ?", (snapshot_id,))

            symbols = 0
            row_count = 0
            as_of: date | None = None
            issues: list[tuple[int, str, str]] = []
            for code, entry in sorted(tickers.items()):
                ticker = str(code).strip().upper()
                if not isinstance(entry, dict) or not entry.get("file"):
                    issues.append((snapshot_id, ticker, "the manifest has no file"))
                    continue
                raw = Path(str(entry["file"]))
                csv_path = raw if raw.is_absolute() else root / raw
                frame = _read_csv(csv_path)
                if frame is None:
                    issues.append((snapshot_id, ticker, "no usable rows"))
                    continue
                records = [
                    (
                        ticker,
                        row.date.strftime("%Y-%m-%d"),
                        yahoo_symbol(ticker),
                        float(row.open) if pd.notna(row.open) else None,
                        float(row.high) if pd.notna(row.high) else None,
                        float(row.low) if pd.notna(row.low) else None,
                        float(row.close),
                        float(row.adj_close) if pd.notna(row.adj_close) else None,
                        int(row.volume) if pd.notna(row.volume) else 0,
                    )
                    for row in frame.itertuples(index=False)
                ]
                conn.executemany(
                    "INSERT OR REPLACE INTO bars "
                    "(ticker, trade_date, yahoo_symbol, open, high, low, close, adj_close, volume) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    records,
                )
                symbols += 1
                row_count += len(records)
                ticker_as_of = frame["date"].max().date()
                as_of = ticker_as_of if as_of is None else max(as_of, ticker_as_of)

            if issues:
                conn.executemany(
                    "INSERT OR REPLACE INTO issues (snapshot_id, ticker, reason) VALUES (?, ?, ?)",
                    issues,
                )
            conn.execute(
                "UPDATE snapshots SET finished_at = ?, status = 'complete', symbols = ?, rows = ?, as_of = ?, detail = ? "
                "WHERE id = ?",
                (
                    _now(),
                    symbols,
                    row_count,
                    as_of.isoformat() if as_of else None,
                    json.dumps({"issues": len(issues)}),
                    snapshot_id,
                ),
            )
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    return latest(db_path=path) or {}


def latest(db_path: Path | str | None = None) -> dict[str, Any] | None:
    """The newest completed snapshot, or None when the store is empty."""
    try:
        conn = _connect(db_path)
    except (OSError, sqlite3.Error):
        return None
    try:
        row = conn.execute(
            "SELECT * FROM snapshots WHERE status = 'complete' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    return dict(row) if row else None


def available(db_path: Path | str | None = None) -> bool:
    snap = latest(db_path)
    if not snap:
        return False
    return int(snap.get("rows") or 0) > 0


def stamp(db_path: Path | str | None = None) -> str:
    snap = latest(db_path)
    if not snap:
        return "store:empty"
    return f"store:{snap['id']}:{snap.get('generated_at') or ''}"


def read_bars(
    codes: Iterable[str] | None = None,
    *,
    db_path: Path | str | None = None,
) -> dict[str, pd.DataFrame]:
    """Read the current snapshot as one frame per plain study code.

    Returns an empty dict when there is no store; callers fall back to the study
    CSVs or live data.
    """
    if not available(db_path):
        return {}
    wanted = [str(c).strip().upper() for c in codes] if codes is not None else None
    conn = _connect(db_path)
    try:
        if wanted:
            placeholders = ",".join("?" for _ in wanted)
            sql = (
                "SELECT ticker, trade_date, open, high, low, close, adj_close, volume "
                f"FROM bars WHERE ticker IN ({placeholders}) ORDER BY ticker, trade_date"
            )
            frame = pd.read_sql_query(sql, conn, params=wanted)
        else:
            frame = pd.read_sql_query(
                "SELECT ticker, trade_date, open, high, low, close, adj_close, volume "
                "FROM bars ORDER BY ticker, trade_date",
                conn,
            )
    except (sqlite3.Error, pd.errors.DatabaseError):
        return {}
    finally:
        conn.close()
    if frame.empty:
        return {}
    frame = frame.rename(columns={"trade_date": "date"})
    frame["date"] = pd.to_datetime(frame["date"])
    return {
        str(ticker): group.drop(columns=["ticker"]).reset_index(drop=True)
        for ticker, group in frame.groupby("ticker", sort=True)
    }


_PERIOD_DAYS = {
    "1mo": 31,
    "3mo": 92,
    "6mo": 183,
    "1y": 366,
    "2y": 731,
    "3y": 1096,
    "5y": 1826,
    "10y": 3653,
}


def read_history(
    ticker: str,
    period: str = "1y",
    *,
    db_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """The store's daily rows for one Yahoo-style ticker, oldest first.

    The list shape matches `app.market.fetch_history` (adjusted close is the
    close, as yfinance's auto_adjust did). A period longer than the stored
    history simply returns the whole history.
    """
    if not available(db_path):
        return []
    snap = latest(db_path)
    symbol = yahoo_symbol(ticker)
    conn = _connect(db_path)
    try:
        latest_date = conn.execute(
            "SELECT MAX(trade_date) FROM bars WHERE yahoo_symbol = ?", (symbol,)
        ).fetchone()[0]
        if not latest_date:
            return []
        params: list[Any] = [symbol]
        sql = (
            "SELECT trade_date AS date, open, high, low, close, volume FROM bars "
            "WHERE yahoo_symbol = ?"
        )
        days = _PERIOD_DAYS.get(period)
        if days is not None:
            cutoff = (date.fromisoformat(latest_date) - timedelta(days=days)).isoformat()
            sql += " AND trade_date >= ?"
            params.append(cutoff)
        sql += " ORDER BY trade_date"
        rows = conn.execute(sql, params).fetchall()
    except (sqlite3.Error, ValueError):
        return []
    finally:
        conn.close()
    return [
        {
            "date": row["date"],
            "open": row["open"],
            "high": row["high"],
            "low": row["low"],
            "close": row["close"],
            "volume": row["volume"],
        }
        for row in rows
    ]


def issue_counts(db_path: Path | str | None = None) -> dict[str, Any]:
    """Small diagnostics block for the sync output and /api/health."""
    snap = latest(db_path)
    if not snap:
        return {"available": False}
    conn = _connect(db_path)
    try:
        issues = conn.execute(
            "SELECT ticker, reason FROM issues WHERE snapshot_id = ? ORDER BY ticker",
            (snap["id"],),
        ).fetchall()
    except sqlite3.Error:
        issues = []
    finally:
        conn.close()
    return {
        "available": True,
        "snapshot": snap,
        "issues": [dict(row) for row in issues],
    }
