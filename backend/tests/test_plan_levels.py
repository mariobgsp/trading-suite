"""Reversal support and resistance: the count is the claim.

A level with "x3" beside it says price turned there three times, so the test
builds bars where the turn count is known by construction: a range that the
price walks four times down to the floor and three times up to the ceiling.
Everything else — a too-short window, a frozen series, a name the bars dict
does not know — must read as absent, never as a level somebody invented.
"""

from __future__ import annotations

from typing import cast

import pandas as pd
import pytest

from app.plan import screen as S
from app.plan.model import Gate, GateKey

SESSIONS = pd.bdate_range("2026-01-05", periods=50)
SHORT_SESSIONS = pd.bdate_range("2026-01-05", periods=10)
AS_OF = cast(pd.Timestamp, SESSIONS[-1])

# A range walk: down to ~100, up to ~120, four floors and three ceilings.
WALK = [
    110,
    108,
    106,
    104,
    102,
    100,  # floor 1
    102,
    104,
    106,
    108,
    110,
    120,  # ceiling 1
    118,
    116,
    114,
    112,
    110,
    100.5,  # floor 2
    102,
    104,
    106,
    108,
    110,
    119,  # ceiling 2
    117,
    115,
    113,
    111,
    109,
    100.9,  # floor 3
    102,
    104,
    106,
    108,
    110,
    118,  # ceiling 3
    116,
    114,
    112,
    110,
    108,
    101,  # floor 4
    103,
    105,
    107,
    109,
    111,
    118.5,  # ceiling 4 (too recent: not a pivot)
    116,
    110,
]


def _frame(closes: list[float], dates: pd.DatetimeIndex | None = None) -> pd.DataFrame:
    resolved = dates if dates is not None else pd.bdate_range("2026-01-05", periods=len(closes))
    return pd.DataFrame(
        {
            "date": resolved,
            "open": closes,
            "high": closes,
            "low": closes,
            "close": closes,
            "volume": [1_000_000] * len(closes),
        }
    )


def test_levels_count_the_reversals_at_each_side():
    support, support_touches, resistance, resistance_touches = S.support_resistance(
        _frame(WALK), AS_OF
    )
    # Four pivot lows within 2% of 100, three pivot highs within 2% of 120
    # (the fourth ceiling is too recent to be a confirmed pivot). A level quotes
    # the mean of its pivots: the price the cluster actually respected.
    assert support is not None and resistance is not None
    assert support == pytest.approx(100.6)
    assert support_touches == 4
    assert resistance == pytest.approx(119.0)
    assert resistance_touches == 3
    assert support < 110 < resistance  # close sits between its own levels


def test_a_window_too_short_to_confirm_any_pivot_reads_absent():
    short = _frame(WALK[:10], SHORT_SESSIONS)
    result = S.support_resistance(short, cast(pd.Timestamp, SHORT_SESSIONS[-1]))
    assert result == (None, None, None, None)


def test_a_frozen_series_has_no_reversals_to_count():
    frozen = _frame([100.0] * 40)
    assert S.support_resistance(frozen, AS_OF) == (None, None, None, None)


def test_a_window_cut_before_as_of_ignores_the_future():
    cut = cast(pd.Timestamp, SESSIONS[30])
    _support, support_touches, _resistance, resistance_touches = S.support_resistance(
        _frame(WALK), cut
    )
    # Everything after the cut is unseen: only the first two floors and the
    # first two ceilings exist yet, and the later walk cannot count.
    assert support_touches == 2
    assert resistance_touches == 2


def _gate(key: GateKey, passed: bool, threshold: float = 0.0) -> Gate:
    return Gate(key, key, passed, None if not passed else 1.0, threshold, "", "")


def _scored(ticker: str) -> dict[str, object]:
    return {
        "ticker": ticker,
        "close": 110.0,
        "change_pct": 1.0,
        "turnover_idr": 1_000_000_000.0,
        "breakout_pct": 2.0,
        "rs_rating": 94.0,
        "vol20": 1.0,
        "vol20_median": 2.0,
        "passed": False,
        "gates": {
            "breakout": _gate("breakout", True),
            "relative_strength": _gate("relative_strength", True),
            "quiet_vol": _gate("quiet_vol", True, threshold=2.0),
            "index_above_200": _gate("index_above_200", True),
        },
    }


def test_scan_rows_carry_the_levels_and_count_their_reversals():
    rows = S.scan_rows(
        [_scored("AAA"), _scored("MISSING"), _scored("BROKEN")],
        spec=cast("object", None),  # type: ignore[arg-type]
        bars={"AAA": _frame(WALK), "BROKEN": pd.DataFrame({"junk": [1]})},
        as_of=AS_OF,
    )
    by_ticker = {str(row["ticker"]): row for row in rows}
    aaa = by_ticker["AAA"]
    assert aaa["support"] == pytest.approx(100.6)
    assert aaa["support_touches"] == 4
    assert aaa["resistance"] == pytest.approx(119.0)
    assert aaa["resistance_touches"] == 3
    # A name the bars dict does not know, and a frame that cannot be read, both
    # read as absent levels rather than sinking the whole scan.
    for absent in ("MISSING", "BROKEN"):
        for key in ("support", "support_touches", "resistance", "resistance_touches"):
            assert by_ticker[absent][key] is None, f"{absent}.{key} should be absent"


def test_scan_rows_without_bars_leaves_the_levels_absent():
    rows = S.scan_rows([_scored("AAA")], spec=cast("object", None))  # type: ignore[arg-type]
    assert rows[0]["support"] is None
    assert rows[0]["resistance_touches"] is None
