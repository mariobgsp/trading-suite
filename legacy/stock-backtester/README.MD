# Stock Backtester & Smart Money Scanner

## 📈 Overview

A powerful stock analysis platform combining **technical analysis**, **smart money flow detection**, and **AI-powered news sentiment analysis**. Built with a Python/Flask backend and React/TypeScript frontend, fully containerized with Docker.

### Key Features

| Feature                      | Description                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 🖥️ **Overview Dashboard**    | Real-time trend analysis, technical conclusion (BUY/SELL), and key indicators summary                               |
| 🔎 **MA Squeeze Screener**   | Real-time SSE scanner across 900+ IHSG stocks detecting tight moving averages, convergence, and volume accumulation |
| 📊 **Interactive Charts**    | Candlestick charts with EMA (9/21/50/200), MACD, RSI, Stochastic, and volume overlay                                |
| 🧠 **Smart Money Detection** | Bandarmology indicators: CMF, NVI, PVI, Wyckoff Spring, Buy-on-Dip/Weakness signals                                 |
| 🔮 **Trend Prediction**      | Moving Average convergence/divergence forecasting                                                                   |
| 📰 **News Sentiment**        | Dictionary-based headline sentiment analysis (Bullish/Bearish/Neutral)                                              |
| ⏱️ **Multi-Timeframe**       | Daily, Weekly, and Monthly interval support                                                                         |
| 🧪 **Strategy Backtesting**  | Backtest signals against 2 years of historical data                                                                 |

## 📁 Project Structure

```
stock-backtester/
├── backend/                 # Python/Flask API
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── api.py               # Flask REST API endpoints
│   ├── main.py              # StockScanner core logic
│   └── simple_sentiment.py  # Dictionary-based sentiment analyzer
├── frontend/                # React/TypeScript UI
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── src/
│   │   ├── App.tsx
│   │   ├── types.ts
│   │   └── components/
│   │       ├── StockChart.tsx        # Interactive candlestick chart
│   │       ├── SmartMoneyPanel.tsx   # Smart money indicators
│   │       ├── Overview.tsx          # Dashboard overview & conclusion
│   │       ├── SentimentPanel.tsx    # News sentiment analysis
│   │       ├── BacktestResults.tsx   # Backtest summary
│   │       ├── PredictionResults.tsx # MA crossover predictions
│   │       ├── TickerInput.tsx       # Ticker search input
│   │       └── MAScreenerModal.tsx   # Real-time stock screener modal
│   └── package.json
├── docker-compose.yml
├── LICENSE
└── README.MD
```

## 🚀 Quick Start (Docker)

```bash
# Start both backend and frontend
docker compose up --build -d

# View logs
docker compose logs -f
```

| Service     | URL                                            |
| ----------- | ---------------------------------------------- |
| Frontend    | [http://localhost:8080](http://localhost:8080) |
| Backend API | [http://localhost:5000](http://localhost:5000) |

```bash
# Stop
docker compose down
```

## 🛠️ Development Setup

### Backend (Python 3.11 / Flask)

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python api.py
```

Server runs on `http://localhost:5000`

### Frontend (React / Vite / TypeScript)

```bash
cd frontend
npm install
npm run dev
```

Dev server runs on `http://localhost:5173`

## 📡 API Reference

### `POST /api/analyze`

Analyzes a stock ticker and returns comprehensive data.

**Request:**

```json
{
  "ticker": "BBCA",
  "period": "2y",
  "interval": "1d"
}
```

**Response includes:**

- `overview` — Comprehensive dashboard data (Trend, Conclusion, Forecasts)
- `historical_data` — OHLCV + indicators for charting
- `backtest_summary` — Signal backtest results
- `smart_money` — CMF, NVI, PVI, active signals
- `news_sentiment` — Headline sentiment analysis

### `GET /api/screener/stream` (SSE)

Real-time Server-Sent Events endpoint that scans 900+ IHSG stocks for MA squeeze setups.

**Response Events:**

- `info`: Initial scan parameters.
- `progress`: Streaming status updates including scanned count.
- `result`: Fired immediately when a matching setup is found.
- `done`: Final summary when scanning completes.

### `GET /api/screener/tickers`

Returns the list of 900+ IHSG tickers targeted by the screener.

## 🧪 Tech Stack

| Layer        | Technology                                         |
| ------------ | -------------------------------------------------- |
| **Backend**  | Python 3.11, Flask, yfinance, pandas, numpy, scipy |
| **Frontend** | React 18, TypeScript, Vite, lightweight-charts     |
| **Styling**  | CSS custom properties (dark theme)                 |
| **Infra**    | Docker, Docker Compose, Nginx                      |

## 📊 Indicators

### Technical

- **EMA**: 9, 21, 50, 200 period
- **MACD**: (12, 26, 9)
- **RSI**: 14 period
- **Stochastic**: %K / %D (14, 3)

### Smart Money (Bandarmology)

- **CMF**: Chaikin Money Flow (20 period)
- **NVI / PVI**: Negative / Positive Volume Index
- **Wyckoff Spring**: Detects spring reversal setups
- **Buy on Dip / Weakness**: Institutional accumulation signals

## 📜 Changelog

### v0.3.0 (Current)

- **MA Squeeze Screener**: Introduced a real-time SSE scanner hitting 900+ IHSG stocks to find tight moving averages, momentum convergence, and volume accumulation setups. Includes floating action button and intuitive table modal on the frontend.
- **Frontend Refinements**: Added types and components to handle Server-Sent Events gracefully. Fixed TypeScript build issues.

### v0.2.0

- **Smart Money Concepts (SMC)**: Integrated CMF, NVI, and active signal detection (Wyckoff Spring, Buy on Dip/Weakness).
- **Interactive Charting**: Upgraded to `lightweight-charts` for TradingView-style interactive candlestick charts.
- **Advanced Technicals**: Added MACD, RSI, Stochastic, and multiple EMAs (9, 21, 50, 200).
- **Overview Dashboard**: Added a consolidated dashboard with real-time trend analysis and actionable technical conclusions.
- **Architecture**: Separated frontend (React/Vite) and backend (Flask) for better scalability and Docker containerization.

### v0.1.0

- Initial release.
- Basic stock price visualization and historical data fetching.
- Simple Moving Average crossover strategy backtesting.
- AI-powered news sentiment analysis.

## 📄 License

See [LICENSE](LICENSE) for details.
