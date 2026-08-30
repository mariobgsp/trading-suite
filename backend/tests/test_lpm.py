"""Unit tests for LPM math in stockbit_lpm_intensity.

Pin the contract:
- LPM[i] is anchored to current bar's price (close * (1 + mean(next3 broker_norm) * 0.05))
- Last 3 bars carry the prior LPM value forward (no future data, keep line continuous)
- Series length matches per_day length
- Returns floats in price space (within +/-5% of close)
- Backend contract: dict with {ticker, lpm: list, intensity: list, available, days, dates, orderbook, as_of}
"""

from __future__ import annotations

import math
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _synthetic_per_day(n: int = 30, base_price: float = 1000.0):
    """per_day-shaped dicts. top3_net ramps up then down so the LPM signal has a clear shape."""
    rows = []
    for i in range(n):
        # u-shape: top3_net = 1000 + 500*sin(i/5) so mean(next3) varies smoothly
        top3 = 1000.0 + 500.0 * math.sin(i / 5.0)
        rows.append(
            {
                "date": f"2026-01-{(i % 28) + 1:02d}",
                "price": base_price + i,
                "volume": 1_000_000,
                "available": True,
                "rows": [],
                "top3_net": top3,
            }
        )
    return rows


class LpmMathTest(unittest.TestCase):
    def setUp(self):
        # Stub broker_history + orderbook_snapshot so the call is fully offline.
        from app import stockbit

        self._bh_patch = patch.object(
            stockbit, "broker_history", return_value={"per_day": _synthetic_per_day(30), "available": True, "dates": [], "as_of": "2026-01-01T00:00:00Z"}
        )
        self._ob_patch = patch.object(stockbit, "orderbook_snapshot", return_value={"available": False})
        self._bh_patch.start()
        self._ob_patch.start()

    def tearDown(self):
        self._bh_patch.stop()
        self._ob_patch.stop()

    def test_returns_payload_shape(self):
        from app.stockbit import stockbit_lpm_intensity

        out = stockbit_lpm_intensity("BBCA", days=30, force=True)
        self.assertIn("lpm", out)
        self.assertIn("intensity", out)
        self.assertIn("ticker", out)
        self.assertEqual(out["ticker"], "BBCA")
        self.assertEqual(len(out["lpm"]), 30)
        self.assertEqual(len(out["intensity"]), 30)

    def test_lpm_lives_in_price_space(self):
        """LPM value at bar i must be within +/-5% of price[i]."""
        from app.stockbit import stockbit_lpm_intensity

        out = stockbit_lpm_intensity("BBCA", days=30, force=True)
        # The last 3 bars carry the prior LPM forward -> skip them
        for i, v in enumerate(out["lpm"][:-3]):
            self.assertIsNotNone(v, f"lpm[{i}] should not be None")
            price = 1000.0 + i
            self.assertGreater(v, price * 0.94)
            self.assertLess(v, price * 1.06)

    def test_last_bar_carries_forward(self):
        """The very last bar has no future window; LPM carries the prior value forward so the line stays drawn."""
        from app.stockbit import stockbit_lpm_intensity

        out = stockbit_lpm_intensity("BBCA", days=30, force=True)
        lpm = out["lpm"]
        # Bar 28 has window [29:30] = 1 bar, so it computes from one value.
        # Bar 29 (last) has no future, so it carries the prior value forward.
        self.assertEqual(lpm[29], lpm[28])

    def test_lead_is_structural(self):
        """LPM value at bar i must change when future broker_norms change, even if price[i] is constant."""
        from app import stockbit

        # Two synthetic histories with the SAME prices but DIFFERENT future broker flow
        per_day_a = _synthetic_per_day(30)
        per_day_b = _synthetic_per_day(30)
        # Shift top3_net on bars 20..29 so the LPM at bars 17..20 should change
        for i in range(20, 30):
            per_day_b[i]["top3_net"] = per_day_b[i]["top3_net"] * -1  # flip sign

        with patch.object(stockbit, "broker_history", side_effect=[
            {"per_day": per_day_a, "available": True, "dates": [], "as_of": ""},
            {"per_day": per_day_b, "available": True, "dates": [], "as_of": ""},
        ]), patch.object(stockbit, "orderbook_snapshot", return_value={"available": False}):
            out_a = stockbit.stockbit_lpm_intensity("BBCA", days=30, force=True)
            out_b = stockbit.stockbit_lpm_intensity("BBCA", days=30, force=True)

        # LPM at bar 18 (uses bars 19..21) should differ between A and B
        self.assertNotEqual(out_a["lpm"][18], out_b["lpm"][18])
        # LPM at bar 26 (last with future window) should differ
        self.assertNotEqual(out_a["lpm"][26], out_b["lpm"][26])
        # Price[18] is the same -> line anchor is the same; only the magnitude differs
        # because future flow changed.


if __name__ == "__main__":
    unittest.main()
