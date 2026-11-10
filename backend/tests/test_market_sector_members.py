"""The sector-members readout behind the clickable sector rows."""

from __future__ import annotations

import app.routers.market as rm


def _row(sym, sector, change, price, cap, vol):
    return {"symbol": sym, "name": sym, "sector": sector, "industry": "x-" + str(sector),
            "change_percent": change, "price": price, "market_cap": cap, "volume": vol}


SCAN = [
    _row("AAA", "Finance", +4.0, 1_000.0, 10.0, 100.0),
    _row("BBB", "Finance", -2.0, 2_000.0, 20.0, 300.0),
    _row("CCC", "Energy", +1.0, 500.0, 5.0, 50.0),
    _row("DDD", None, +9.0, 10.0, 1.0, 10.0),  # unsectored
    {"symbol": "ERR", "sector": "Finance", "price": None, "change_percent": 5.0},
]


def test_members_ranked_filtered_and_aggregated(monkeypatch):
    monkeypatch.setattr(rm, "fetch_universe", lambda force=False: SCAN)
    out = rm._sector_members("Finance", "sector", 40, False)
    assert out["available"] is True
    assert out["count"] == 2  # the unpriced row is dropped
    assert [m["ticker"] for m in out["members"]] == ["AAA", "BBB"]
    assert out["members"][0]["value"] == 1_000.0 * 100.0
    assert out["up"] == 1 and out["down"] == 1
    assert out["avg_change_pct"] == 1.0


def test_industry_field_and_case_insensitive(monkeypatch):
    monkeypatch.setattr(rm, "fetch_universe", lambda force=False: SCAN)
    out = rm._sector_members("  FINANCE ", "sector", 40, False)
    assert out["count"] == 2
    out2 = rm._sector_members("x-Energy", "industry", 40, False)
    assert out2["count"] == 1 and out2["members"][0]["ticker"] == "CCC"


def test_empty_and_bounded(monkeypatch):
    monkeypatch.setattr(rm, "fetch_universe", lambda force=False: SCAN)
    out = rm._sector_members("Nonexistent", "sector", 40, False)
    assert out["available"] is False
    assert out["reason"]
    many = [_row("S%02d" % i, "Finance", float(i) - 50, 100.0, 1.0, 1.0) for i in range(60)]
    monkeypatch.setattr(rm, "fetch_universe", lambda force=False: many)
    out2 = rm._sector_members("Finance", "sector", 40, False)
    assert out2["count"] == 60 and out2["shown"] == 40 and len(out2["members"]) == 40
