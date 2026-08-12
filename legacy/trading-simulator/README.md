
> Part of [[trading-simulator/trading-simulator|trading-simulator]] project

# 📈 Trading Simulator & Market Terminal

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/mariobgsp/trading-simulator)

A powerful, entirely local-first trading simulator and advanced market intelligence terminal. Built for multi-currency portfolios (US Stocks, Crypto, and IHSG) with **IDR (Indonesian Rupiah)** as the master base currency.

It uses a unique Git-Ops architecture: JSON files act as your database, a Python engine executes phantom orders, and a Vite/React application provides a live, dynamic, information-dense dashboard.

---

## 🌟 Key Features

*   **Bloomberg Terminal Dashboard**: An ultra-premium, high-density, dark-themed terminal UI that replicates classic professional financial workstations. Rebuilt with a true neutral-black theme, live WIB clock, IDX market session phase tracking, quick F-key function navigation (F1-F4), and a scrolling ticker tape fed by live watchlist quotes.
*   **Advanced Market Intelligence**: Integrated directly with external APIs (Stockbit, Tradersaham, IDX) to provide Bandarmology accumulation/distribution patterns, orderbook visualization, broker summaries, and key stats.
*   **Sentinel News Intelligence**: A multi-channel news wire that extracts real-time market news from major Indonesian portals (CNBC, Detik, CNN, Antara) and official IDX headlines. Features AI-driven sentiment analysis and summaries.
*   **Professional Charting**: Features a built-in TradingView-style interactive chart complete with custom technical indicators and a unique Bandarmology flow overlay.
*   **Multi-Currency FIFO Engine**: Accurately tracks realized Profit and Loss (PnL) using First-In-First-Out logic. It fetches the exact historical USD/IDR exchange rate for the day a foreign trade occurred to determine a precise cost basis.
*   **Phantom Auto-Execution**: The backend engine checks daily High/Low prices against your active positions. If a Stop Loss (SL), Take Profit (TP), or Trailing Stop is breached, it automatically executes the sell.
*   **Conditional Pending Orders**: Set "Support Buy" or "Breakout Buy" limit orders.

---

## 📚 Documentation

For a deep dive into the system design, operational workflow, and internal data structures, please see the dedicated documentation files:

*   **[Project Documentation](documentation/PROJECT_DOCUMENTATION.md)**: Details the core capabilities, setup instructions, and operational workflow.
*   **[Architecture Document](documentation/ARCHITECTURE.md)**: Explains the Git-Ops JSON database, the Dual-Engine execution model, and the Vite API Proxy architecture.

---

## 🚀 Quick Start (Local Dashboard)

The dashboard provides a premium, dark-mode terminal UI for live trading and portfolio tracking. 

### Prerequisites
*   **Node.js** (v18+) & **npm**
*   A valid Stockbit JWT token (required for advanced Market Intel features).

### 1. Setup Environment
```bash
cd dashboard
cp .env.example .env
# Edit .env and paste your STOCKBIT_JWT_TOKEN
```

### 2. Start the Terminal
```bash
npm install
npm run dev
```
Open your browser to `http://localhost:5173/`. You can now place trades, analyze the advanced charts, and watch live PnL.

---

## ⚙️ The Python Engine

To process historical FIFO matching, trigger phantom orders (SL/TP), and process pending orders on daily candle data, run the backend engine manually (or via GitHub Actions).

```bash
# Install Python dependencies (only needed once)
pip install yfinance

# Run the clearing house engine
python engine.py
```
