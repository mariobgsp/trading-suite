# 📊 IHSG Swing Trading — Daily Report (23-06-2026)

> **Date:** 23-06-2026
> **Last Updated:** 2026-06-23T21:25:58.700359+00:00

---

## How to Read This Report

This report contains today's market analysis (regime, trade signals, wait list) and the current state of the paper trading portfolio. Each day generates a separate report file.

---

## 📅 2026-06-23

### 🕐 Midday Evaluation

> ✅ **No macro veto** — Market conditions are acceptable.

- **IHSG Daily Change:** 🔴 -0.84%

_No alerts triggered._


### 🟡 CAUTION Market Regime — Daily Scan

> The market shows mean-reverting behavior (Hurst < 0.45). Only selected engines are active (FVG, B.O.W., EMA, VCLR, Wyckoff). Position sizes are halved.

| Indicator | Value |
|-----------|-------|
| IHSG Close | IDR 6,117 |
| SMA(50) | IDR 6,714 |
| SMA(200) | IDR 7,835 |
| ATR(14) | IDR 244 |
| Hurst Exponent | 0.42 |

#### 📋 Scan Summary

| Metric | Count |
|--------|-------|
| Total Scanned | 958 |
| With Data | 958 |
| ❌ Avoid (filtered) | 715 |
| ⏳ Wait (setting up) | 78 |
| ✅ Trade (actionable) | 0 |
| ⏭️ Skipped | 0 |

#### 🎯 Trade Signals

_No trade signals today._

#### ⏳ Wait List (20 stocks setting up)

| Ticker | Condition | Price |
|--------|-----------|-------|
| ACES | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 336 |
| AHAP | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 88 |
| AKRA | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,265 |
| AMRT | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,410 |
| APEX | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 129 |
| ANTM | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 2,960 |
| ASLI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 236 |
| ASRI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 111 |
| ATLA | Price is in a tight trading range — watching for breakout | IDR 50 |
| ASSA | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 640 |
| ATAP | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 490 |
| BAIK | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 605 |
| BBCA | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 6,225 |
| BBNI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 3,490 |
| BDKR | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 136 |
| BFIN | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 685 |
| BIRD | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,685 |
| BMRI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 4,220 |
| BRMS | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 635 |
| BSML | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 476 |

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