# Trading Suite — the IDX scanner

> One question, answered every session: **which Indonesian stocks are near the
> measured setup, and which are on the watchlist?** A scanner, a FastAPI backend,
> and a rule chain re-transcribed from a walk-forward study — with the study's own
> artifacts as the evidence, and "no trade" as a first-class answer.

```
┌──────────────────────┐  /api/scanner + /api/plan  ┌────────────────────┐   ┌──────────────────────┐
│ Vite + React SPA     │ ──────────────────────────▶ │ FastAPI  :8000     │──▶│ study results (CSV)  │
│ :5173  (3 tabs)      │ ◀────────────────────────── │ app/plan/*         │   │ + daily bars + live  │
└──────────────────────┘   SWR cache                └─────────┬──────────┘   │   tail (yfinance)    │
                                                              │ SQLite WAL   └──────────────────────┘
                                                       ┌──────▼───────┐
                                                       │ cache.db     │
                                                       └──────────────┘
```

## Quick start

```sh
chmod +x ./trading-suite
./trading-suite run      # backend :8000 + frontend :5173
./trading-suite verify   # backend tests + frontend typecheck
./trading-suite stop     # kill both
./trading-suite logs      # tail -f /tmp/trading-suite/*.log
```

The backend needs the study checkout (see [Data](#data)) before the scanner can
answer anything; the first request reads ~887 ticker files and takes a few
seconds to half a minute, then the persisted payload answers from cache.

<details>
<summary>Raw commands, if you prefer not to use the runner</summary>

```sh
# backend
backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --app-dir backend

# frontend
cd frontend-web && npm install && npm run dev -- --port 5173
```

The browser fetches the API at `VITE_API_URL`, default `http://localhost:8000`. If
your browser resolves `localhost` to IPv6 and the backend is IPv4, start the
frontend with `VITE_API_URL=http://127.0.0.1:8000` and open `http://127.0.0.1:5173`.
</details>

## The three tabs

| Tab | Route | The question it answers |
| --- | --- | --- |
| **Scanner** | `/` | Setiap saham tradable di universe studi, di satu tabel. Tiap baris membawa kondisi yang sama dengan plan: breakout 40 sesi, momentum top 10%, volatilitas tenang. Filter `Tier 1`, `setup`, `breakout`, `momentum`, `quiet`, dan `capitulation watch`; hanya Tier 1 yang membawa hasil terukur. Klik satu ticker untuk Deep Dive |
| **Deep Dive** | `/deep/{ticker}` | Layak trade secara fundamental? dan secara teknikal? — two separate counted verdicts: the invest case's fundamental pillar (criteria against written bands, share structure, stake trend) and the method's condition chain (each gate with its value and run lengths, and the priced entry/target/stop when the name is buyable), plus the chart with levels, a 52-week range bar, KI filings, ticker news, and the flow-proxy research rail |
| **Backtest** | `/backtest` | Semua metode pada satu target, diadu dengan indeks: every strategy from `app/backtest.py` (MACD/RSI, Stoch reversal, golden cross, EMA crosses, TSMOM, breakout, pullback, volatility compression) simulated over one window through the same fee + slippage model, an equity-curve chart normalised to 100, stats with CAGR / max drawdown / alpha vs the index / time-in-market and a per-strategy walk-forward flag — with the walk-forward study's own corrected headline, the haircuts, and the five-year replay tiers beside it |

### Hidden routes

The old screens remain reachable by URL but are out of the header:

| Route | The question it answers |
| --- | --- |
| `/plan` | Should I buy anything tonight, and if so what exactly? The verdict, the order ticket for each name, the watchlist, and the measured case for standing down |
| `/paper` | The book the app fills by itself from the plan's signals |
| `/flow` | Bandarmology-style cards for a bounded universe: technicals and a **transparent flow-pressure proxy**. Not the vendor LPM, and never a plan input |
| `/method` | The rule chain, the result, the horizons that were measured and refused, the costs, and every citation |

`/screener` and `/market` redirect to `/`: the scanner replaces both.


The Flow panel is deliberately outside the method. Its score is built from Chaikin
Money Flow plus the current IDX foreign-flow print (and optional Stockbit broker
rows on explicit detail requests). The vendor formula and its data are proprietary;
the UI says "proxy" wherever the line appears, and the accuracy panel reports the
proxy's own forward-return record rather than a parity claim.

The selected name also gets an invest case: a fundamental pillar and a technical
pillar, each a count of criteria against written bands rather than a buy call,
plus shares outstanding, controlling versus public float, the stake trend between
archived ownership snapshots, and the ticker's own IDX KI filings and headlines.
Neither pillar is a plan input; `app.plan` does not import the case.

## The answer it gives

**Regime, in three bands** (breadth = share of the tradable universe above its own
200-session average):

| Band | Action |
| --- | --- |
| ≥ 0.60 | trade |
| 0.25 – 0.60 | **flat, by design** |
| < 0.25 | watchlist only |

The flat band is the finding, not a gap: the study measured it drifting about zero
over five sessions while a round trip costs 0.50%. It is ~72% of sessions.

**Entry**: a 40-session breakout, relative strength in the top 10% of the universe,
and 20-session volatility in its own lowest 40%. **Exit**: +13% target, −35% stop,
95-session cap. **Size**: 2% of median 60-session turnover, clamped to 2M–10M IDR,
rejected above 2% participation.

**One verdict per session**, in strict precedence:

| State | Meaning |
| --- | --- |
| `ENTER` | At least one name cleared every condition *and* can be sized |
| `WAIT` | The tape is right; nothing has cleared the chain yet |
| `NO_TRADE` | The band this method does not trade, or nothing fillable |
| `DATA_UNSAFE` | The bars or the evidence cannot be trusted — **every ticket is withheld** |

`DATA_UNSAFE` beats every signal. A screen that says "buy" on a broken bar source is
worse than one that says nothing, so the integrity checks (exchange calendar, bars
current, universe size, coverage, phantom bars, evidence readable) fail closed
rather than sitting beside a ticket as a warning.

## What it refuses to claim

The app shows three evidence tiers and never blends them:

| Tier | What it is |
| --- | --- |
| `searched_census` | a row of the study's results — a maximum over a search, not an expectation |
| `walk_forward_corrected` | what the study publishes after its own correctness pass (the headline) |
| `replay` | a one-window, mark-to-market projection |

- The headline is the **corrected** result: **76.32% win / +1.85% a trade, 9.4% max
  drawdown**, on 76 trades in three folds. The searched maximum (81.07% / +5.51%)
  is shown as what it is — a maximum — and the app says which it is quoting.
- Published trade counts are pools: the family's 523 trades sum four donchian
  windows, and this screen runs one of them (108 trades). Both numbers travel.
- The haircuts travel with the headline: dropping the best fifth of tickers leaves
  **+0.04%**, and unseen folds read **+0.09%**.
- The five-year replay books **−68.2%** for tier 1 and **−80.5%** pooled. Leverage
  is not modelled anywhere, and the one row that does model it puts 3× at −98.29%.
- **Day trading is refused with arithmetic, not opinion**: an intraday sleeve was
  designed, run over 30 configurations and declined — all negative, ~0.36%
  capturable against a 0.40–0.90% round trip, and no real intraday bars exist for
  the thin names this screen trades. No 1–3 session rule exists in the study at all.

The figures that exist only as prose in the study are cited in
[`backend/app/plan/citations.py`](backend/app/plan/citations.py) with file, line,
sentence and regeneration command, and
[`tests/test_plan_citations.py`](backend/tests/test_plan_citations.py) fails the
build when a cited line changes. The rule chain itself is diffed against the
study's own `strategies.signals()` by
[`tests/test_plan_conformance.py`](backend/tests/test_plan_conformance.py).

## The regime layer

The verdict is cut on three breadth bands, and the rounds that produced those
bands then measured what is tradable inside each one. That work - 1,060 bearish
cells, 820 sideways cells and 1,007 institutional-activity cells, each carried to
unseen folds and then re-measured on quarterly windows and under the survivorship
haircut - is read from the study's own artifacts at request time and shown where
the decision is made:

| Where | What it shows |
| --- | --- |
| Tonight, under the band | the band's measured 5-session drift, aggregated from the study's 262k-session diagnostic (+2.11% capitulation, about 0 sideways, +0.63% trending) |
| Tonight, in the capitulation band | the tier-3 watch: the names the study's `cap_bounce` rule would flag, with the sweep, the clean-universe re-measurement and the quarterly stress that refused it |
| Method, "The three regimes" | the per-regime holdout ledger, the frozen replays and their stress, the tier table, the flow census and the exit census |
| Scanner | the same measured drift, and the capitulation watchers when the band is one |

The study's answer, which the app carries rather than argues with: **nothing in the
bearish, sideways or institutional regimes clears the bar.** 0 of 1,060 bearish and
0 of 820 sideways cells cleared 80%/+5%; the best bearish rule is the long
`washout_donchian` at 71.65% / +3.02% (3 of 6 folds), the best sideways rule is
`range_revert` at 56.35% / +1.24%; every short family loses after costs; gating the
champion on institutional accumulation made it worse (51.06% to 45.52% win); and the
flow indicators were measured to *lag* breadth (best forward AUC 0.915 against
breadth's 0.996). All of it lives in
[`backend/app/plan/regimes.py`](backend/app/plan/regimes.py), read from the artifacts,
and [`tests/test_plan_regimes.py`](backend/tests/test_plan_regimes.py) fails the build
when an artifact stops carrying what the UI quotes.

The capitulation tier is the one lead the study found - and it refused it: 79.39% /
+7.26% on 131 illiquid trades, 53.15% / +0.15% on the clean universe, 60.47% / +2.84%
quarterly, and negative under the survivorship haircut. The app shows the watch list
with every one of those numbers attached, and never as a ticket.
## Data

**The study is a hard dependency.** By default the app reads
`~/Projects/trading-backtest-docs`; override with `TRADING_DOCS_DIR`:

```sh
TRADING_DOCS_DIR=/path/to/study ./trading-suite run
```

- Bars: the normalized local store at `backend/data/market.db` (SQLite, ~887
  names / ~1M rows), imported from the study's `data/raw/*.csv` and manifest.
  The CSVs + manifest remain the provenance of record; the store is the app's
  read path. The plan's default bar source is the store; a missing store falls
  back to the study CSVs, then to live Yahoo.
- Results: `results/*.csv` — the census, the ladder, the holdout, the replay.
- The API also keeps its own cache at `backend/data/cache/cache.db` (SQLite WAL)
  for yfinance/IDX/Intel feeds and the Flow payloads. Delete the file to reset.
  The persisted plans live there too under `computed:plan:*`.

**Weekly data update.** The store is refreshed once a week from Yahoo, through
the study's resumable fetch:

```sh
./trading-suite sync-data            # fetch 5y, repair, import, warm the plan (10-20m)
./trading-suite sync-data --no-fetch # repair + import the current study CSVs (~1m)
```

The sync is exclusive (a second run exits with `lock_busy`), replaces the bar
snapshot atomically, and computes the plan once at the end so the app's next start
does not pay the 26-second screen. It also runs the study's own phantom-bar
repair before importing: a fresh 5-year window can start earlier for the
benchmark than for a ticker whose fetch failed, and the plan's
`no_phantom_bars` integrity check would correctly refuse such a source
(`DATA_UNSAFE`). The systemd timer runs it every Saturday at
09:00 Asia/Jakarta:

```sh
cp systemd/trading-suite-sync.{service,timer} ~/.config/systemd/user/
# edit the checkout path in the service if it is not ~/Projects/trading-suite
systemctl --user daemon-reload
systemctl --user enable --now trading-suite-sync.timer
systemctl --user list-timers trading-suite-sync.timer
journalctl --user -u trading-suite-sync.service
```

The normal plan and daily history then read the store and do not call Yahoo.
Two paths deliberately still do: the explicit **Refresh** button (it needs the
latest bars) and the quote/IDX/Intel feeds whose TTLs are shorter than a week.
Weekly bars cannot be a live quote; the plan labels the data's `as_of` instead
of pretending otherwise.
- **Stockbit.** Flow's explicit broker detail can read Stockbit's own
  `marketdetectors` rows when `STOCKBIT_JWT_TOKEN` is set. That path is optional:
  without a token the proxy falls back to IDX foreign flow plus CMF and says so.
  There is no browser companion; the legacy `/api/intel/stockbit/*` endpoints
  remain for an operator who already has a token.

**Refresh** (the button in the header) pulls the latest daily bars and re-runs the
analysis. Two rules keep it honest: a bar dated **today is refused until 16:02 WIB**
(an unfinished candle is a partial price), and every failed name is counted, because
breadth is a share of the universe. The live tail is merged **in memory** — nothing
is ever written back into the study. The first press fetches the whole universe and
takes minutes; later ones are incremental.

**Caching.** The research surfaces persist computed payloads in the same SQLite
WAL cache as the market data (`backend/data/cache/cache.db`). Flow keys are
`flow:v2:*`; Market uses `computed:overview:v1:*`; the plan uses
`computed:plan:v2:*`, keyed by the store snapshot, the requested session and the
method family. The scanner uses `computed:scan:v2:*` with the universe floor and
frozen cut in the key. A warm plan is ~0.05s against the measured 26s cold
screen; the sync warms it after every import. Bump `PLAN_CACHE_VERSION` or
`SCAN_CACHE_VERSION` in `backend/app/plan/__init__.py` when the rule chain or
universe changes.

- **Flow**: cards, series and validation reports are keyed by their exact inputs
  and served for `FLOW_CACHE_TTL` seconds (default 300). Stale entries are kept
  for `FLOW_CACHE_STALE_DAYS` (default 7) and served with a warning if recompute
  fails. `?refresh=1` bypasses the cache; `GET /api/flow/cache` shows the keys,
  and `POST /api/flow/cache/clear` removes only Flow entries.
- **Market**: `GET /api/overview` only reads a persisted snapshot. A background
  job builds the first snapshot at startup and after a session changes; the page
  shows the previous snapshot while the new one is built. `POST
  /api/overview/refresh` starts the single-flight job, `GET
  /api/overview/status` reports its phase, and `GET /api/overview/cache` shows
  the store. A warm GET is a SQLite read, not a universe scan.

## API

| Endpoint | Notes |
| --- | --- |
| `GET /api/scanner` | every tradable name at one session: compact gate rows, the measured filter registry, universe counts and the index-context reading. `?as_of=` replays an earlier session |
| `GET /api/plan` | the session's verdict, candidates, watchlist, ranked universe, evidence, IDX tables. `?as_of=` replays an earlier session, `?exit_method=` switches among measured exits |
| `GET /api/plan/method` | rule definitions, the corrected row, the ladder, the horizon list, citations, robustness |
| `GET /api/plan/{ticker}` | one name: gates with run lengths, the why-now run-up, levels, a sized geometry |
| `POST /api/plan/size` | size one order and price its friction, without a universe pass |
| `POST /api/plan/refresh` | start a refresh job (poll `GET /api/plan/refresh/{id}`, stop with `POST …/cancel`) |
| `GET /api/flow/cards` | bounded Flow card scan; `universe=watchlist|movers|plan|tickers`, `limit`, `source` |
| `GET /api/flow/{ticker}` | price + proxy-flow series and parameters for one name |
| `POST /api/flow/validate` | forward-return report for a bounded list of names; vendor parity only with `FLOW_VENDOR_CSV` |
| `GET /api/flow/health` | source availability, cache stats and the proxy disclaimer |
| `GET /api/flow/cache` | Flow cache keys, path, TTLs and DB size |
| `POST /api/flow/cache/clear` | delete only `flow:v2:*` cache entries |
| `GET /api/backtest/{ticker}` | one strategy's backtest: trades, equity, stats and a first-half/second-half OOS guard |
| `GET /api/backtest/compare` | every strategy on one target vs its buy-and-hold and vs IHSG: stats, base-100 curves, walk-forward flags; cached v4, `force=1` recomputes |
| `GET /api/market/profile/{ticker}` | identity labels from the scan + live quote; every field nullable |
| `GET /api/overview` | cached daily dashboard snapshot (v2: breadth, gauge, rotation, movers, sector day, index contribution, benchmark tail, indices); 202 with build progress when the first snapshot is still being built |
| `GET /api/overview/status` | build phase, timing, coverage and errors |
| `POST /api/overview/refresh` | start/reuse the single-flight dashboard build |
| `GET /api/overview/cache` | overview cache keys, path, bytes and last build |
| `POST /api/overview/cache/clear` | delete only overview snapshots |
| `GET /api/overview/archive/{session}` | a persisted snapshot for a past session |
| `GET /api/health`, `/docs` | health and Swagger |

The older groups (`/api/market/*`, `/api/intel/*`, `/api/screener/*`,
`/api/validator/*`, `/api/regime/*`, `/api/portfolio/*`, `/api/backtest/*`,
`/api/summary/*`, `/api/alerts/*`, `/api/sentiment/*`, `/api/analysis/*`) are still
mounted in `backend/app/main.py` for the legacy surfaces; the scanner and plan do
not use them. Flow uses `/api/flow/*` plus the existing market history endpoint
for its candles. Market uses `/api/overview/*` only; it reads study history and
the cached TradingView universe.

## Layout

| Path | What it is |
| --- | --- |
| `frontend-web/src/routes/{MarketsHome,Deep,Backtest,Tonight,Scanner,Flow,Method}.tsx` | the three tabs plus the hidden screens |
| `frontend-web/src/components/{plan,regimes,deep,FlowChart,MarketChart,market,RefreshButton,ThemeToggle,InvestCase}.tsx` | shared vocabulary, the regime ledger, charts, the dashboard, deep-dive panels, refresh, theme, the invest case |
| `frontend-web/src/lib/{api/plan.ts,api/flow.ts,api/overview.ts,api/case.ts,refresh.ts,cache.ts,theme.ts}` | types + SWR client + the re-read signal |
| `backend/app/plan/` | the nightly method: `screen`, `method`, `model`, `verdict`, `refresh`, `idx`, `citations`, `bars`, `regimes` |
| `backend/app/flow/` | the research proxy: `technicals`, `lpm`, `sources`, `cards`, `series`, `validate` |
| `backend/app/overview/` | the cache-first dashboard: `universe`, `summary`, `gauge`, `rotation`, `moves` (movers, sector day, IHSG contribution, benchmark tail), `snapshot` |
| `backend/app/computed_cache.py` | the shared versioned SQLite cache for computed payloads, including the persisted plan |
| `backend/app/market_store.py` | the normalized SQLite daily-bar store imported from the study snapshot |
| `backend/scripts/sync_market.py` | the weekly fetch → import → plan-warm job |
| `systemd/trading-suite-sync.{service,timer}` | the Saturday 09:00 WIB data update |
| `backend/data/market.db` | the local bar store (gitignored; rebuilt by the sync) |
| `backend/app/routers/{plan,flow,overview,case}.py` | the HTTP seams |
| `backend/tests/test_plan_*.py`, `test_flow_*.py`, `test_overview_*.py`, `test_case*.py` | conformance, citations, sizing, verdict, refresh, regimes; Flow proxy and causality; Market summary/rotation/cache; the invest case |
| `docs/architecture/*.puml` | diagrams of the **earlier** 5-route desk — not redrawn for this app |
| `legacy/` | archived repos, not part of this app |
| `trading-suite` / `trading-suite.sh` | the runner (identical twins) |

`backend/app/plan/README.md` documents the module itself: the seam, the evidence
tiers, the size rule, the verdict machine and what it still cannot claim.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TRADING_DOCS_DIR` | where the study lives (default `~/Projects/trading-backtest-docs`); also the sync's default `--study-root` |
| `MARKET_DB` | override the local bar store path (default `backend/data/market.db`) |
| `PLAN_CACHE_TTL_SECONDS` | how long a persisted plan remains readable (default 8 days; the computed-cache hard stale is 7 days) |
| `CORS_ORIGINS` | allowed browser origins (defaults include `:3000`, `:5173` and `:4173`) |
| `YFINANCE_CACHE_TTL`, `YFINANCE_HISTORY_CACHE_TTL`, `FOREX_CACHE_TTL` | feed cache lifetimes |
| `STOCKBIT_JWT_TOKEN` | optional Stockbit JWT for Flow's explicit broker detail and the legacy `/api/intel/stockbit/*` reads; without it those paths report unavailable. There is no browser companion |
| `IDX_PW_CORE` | optional explicit path to a playwright-core `index.js`; the index browser bridge resolves the vendored copy in `backend/vendor/node_modules` first, then the agent installs and npx caches |
| `STOCKBIT_USERNAME` / `STOCKBIT_PASSWORD` | read only by the legacy `/api/intel/stockbit/login`; no screen needs them |
| `FLOW_VENDOR_CSV` | optional licensed `date,ticker,lpm` CSV for a vendor-parity report; nothing is scraped |
| `FLOW_CACHE_TTL` / `FLOW_CACHE_TTL_VALIDATE` / `FLOW_CACHE_STALE_DAYS` | Flow cache freshness (300s), validation freshness (3600s), stale retention (7 days) |
| `OVERVIEW_CACHE_TTL` | Market snapshot freshness (default 900s) |
| `GEMINI_API_KEY`, `OPENCODE_GO_API_KEY` | AI summaries in the legacy surfaces (optional) |

`.env.example` still lists `NEXT_PUBLIC_API_URL` from the Next.js era; the Vite
frontend reads `VITE_API_URL` instead with the same default.

## Testing

```sh
./trading-suite verify        # backend suite + frontend typecheck
```

- **Backend**: 276 passed, 6 skipped, 0 failed (full run, ~8–13m on the study
  checkout depending on cache and load, with the dev servers stopped so the
  live-contract tests skip). The old `tests/test_lpm.py` failures were a
  look-ahead formula; that test file now pins causality, and the legacy endpoint
  uses the Flow proxy. Two cases cover the persisted-plan cache and three cover
  the market store. Twenty-three cases cover the invest case
  (`tests/test_case.py`, `tests/test_sentiment_ticker.py`).
  `tests/test_flow_*.py` cover the technicals, the proxy, the cache, the HTTP
  seam and the accuracy report; `tests/test_overview_*.py` cover the Market
  summary, stress gauge, rotation and the cache-first snapshot job. The
  `tests/test_api_contracts.py` cases run only when a backend is listening on
  `:8000`; run `./trading-suite verify` after `stop` for the offline profile.
  The plan-cache tests clear the persisted plan; `./trading-suite sync-data
  --no-fetch --json` warms it again (or the next start computes once).
- The plan tests need the study checkout; the conformance tests import the study's
  own signal code. `tests/test_plan_regimes.py` runs the study's own `cap_bounce`
  family against the app's capitulation watch and guards every regime artifact the
  UI quotes.
- `pytest` is **not** in `backend/requirements.txt`. If the venv lacks it:
  `uv pip install --python backend/.venv/bin/python pytest`.
- **Frontend**: `cd frontend-web && npm run typecheck` (or `npm run build`).
  `@types/node` is a devDependency; without it the `node:test` / `node:url`
  imports in the existing test files and `vite.config.ts` fail the typecheck.

## Known gaps

- **Docker is stale.** `docker-compose.yml` and the root `Dockerfile` still build
  the removed Next.js frontend (they need a root `package.json` that no longer
  exists) and a `pilot` service whose directory is gone. Use the runner or the raw
  commands above; the compose file needs rewriting for `frontend-web`.
- Leftovers from that era sit at the repo root: `next-env.d.ts`,
  `tsconfig.tsbuildinfo`, `public/*.svg`, `scripts/check-feature-wiring.mjs`.
- `docs/architecture/*.puml` describe the earlier 5-route desk, not this app.

## License

[MIT](LICENSE)
