"""Movers, sector day, IHSG contribution split and the benchmark tail."""

from __future__ import annotations

import pandas as pd

from app.overview import moves


def _row(ticker: str, change: float, cap: float, price: float = 100.0, sector: str = "Finance") -> dict:
    return {
        "ticker": ticker,
        "name": ticker,
        "sector": sector,
        "change_pct": change,
        "price": price,
        "market_cap": cap,
        "volume": 1_000.0,
    }


def test_movers_sorted_bounded_and_labeled():
    joined = [
        _row("A", +9.0, 10.0),
        _row("B", +3.0, 10.0),
        _row("C", -4.0, 10.0),
        _row("D", 0.0, 10.0),
        _row("E", +1.0, 10.0, price=50.0),
    ]
    out = moves.build_movers(joined)
    assert [row["ticker"] for row in out["gainers"]] == ["A", "B", "E"]
    assert [row["ticker"] for row in out["losers"]] == ["C"]
    assert out["losers"][0]["change_pct"] == -4.0
    assert out["most_active"][0]["ticker"] == "A"  # same price, same volume
    assert "harga" in out["value_note"] or "nilai" in out["value_note"]
    assert out["available"] is True


def test_movers_empty_input_states_reason():
    out = moves.build_movers([])
    assert out["available"] is False
    assert out["reason"] == "no_priced_rows"


def test_sector_day_counts_add_up_and_carries_leaders():
    joined = [
        _row("A", +10.0, 10.0, sector="Finance"),
        _row("B", -5.0, 10.0, sector="Finance"),
        _row("C", 0.0, 10.0, sector="Finance"),
        _row("D", -1.0, 10.0, sector="Energy"),
    ]
    out = moves.build_sector_day(joined)
    finance = next(row for row in out["sectors"] if row["sector"] == "Finance")
    assert finance["members"] == 3
    assert finance["up"] + finance["down"] + finance["flat"] == 3
    assert finance["avg_change_pct"] == _approx2((10.0 - 5.0 + 0.0) / 3)
    assert finance["best"] == {"ticker": "A", "change_pct": 10.0}
    assert finance["worst"] == {"ticker": "B", "change_pct": -5.0}
    assert out["sectors"][0]["sector"] == "Finance"


def _approx2(value: float) -> float:
    return round(round(value, 2), 2)


def test_contribution_calibrates_to_the_actual_index_change():
    joined = [
        _row("BIG", +10.0, 200.0),
        _row("SMALL", -5.0, 100.0),
    ]
    market = {"ihsg": {"change_pct": 5.0}}
    out = moves.build_index_contribution(joined, market)
    # weights: 2/3 and 1/3, model = 6.67 - 1.67 = 5.0, actual 5.0 -> factor 1.0
    assert out["available"] is True
    assert _approx2(out["model_change_pct"]) == 5.0
    assert _approx2(out["factor"]) == 1.0
    top, bottom = out["top"][0], out["bottom"][0]
    assert top["ticker"] == "BIG"
    assert top["weight_pct"] == _approx2(66.67)
    assert _approx2(sum(r["contribution_pct"] for r in out["top"] + out["bottom"])) == 5.0
    assert bottom["ticker"] == "SMALL"


def test_contribution_rescales_when_the_model_drifts():
    joined = [
        _row("BIG", +10.0, 200.0),
        _row("SMALL", -5.0, 100.0),
    ]
    market = {"ihsg": {"change_pct": 10.0}}
    out = moves.build_index_contribution(joined, market)
    # model sums 5.0, actual is 10.0 -> factor (10/5)=2.0, parts sum to 10.0
    assert _approx2(out["factor"]) == 2.0
    assert _approx2(sum(r["contribution_pct"] for r in out["top"] + out["bottom"])) == 10.0
    assert out["calibration"] == "calibrated" and out["reason"] is None


def test_contribution_uncalibrated_on_a_tiny_model_sum():
    joined = [
        _row("ONE", +0.005, 150.0),
        _row("TWO", -0.005, 150.0),
    ]
    out = moves.build_index_contribution(joined, {"ihsg": {"change_pct": 5.0}})
    # model sums to exactly zero -> below the noise floor; no factor is invented
    assert out["reason"] == "index_unchanged"
    assert out["calibration"] == "uncalibrated"
    assert out["factor"] == 1.0


def test_contribution_flat_and_empty_states():
    flat = moves.build_index_contribution(
        [_row("A", 0.0, 10.0)], {"ihsg": {"change_pct": 0.0}}
    )
    assert flat["available"] is False
    assert flat["reason"] == "index_unchanged"
    none = moves.build_index_contribution([{"ticker": "A", "change_pct": 1.0}], None)
    assert none["available"] is False
    assert none["reason"] == "no_market_cap_for_any_priced_name"


def test_benchmark_tail_appends_the_print_once():
    series = pd.Series(
        [4_000.0, 4_050.0],
        index=pd.DatetimeIndex(["2026-11-06", "2026-11-09"]),
    )
    out = moves.build_benchmark_tail(
        series, {"close": 4_100.0}, pd.Timestamp("2026-11-10").date()
    )
    assert out["available"] is True
    assert out["points"][-1] == {"date": "2026-11-10", "close": 4_100.0}
    again = moves.build_benchmark_tail(
        pd.concat([series, pd.Series({pd.Timestamp("2026-11-10"): 4_100.0})]),
        {"close": 4_150.0},
        pd.Timestamp("2026-11-10").date(),
    )
    assert again["points"][-1]["close"] == 4_100.0  # a settled bar is never rewritten
    assert again["points"][-2] == {"date": "2026-11-09", "close": 4_050.0}


def test_build_returns_all_four_blocks():
    inputs = {
        "joined": [_row("A", +1.0, 10.0)],
        "benchmark": pd.Series([1.0], index=pd.DatetimeIndex(["2026-11-10"])),
        "benchmark_quote": None,
        "print_date": None,
    }
    out = moves.build(inputs, {"ihsg": {"change_pct": 1.0}})
    assert set(out) == {"movers", "sector_day", "index_contribution", "benchmark_tail"}
