# The flow module

`/flow` is a research panel, not the nightly plan. It shows:

- technical cards (RSI, Stochastic, Supertrend, Ichimoku, VWAP, MA20/50, 52W,
  5D change, 5D value);
- a **transparent flow-pressure proxy** with a direction badge and a chart;
- a forward-return report for the proxy;
- optional vendor parity only when the user supplies a licensed sample.

It is deliberately separate from `app.plan`. The plan's evidence and verdict are
not affected by anything in this package.

## What this is not

It is **not Bandarmetrics' Liquidity Pressure Model**. The vendor formula, its
broker data and its accuracy claim are proprietary. There is no licensed copy in
this repo, and the app does not scrape the vendor. A line that looks like LPM is
not LPM; every surface says "proxy" for that reason.

The screenshot-era question "same levels and same accuracy" splits into two
answers:

- **Standard technical levels:** reproducible exactly if the formula, periods
  and price-adjustment convention match. The parameters are pinned in
  `technicals.py` and returned in every response.
- **Vendor LPM levels/accuracy:** not reproducible from public OHLCV plus the
  current IDX foreign print. The old code was a different proxy and its tests
  currently encoded look-ahead; this package replaces it with a causal proxy and
  says so.

## The proxy

At bar `t`, only bars `<= t` are read.

```
cmf20            = Chaikin Money Flow, 20 sessions
broker_pressure  = tanh(3 * top3_net_lots / avg_volume_20)     # optional
foreign_pressure = tanh(3 * net_foreign_idr / turnover)        # optional

if broker available:
    score = 0.5*broker_pressure + 0.3*foreign_pressure + 0.2*cmf20
elif foreign available:
    score = 0.6*foreign_pressure + 0.4*cmf20
else:
    score = cmf20

score = EMA(score, 5)
direction = rising  if score[t] - score[t-5] >  0.02
            falling if score[t] - score[t-5] < -0.02
            else flat
```

The weights are design constants, not measured claims. `lpm_score` is
dimensionless and bounded to [-1, 1]. `lpm_price_space = close * (1 + 0.12 *
score)` exists for the legacy endpoint's shape; it is a display transform, never
a measured level.

## Data sources

| Source | What it gives | Limits |
| --- | --- | --- |
| yfinance via `app.market.fetch_history` | OHLCV, adjusted, cached | adjusted prices may differ from a vendor's feed |
| `app.idx.foreign_flow_universe` | official current-day foreign flow for the whole market, one call | **current day only**; no history |
| `app.stockbit.broker_history` | top-3 broker net lots per day | private endpoint, JWT, captcha, one request per ticker-day; detail only |
| `FLOW_VENDOR_CSV` | licensed `date,ticker,lpm` sample | never scraped or committed |

Because IDX foreign flow has no history, the historical proxy is CMF-driven. The
report says so. The card's direction can use the current-day foreign print; the
chart labels that limitation.

## Public seam

```python
from app.flow import cards, series, validate, health

cards(universe="watchlist", limit=30, source="auto")
series("BBCA", days=120, source="auto")
validate(["BBCA"], horizon=5, days=250, source="auto")
health()
```

## HTTP

| Endpoint | Notes |
| --- | --- |
| `GET /api/flow/health` | source availability, cache stats and the proxy disclaimer |
| `GET /api/flow/cache` | cache keys, path, TTLs and DB size |
| `POST /api/flow/cache/clear` | delete only `flow:v2:*` entries |
| `GET /api/flow/cards` | `universe=watchlist|movers|plan|tickers`, `limit` 1-100, `source=auto|idx|stockbit|ohlcv`, `days` 30-250, `refresh` |
| `GET /api/flow/{ticker}` | price, `lpm_score`, `lpm_price_space`, intensity, foreign flow, CMF; `refresh` |
| `POST /api/flow/validate` | `tickers` (1-30), `horizon` 1-20, `days` 60-250, `refresh` |
| `GET /api/flow/validate/{ticker}` | one-name report |

Every response carries `source`, `quality`, `as_of` and `warnings`.

## Cache

The computed payloads are persisted in the app's SQLite WAL store
(`backend/data/cache/cache.db`), not in a second database. That file already holds the
OHLCV, IDX and Stockbit responses; the Flow layer adds the computed cards,
series and validation reports on top.

| Setting | Default | Meaning |
| --- | ---: | --- |
| `FLOW_CACHE_TTL` | 300s | cards/series freshness |
| `FLOW_CACHE_TTL_VALIDATE` | 3600s | validation report freshness |
| `FLOW_CACHE_STALE_DAYS` | 7 | how long a stale entry may be served if recompute fails |

Keys include the exact inputs (resolved codes, source, window), so changing the
watchlist or the plan does not return a stale membership list. `?refresh=1` on
`/api/flow/cards` and `/api/flow/{ticker}`, or `refresh: true` in the validation
body, bypasses the cache. `GET /api/flow/cache` shows the keys and store stats;
`POST /api/flow/cache/clear` deletes only `flow:v2:*` keys, leaving the market
cache warm. Every response carries a `cache` block with `hit`, `age_seconds`,
`saved_at` and `ttl_seconds`.

If recomputation fails, a stale payload is returned with a warning instead of a
blank page. That is deliberate: a card that was correct five minutes ago is
usually more useful than an outage.

## Accuracy protocol

`validate.py` reports:

- direction hit rate and Wilson interval;
- AUC for the forward-return sign;
- the same metrics for a 5-day price-momentum baseline;
- cross-sectional rank IC and top-minus-bottom spread when several names share
  dates;
- vendor parity from `FLOW_VENDOR_CSV`: Spearman, normalized MAE and sign
  agreement.

It does **not** certify "same accuracy". That requires the vendor's formula,
data and labels, and even then the app's universe, costs and horizons differ.

## Tests

```sh
cd backend
.venv/bin/python -m pytest tests/test_flow_*.py tests/test_lpm.py -q
```

The important test is causality: changing a future bar or a future broker row
must not change an earlier score. That is also why the legacy `test_lpm.py` was
rewritten — its "lead is structural" case expected future data to move past
values, which is look-ahead.

## Promotion rule

The proxy stays a research panel by default. It may become a filter only if it
beats the existing breadth/RS chain on the study's walk-forward folds, with
costs and at least 100 trades. Given the study's own institutional-flow result
(0 of 1,007 cells cleared the bar), the default expectation is that it will not.
