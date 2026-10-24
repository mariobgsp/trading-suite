# The overview module

`/api/overview` is the cache-first daily market dashboard. It reads a persisted
snapshot; the expensive build runs in a background job.

## Reading path

`GET /api/overview` never calls `StudyBars`, `fetch_universe` or
`fetch_history`. It reads `computed:overview:v1:latest` and the matching
snapshot from SQLite.

| State | Response |
| --- | --- |
| snapshot for the current completed session | 200, `stale: false` |
| older snapshot | 200, `stale: true`; a background build is started |
| no snapshot | 202, `{state: "building"}`; a background build is started |

The frontend renders the previous snapshot while a build runs, then polls
`/api/overview/status` every few seconds.

## Write path

`POST /api/overview/refresh` (and the startup warm thread) starts a
single-flight job:

1. read the TradingView universe and the study frames;
2. join current prints to history;
3. compute the summary and the stress gauge;
4. compute sector, conglomerate and industry rotation;
5. persist the snapshot and pointer atomically.

A fresh build takes roughly 10–15 seconds in the current checkout (study frames
plus one TradingView scan). No per-ticker yfinance calls are made on this path.

## Data

- History: `StudyBars.load(None)` — ~887 frames with the manifest provenance.
- Current print and taxonomy: one `movers.fetch_universe()` call, extended with
  TradingView `industry`.
- Benchmark: study `^JKSE` frame and `fetch_quote("^JKSE")`.
- The current print is **not** appended to the historical series when the study
  history is more than five days older; the summary compares today's price
  against the latest history and the payload carries a warning. This prevents a
  16-day gap from being counted as one session.

## Metrics

- Up / flat / down use ±0.05%.
- Above MA50 compares the current price with the 50-session mean.
- Near 52W uses a 5% band around the 252-session high/low; the threshold is in
  the payload.
- IHSG momentum and 20-day annualised volatility come from the benchmark series.
- Accounting for the current print is explicit in `coverage`.

## Stress gauge

Six components: breadth, percent above MA50, 52-week high/low balance, momentum
vs MA100, 20-day volatility, and the share down at least 5%.

```
score = weighted mean of normalized components
weights = 25 / 20 / 15 / 15 / 15 / 10
bands = panic <25, fear <50, neutral <65, greed <85, extreme greed <=100
```

The weights are design constants. The payload publishes them, and the page says
"our composite"; there is no external parity claim.

## Rotation

Group return is the equal-weight mean of member returns. The group index is the
cumulative product of (1 + return). Weekly closes are Friday.

```
rs         = group index / benchmark index
rs_ratio   = 100 * rs / SMA10(rs)
rs_momentum= 100 * rs_ratio / rs_ratio.shift(4 weeks)
```

Quadrants are read at 100. Groups with insufficient weekly history are omitted.
Industries need at least five members; conglomerates use the curated
`app.konglo.KONGLO_GROUPS` map with display aliases.

## Cache keys

```
computed:overview:v1:snapshot:<session>
computed:overview:v1:latest
computed:overview:v1:status
```

`OVERVIEW_CACHE_TTL` defaults to 900s. Old snapshots are retained for the
archive but pruned by the shared database policy. `FORMULA_VERSION` is part of
the payload; bump it when a formula changes.

## Limitations

- The study checkout is the historical source; if it is stale, the payload says
  so and the rotation uses the latest study bars.
- The target dashboard's exact gauge weights and custom taxonomies are not
  reproduced. This is a transparent adaptation.
- Before 16:02 WIB, the dashboard uses the last completed session.
- A first-ever build still takes ~10s; the UI shows progress and never blocks a
  GET.

## Tests

```sh
cd backend
.venv/bin/python -m pytest tests/test_overview_*.py -q
```

The cache test asserts that `GET` never calls the loaders; the job test asserts
that a snapshot is persisted and served from cache; the rotation tests pin the
weekly math and the industry member floor.
