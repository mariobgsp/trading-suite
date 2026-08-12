# Trading Suite — IDX (Indonesia) Trading Platform

A self-hosted Indonesian stock-market platform: live quotes, charting, screening,
bandarmology (smart-money) validation, portfolio FIFO accounting, regime filter,
backtesting, AI summaries, and rule-based entry plans — all backed by real data
for the 900+ ticker IDX universe.

```
┌─────────────┐     /api/* proxy      ┌──────────────┐
│  pilot web  │ ─────────────────────▶ │  FastAPI     │──▶ yfinance / SQLite cache
│ (:3001 SSR) │                        │  (:8000)     │──▶ TradingView scanner scrape
└─────────────┘                        │              │──▶ opencode-go model (optional)
        ▲                              └──────────────┘
        │ (legacy Next.js app also ships: :3000)
```

## Monorepo layout

| Path | What it is |
| --- | --- |
| `backend/` | FastAPI service: market data, indicators, screener, validator, portfolio, regime, backtest, sentiment, AI summaries, entry plans |
| `backend/app/` | API routers + services (`market`, `screener`, `validator`, `portfolio`, `regime`, `backtest`, `sentiment`, `movers`, `entry`, `ai`, `indicators`) |
| `backend/app/routers/` | FastAPI route modules (`/api/*`) |
| `backend/core/` | Canonical technical-indicator math (SMA/EMA/RSI/MACD/ATR/Stochastic/CMF/MFI/PSAR/A-D line, …) |
| `backend/config/` | 900+ ticker IDX universe, index symbols |
| `backend/tests/` | Offline pytest suite (synthetic data — no network) |
| `pilot/` | Migration-pilot frontend: TanStack Start + Hono SSR, Vite, lightweight-charts |
| `pilot/src/routes/` | Pilot pages: `/`, `/overview`, `/markets`, `/validator`, `/screener`, `/portfolio`, `/backtest`, `/sentiment`, `/regime` |
| `src/` | Legacy Next.js frontend (runs alongside; compare mode) |
| `legacy/` | Archived original source repos (six merged codebases) |
| `docker-compose.yml` | Runs backend + frontend + pilot as containers |

## Prerequisites

- Python 3.11+ with `backend/.venv` (project virtualenv; `python-dotenv` in requirements)
- Node.js 22+ (pilot uses `tsx`, Vite 6, TanStack Start)
- Docker / Podman (optional — for the compose stack)

## Setup

### 1. Backend

```sh
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # optional secrets; the stack runs fine empty
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
```

API health: <http://127.0.0.1:8000/api/health> · Swagger: <http://127.0.0.1:8000/docs>

> The backend never calls `load_dotenv()` — pass `--env-file .env` (as above) or
> export the variables in the process environment.

### 2. Pilot web app (recommended UI)

```sh
cd pilot
npm install
npm run dev          # client-only Vite dev server (:5173)
# or production SSR:
npm run build && npm start   # Hono + TanStack Start on :3001
```

`pilot` proxies `/api/*` to the backend at `:8000` (Vite dev proxy / Hono gateway),
so the frontend is same-origin — no `VITE_API_URL` needed locally.

### 3. Legacy Next.js app (optional)

```sh
npm install
npm run dev          # Next.js on :3000
```

### 4. Docker stack (optional)

```sh
cp .env.example .env
docker compose up -d --build     # backend :8000, frontend :3000, pilot :3001
```

## Environment variables

All are optional — the suite runs with empty secrets (AI features fall back to
deterministic text).

| Variable | Purpose |
| --- | --- |
| `OPENCODE_GO_API_KEY` | API key for the opencode-go / deepseek model — enables AI summaries & entry-plan narration |
| `OPENCODE_GO_BASE_URL` | Default `https://opencode.ai/zen/go/v1` |
| `OPENCODE_GO_MODEL` | Default `deepseek-v4-flash` |
| `STOCKBIT_JWT_TOKEN` | Stockbit feed / bandarmology detector (optional) |
| `GEMINI_API_KEY` | Legacy bot pipeline (optional) |
| `YFINANCE_CACHE_TTL` / `YFINANCE_HISTORY_CACHE_TTL` / `FOREX_CACHE_TTL` | Cache TTLs in seconds (quotes 1h, history 12h, forex 1h) |
| `CORS_ORIGINS` | Allowed browser origins (comma-separated) |
| `NEXT_PUBLIC_API_URL` | Legacy frontend → API base (default `http://localhost:8000`) |

Secrets live in gitignored `.env` files; never commit real keys.

## Data sources

- **Quotes / history** — yfinance (`.JK` symbols, `^JKSE` etc.), cached in SQLite
  (`backend/data/cache.db`) with TTLs; stale-cache fallback on upstream failures.
- **Top gainers / losers + sector rotation** — scraped from TradingView's
  Indonesia scanner API (one POST returns the full ~885-ticker universe with
  sector + % change; 5-minute cache).
- **AI model** — opencode-go chat-completions endpoint via `backend/app/ai.py`.
  When unconfigured/unreachable, summaries and narrations fall back to
  deterministic data-derived text so the UI never hard-fails.

## API endpoints

### Market (`/api/market`)

| Endpoint | Description |
| --- | --- |
| `GET /indices` | IHSG / LQ45 / IDX30 / IDX80 / BISNIS-27 / INFOBANK15 quotes |
| `GET /quote/{ticker}` | Single quote (`?force=true` bypasses cache) |
| `GET /quotes?tickers=BBCA,BBRI` | Batch quotes |
| `GET /history/{ticker}?period=1y&interval=1d` | OHLCV + indicator bundle (`indicators`, `latest_indicators`, `momentum`) |
| `GET /beta/{ticker}` | Beta / correlation / excess return vs ^JKSE (3M/6M/1Y) + classification |
| `GET /movers?side=gainers&limit=20` | Top gainers/losers by % change (IDX convention) |
| `GET /sectors` | Per-sector avg % change, gainer/loser counts (rotation view) |
| `GET /forex` | USD/IDR |
| `GET /cache/stats` | Cache diagnostics |

Indicators emitted by `/history`: SMA20/50/200, EMA9/21, RSI(14), ATR(14), MACD,
**Stochastic 10,3,3**, OBV, VWAP, **CMF(20)**, **MFI(14)**, **PSAR** (0.02/0.02/0.20),
**A/D line**, **VOL MA20**.

### Validator (`/api/validator`)

| Endpoint | Description |
|---|---|
| `GET /{ticker}` | Bandarmology: bandar phase, institutional flow, hidden-intent radar, liquidity, CMF/MFI, RSI |

### Screener (`/api/screener`)

| Endpoint | Description |
| --- | --- |
| `GET /tickers` | Universe list |
| `GET /analyze/{ticker}` | Single-ticker behavior score |
| `GET /squeeze/{ticker}` | MA-squeeze check |
| `GET /vault/{ticker}` | Vault MA-positioning score |
| `GET /scan` / `GET /scan/stream` | Universe scan (REST + SSE streaming) |

### Regime / sentiment / portfolio / backtest

| Endpoint | Description |
| --- | --- |
| `GET /api/regime/snapshot` · `/api/regime/history` | IHSG regime filter + index history |
| `GET /api/regime/stockbit` · `/api/regime/stockbit/detector/{ticker}` | Stockbit feeds (optional) |
| `GET /api/sentiment/news` · `/api/sentiment/idx` | News sentiment radar |
| `GET /api/portfolio/state` · `/watchlist` · `/journal` · `/pending-orders` | FIFO ledger (GET/POST) |
| `GET /api/backtest/strategies` · `/{ticker}` | Strategy backtests |

### AI & analysis

| Endpoint | Description |
| --- | --- |
| `GET /api/summary/{page}?ticker=` | AI summary per page (`launcher`…`regime`); model call or offline fallback |
| `GET /api/analysis/entry/{ticker}` | Rule-based entry plan (score, zone, stop, targets, triggers) + AI narration |

## Pilot pages

| Route | What it shows |
| --- | --- |
| `/` | App launcher (all tools) |
| `/overview` | Indices strip, top gainers/losers, sector rotation, regime, AI summary |
| `/markets` | Multi-pane chart: candles + SMA/EMA + PSAR dots · volume + VOL MA20 (always on) · Stochastic 10,3,3 (always on) · MFI/CMF/A-D line (toggleable panes) · beta vs IHSG · AI summary |
| `/validator` | Bandarmology analysis + entry plan + AI summary |
| `/screener` | Single-ticker analysis + streaming universe scan (SSE) |
| `/portfolio` | FIFO positions, cash, realized/unrealized P&L |
| `/backtest` | Strategy backtests |
| `/sentiment` | News sentiment radar |
| `/regime` | IHSG regime + bot engine filter |

AI summaries render on `/markets`, `/validator`, `/screener` (per single ticker),
and `/overview`. The other pages never mount or fetch a summary.

## Testing & checks

```sh
# Backend: offline unit tests (synthetic data, no network)
( cd backend && .venv/bin/python -m pytest -q )

# Pilot: typecheck, lint, build
( cd pilot && npx tsc --noEmit )
( cd pilot && npx eslint . )
( cd pilot && npm run build )
```

## License

Released under the [MIT License](LICENSE).
