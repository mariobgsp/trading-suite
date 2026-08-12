# 📊 IHSG Swing Trading — Daily Report (05-07-2026)

> **Date:** 05-07-2026
> **Last Updated:** 2026-07-05T20:50:11.125336+00:00

---

## How to Read This Report

This report contains today's market analysis (regime, trade signals, wait list) and the current state of the paper trading portfolio. Each day generates a separate report file.

---

## 📅 2026-07-05

### 🟡 CAUTION Market Regime — Daily Scan

> The market shows mean-reverting behavior (Hurst < 0.45). Only selected engines are active (FVG, B.O.W., EMA, VCLR, Wyckoff). Position sizes are halved.

| Indicator | Value |
|-----------|-------|
| IHSG Close | IDR 5,876 |
| SMA(50) | IDR 6,450 |
| SMA(200) | IDR 7,742 |
| ATR(14) | IDR 179 |
| Hurst Exponent | 0.44 |

#### 📋 Scan Summary

| Metric | Count |
|--------|-------|
| Total Scanned | 958 |
| With Data | 958 |
| ❌ Avoid (filtered) | 756 |
| ⏳ Wait (setting up) | 85 |
| ✅ Trade (actionable) | 0 |
| ⏭️ Skipped | 0 |

#### 🎯 Trade Signals

_No trade signals today._

#### ⏳ Wait List (20 stocks setting up)

| Ticker | Condition | Price |
|--------|-----------|-------|
| AADI | Price is in a tight trading range — watching for breakout | IDR 7,975 |
| AALI | Price is in a tight trading range — watching for breakout | IDR 6,025 |
| ACES | Price is in a tight trading range — watching for breakout | IDR 338 |
| ADES | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 32,500 |
| ADRO | Price is in a tight trading range — watching for breakout | IDR 2,300 |
| AKRA | Price is in a tight trading range — watching for breakout | IDR 1,255 |
| AMRT | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,395 |
| ANTM | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 2,930 |
| ARCI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,005 |
| ASII | Price is in a tight trading range — watching for breakout | IDR 4,810 |
| AUTO | Price is in a tight trading range — watching for breakout | IDR 2,390 |
| AYAM | Price is in a tight trading range — watching for breakout | IDR 350 |
| BBCA | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 6,050 |
| BBNI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 3,250 |
| BDKR | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 145 |
| BIPI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 121 |
| BIRD | Price is in a tight trading range — watching for breakout | IDR 1,515 |
| BJTM | Price is in a tight trading range — watching for breakout | IDR 510 |
| BJBR | Price is in a tight trading range — watching for breakout | IDR 765 |
| BMRI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 4,010 |

#### 📝 Paper Trading Activity

| Metric | Value |
|--------|-------|
| Equity | IDR 5,000,000 |
| Total Return | 🟢 +0.00% |
| Open Positions | 0 |


---

# 📝 Paper Trading — Portfolio Overview

This report shows the current state of the paper trading simulator. The simulator executes all scanner signals automatically using IDR 5,000,000 starting capital with identical risk management rules as the backtester (slippage, fees, trailing stops, take-profit levels).

---

## 💰 Portfolio Overview

| Metric | Value |
|--------|-------|
| Starting Capital | IDR 5,000,000 |
| Current Equity | IDR 5,000,000 |
| Total Return | 🟢 +0.00% |
| Realized P&L | IDR 0 |
| Unrealized P&L | IDR 0 |
| Market Value (Positions) | IDR 0 |
| Portfolio Heat | 0.00% _(max 6%)_ |
| Win Rate | 0.0% |

<details>
<summary>📖 What do these metrics mean?</summary>

- **Equity** = Starting capital + all realized P&L. This is the "bank balance" after closing trades.
- **Realized P&L** = Total profit/loss from closed trades (after slippage + broker fees).
- **Unrealized P&L** = Paper profit/loss on open positions based on current market prices.
- **Market Value** = Current value of all open positions at market price.
- **Portfolio Heat** = Total risk exposure as % of initial capital. Capped at 6% to prevent catastrophic drawdowns.
- **Win Rate** = Percentage of closed trades that were profitable.

</details>

## 📊 Open Positions

_No open positions._

## 📈 Closed Trades

_No trades closed yet._

---

_This report is generated automatically by the IHSG Swing Trading System. Do not edit manually — it will be overwritten on the next scan._