# 📊 IHSG Swing Trading — Daily Report (18-06-2026)

> **Date:** 18-06-2026
> **Last Updated:** 2026-06-18T22:00:40.323726+00:00

---

## How to Read This Report

This report contains today's market analysis (regime, trade signals, wait list) and the current state of the paper trading portfolio. Each day generates a separate report file.

---

## 📅 2026-06-18

### 🟡 CAUTION Market Regime — Daily Scan

> The market shows mean-reverting behavior (Hurst < 0.45). Only selected engines are active (FVG, B.O.W., EMA, VCLR, Wyckoff). Position sizes are halved.

| Indicator | Value |
|-----------|-------|
| IHSG Close | IDR 6,221 |
| SMA(50) | IDR 6,771 |
| SMA(200) | IDR 7,860 |
| ATR(14) | IDR 242 |
| Hurst Exponent | 0.41 |

#### 📋 Scan Summary

| Metric | Count |
|--------|-------|
| Total Scanned | 958 |
| With Data | 958 |
| ❌ Avoid (filtered) | 701 |
| ⏳ Wait (setting up) | 91 |
| ✅ Trade (actionable) | 0 |
| ⏭️ Skipped | 0 |

#### 🎯 Trade Signals

_No trade signals today._

#### ⏳ Wait List (20 stocks setting up)

| Ticker | Condition | Price |
|--------|-----------|-------|
| ACES | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 372 |
| AHAP | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 90 |
| AMRT | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,390 |
| APEX | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 132 |
| ANTM | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 3,170 |
| ARCI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,110 |
| ASLI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 232 |
| ASRI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 114 |
| ASSA | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 650 |
| ATAP | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 490 |
| AYAM | Volume Spread Analysis detected a squat candle — high volume, narrow range, possible reversal setup | IDR 346 |
| BBCA | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 6,075 |
| BBNI | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 3,730 |
| BBTN | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,240 |
| BIRD | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,660 |
| BLUE | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 3,420 |
| BMTR | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 118 |
| BSDE | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 595 |
| BSSR | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 4,350 |
| BTPS | Price is approaching a Fair Value Gap zone — watching for pullback entry | IDR 1,015 |

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