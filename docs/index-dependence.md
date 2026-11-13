# Index dependence — what the tape says

**Question:** if most stocks no longer track IHSG, should the scanner gate a
stock on the index level?

**Short answer:** no. The index is a poor per-stock gate, and the shipped chain
already has no index condition. But the market is not irrelevant: breadth (the
share of stocks above their own 200-day average) is the regime variable the
study measured, and the scanner keeps it. Stress remains market-wide even when
the calm tape is not.

Data: the study's own daily closes, 887 tickers, through **2026-11-06**. Returns
are close-to-close. Correlation is Pearson. The "tradable" set applies the
universe floor in docs/21 §2 (price ≥ Rp50, median 60-session turnover ≥ Rp250
million, no frozen series, enough history).

## What was measured

| Measure | Raw set (844 names) | Scanner's tradable set (405) |
| --- | ---: | ---: |
| Median 120-session correlation with IHSG | **0.47** | **0.55** |
| Same, excluding days the index moved more than 2% | **0.23** | **0.31** |
| Median correlation, last 20 sessions (the October crash) | **0.71** | **0.74** |
| Share with correlation below 0.5 | **56%** | — |
| YTD 2026: IHSG | **−42.3%** | **−41.6%** |
| YTD 2026: median stock | **−28.6%** | **−29.7%** |
| Share of stocks beating the index YTD | **66%** | **64%** |

The tradable set is more liquid, so its correlation is higher. Both readings
tell the same story.

## Three readings, not one

1. **On a normal day, most stocks do not move with the index.** The median
   correlation drops to roughly 0.2–0.3 once the index's own big moves are
   removed. Ranking stocks on their own conditions is the right default.
2. **In stress, they do.** The last 20 sessions — the October sell-off — show a
   median correlation of about 0.7. On days IHSG fell, only about a quarter of
   stocks rose. A stock-level screen does not remove market risk.
3. **The index is not representative.** The median stock fell 28.6% year to date
   while IHSG fell 42.3%; 66% of names beat the index. A cap-weighted index is
   not a good description of the average stock.

## What the scanner does with this

- **No index gate.** The shipped family (`breadth_quiet4_rs90_donchian`) has no
  `index_above_200` condition, and the scanner does not add one.
- **Breadth stays.** Breadth is not the index. It is the share of stocks above
  their own 200-day average, and it is the regime variable the study measured:
  at breadth ≥ 0.60 the chain's corrected result is 76.32% win / +1.85% per
  trade; the sideways band drifts about zero while a round trip costs 0.50%.
- **Index context is shown, not used as a filter.** The scanner prints the
  median correlation and the YTD spread so a reader can see why the index is
  context rather than a condition.
- **Stock-level filters still show names when breadth is shut.** `Tier 1 setup`
  is watch-only in that band; the measured result belongs to the full chain,
  which includes breadth.

## Limits

- Correlation measures co-movement, not causation, and 120 sessions is one
  window in one market.
- The manifest is today's universe applied backwards; names that stopped
  trading are absent.
- The index is cap-weighted and the study does not carry market caps, so the
  "index is not representative" reading is a median-vs-index comparison, not a
  decomposition of the index's weights.
- The 2026 correlation is dominated by the October crash. The calm-period
  reading (excluding >2% index days) is the better description of a normal
  session.

**Bottom line:** select on the stock, size for the market. The index is a
context line, not a condition.
