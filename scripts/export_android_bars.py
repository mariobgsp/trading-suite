#!/usr/bin/env python3
"""Pack the study's daily bars into one fixed-width file for the Android app.

The phone gets the same series the desktop reads, in a layout it can read with
one ByteBuffer instead of a million SQLite rows: one calendar, one index, one
blob. Standard library only, so it runs under any Python.

    python3 scripts/export_android_bars.py

Writes android/data/bars.bin (+ meta.json). It is not shipped in the APK:
the laptop computes, the phone caches responses.

Layout (little-endian):

    "TSB1" | uint32 n_tickers | uint32 n_dates
    int32  dates[n_dates]                  days since 1970-01-01
    per ticker: uint16 code_len, code_ascii, uint32 count, uint32 blob_offset
    blob, per ticker: uint16 date_idx[count], float32 close[count], int64 volume[count]
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import os
import struct
import sys
import time
from pathlib import Path

MAGIC = b"TSB1"
ROOT = Path(
    os.environ.get("TRADING_DOCS_DIR", Path.home() / "Projects" / "trading-backtest-docs")
)
OUT = Path(__file__).resolve().parents[1] / "android" / "data"
EPOCH = dt.date(1970, 1, 1)


def read_one(path: Path) -> list[tuple[str, float, int]]:
    rows: list[tuple[str, float, int]] = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            close = row.get("close") or ""
            if not close:
                continue
            try:
                price = float(close)
            except ValueError:
                continue
            volume = row.get("volume") or "0"
            try:
                shares = int(float(volume))
            except ValueError:
                shares = 0
            rows.append((row["date"], price, shares))
    return rows


def main() -> int:
    started = time.time()
    try:
        manifest = json.loads((ROOT / "data" / "meta" / "manifest.json").read_text())
    except (OSError, ValueError) as exc:
        print(f"cannot read the study manifest under {ROOT}: {exc}", file=sys.stderr)
        return 1

    series: dict[str, list[tuple[str, float, int]]] = {}
    for code, entry in manifest["tickers"].items():
        path = ROOT / entry["file"]
        if path.exists():
            rows = read_one(path)
            if rows:
                series[code] = rows
    if not series:
        print(f"no bars found under {ROOT}", file=sys.stderr)
        return 1

    dates = sorted({row[0] for rows in series.values() for row in rows})
    day_index = {day: i for i, day in enumerate(dates)}
    days = [(dt.date.fromisoformat(day) - EPOCH).days for day in dates]

    codes = sorted(series)
    blob = bytearray()
    index: list[tuple[str, int, int]] = []
    for code in codes:
        rows = series[code]
        start = len(blob)
        blob += struct.pack(f"<{len(rows)}H", *[day_index[r[0]] for r in rows])
        blob += struct.pack(f"<{len(rows)}f", *[r[1] for r in rows])
        blob += struct.pack(f"<{len(rows)}q", *[r[2] for r in rows])
        index.append((code, len(rows), start))

    out = bytearray(MAGIC)
    out += struct.pack("<II", len(codes), len(dates))
    out += struct.pack(f"<{len(days)}i", *days)
    for code, count, start in index:
        raw = code.encode("ascii")
        out += struct.pack("<H", len(raw)) + raw
        out += struct.pack("<II", count, start)
    out += blob

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "bars.bin").write_bytes(out)
    (OUT / "meta.json").write_text(
        json.dumps(
            {
                "source": str(ROOT),
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "as_of": dates[-1],
                "tickers": len(codes),
                "dates": len(dates),
                "bars": sum(count for _, count, _ in index),
                "bytes": len(out),
            },
            indent=1,
        )
        + "\n"
    )

    total = sum(count for _, count, _ in index)
    print(
        f"{len(codes)} tickers · {len(dates)} sessions · {total:,} bars · "
        f"{len(out) / 1e6:.1f} MB · {time.time() - started:.1f}s"
    )
    print(f"as of {dates[-1]} → {OUT / 'bars.bin'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
