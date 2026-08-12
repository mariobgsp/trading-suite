# Research: TanStack Start SSR Performance — Bun vs Node, and vs Next.js (2025–2026)

## Summary

**No comparative benchmark of TanStack Start on Bun vs Node exists as of mid-2026** — no req/s, cold-start, or memory head-to-head was found in TanStack GitHub issues, Bun docs/issues, or production blogs. The gap is confirmed. However, several high-quality benchmarks compare TanStack Start SSR vs Next.js App Router (all on Node), which is directly relevant to a client-heavy dashboard.

## Findings

1. **TanStack Start vs Next.js (Platformatic / Matteo Collina, Feb–Mar 2026)** — Same eCommerce app, 1,000 req/s, 3 min, AWS EKS, no compression. TanStack Start outperformed the field "by a wide margin"; corrected v2: ~25% higher throughput and ~35% lower latency than React Router; Next.js v15 could not hold 1,000 req/s (avg ~8,000–11,000 ms, ~60% success, p95 = 10 s timeout). High confidence (v1 criticized for compression mismatch, v2 re-ran corrected). [Source](https://blog.platformatic.dev/react-ssr-framework-benchmark-tanstack-start-react-router-nextjs) · [v2](https://blog.platformatic.dev/ssr-framework-benchmarks-v2-corrected-results) · [yceffort summary](https://yceffort.kr/en/2026/03/is-nextjs-fast-enough)
2. **TanStack Start SSR throughput (own blog, Mar 17, 2026)** — Post-v1.154.4 optimizations: 427 → 2,357 req/s (5.5x), avg latency 424 → 43 ms, p99 6,558 → 928 ms (links-100, 100 conn, 30 s). Node-based; not runtime-comparative. [Source](https://tanstack.com/blog/tanstack-start-5x-ssr-throughput)
3. **Parity-gated benchmark incl. dashboard (1gr14/point0, GitHub, 2026)** — Same app (blog + SaaS dashboard), Playwright-gated: TanStack Start SSR 2,921 req/s vs Next.js 521 req/s; prod cold start 103 ms vs 765 ms. TanStack ran on **Node**; runtime kept per-framework (Bun only for Point0 itself). Medium-high confidence; self-published but reproducible. [Source](https://github.com/1gr14/point0-benchmarks)
4. **Bun-side operational data points (no TanStack numbers)** — Next.js 16 standalone runs ~10x slower under Bun than Node (oven-sh/bun#30317, May 2026); TanStack-on-Bun issues are bugs/docs (TanStack/router#5205, #5328), not perf. Bun production compile (May 2026) cuts image 2.8 GB → 355 MB, but no req/s claims. [Source](https://github.com/oven-sh/bun/issues/30317) · [Source](https://xaviergeerinck.com/2026/05/19/compiling-tanstack-start-with-bun/)

## Sources

- Kept: Platformatic SSR benchmark + v2 (primary comparative data); TanStack 5x SSR blog; point0-benchmarks; oven-sh/bun#30317; Xavier Geerinck Bun compile report.
- Dropped: Reddit comparison thread (unreadable/uncorroborated); beyondit/Stackademic posts (SEO content farm); webjs PR microbenchmarks (not TanStack).

## Gaps

- Bun-vs-Node for TanStack Start specifically: unmeasured. Closest proxies: Next.js-under-Bun regression (bun#30317) and generic Bun.serve microbenchmarks — neither transfers cleanly.
- Suggested next step: run autocannon on the same TanStack Start app under `nitro preset: "bun"` vs Node, mirroring Platformatic's methodology.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings written to /home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/c914e025/research.md: TanStack Start 427->2357 req/s (5.5x) SSR optimization (tanstack.com/blog, Mar 17 2026); Platformatic v1/v2 1000 req/s AWS EKS benchmark showing TanStack Start ~25% throughput advantage over React Router and Next.js v15 failing ~40% of requests (blog.platformatic.dev, Feb-Mar 2026); point0 parity-gated benchmark: TanStack 2,921 req/s vs Next.js 521 req/s, cold start 103ms vs 765ms (github.com/1gr14/point0-benchmarks). Explicit gap confirmed: NO TanStack Start Bun-vs-Node comparative benchmark exists."
    }
  ],
  "changedFiles": [
    "/home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/c914e025/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "web_search (4 query groups: Bun vs Node TanStack; TanStack vs Next.js; Bun SSR req/s 2025; production reports)",
      "result": "passed",
      "summary": "Located Platformatic v1/v2 benchmark, TanStack 5x SSR blog, point0-benchmarks, bun#30317, Xavier Geerinck Bun compile report"
    },
    {
      "command": "fetch_content / get_search_content verification of primary sources",
      "result": "passed",
      "summary": "Verified exact numbers and dates from TanStack blog, point0 repo, and search-synthesized Platformatic v2 figures; Reddit and Platformatic full-page extraction failed, cross-corroborated via secondary sources"
    },
    {
      "command": "write /home/mariobgsp/Project/github/trading-suite/.pi-subagents/artifacts/outputs/c914e025/research.md",
      "result": "passed",
      "summary": "Brief written, under 300 words, with sources, dates, confidence, and explicit gap statement"
    }
  ],
  "validationOutput": [
    "No files in the trading-suite repo were edited; only the designated research artifact path was written. Word count of brief body ~290 words. All dates and numbers attributed to fetched/search-verified sources."
  ],
  "residualRisks": [
    "Platformatic v2 exact per-framework req/s figures could not be fully extracted from full-page fetch (page extraction error); v2 numbers (25% throughput, 35% latency) sourced from search-synthesized content of the same post and may lack precision",
    "Next.js v15 vs v16: benchmark used v15.5.5 (v16 canary improved throughput 2x per Platformatic, untested here); TanStack-vs-Next conclusions may not hold against Next 16 stable",
    "point0-benchmarks is self-published by a single author (1gr14); reproducible and parity-gated but not independently audited",
    "No Bun-vs-Node TanStack Start data anywhere; any inference for Bun from bun#30317 (Next.js) is indirect"
  ],
  "noStagedFiles": true,
  "diffSummary": "Single new research artifact written to .pi-subagents/artifacts/outputs/c914e025/research.md; no repo source files touched",
  "reviewFindings": [
    "no blockers: gap explicitly confirmed — no TanStack Start Bun-vs-Node benchmark exists (that is the valid answer)",
    "finding: best available SSR comparison is TanStack Start vs Next.js on Node (Platformatic v2, point0); both favor TanStack Start for throughput and cold start",
    "finding: Bun-specific risk signal — Next.js 16 standalone under Bun is ~10x slower than under Node (oven-sh/bun#30317, May 2026), suggesting Bun-runtime SSR regressions are plausible for other Nitro/Node-targeted frameworks"
  ],
  "manualNotes": "For a client-heavy dashboard, note the TanStack SSR-streaming memory leak issue (TanStack/router#5289) as an adjacent risk; Platformatic's Watt integration post claims Watt ~= single-process Node throughput with +10% tail-latency gains at 10k req/s for TanStack Start if multi-core is needed."
}
```
