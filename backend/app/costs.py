"""The one cost model anything that prices an IDX fill must charge.

Buy and sell are asymmetric on IDX: the sale value carries a 0.1% final tax on
top of brokerage, so one symmetric rate understates a round trip by 20 basis
points. `app/backtest.py` still charges a single rate for both sides; the paper
book charges this module's numbers, which are the ones the tickets quote
(`app/plan/idx.py`). Comparing the two therefore measures the strategy *and*
the 0.1% — unify backtest onto this module before drawing conclusions across
them.
"""

from __future__ import annotations

LOT = 100

# IDX online brokerage, broker-specific in practice.
BUY_FEE_RATE = 0.0015
SELL_FEE_RATE = 0.0025  # 0.15% brokerage + 0.1% PPh final on the sale value
SLIPPAGE_RATE = 0.0015


def buy_fill_price(price: float) -> float:
    """The price a market buy is assumed to pay, before fees."""
    return price * (1 + SLIPPAGE_RATE)


def sell_fill_price(price: float) -> float:
    """The price a market sell is assumed to receive, before fees."""
    return price * (1 - SLIPPAGE_RATE)


def buy_cash(price: float, shares: int) -> float:
    """Total cash a buy takes out of the book, slippage and fees included."""
    return buy_fill_price(price) * shares * (1 + BUY_FEE_RATE)


def sell_cash(price: float, shares: int) -> float:
    """Total cash a sell puts into the book, slippage and fees included."""
    return sell_fill_price(price) * shares * (1 - SELL_FEE_RATE)


def lots(shares: float) -> int:
    """Round a share count down to whole IDX lots."""
    return int(shares // LOT) * LOT
