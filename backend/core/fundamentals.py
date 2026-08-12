"""
Fundamental Screener — Code 33 & Graham Defensive Filter.

Enhancement v2: Advanced fundamental checks to filter out
fundamentally weak stocks before they reach the Trade bucket.

Two independent screeners:
  1. Minervini "Code 33" Acceleration — 3 consecutive quarters of
     accelerating EPS, Sales, AND Profit Margins simultaneously.
  2. Graham Defensive Filter — Current Ratio >= 2.0 AND
     Long-Term Debt <= Net Current Assets (Working Capital).

Both are gated behind FUNDAMENTAL_SCREENER_ENABLED (default False)
because they require per-ticker yfinance API calls (slow + rate-limited).
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from config.settings import (
    CODE33_MIN_QUARTERS,
    GRAHAM_CURRENT_RATIO_MIN,
    GRAHAM_DEBT_TO_WC_MAX,
)

logger = logging.getLogger(__name__)


# ─── Code 33: Earnings Acceleration ─────────────────────────────────────────


def check_code33_acceleration(ticker: str) -> tuple[bool, dict]:
    """
    Check for Minervini "Code 33" — accelerating fundamentals.

    Requires N consecutive quarters where the *rate of growth* in
    EPS, Revenue, and Net Margin is **increasing** (acceleration).

    Parameters
    ----------
    ticker : str
        IDX ticker code (without .JK suffix).

    Returns
    -------
    tuple[bool, dict]
        (passed, details) — passed is True if the stock meets Code 33.
    """
    details: dict = {"check": "code33", "ticker": ticker}

    try:
        import yfinance as yf
        yf_ticker = yf.Ticker(f"{ticker}.JK")

        # Fetch quarterly income statement
        income = yf_ticker.quarterly_income_stmt
        if income is None or income.empty:
            details["error"] = "no quarterly income data"
            return False, details

        # Transpose so rows = quarters, cols = metrics
        inc = income.T.sort_index()

        # Extract key metrics (yfinance uses these labels)
        eps_key = None
        revenue_key = None
        net_income_key = None

        for col in inc.columns:
            col_lower = col.lower() if isinstance(col, str) else ""
            if "diluted eps" in col_lower or "basic eps" in col_lower:
                eps_key = col
            elif "total revenue" in col_lower:
                revenue_key = col
            elif "net income" in col_lower and net_income_key is None:
                net_income_key = col

        if eps_key is None or revenue_key is None:
            details["error"] = "missing EPS or Revenue columns"
            return False, details

        # Calculate YoY growth rates for each quarter
        # We need at least CODE33_MIN_QUARTERS + 1 quarters to compute growth
        if len(inc) < CODE33_MIN_QUARTERS + 1:
            details["error"] = f"only {len(inc)} quarters available"
            return False, details

        eps_values = inc[eps_key].dropna().values
        rev_values = inc[revenue_key].dropna().values

        if len(eps_values) < CODE33_MIN_QUARTERS + 1:
            details["error"] = "insufficient EPS data"
            return False, details

        # Calculate sequential growth rates
        eps_growth = []
        rev_growth = []
        for i in range(1, len(eps_values)):
            if eps_values[i - 1] != 0:
                eps_growth.append(
                    (eps_values[i] - eps_values[i - 1]) / abs(eps_values[i - 1])
                )
            else:
                eps_growth.append(0.0)
            if rev_values[i - 1] != 0 and i < len(rev_values):
                rev_growth.append(
                    (rev_values[i] - rev_values[i - 1]) / abs(rev_values[i - 1])
                )
            else:
                rev_growth.append(0.0)

        # Check for acceleration: growth rate must be increasing
        # for the last CODE33_MIN_QUARTERS periods
        eps_accel = _is_accelerating(eps_growth, CODE33_MIN_QUARTERS)
        rev_accel = _is_accelerating(rev_growth, CODE33_MIN_QUARTERS)

        # Profit margin acceleration check
        margin_accel = False
        if net_income_key and revenue_key:
            net_inc = inc[net_income_key].dropna().values
            rev_for_margin = inc[revenue_key].dropna().values
            min_len = min(len(net_inc), len(rev_for_margin))
            if min_len >= CODE33_MIN_QUARTERS + 1:
                margins = []
                for i in range(min_len):
                    if rev_for_margin[i] != 0:
                        margins.append(net_inc[i] / rev_for_margin[i])
                    else:
                        margins.append(0.0)
                # Calculate margin growth
                margin_growth = []
                for i in range(1, len(margins)):
                    margin_growth.append(margins[i] - margins[i - 1])
                margin_accel = _is_accelerating(margin_growth, CODE33_MIN_QUARTERS)

        passed = eps_accel and rev_accel and margin_accel

        details.update({
            "eps_accelerating": eps_accel,
            "revenue_accelerating": rev_accel,
            "margin_accelerating": margin_accel,
            "quarters_checked": CODE33_MIN_QUARTERS,
        })

        return passed, details

    except Exception as e:
        logger.debug("[%s] Code 33 check failed: %s", ticker, e)
        details["error"] = str(e)
        return False, details


def _is_accelerating(growth_rates: list[float], n_periods: int) -> bool:
    """
    Check if the last n_periods growth rates are strictly increasing.

    This confirms acceleration — the rate of growth is itself growing.
    """
    if len(growth_rates) < n_periods:
        return False

    recent = growth_rates[-n_periods:]
    for i in range(1, len(recent)):
        if recent[i] <= recent[i - 1]:
            return False
    return True


# ─── Graham Defensive Filter ────────────────────────────────────────────────


def check_graham_defensive(ticker: str) -> tuple[bool, dict]:
    """
    Check Graham's Defensive Filter — balance sheet safety.

    Conditions:
    1. Current Ratio >= 2.0 (Current Assets / Current Liabilities)
    2. Long-Term Debt <= Net Current Assets (Working Capital)

    Parameters
    ----------
    ticker : str
        IDX ticker code (without .JK suffix).

    Returns
    -------
    tuple[bool, dict]
        (passed, details) — passed is True if the stock meets Graham criteria.
    """
    details: dict = {"check": "graham_defensive", "ticker": ticker}

    try:
        import yfinance as yf
        yf_ticker = yf.Ticker(f"{ticker}.JK")

        bs = yf_ticker.balance_sheet
        if bs is None or bs.empty:
            details["error"] = "no balance sheet data"
            return False, details

        # Use the most recent period (first column)
        latest = bs.iloc[:, 0]

        # Extract balance sheet items (yfinance labels vary)
        current_assets = _find_item(latest, [
            "Current Assets", "Total Current Assets",
        ])
        current_liabilities = _find_item(latest, [
            "Current Liabilities", "Total Current Liabilities",
        ])
        long_term_debt = _find_item(latest, [
            "Long Term Debt", "Long-Term Debt",
            "Long Term Debt And Capital Lease Obligation",
        ])

        if current_assets is None or current_liabilities is None:
            details["error"] = "missing current assets/liabilities"
            return False, details

        # Current Ratio
        current_ratio = (
            current_assets / current_liabilities
            if current_liabilities != 0
            else float("inf")
        )

        # Working Capital (Net Current Assets)
        working_capital = current_assets - current_liabilities

        # Long-term debt check (default to 0 if not found)
        lt_debt = long_term_debt if long_term_debt is not None else 0.0
        debt_to_wc = (
            lt_debt / working_capital
            if working_capital > 0
            else float("inf")
        )

        passed_ratio = current_ratio >= GRAHAM_CURRENT_RATIO_MIN
        passed_debt = debt_to_wc <= GRAHAM_DEBT_TO_WC_MAX

        details.update({
            "current_ratio": round(current_ratio, 2),
            "working_capital": round(working_capital, 2),
            "long_term_debt": round(lt_debt, 2),
            "debt_to_wc_ratio": round(debt_to_wc, 2),
            "current_ratio_ok": passed_ratio,
            "debt_to_wc_ok": passed_debt,
        })

        return passed_ratio and passed_debt, details

    except Exception as e:
        logger.debug("[%s] Graham defensive check failed: %s", ticker, e)
        details["error"] = str(e)
        return False, details


def _find_item(series: pd.Series, labels: list[str]) -> float | None:
    """Find the first matching label in a balance sheet Series."""
    for label in labels:
        if label in series.index:
            val = series[label]
            if pd.notna(val):
                return float(val)
    return None
