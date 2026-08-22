"""Tests for the BidBot-ported features: D-Signal alerts + Konglo aggregation.

All tests offline — data sources are monkeypatched, never touched.
"""

from __future__ import annotations

from datetime import date, timedelta


def _synthetic_history(n: int = 120, start: float = 100.0) -> list[dict]:
    """OHLCV series with realistic pullbacks (so indicators stay defined)."""
    rows = []
    d = date(2026, 1, 1)
    price = start
    for i in range(n):
        drift = 0.004 if i % 7 != 5 else -0.006
        o = price
        c = price * (1 + drift)
        hi = max(o, c) * 1.01
        lo = min(o, c) * 0.99
        rows.append(
            {
                "date": (d + timedelta(days=i)).isoformat(),
                "open": round(o, 2),
                "high": round(hi, 2),
                "low": round(lo, 2),
                "close": round(c, 2),
                "volume": int(1_000_000 + i * 1000),
            }
        )
        price = c
    return rows


# ─── D-Signal alerts ──────────────────────────────────────────────────────────


def test_ladder_labels():
    from app.alerts import _ladder

    assert _ladder([]) == "Di bawah semua MA"
    assert _ladder([3, 5, 10, 20, 50, 100]) == "Di atas MA3/5/10/20/50/100"
    assert _ladder([20, 50, 100]) == "Di atas MA20/50/100 (long-term)"
    assert _ladder([50, 100]) == "Di atas MA50/100 (long-term)"
    assert _ladder([3, 5]) == "Di atas MA3/5"


def test_above_mas_on_uptrend():
    from app.alerts import _above_mas

    closes = [100 + i for i in range(120)]  # monotone up
    import pandas as pd

    above = _above_mas(close=float(closes[-1]), closes=pd.Series(closes))
    assert above == [3, 5, 10, 20, 50, 100]


def test_scan_shapes_by_ticker(monkeypatch):
    from app import alerts as alerts_mod

    monkeypatch.setattr(alerts_mod, "get_ticker_universe", lambda: ["TEST", "FAIL", "TEST2"])

    def fake_fetch(ticker: str, period: str, interval: str) -> list[dict]:
        # FAIL returns nothing → filtered out of the scan
        if ticker == "FAIL":
            return []
        return _synthetic_history(90, start=100.0)

    monkeypatch.setattr(alerts_mod, "fetch_history", fake_fetch)

    out = alerts_mod.run_alert_scan(limit=10)
    assert out["count"] > 0
    assert set(out["counts"]) == {"premium", "breakout", "spike_pagi", "full_ladder"}
    for item in out["items"]:
        assert item["ticker"] in {"TEST", "TEST2"}
        assert item["price"] > 0
        assert item["change_percent"] is not None
        assert item["d_signal"] in {"PREMIUM", "BREAKOUT", None}
        assert isinstance(item["above_ma"], list)


# ─── Konglo aggregation ────────────────────────────────────────────────────────


def test_konglo_overview_aggregates_by_group(monkeypatch):
    fake_rows = [
        {
            "ticker": "ASII",
            "price": 5000.0,
            "change_percent": 1.5,
            "net_foreign_idr": 12_000_000_000,
        },
        {
            "ticker": "AALI",
            "price": 7000.0,
            "change_percent": -0.5,
            "net_foreign_idr": -2_000_000_000,
        },
        {
            "ticker": "BBCA",
            "price": 9000.0,
            "change_percent": 0.2,
            "net_foreign_idr": 5_000_000_000,
        },
    ]

    def fake_universe() -> dict:
        return {"available": True, "rows": fake_rows}

    monkeypatch.setattr("app.idx.foreign_flow_universe", fake_universe)

    from app.konglo import konglo_overview

    out = konglo_overview()
    astra = next(g for g in out["groups"] if g["group"] == "Astra Group")
    assert astra["count_saham"] == 2
    assert astra["members"][0]["ticker"] == "ASII"
    assert astra["avg_change_percent"] == 0.5  # (1.5 + -0.5) / 2
    assert astra["net_foreign_idr"] == 10_000_000_000
    assert out["tickers_mapped"] == 3  # ASII + AALI (Astra) + BBCA (Djarum)


def test_konglo_skips_groups_with_no_universe_rows(monkeypatch):
    def fake_universe() -> dict:
        return {"available": True, "rows": []}

    monkeypatch.setattr("app.idx.foreign_flow_universe", fake_universe)

    from app.konglo import konglo_overview

    out = konglo_overview()
    assert out["groups"] == []
    assert out["tickers_mapped"] == 0
