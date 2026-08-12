> Part of [[trading-simulator/trading-simulator|trading-simulator]] project

# Trading Simulator — Architecture Document

## System Overview

The Trading Simulator is a sophisticated, local-first financial terminal and paper-trading engine. It combines a git-ops JSON database, a Python-based execution engine, and a React/Vite dashboard to provide a professional trading experience that mirrors enterprise systems like Stockbit and TradingView.

The architecture is built around three core pillars:
1. **Local-First Data Persistence**: JSON files acting as databases.
2. **Dual-Engine Execution**: A Python backend engine for offline/phantom execution, and a TypeScript engine for real-time dashboard PnL calculation.
3. **Information Density & Market Intelligence**: Integration with external APIs (Stockbit, Tradersaham, Yahoo Finance) via Vite proxying to bypass CORS constraints and securely inject authentication tokens.

---

## 1. Data Layer (JSON Database)

The system relies on human-readable, version-controllable JSON files stored directly in the repository root. This guarantees data sovereignty and transparency.

*   `journal.json`: The immutable ledger. All events (BUY, SELL, DEPOSIT, WITHDRAW) are appended here. It acts as the single source of truth for the portfolio's history.
*   `pending_orders.json`: Tracks active conditional orders (e.g., Breakout Buy, Support Buy).
*   `watchlist.json`: Stores user-defined ticker symbols for quick tracking.

---

## 2. Backend Layer: Python Engine

Located at `engine.py` (and potentially `stockbit.py` for API syncs), the Python layer is designed to run asynchronously, either via manual cron jobs, systemd services, or GitHub Actions.

### Responsibilities:
*   **Phantom Execution**: Iterates through active positions and pending orders. It fetches historical/daily candle data to check if Stop Loss (SL), Take Profit (TP), or entry triggers have been breached. If breached, it auto-generates the corresponding SELL or BUY event in `journal.json`.
*   **Cost Basis & Forex Calculation**: Converts foreign assets (e.g., USD stocks or crypto) to the master currency (IDR) using the precise historical USDIDR exchange rate from the date of the transaction.
*   **State Generation**: Outputs cached analytical states to the `/output` folder, which can be consumed by lightweight static viewers.
*   **Sentinel News Wire**: Aggregates official IDX news and media portal headlines into `news_data.json` for frontend consumption.

---

## 3. News Intelligence Pipeline (Sentinel)

The Sentinel system is a two-stage pipeline designed to transform raw financial news into actionable trading signals.

1.  **Extraction (`news_service.py`)**: Fetches data from multiple sources:
    *   **Official IDX API**: Scrapes latest headlines directly from the Indonesian Stock Exchange.
    *   **Media Portals**: Parses RSS feeds from CNBC Indonesia, Detik Finance, CNN, and Antara.
    *   **Global Feeds**: Includes Yahoo Finance and Investing.com for macro context.
    *   **Ticker Tagging**: Automatically extracts 4-letter emiten codes from titles/descriptions.
2.  **Analysis (`news_analyzer.py`)**: A logic-driven analyzer that:
    *   Scores items for Bullish/Bearish sentiment based on financial keywords.
    *   Generates concise AI-style summaries for the "Sentinel News Wire" UI.
    *   Updates the `status` of news items from `raw` to `analyzed`.

---

## 4. Frontend Layer: React & Vite Dashboard

Located in the `/dashboard` directory, this layer transforms the raw JSON data into a rich, interactive trading terminal.

### Key Technologies:
*   **React 19 & TypeScript**: Strict typing for financial calculations.
*   **Vite**: Extremely fast HMR and local dev server.
*   **Lightweight-Charts**: TradingView's canvas-based charting library for high-performance financial visualizations.

### Component Architecture:
*   **Portfolio Module**: An internal TypeScript port of the Python engine runs live in the browser. It reads `journal.json`, applies FIFO (First-In-First-Out) matching logic, and calculates real-time PnL by combining historical costs with live market quotes.
*   **Market Intel Module**: Dedicated views for market analysis.
    *   `IndicatorSignalCard`: Analyzes and displays golden cross/death cross signals for MACD, RSI, and Stochastic oscillators.
    *   `BandarmologyCard`: Visualizes institutional accumulation/distribution, broker summaries, and net foreign flows.
    *   `OrderbookCard`: Bid/Ask visualization.
    *   `ActiveTradeCard` & `KeyStatsCard`: Financial ratios and daily trade velocity.

### Security & Proxy Architecture:
To access secure external APIs (like Stockbit) without exposing JWT tokens in the browser or triggering CORS errors, the Vite configuration (`vite.config.ts`) acts as an intermediate proxy server.

1.  **Yahoo Finance Proxy** (`/api/yahoo`): Routes to `query1.finance.yahoo.com` to fetch live prices and OHLCV data without CORS blocks.
2.  **Stockbit Proxy** (`/api/stockbit`): Routes to `api.stockbit.com`. It reads the `STOCKBIT_JWT_TOKEN` from the local `.env` file and securely injects it into the HTTP headers of every outgoing request.
3.  **Tradersaham Proxy** (`/api/tradersaham`): Routes to `api.tradersaham.com` to fetch detailed broker accumulation heatmap data.
