# Trading Suite — IDX (Indonesia) Trading Platform

A self-hosted Indonesian stock-market platform: live quotes, charting, screening,
bandarmology (smart-money) validation, ownership & shareholder intelligence,
portfolio FIFO accounting, regime filter, backtesting, AI summaries, and
rule-based entry plans — all backed by real data for the 900+ ticker IDX
universe.

```text
┌─────────────┐     /api/* proxy      ┌──────────────┐
│  pilot web  │ ─────────────────────▶ │  FastAPI     │──▶ IDX official API
│ (:3001 SSR) │                        │  (:8000)     │──▶ yfinance
└─────────────┘                        │              │──▶ TradingView scanner
        ▲                              └──────────────┘
        │ (legacy Next.js app also ships: :3000)
```

## Monorepo layout

| Path | What it is |
| --- | --- |
| `backend/` | FastAPI service: market data, indicators, screener, validator, ownership, portfolio, regime, backtest, sentiment, AI summaries, entry plans |
| `backend/app/` | API routers + services (`market`, `idx`, `intel`, `ownership`, `validator`, `portfolio`, `regime`, `backtest`, `sentiment`, `entry`, `ai`, `indicators`, …) |
| `backend/app/routers/` | FastAPI route modules (`/api/*`) |
| `backend/core/` | Canonical technical-indicator math (SMA/EMA/RSI/MACD/ATR/Stochastic/CMF/MFI/PSAR/A-D line, …) |
| `backend/config/` | 900+ ticker IDX universe, index symbols |
| `backend/tests/` | Offline pytest suite (synthetic data — no network) |
| `pilot/` | Main frontend: TanStack Start + Hono SSR, Vite, lightweight-charts |
| `pilot/src/routes/` | Pilot pages: `/`, `/overview`, `/markets`, `/ownership`, `/profiler`, `/validator`, `/screener`, `/portfolio`, `/backtest`, `/regime`, `/foreignflow`, `/brokerintel`, … (20 tools) |
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

### 2. Pilot web app (the main UI)

```sh
cd pilot
npm install
npm run dev          # Vite dev server on :3001
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

- **IDX official API** — `www.idx.co.id/primary/*` (GetStockSummary,
  GetCompanyProfilesDetail, GetBrokerSummary, GetAnnouncement, …). Used for the
  heatmap, movers, foreign flow, broker radar, ownership, announcements, and
  sector rotation. Fetched with curl_cffi Chrome impersonation + Playwright
  fallback; responses cached in SQLite with per-feed TTLs, plus
  stale-while-revalidate so slow IDX scrapes never block the UI.
- **Quotes / history** — yfinance (`.JK` symbols, `^JKSE` etc.), cached in SQLite
  (`backend/data/cache.db`) with TTLs; stale-cache fallback on upstream failures.
- **TradingView scanner** — top gainers/losers + sector rotation (one POST
  returns the full ~885-ticker universe with sector + % change; 5-minute cache).
- **AI model** — opencode-go chat-completions endpoint via `backend/app/ai.py`.
  When unconfigured/unreachable, summaries and narrations fall back to
  deterministic data-derived text so the UI never hard-fails.

## Caching & performance

- SQLite `kv_cache` (WAL) with per-feed TTLs: quotes 1h, history 12h, ownership
  24h, broker/foreign 1h, announcements 10m.
- **Stale-while-revalidate** on the slow IDX feeds (heatmap, movers): stale data
  is served instantly while a background thread refreshes — no request ever
  blocks on an IDX scrape.
- **Entry plans** are cached per ticker (10 min) including the AI narration;
  the profiler's Analyze button forces a fresh recompute.
- **Ownership history** keeps a per-ticker snapshot archive (up to 24 snapshots)
  that powers period-over-period diffs and 5/25/50% threshold watch.
- The pilot shows a global pending bar + per-panel refresh spinners while any
  data view is loading; all motion honors `prefers-reduced-motion`.

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

### Intel — IDX market intelligence (`/api/intel`)

| Endpoint | Description |
| --- | --- |
| `GET /heatmap` | Whole-IDX treemap (market cap √-scaled sizes, ±6% change colors, sector grouping) |
| `GET /movers?range_days=1&limit=50` | Leaders/laggards by JCI point contribution |
| `GET /foreign/universe` · `/foreign/{ticker}` | Net foreign flow — whole board + per ticker |
| `GET /broker/radar` · `/broker/{ticker}` | Exchange-level broker volume/value ranking; per-ticker foreign flow context |
| `GET /ownership/{ticker}` · `/ownership/{ticker}/history` | Shareholder / board / subsidiaries + snapshot-diff archive |
| `GET /announcements` | Official IDX announcements (45-day window, PDF links) |
| `GET /rotation?days=20` | Sector rotation |

### Validator (`/api/validator`)

| Endpoint | Description |
| --- | --- |
| `GET /{ticker}` | Bandarmology: bandar phase, institutional flow, hidden-intent radar (newest-first), liquidity, CMF/MFI, RSI |

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
| `/overview` | Indices strip, **IDX heatmap** (whole market at a glance), **JCI movers** (point contribution), regime filter |
| `/markets` | Multi-pane chart: candles + SMA/EMA + PSAR dots · volume + VOL MA20 (always on) · Stochastic 10,3,3 (always on) · MFI/CMF/A-D line (toggleable panes) · beta vs IHSG |
| `/ownership` | **Connection web** (2.5D radial graph: shareholders/board/subsidiaries, d3-force drift, hover-highlight, click-focus, parallax) · shareholder table · ownership-change diff archive · board lists |
| `/profiler` | One-screen full picture: quote, price action, beta, bandarmology, regime, **entry plan** — Analyze refreshes everything |
| `/foreignflow` | Foreign buy / sell split tables (top 10 + see-more), per-ticker breakdown |
| `/brokerintel` | Broker radar (exchange-level volume/value ranking) + per-ticker foreign flow context |
| `/validator` | Bandarmology analysis + entry plan + AI summary + intent radar (newest-first) |
| `/screener` | Single-ticker analysis + streaming universe scan (SSE) |
| `/portfolio` | FIFO positions, cash, realized/unrealized P&L |
| `/backtest` | Strategy backtests |
| `/sentiment` | News sentiment radar |
| `/regime` | IHSG regime + bot engine filter |
| `/announcements` | Official IDX announcements |
| `/watchlist` / `/journal` / `/msci` / `/sector-rotation` / `/calculators` / `/wiki` | Ledger, MSCI watch, rotation, calculators, wiki |

## Testing & checks

```sh
# Backend: offline unit tests (synthetic data, no network)
( cd backend && .venv/bin/python -m pytest -q )

# Backend: typecheck
( cd backend && pyright . )

# Pilot: lint + build
( cd pilot && npx eslint . )
( cd pilot && npm run build )
```

## License

Released under the [MIT License](LICENSE).
