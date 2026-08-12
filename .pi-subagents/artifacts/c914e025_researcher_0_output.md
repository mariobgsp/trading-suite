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