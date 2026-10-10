# The plan module

`GET /api/plan` answers one question: **which IDX names should I buy at the next
session's open, and why?** It is the only screen that matters at night, so it is
the only one that had to be right.

The answer is not invented here. It is one method out of a walk-forward backtest
of the Indonesian market, read from that study's own results file, and applied to
tonight's bars by the same rules the study used.

## The interface

Three functions. Everything a caller must know is in them; the rule chain, the
cost model, the universe filters, the cross-sectional panels and the evidence
lookup sit behind the seam.

```python
plan()                  # -> Plan: regime, candidates, watchlist, evidence
detail("BBCA")          # -> one name, every gate's measured value
method_card()           # -> the rule chain and its measured proof
```

`plan()` is memoised per (source, session, exit, family): a universe pass is not
free, and the front end asks more than once.

## The seam

`bars.py` defines where daily bars come from, with two adapters:

| Adapter | What it reads | Used for |
| --- | --- | --- |
| `StudyBars` | the study's `data/raw/*.csv` + manifest | production, and any audit |
| `LiveBars` | yfinance via `app.market.fetch_history` | running against today's bars |

Two adapters make it a real seam rather than indirection: the same rule chain has
to work on the data the proof was measured on and on data that arrived later.

The `StudyBars` adapter resolves manifest paths against the study root, not the
process working directory, so a checkout in either place works.

## What sits behind the seam

- **`method.py`** — the rule chain, the costs, and the measured evidence. Every
  constant carries the study file and line it came from.
- **`screen.py`** — the panels, the gates and the exit geometry.
- **`bars.py`** — the two adapters.
- **`model.py`** — the shapes a caller receives. Dataclasses, so the interface is
  readable without reading the implementation.

## Why the numbers cannot drift

`app/plan` is a *re-transcription* of one of the study's 43 entry families. A
re-transcription is a lie waiting to happen: change a comparison, and the app
keeps quoting a win rate that no longer describes what it does.

`tests/test_plan_conformance.py` closes that hole. It imports the study's **own**
`strategies.signals()`, runs it and the app's gate chain over the same bars, and
fails if any name disagrees. It checks breadth, the cross-sectional relative
strength panel, and all three runnable families.

```
cd backend && .venv/bin/python -m pytest tests/test_plan_conformance.py -q
```

Point `TRADING_DOCS_DIR` at a study checkout to enable it; without one it skips.

## Evidence is read, never written

The win rate, the average return, the trade count and the per-fold spread come
from `results/top10_methods.csv` at request time. Nothing is hard-coded, so a new
study round is picked up by `POST /api/plan/refresh` without a restart, and the
number on screen is by construction the number the study measured.

## The headline is a searched maximum, and the app says so

This is the most important thing in the module, so it is stated first.

`results/top10_methods.csv` is a table of the best cells the study *ranked*. It
is not a list of what to expect, and `docs/22-the-80-and-5-question.md` answers
the question directly by holding data out:

```
SEARCH HALF   folds 0-2, 2023-10-07 → 2025-04-07   280 cells ranked
HOLDOUT       folds 3-5, 2025-04-07 → 2026-10-07   never searched, never selected on
```

Read from `results/holdout_search_cells_screen.csv` and
`results/holdout_search_screen.csv` via `method.holdout()`:

```
0 / 280  cells cleared 80% win rate and +5% per trade together
0 / 12   shortlisted winners survived the holdout
best on unseen data: 74.11% win, +0.09% per trade
```

So the app emits three separate things and never merges them:

| object | what it is | where it shows |
| --- | --- | --- |
| `Evidence` | the best cell the search found | badge, labelled *searched figure* |
| `Holdout` | what survived unseen data | above the headline on Method, and on Tonight |
| `ShippedConfig` | **the app's own chain**, scored in the census | Method, as a range |

`ShippedConfig` is the one that most constrains the app. It looks the running
constants up in the census and reports the **spread** across every matching row,
because at a gate this strict the rows disagree by several percent per trade and
one of them loses money. The app runs `breadth_quiet4_rs90_donchian × lt_14_40_95`
at breadth 0.60; measured on the folds that ranked it, that chain reads
**10–17 trades, 52.9%–70.0% win rate, −4.69% to +3.60% per trade**.

That is the honest description of the thing the user is being asked to trade,
and it is not the 81.07% in the badge. Both are shown. Neither is hidden.

`test_the_holdout_travels_with_every_plan` and
`test_shipped_config_is_measured_not_asserted` exist so this cannot be tidied
away later.

## Two guards the study does not have

Both are deliberate and both are visible in the UI rather than silent:

1. **Coverage-aware session anchor.** A fetch in progress leaves a few tickers
   stamped with today while the rest stop at yesterday. Breadth and relative
   strength are cross-sectional, so a session holding 3 names out of 887 does not
   mean the market is 67% strong — it means the download is unfinished. The plan
   anchors on the last session covered by at least 60% of a normal session.
2. **Gapped breakouts are skipped.** A close more than 15% above the 40-session
   high is a gap or an unadjusted corporate action, not a breakout. The gate text
   says so rather than dropping the name silently.

## Which method it runs

The study names its own pick in `docs/18-strategy-and-results.md`, and the app
runs that one rather than choosing for itself:

> signal quality (the method to trade): **breadth_quiet4_rs90_donchian ×
> lt_14_40_95** — 523 out-of-sample trades, 81.07% win rate, +5.57% per closed
> trade, traded in 5 of the 6 test windows

It wins on what a nightly screen needs. It trades in more folds than any other
qualifying row, and it carries **no index gate**, so it is not shut for whole
quarters the way `full_breadth_quiet_wup_rs90_donchian` is — that one added
"IHSG above its 200-day average", and the index has been below it for the last
several months, which would have made the screen permanently empty.

Its worst fold is **59.6%**, a shade under the study's own 60% fragility line.
The UI says so rather than rounding it away.

Two other families clear the bar and are in `FAMILY_SPECS`, selectable but not
the default: `breadth7_quiet_rs90_donchian` (the study's rank-1 row, but it
needs breadth over 70%, which opens on ~7% of sessions) and
`full_breadth_quiet_wup_rs90_donchian`.

## Deployment evidence

A per-trade win rate says nothing about how much to hold or how deep the
drawdown gets, so `method.deployment()` reads `results/portfolio_multi.csv` and
`results/portfolio_robust.csv` (docs/17) and the Method page shows it:

| book | taken | win | total | max DD | invested |
| --- | ---: | ---: | ---: | ---: | ---: |
| this method alone, 10 slots | 108 | 82.4% | +69.0% | −18.8% | 32% |
| all qualifying methods, ranked | 317 | 59.9% | +165.9% | −30.4% | 75% |

The chained leave-one-out figure the Method page renders is **struck through and
labelled "not a rate to plan against"**, because it is not one. It chains six
held-out folds selecting across a *pool of 24 method variants* — not the single
family the app runs — and it predates the frozen-name correction that lowered
every headline in the study. The same repository's five-year replay
(`results/five_year_replay_flat.csv`) books the pooled version at **−80.52%**.
Both numbers are shown together, because the gap between them is the honest
width of this result and either one alone would mislead.

## Tradability, applied before scoring

An independent audit of the study found **7.0% of its trades came from names
that do not trade** — close unchanged on ≥50% of sessions, one ticker alone
supplying 4.2% of all trades. Removing them moved the study's own headline from
78.48% to 76.32% win rate and halved the drawdown.

`screen.tradable()` applies the same filter before anything is scored: ≥200
sessions of history, price ≥ 50 IDR, and a series that actually moves. Breadth is
counted over the surviving set too, so the market's health is measured on names
the user could buy.

## Three regime bands, not two

`docs/21` splits breadth three ways, and the middle band is the finding rather
than a gap:

| band | breadth | action | why |
| --- | --- | --- | --- |
| trending | ≥ 0.60 | trade | where the return is (`docs/24`) |
| sideways | 0.25 – 0.60 | **flat** | drifts ≈ 0 over five sessions; a round trip costs 0.50% |
| capitulation | < 0.25 | watch | not a sell signal — where the watchlist earns its keep |

`docs/24` tested the looser gates directly: each extra trade bought by dropping
breadth to 0.50 or 0.45 is a worse one, so the gate stays at 0.60. The app
therefore says *flat* rather than *shut* in the middle band, and
`method.regime_frequency()` reads `results/results_breadth_days.csv` to show that
the gate clears on **20.98%** of measured sessions — about one session in five.

## Known limits

- **The plan is empty most nights.** That is the method working, not a bug: the
  study measured its win rate on the trades it *did* take. `Tonight` therefore
  always renders a watchlist of names one condition away, so the screen says
  something useful on the days it says "nothing".
- The screen ranks the day's buyable names by momentum and volatility tightness.
  It does **not** implement the study's extension-ranked pool across all 95
  families, which needs each family's per-fold selected spec and a duplicate
  rule; that is a deployment design, not a screen.
- `next_session` uses the **exchange calendar** — the bar dates in `^JKSE.csv` —
  for as far as that calendar extends, which is what `scripts/repair_phantom_bars.py`
  established ^JKSE to be. Past the last recorded session no calendar can help,
  because none contains the future, so the app falls back to the next weekday and
  says `next_weekday_unverified` rather than naming a holiday as a trading day.
- **Phantom bars are refused on load.** The study found 4,125 (ticker, date) rows
  on nine dates absent from the ^JKSE calendar — volume 0, close carried forward,
  four of them in every one of 886 files including a public holiday — and all nine
  fell inside fold f5, a scored out-of-sample fold. The cache is repaired, but the
  fault was in the *fetcher*, so `bars._drop_phantom()` re-checks on every load
  and `plan.coverage` reports what it refused. Dropping requires both conditions
  (off-calendar **and** no volume) so a genuine zero-volume session is never
  deleted.
- Long only. The study's short twin measured 54.7%, and the app does not offer it.
- **The searched headline does not survive holdout.** 81.07% / +5.51% is the
  best of 280 configurations, and the best of everything tried on unseen folds is
  74.11% / +0.09%. The app shows both; the first is never presented alone.
- **The app's own chain, measured, is weaker still**: 10–17 trades at a 52.9%–
  70.0% win rate on the folds that ranked it. The gate that produces that number
  is the same gate that keeps the screen closed most of the time. Selectivity and
  sample size are the same trade-off, not two independent choices.
- The robust preference is a survivor panel, so every return here is an upper
  bound. On the shipped cell, rebuilding on surviving names takes +2.09% per
  trade to −0.59%.