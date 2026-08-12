"""
CLI to check the current IHSG market regime.

Usage:
    python -m scripts.regime
    python -m scripts.regime -v
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config.settings import LOG_DATE_FORMAT, LOG_FORMAT, REGIME_SMA_LONG, REGIME_SMA_SHORT, REGIME_ATR_PERIOD
from core.regime import MarketRegime, RegimeType


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="IHSG Market Regime Check")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format=LOG_FORMAT, datefmt=LOG_DATE_FORMAT,
                        handlers=[logging.StreamHandler(sys.stdout)])
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    logger = logging.getLogger("scripts.regime")

    logger.info("Fetching IHSG composite regime...")
    regime = MarketRegime(period="1y")
    snap = regime.get_snapshot()

    print()
    print("=" * 60)
    print("IHSG MARKET REGIME")
    print("=" * 60)
    print(f"  Status:       {snap.regime.value}")
    print(f"  IHSG Close:   {snap.close:,.0f}")
    print(f"  SMA({REGIME_SMA_SHORT}):      {snap.sma_short:,.0f}")
    print(f"  SMA({REGIME_SMA_LONG}):     {snap.sma_long:,.0f}")
    print(f"  ATR({REGIME_ATR_PERIOD}):      {snap.atr_value:,.0f}")
    print(f"  As-of:        {snap.as_of_date}")
    print()

    # Engine permissions
    for eng in ["fvg_pullback", "momentum_breakout", "buying_on_weakness"]:
        allowed = "YES" if snap.allows_engine(eng) else "NO"
        print(f"  {eng:25s} -> {allowed}")

    print("=" * 60)

    # Interpretation
    if snap.regime == RegimeType.BULL:
        print("  All engines active. Full position sizing.")
    elif snap.regime == RegimeType.CAUTION:
        print("  Reduced engines. Consider half position sizes.")
    else:
        print("  BEAR market. Only B.O.W. engine active. Defensive mode.")
    print()


if __name__ == "__main__":
    main()
