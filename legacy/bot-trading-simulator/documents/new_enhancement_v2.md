# Role
You are an expert quantitative developer. I have an existing trading simulator repository that currently implements basic fundamental and technical strategies. 

# Objective
**DO NOT replace or rewrite the entire codebase.** Your task is to review the existing classes/functions and inject strict accuracy-enhancing filters and risk-management upgrades based on advanced quantitative theories. Integrate these directly into the existing pipeline to improve the win rate (batting average) and reduce false signals.

# Accuracy Enhancements to Implement

Please locate the relevant modules in the current codebase and apply the following upgrades:

## 1. Upgrade the Technical Entry Engine (Filter False Breakouts)
Currently, the simulator might be taking premature or false breakouts. Inject the following strict Mark Minervini Technical parameters to improve timing accuracy:
*   **Volume Confirmation on VCP:** Update the Volatility Contraction Pattern (VCP) logic. It is not enough for price to contract; the code must verify that trading volume *significantly contracts (dries up)* during the tightest, right-most phase of the base. 
*   **Breakout Volume Spikes:** Require the breakout pivot point to be accompanied by a volume spike of several hundred percent above the daily average. If a price breaks resistance but volume is low, the code must reject the signal to avoid "whipsaws".
*   **Time Compression Filter:** Add a check to reject "V-shaped" recoveries. A proper consolidation must take time (e.g., 3 to 65 weeks). If the stock price runs up the right side of a base too quickly without a pause or "handle," reject the trade.

## 2. Upgrade the Fundamental Screener ("Code 33" & Graham Safety)
Refine the existing fundamental screener by tightening the mathematical thresholds:
*   **Minervini's "Code 33" Acceleration:** Enhance the earnings check. Instead of just looking for positive earnings, the code must specifically identify companies exhibiting 3 consecutive quarters of *accelerating* (increasing rate of growth) Earnings Per Share, Sales, and Profit Margins simultaneously.
*   **Graham's Defensive Filter:** Inject a strict balance sheet check: Current Assets must be >= 2x Current Liabilities (2:1 ratio), and Long-Term Debt must strictly not exceed Net Current Assets (Working Capital).

## 3. Upgrade the Valuation Engine (Bernstein's Gordon Equation)
To accurately estimate long-term expected returns and prevent buying into overvalued markets, implement William Bernstein's mathematical formulas into the valuation module:
*   **The Gordon Equation:** Create a function to evaluate the market or asset's expected return using the formula: `Expected Return = Dividend Yield + Dividend Growth Rate`. 
*   **Discounted Dividend Model (DDM):** Inject a fair-value baseline check using the formula: `Market Value = Present Dividend / (Discount Rate - Dividend Growth Rate)`. If the current market price vastly exceeds this calculated value, lower the asset's allocation priority.

## 4. Upgrade Risk & Survival Logic (Dynamic Stop-Losses)
To maximize the system's survival mathematical expectancy, update the exit execution logic:
*   **The Cardinal Sin Check:** The stop-loss must no longer be a static arbitrary number. The code must dynamically calculate the simulator's *historical average gain* per winning trade. The maximum stop-loss must be hardcoded to **never exceed one-half (50%) of that average gain**. 
*   **Absolute Maximum:** Even if the average gain is huge, the stop-loss must hit a hard ceiling at a maximum of 10%.
*   **Anti-Averaging Down:** Ensure there is strict logic that absolutely prevents the simulator from allocating more capital to a losing position (averaging down). Scaling in is only permitted if the initial purchase shows a profit.

# Instructions for the AI
1. Ask me to provide the specific existing files or functions (e.g., `screener.py`, `execution.py`).
2. Provide only the updated `diff` or specific injected code snippets to merge into the existing architecture. 
3. Explain briefly how each injected filter mathematically improves the current simulator's accuracy.
