# 📊 IHSG Swing Trading — Daily Report (02-07-2026)

> **Date:** 02-07-2026
> **Last Updated:** 2026-07-02T20:56:58.253132+00:00

---

## How to Read This Report

This report contains today's market analysis (regime, trade signals, wait list) and the current state of the paper trading portfolio. Each day generates a separate report file.

---

## 📅 2026-07-02

### 🕐 Midday Evaluation

> ✅ **No macro veto** — Market conditions are acceptable.

- **IHSG Daily Change:** 🟢 +0.91%

_No alerts triggered._


### 🟡 CAUTION Market Regime — Daily Scan

> The market shows mean-reverting behavior (Hurst < 0.45). Only selected engines are active (FVG, B.O.W., EMA, VCLR, Wyckoff). Position sizes are halved.

| Indicator | Value |
|-----------|-------|
| IHSG Close | IDR 5,695 |
| SMA(50) | IDR 6,524 |
| SMA(200) | IDR 7,763 |
| ATR(14) | IDR 190 |
| Hurst Exponent | 0.43 |

#### 📋 Scan Summary

| Metric | Count |
|--------|-------|
| Total Scanned | 958 |
| With Data | 958 |
| ❌ Avoid (filtered) | 759 |
| ⏳ Wait (setting up) | 68 |
| ✅ Trade (actionable) | 0 |
| ⏭️ Skipped | 0 |

#### 🎯 Trade Signals

_No trade signals today._

#### ⏳ Wait List (20 stocks setting up)

| Ticker | Condition | Price |
|--------|-----------|-------|
| AALI | Price is in a tight trading range — watching for breakout | IDR 5,975 |
| ACES | Price is in a tight trading range — watching for breakout | IDR 328 |
| ADRO | Price is in a tight trading range — watching for breakout | IDR 2,280 |
| AKRA | Price is in a tight trading range — watching for breakout | IDR 1,235 |
| AMRT | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,375 |
| ARCI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 925 |
| ASII | Price is in a tight trading range — watching for breakout | IDR 4,580 |
| AUTO | Price is in a tight trading range — watching for breakout | IDR 2,360 |
| AYAM | Price is in a tight trading range — watching for breakout | IDR 344 |
| BAIK | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 645 |
| BBRM | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 122 |
| BIRD | Price is in a tight trading range — watching for breakout | IDR 1,515 |
| BJBR | Price is in a tight trading range — watching for breakout | IDR 755 |
| BJTM | Price is in a tight trading range — watching for breakout | IDR 505 |
| BNBR | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 105 |
| BNGA | Price is in a tight trading range — watching for breakout | IDR 1,515 |
| BSSR | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 4,000 |
| BTPS | Price is in a tight trading range — watching for breakout | IDR 965 |
| CMNT | Price is in a tight trading range — watching for breakout | IDR 795 |
| CMRY | Price is in a tight trading range — watching for breakout | IDR 4,320 |

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