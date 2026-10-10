# Trading Suite — the nightly IDX plan

> One question, answered once a session: **which Indonesian stocks should I buy at
> the next open, and why?** Four screens, a FastAPI backend, and a rule chain
> re-transcribed from a walk-forward study — with the study's own artifacts as the
> evidence, and "no trade" as a first-class answer.

```
┌──────────────────────┐   /api/plan*   ┌────────────────────┐   ┌──────────────────────┐
│ Vite + React SPA     │ ─────────────▶ │ FastAPI  :8000     │──▶│ study results (CSV)  │
│ :5173  (4 screens)   │ ◀───────────── │ app/plan/*         │   │ + daily bars + live  │
└──────────────────────┘   SWR cache    └─────────┬──────────┘   │   tail (yfinance)    │
                                                 │ SQLite WAL   └──────────────────────┘
                                          ┌──────▼───────┐
                                          │ cache.db     │
                                          └──────────────┘
```

## Quick start

```sh
chmod +x ./trading-suite
./trading-suite run      # backend :8000 + frontend :5173
# open http://127.0.0.1:5173
./trading-suite verify    # backend tests + frontend typecheck
./trading-suite stop      # kill both
./trading-suite logs      # tail -f /tmp/trading-suite/*.log
```

The backend needs the study checkout (see [Data](#data)) before `plan` can answer
anything; the first request reads ~887 ticker files and takes a few seconds.

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

## The four screens

| Route | The question it answers |
| --- | --- |
| `/` **Tonight** | Should I buy anything, and if so what exactly? The verdict, the order ticket for each name, the watchlist, and the measured case for standing down |
| `/screener` | Every name, ranked by how near it is to being buyable. No buy signals, on purpose |
| `/method` | The rule chain, the result, the horizons that were measured and refused, the costs, and every citation |
| `/name/$ticker` | One name: each condition with its value and how long it has held, the run-up to the signal, the levels, the ticket, the chart |

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

## Data

**The study is a hard dependency.** By default the app reads
`~/Projects/trading-backtest-docs`; override with `TRADING_DOCS_DIR`:

```sh
TRADING_DOCS_DIR=/path/to/study ./trading-suite run
```

- Bars: the study's `data/raw/*.csv` through its manifest (with its per-file
  sha256 provenance and the phantom-bar repair re-applied on every load).
- Results: `results/*.csv` — the census, the ladder, the holdout, the replay.
- The API also keeps its own cache at `backend/data/cache.db` (SQLite WAL) for
  yfinance/IDX/Intel feeds. Delete the file to reset.

**Refresh** (the button in the header) pulls the latest daily bars and re-runs the
analysis. Two rules keep it honest: a bar dated **today is refused until 16:02 WIB**
(an unfinished candle is a partial price), and every failed name is counted, because
breadth is a share of the universe. The live tail is merged **in memory** — nothing
is ever written back into the study. The first press fetches the whole universe and
takes minutes; later ones are incremental.

## API

| Endpoint | Notes |
| --- | --- |
| `GET /api/plan` | the session's verdict, candidates, watchlist, ranked universe, evidence, IDX tables. `?as_of=` replays an earlier session, `?exit_method=` switches among measured exits |
| `GET /api/plan/method` | rule definitions, the corrected row, the ladder, the horizon list, citations, robustness |
| `GET /api/plan/{ticker}` | one name: gates with run lengths, the why-now run-up, levels, a sized geometry |
| `POST /api/plan/size` | size one order and price its friction, without a universe pass |
| `POST /api/plan/refresh` | start a refresh job (poll `GET /api/plan/refresh/{id}`, stop with `POST …/cancel`) |
| `GET /api/health`, `/docs` | health and Swagger |

The older groups (`/api/market/*`, `/api/intel/*`, `/api/screener/*`,
`/api/validator/*`, `/api/regime/*`, `/api/portfolio/*`, `/api/backtest/*`,
`/api/summary/*`, `/api/alerts/*`, `/api/sentiment/*`, `/api/analysis/*`) are still
mounted in `backend/app/main.py` for the legacy surfaces; the four plan screens do
not use them.

## Layout

| Path | What it is |
| --- | --- |
| `frontend-web/src/routes/{Tonight,Screener,Method,Name}.tsx` | the four screens |
| `frontend-web/src/components/{plan,MarketChart,RefreshButton,ThemeToggle}.tsx` | shared vocabulary, charts, refresh |
| `frontend-web/src/lib/{api/plan.ts,refresh.ts,cache.ts,theme.ts}` | types + SWR client + the re-read signal |
| `backend/app/plan/` | the module: `screen`, `method`, `model`, `verdict`, `refresh`, `idx`, `citations`, `bars` |
| `backend/app/routers/plan.py` | the HTTP seam for the plan |
| `backend/tests/test_plan_*.py` | conformance, citations, sizing, verdict, why-now, refresh |
| `docs/architecture/*.puml` | diagrams of the **earlier** 5-route desk — not redrawn for this app |
| `legacy/` | archived repos, not part of this app |
| `trading-suite` / `trading-suite.sh` | the runner (identical twins) |

`backend/app/plan/README.md` documents the module itself: the seam, the evidence
tiers, the size rule, the verdict machine and what it still cannot claim.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TRADING_DOCS_DIR` | where the study lives (default `~/Projects/trading-backtest-docs`) |
| `CORS_ORIGINS` | allowed browser origins (defaults include `:3000`, `:5173` and `:4173`) |
| `YFINANCE_CACHE_TTL`, `YFINANCE_HISTORY_CACHE_TTL`, `FOREX_CACHE_TTL` | feed cache lifetimes |
| `STOCKBIT_JWT_TOKEN` / `STOCKBIT_USERNAME` / `STOCKBIT_PASSWORD` | Stockbit broker feed (optional) |
| `GEMINI_API_KEY`, `OPENCODE_GO_API_KEY` | AI summaries in the legacy surfaces (optional) |

`.env.example` still lists `NEXT_PUBLIC_API_URL` from the Next.js era; the Vite
frontend reads `VITE_API_URL` instead with the same default.

## Testing

```sh
./trading-suite verify        # backend suite, then the frontend typecheck
```

- **Backend**: 176 passed, 6 skipped, 2 failed. The two failures are
  `tests/test_lpm.py` (Stockbit LPM math) and they fail identically on the commit
  before the plan work — they are not caused by it.
- The plan tests need the study checkout; the conformance test imports the study's
  own signal code.
- `pytest` is **not** in `backend/requirements.txt`. If the venv lacks it:
  `uv pip install --python backend/.venv/bin/python pytest`.
- **Frontend**: `cd frontend-web && npm run typecheck` (or `npm run build`).

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
