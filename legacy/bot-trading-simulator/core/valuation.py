"""
Valuation Engine — Gordon Equation & Discounted Dividend Model (DDM).

Enhancement v2: Bernstein-inspired mathematical valuation to prevent
buying into overvalued markets or individual stocks.

Two valuation methods:
  1. Gordon Equation: Expected Return = Dividend Yield + Dividend Growth Rate
  2. DDM Fair Value: Market Value = Present Dividend / (Discount Rate - Growth Rate)

If the current market price vastly exceeds the DDM fair value,
the stock's allocation priority is lowered.

Gated behind VALUATION_ENABLED (default False) because it requires
dividend data from yfinance.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from config.settings import DDM_DISCOUNT_RATE, DDM_OVERVALUED_RATIO

logger = logging.getLogger(__name__)


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class ValuationResult:
    """Complete valuation assessment for a stock."""

    ticker: str
    current_price: float
    dividend_yield: float | None  # D/P
    dividend_growth_rate: float | None  # g
    expected_return: float | None  # Gordon: D/P + g
    fair_value: float | None  # DDM: D1 / (r - g)
    price_to_fair_value: float | None  # Current Price / Fair Value
    is_overvalued: bool  # Price > DDM_OVERVALUED_RATIO * Fair Value
    details: dict


# ─── Pure Math Functions ─────────────────────────────────────────────────────


def gordon_expected_return(
    dividend_yield: float, dividend_growth_rate: float
) -> float:
    """
    Gordon Equation: Expected Return = Dividend Yield + Dividend Growth Rate.

    Parameters
    ----------
    dividend_yield : float
        Current annual dividend yield (D/P), e.g. 0.03 for 3%.
    dividend_growth_rate : float
        Expected annual dividend growth rate, e.g. 0.05 for 5%.

    Returns
    -------
    float
        Expected total return (as decimal, e.g. 0.08 for 8%).
    """
    return dividend_yield + dividend_growth_rate


def ddm_fair_value(
    current_dividend: float,
    discount_rate: float,
    growth_rate: float,
) -> float | None:
    """
    Discounted Dividend Model (DDM / Gordon Growth Model).

    Fair Value = D₁ / (r - g)
    where D₁ = D₀ × (1 + g) = next year's expected dividend.

    Parameters
    ----------
    current_dividend : float
        Current annual dividend per share (D₀).
    discount_rate : float
        Required rate of return (r), e.g. 0.12 for 12%.
    growth_rate : float
        Expected dividend growth rate (g), e.g. 0.05 for 5%.

    Returns
    -------
    float | None
        Estimated fair value per share. Returns None if r <= g
        (model breaks down when growth exceeds discount rate).
    """
    if discount_rate <= growth_rate:
        return None  # DDM undefined when g >= r

    d1 = current_dividend * (1.0 + growth_rate)
    return d1 / (discount_rate - growth_rate)


# ─── Integrated Valuation Check ─────────────────────────────────────────────


def evaluate_valuation(ticker: str) -> ValuationResult:
    """
    Fetch dividend data from yfinance and compute Gordon/DDM valuation.

    Parameters
    ----------
    ticker : str
        IDX ticker code (without .JK suffix).

    Returns
    -------
    ValuationResult
        Complete valuation assessment.
    """
    details: dict = {}

    try:
        import yfinance as yf
        import pandas as pd

        yf_ticker = yf.Ticker(f"{ticker}.JK")
        info = yf_ticker.info or {}

        current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        if not current_price or current_price <= 0:
            return ValuationResult(
                ticker=ticker, current_price=0,
                dividend_yield=None, dividend_growth_rate=None,
                expected_return=None, fair_value=None,
                price_to_fair_value=None, is_overvalued=False,
                details={"error": "no current price"},
            )

        # Get dividend yield
        div_yield = info.get("dividendYield")  # Already as decimal (0.03)
        trailing_dividend = info.get("trailingAnnualDividendRate", 0)

        if div_yield is None and trailing_dividend and current_price > 0:
            div_yield = trailing_dividend / current_price

        # Estimate dividend growth rate from historical dividends
        growth_rate = _estimate_dividend_growth(yf_ticker)

        # Gordon Expected Return
        expected_ret = None
        if div_yield is not None and growth_rate is not None:
            expected_ret = gordon_expected_return(div_yield, growth_rate)
            details["gordon_expected_return_pct"] = round(expected_ret * 100, 2)

        # DDM Fair Value
        fair_val = None
        price_to_fv = None
        is_overvalued = False

        if trailing_dividend and trailing_dividend > 0 and growth_rate is not None:
            fair_val = ddm_fair_value(
                trailing_dividend, DDM_DISCOUNT_RATE, growth_rate
            )
            if fair_val and fair_val > 0:
                price_to_fv = current_price / fair_val
                is_overvalued = price_to_fv > DDM_OVERVALUED_RATIO
                details["ddm_fair_value"] = round(fair_val, 2)
                details["price_to_fair_value"] = round(price_to_fv, 2)

        details.update({
            "dividend_yield_pct": round(div_yield * 100, 2) if div_yield else None,
            "dividend_growth_rate_pct": round(growth_rate * 100, 2) if growth_rate else None,
            "trailing_annual_dividend": trailing_dividend,
            "discount_rate_pct": DDM_DISCOUNT_RATE * 100,
        })

        return ValuationResult(
            ticker=ticker,
            current_price=current_price,
            dividend_yield=div_yield,
            dividend_growth_rate=growth_rate,
            expected_return=expected_ret,
            fair_value=fair_val,
            price_to_fair_value=price_to_fv,
            is_overvalued=is_overvalued,
            details=details,
        )

    except Exception as e:
        logger.debug("[%s] Valuation check failed: %s", ticker, e)
        return ValuationResult(
            ticker=ticker, current_price=0,
            dividend_yield=None, dividend_growth_rate=None,
            expected_return=None, fair_value=None,
            price_to_fair_value=None, is_overvalued=False,
            details={"error": str(e)},
        )


def _estimate_dividend_growth(yf_ticker) -> float | None:
    """
    Estimate the annual dividend growth rate from historical dividends.

    Uses the compound annual growth rate (CAGR) of dividends over
    the available history.
    """
    try:
        divs = yf_ticker.dividends
        if divs is None or divs.empty or len(divs) < 2:
            return None

        # Group by year and sum
        annual = divs.groupby(divs.index.year).sum()
        if len(annual) < 2:
            return None

        # Remove years with zero dividends
        annual = annual[annual > 0]
        if len(annual) < 2:
            return None

        first_div = float(annual.iloc[0])
        last_div = float(annual.iloc[-1])
        years = len(annual) - 1

        if first_div <= 0 or years <= 0:
            return None

        # CAGR = (ending / beginning) ^ (1/years) - 1
        cagr = (last_div / first_div) ** (1.0 / years) - 1.0

        # Clamp to reasonable range (-20% to +30%)
        return max(-0.20, min(0.30, cagr))

    except Exception:
        return None
