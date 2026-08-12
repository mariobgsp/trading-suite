> Part of [[trading-simulator/trading-simulator|trading-simulator]] project

# Trading Simulator — Project Documentation

## Introduction

The Trading Simulator is a hybrid, local-first paper-trading platform designed for power users who require extreme accuracy in multi-currency portfolio tracking (e.g., trading both US Stocks in USD and Indonesian Stocks in IDR, with an IDR base currency). 

Unlike standard paper trading applications, this simulator focuses heavily on **Information Density**. It integrates directly with market intelligence APIs to provide a "Bloomberg Terminal" experience directly in your browser.

---

## Core Capabilities

### 1. Multi-Currency FIFO Engine
- **Accurate Cost Basis**: The engine logs exact historical exchange rates (USD to IDR) on the day of the trade.
- **FIFO Matching**: Realized PnL is calculated strictly using First-In-First-Out methodology, crucial for accurate tax simulation and capital gains tracking.
- **Phantom Auto-Execution**: Stop Loss (SL) and Take Profit (TP) thresholds are monitored against daily High/Low data. If a threshold is breached, the trade is automatically executed locally.

### 2. Market Intelligence & Analytics
The application is heavily enriched with features typically found in premium terminal software:
- **Bandarmology Detection**: Analyzes institutional accumulation and distribution phases.
- **Broker Summaries**: Identifies the top buyers and sellers (brokers) for a given stock.
- **Active Trade & Orderbook**: Visualizes current market liquidity, bid/ask ratios, and daily trade velocity.
- **Fundamental Key Stats**: Displays valuation ratios, income statements, and balance sheet metrics.
- **Sentinel News Intelligence**: A multi-channel news wire with AI-driven sentiment analysis and automated summaries. It aggregates official IDX news and major Indonesian financial portals.

### 3. Advanced TradingView-Style Charting
- Uses `lightweight-charts` to provide fluid, responsive charting.
- Features custom-calculated technical indicators: **RSI**, **Stochastic Oscillator**, and **MFI** (Money Flow Index).
- **Custom Bandarmology Overlay**: Plots a Cumulative Flow Indicator (CFI) directly over the price action to instantly visualize Smart Money divergence.

---

## Operational Workflow

### 1. Environment Setup
To utilize the full capabilities of the terminal (specifically the Stockbit market data), an authentication token is required.
1. Copy `.env.example` to `.env` inside the `dashboard` directory.
2. Obtain a valid JWT token from your active Stockbit session.
3. Paste the token into `STOCKBIT_JWT_TOKEN=` in the `.env` file.

### 2. Running the Terminal
The terminal operates as a local Vite web server.

```bash
cd dashboard
npm install
npm run dev
```
Navigate to `http://localhost:5173`. The proxy server will automatically mask your API requests and append your JWT token, avoiding CORS issues.

### 3. Placing Trades
- **Direct Orders**: Execute market buys and sells directly from the `Portfolio` tab.
- **Pending Orders**: Add limit orders or breakout triggers to `pending_orders.json`.
- **Reset**: The "Clear" button instantly wipes your trading history, allowing you to reset your simulator capital back to the initial state.

### 4. Market Intelligence Processing
To keep the Sentinel News Wire updated with the latest headlines and sentiment analysis, you should run the news pipeline:

```bash
# Fetch latest news from IDX and Portals
python news_service.py

# Perform sentiment analysis and summary generation
python news_analyzer.py
```

### 5. Background Execution
To ensure pending orders and Stop-Loss thresholds trigger properly based on daily market action, run the main engine:

```bash
python engine.py
```
*Note: If hosted on GitHub, all these processes are handled automatically via GitHub Actions.*

---

## Directory Reference

- `/dashboard`: The React 19 application. Contains all UI components, custom hooks, charting logic, and the Vite proxy configuration.
- `/documentation`: High-level architecture and project documentation.
- `engine.py`: The main portfolio clearing house script.
- `news_service.py` & `news_analyzer.py`: The Sentinel news intelligence pipeline.
- `news_data.json`: The database of analyzed news and market signals.
- `journal.json`: Your master trading ledger.
- `pending_orders.json`: Unfilled trading limits and triggers.
- `watchlist.json`: Your local ticker tracking list.
