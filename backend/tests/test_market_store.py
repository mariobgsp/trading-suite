from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from app import market_store
from app.plan.bars import StoreBars


def _study(tmp_path: Path) -> Path:
    root = tmp_path / "study"
    raw = root / "data" / "raw"
    meta = root / "data" / "meta"
    raw.mkdir(parents=True)
    meta.mkdir(parents=True)
    frame = pd.DataFrame(
        {
            "date": ["2026-01-02", "2026-01-05", "2026-01-06"],
            "open": [100.0, 101.0, 102.0],
            "high": [105.0, 106.0, 107.0],
            "low": [99.0, 100.0, 101.0],
            "close": [104.0, 105.0, 106.0],
            "volume": [1000, 1100, 1200],
            "adjclose": [104.0, 105.0, 106.0],
        }
    )
    frame.to_csv(raw / "AAA.csv", index=False)
    frame.to_csv(raw / "^JKSE.csv", index=False)
    manifest = {
        "generated_at": "2026-01-07T00:00:00+00:00",
        "tickers": {
            "AAA": {"file": "data/raw/AAA.csv"},
            "^JKSE": {"file": "data/raw/^JKSE.csv"},
            "BAD": {"file": "data/raw/BAD.csv"},
        },
    }
    (meta / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return root


def test_import_reads_bars_and_snapshot(tmp_path, monkeypatch):
    db = tmp_path / "market.db"
    monkeypatch.setattr(market_store, "MARKET_DB", db)
    snapshot = market_store.import_study(_study(tmp_path))
    assert snapshot["status"] == "complete"
    assert snapshot["symbols"] == 2
    assert snapshot["rows"] == 6
    assert snapshot["as_of"] == "2026-01-06"
    assert market_store.available() is True

    bars = market_store.read_bars(["AAA", "^JKSE"])
    assert list(bars) == ["AAA", "^JKSE"]
    assert len(bars["AAA"]) == 3
    assert bars["AAA"]["close"].iloc[-1] == 106.0

    history = market_store.read_history("AAA", "1y")
    assert len(history) == 3
    assert history[0]["date"] == "2026-01-02"
    assert history[-1]["close"] == 106.0

    # The study's plain code and the app's Yahoo symbol resolve to the same rows.
    assert market_store.read_history("AAA.JK", "1y") == history

    issues = market_store.issue_counts()["issues"]
    assert issues == [{"ticker": "BAD", "reason": "no usable rows"}]


def test_store_bars_is_a_plan_source(tmp_path, monkeypatch):
    from app.plan import bars

    db = tmp_path / "market.db"
    monkeypatch.setattr(market_store, "MARKET_DB", db)
    monkeypatch.setattr(bars, "MIN_BARS", 2)
    market_store.import_study(_study(tmp_path))
    frames = StoreBars().load(None)
    assert set(frames.bars) == {"AAA"}
    assert frames.benchmark is not None
    assert frames.source.startswith("store:")
    assert StoreBars().stamp().startswith("store:")


def test_import_fails_without_a_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(market_store, "MARKET_DB", tmp_path / "market.db")
    with pytest.raises(RuntimeError, match="manifest"):
        market_store.import_study(tmp_path)
    assert market_store.available() is False
