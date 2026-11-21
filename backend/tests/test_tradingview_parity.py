"""TradingView parity — one small check per adoption (gauge/report/snapshot)."""

from app.fundamentals_snapshot import empty, from_yfinance_info
from app.overview.gauge import _rating, build
from core.backtest_report import ReportCard


def test_gauge_rating_bands():
    assert _rating(10.0) == "STRONG_SELL"
    assert _rating(30.0) == "SELL"
    assert _rating(50.0) == "NEUTRAL"
    assert _rating(70.0) == "BUY"
    assert _rating(90.0) == "STRONG_BUY"


def test_gauge_build_carries_rating_and_timeframes():
    summary = {
        "breadth_pct": 60.0,
        "above_ma50_pct": 60.0,
        "near_52w_high": 10,
        "near_52w_low": 10,
        "ihsg": {"momentum_vs_ma100_pct": 0.0, "volatility_20d_pct": 30.0},
        "down5_pct": 5.0,
    }
    plain = build(summary)
    assert plain["rating"] in ("STRONG_SELL", "SELL", "NEUTRAL", "BUY", "STRONG_BUY")
    assert plain["timeframes"] is None
    tf = build(summary, tf_values={"1D": 80.0, "1W": 20.0})
    assert tf["timeframes"]["1D"]["rating"] == "STRONG_BUY"
    assert tf["timeframes"]["1W"]["rating"] == "SELL"


def test_strategy_tester_shape_has_no_invented_fields():
    card = ReportCard(
        total_trades=10,
        winners=6,
        win_rate=60.0,
        expected_value=100.0,
        gross_profit=1000.0,
        gross_loss=500.0,
        profit_factor=2.0,
        max_drawdown_pct=5.0,
        sharpe_ratio=1.2,
        avg_win=200.0,
        avg_loss=100.0,
        total_return_pct=3.0,
        net_profit=300.0,
    )
    shape = card.to_strategy_tester()
    assert shape["percent_profitable"] == 60.0
    assert shape["profit_factor"] == 2.0
    assert shape["exposure_pct"] is None  # unknown stays None
    assert ReportCard().to_strategy_tester()["total_trades"] == 0


def test_fundamentals_snapshot_never_invents():
    blank = empty("BBCA")
    assert blank.get("pe") is None and blank.get("sector") is None
    snap = from_yfinance_info(
        "BBCA", {"trailingPE": 20.0, "returnOnEquity": 0.15, "sector": "Banks"}
    )
    assert snap.get("pe") == 20.0
    assert snap.get("roe_pct") == 15.0
    assert snap.get("sector") == "Banks"
    assert snap.get("source") == "yfinance"
