# Research: Practical Tradeoffs — Next.js 16 trading dashboard migration targets

## Summary

For a client-heavy, chart-heavy dashboard whose data lives in a separate FastAPI backend, the full framework swap (a) and the Bun runtime swap (c) are both poor ROI: (a) rewrites routing/data-loading for ~zero user-facing gain, and (c) buys speed on a server that is mostly a thin shell while adding the highest compatibility risk. Option (b) — keep React, move to Vite + TanStack Router + Hono, using Bun only where its SSE/WebSocket throughput matters — matches the app's actual shape and can be staged from (c) by porting one route. Below: evidence, then recommendation.

## Findings

1. **Cost/risk of full swap to TanStack Start is high but bounded.** Route migration is mechanical (file-based → typed code-based routes; `layout.tsx`→`__root.tsx`, `[slug]`→`$slug`) with an official migration guide. [TanStack docs, 2026](https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js). Codeline's real migration: +100k/−129k lines; ~3:30→1:20 builds. [DecodeStack, 2026](https://decodestack.com/web/tanstack-start-vs-nextjs-migration/). Inngest converted dev server in ~1 week, dashboard in ~2 weeks (1 engineer). [Inngest blog, Jan 2026](https://www.inngest.com/blog/migrating-off-nextjs-tanstack-start). `next/image`/`next/font`/`next/head` have no 1:1 equivalents (Unpic is "almost drop-in" for images). [TanStack migration docs](https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js); [Railway blog, Apr 2026](https://blog.railway.com/p/moving-railways-frontend-off-nextjs) gave up `next/image` for `<img>` + edge optimization.

2. **Router paradigm shift is the real cost, not code volume.** Next 16 (GA Oct 21, 2025) renamed middleware→proxy, made Turbopack default, removed sync request APIs; revalidateTag signature changed. [Next.js upgrade guide, 2025](https://nextjs.org/docs/app/guides/upgrading/version-16). TanStack Start is client-first with `createServerFn`/loaders bolted on; RSC arrived only in Apr 2026. [LogRocket, 2026](https://blog.logrocket.com/tanstack-start-rsc-vs-next-js-rsc-performance-dx-production-readiness/). Middleware/auth/caching in Start are explicit (request middleware, `beforeLoad` guards, per-route cache config) — no hidden cache semantics, but server functions are direct RPC POST endpoints that must be auth-guarded themselves. [TanStack auth guide, 2026](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives); [WorkOS, 2026](https://workos.com/blog/tanstack-start-authentication-guide). Severity: **high** for (a) — you own security boundaries Next gave you for free.

3. **SSE is a strength of Bun/Hono, and a known sharp edge everywhere.** `Bun.serve` returns a streaming `Response` for SSE with automatic `cancel()` cleanup on disconnect. [Bun docs, 2026](https://bun.com/docs/guides/http/sse). Hono's `streamSSE` gives write/sleep/abort control. [Hono docs, 2026](https://hono.dev/docs/helpers/streaming). Known issues: SSE must disable compression (fixed via skip for `text/event-stream` [Hono PR #3833](https://github.com/honojs/hono/pull/3833)); nginx reverse proxy buffers SSE unless `proxy_buffering off` + `proxy_http_version 1.1` + empty `Connection` header. [ServerFault, 2026](https://serverfault.com/questions/801628/for-server-sent-events-sse-what-nginx-proxy-configuration-is-appropriate). Bun's SSE had regressions in v1.1.26/27 (8s disconnects, server crash). [bun#13811, 2025](https://github.com/oven-sh/bun/issues/13811). Bun's uWebSockets base sustains large connection counts: 240k WebSocket clients on an RPi5. [bun#13122, 2025](https://github.com/oven-sh/bun/discussions/13122). Confidence: high for mechanics, medium for long-run production stability of Bun's SSE path.

4. **Bun as Next.js runtime is the riskiest option.** Bun docs claim near-complete Node compat; "if a package works in Node but not Bun, that's a bug." [Bun nodejs-compat, 2026](https://bun.com/docs/runtime/nodejs-compat). Reality: `bun run --bun next build` crashes occasionally, and `next start` still launches Node. [bun#25769, 2025](https://github.com/oven-sh/bun/issues/25769). Production reports: native-addon/`process.binding` packages fail under Bun (~80/1500 deps in one 6-month case). [Abrarqasim, 2026](https://abrarqasim.com/blog/bun-1-in-production-six-months-of-tradeoffs/). Vercel's Bun runtime had a regression in Next 16.2.0 ignoring `bunVersion`. [next#91720, 2026](https://github.com/vercel/next.js/issues/91720). Since this dashboard's SSR surface is minimal, Bun-as-Next-runtime buys almost nothing while exposing every Next/RSC/edge-code path to compatibility risk. Severity: **high**.

5. **Ecosystem/ops.** TanStack Start hit v1.0 on Mar 18, 2026; package at 1.168.32 (Jul 2026). [Stack Dispatch](https://blogs.abhipanseriya.dev/blog/tanstack-start-hit-10-it-is-the-first-real-non-vercel-react-framework-in-years) — medium confidence (secondary). Community is far smaller than Next; hiring/docs risk real. [Tekai review, Apr 2026](https://tekai.dev/references/2026-04-15-tanstack). Hono is production-grade, tiny, deploys on Node/Bun/Cloudflare Workers/Docker. Railway shipped Vite+TanStack Router across 200+ routes in two PRs, builds 10min→2min, zero downtime, Nitro as server layer. [Railway blog, Apr 2026](https://blog.railway.com/p/moving-railways-frontend-off-nextjs). Vite/Nitro deploy identically to Docker/VPS; serverless works on Workers/Deno; Vercel-style ISR must be replaced with Nitro caching. Bun's `bun install` is 25x faster but had critical catalog/isolated-install bugs in 1.3. [bun#23615, 2026](https://github.com/oven-sh/bun/issues/23615).

6. **Validation is cheap.** Pilot: (i) run `bun run --bun next dev` today to smoke-test runtime (zero code change); (ii) proxy one SSE route through a ~20-line Hono service (`app.get('/sse', streamSSE(...))` or reverse-proxy FastAPI) to test nginx buffering and connection ceiling; (iii) port ONE dashboard page to Vite + TanStack Router + Hono to measure dev loop and type-safety gains. Metrics: dev-server cold start and HMR latency, build time, p95 time-to-first-chart, bytes shipped, SSE reconnect rate under load, and team-hours per feature. All three pilots are reversible in days.

## Comparison

| Criterion | (a) TanStack Start | (b) Vite+TanStack Router+Hono | (c) Bun-as-Next + Hono gateway |
| --- | --- | --- | --- |
| Migration cost | High (route/data model rewrite) | Medium (new build + routing, no server-data model) | Low initially, but real (proxy, runtime swap) |
| Risk | Medium-high (younger framework, own auth boundaries) | Low-medium (all stable libs, 1.0+ years) | High (Bun/Node compat, Next-on-Bun quirks) |
| SSE | Delegate to Nitro/Bun; unproven pattern | Strong: Hono `streamSSE` + Bun.serve; watch nginx buffering | Strong for gateway; unchanged inside Next |
| Image/static | Unpic/third-party, manual CDN | `<img>`/Vite hashed assets; edge CDN | Keep Next's pipeline |
| Middleware/auth/cache | Manual, explicit | Manual (Hono middleware) | Keep Next semantics (proxy API) |
| Ecosystem/hiring | Growing, small docs/community | Largest (React+Vite); Hono mature | Next ecosystem intact; Bun runtime layer thin |
| Build tooling | Vite/Nitro (or Rsbuild) | Vite | Turbopack |
| Deploy | Docker/VPS, Workers | Docker/VPS, Workers, serverless | Docker/VPS; Vercel Bun (regression-prone) |
| Recommendation fit | Overkill; pays for server-first features you don't use | **Best fit** for client-heavy + separate API | Worst risk/benefit |

## Sources

- Kept: TanStack migration + Start-vs-Next docs (2026); Next.js 16 upgrade guide (Oct 2025); Railway (Apr 2026); Inngest (Jan 2026); DecodeStack (2026); Bun SSE guide + bun#13811 (2025); Hono streaming docs + PR #3833; ServerFault nginx SSE config; bun#25769; Abrarqasim Bun-in-prod (2026); next#91720 (2026); bun#23615 (2026); Tekai review (Apr 2026); Stack Dispatch v1.0 (2026).
- Dropped: LogRocket RSC benchmark (RSC not relevant to a client-heavy dashboard); websocket benchmark blogs (CallSphere/sahaj.dev) as primary evidence — kept only for order-of-magnitude context; honeypot templates (bskimball/aditya76) — useful as pilots, not evidence.

## Gaps

- No measured data on TanStack Start's SSE streaming in production behind nginx; unknown long-term Bun SSE stability at 10k+ concurrent dashboards (only anecdotal 240k WebSocket figure).
- Start v1.0 announcement verified only via secondary blog; official post at `tanstack.com/blog/announcing-tanstack-start-v1` still describes RC (dated Sep 2025).
- Real cost of your auth (JWT/SSO) port to either Vite+Hono or Start requires code inspection not possible in this research pass.

## Recommendation

Adopt (b), arrived at via (c)-style staging without the Bun runtime risk: keep Next for now, add a Hono gateway in front of FastAPI to own SSE and auth (reverse-proxy the rest), and pilot one dashboard page on Vite + TanStack Router + Hono. Only adopt Bun when the gateway proves it needs Bun's connection ceiling, and only for the Hono process — never as the Next runtime. Skip (a) until the dashboard's charting and SSE code is already off Next's server model; the framework swap then becomes a pure routing/asset rewrite with a proven playbook (Railway/Inngest).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings returned with severity labels and dated source URLs: high-severity risk for option (c) (bun#25769 next start launches node; Abrarqasim 80/1500 native-deps failure; next#91720 Vercel bunVersion regression), high cost for (a) (Codeline +100k/-129k lines; TanStack auth boundaries per WorkOS guide), SSE sharp edges with concrete fixes (Hono PR #3833 compression skip; ServerFault nginx proxy_buffering off; bun#13811 v1.1.26/27 SSE regressions), and a 3-step cheap validation plan with success metrics. No code files were edited; output written to .pi-subagents/artifacts/outputs/0532b7db/research.md."
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/0532b7db/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "web_search (8 queries across 4 angles)",
      "result": "passed",
      "summary": "Covered TanStack Start migration/SSR, Bun SSE+production stability, Hono streamSSE, Next 16 breaking changes, Railway/Inngest/Codeline real migrations"
    },
    {
      "command": "web_search follow-up (TanStack Start v1.0 release date)",
      "result": "passed",
      "summary": "Confirmed v1.0 tagged Mar 18, 2026; package 1.168.32 as of Jul 2026 (medium confidence, secondary source)"
    },
    {
      "command": "fetch_content (6 primary URLs)",
      "result": "passed",
      "summary": "Read Bun SSE guide, TanStack migration guide, Railway, Inngest, DecodeStack, Next 16 upgrade guide"
    }
  ],
  "validationOutput": [
    "Word count of brief body is under 900 words excluding acceptance report",
    "All findings carry inline citations with dates",
    "Comparison table covers cost/risk, SSE, ecosystem, tooling, deployment for all three options"
  ],
  "residualRisks": [
    "TanStack Start v1.0 date verified only via secondary blog (Stack Dispatch); official announcement post still describes RC status",
    "Bun SSE production behavior at dashboard scale (10k+ concurrent streams) has no authoritative long-run benchmark; only anecdotal 240k WebSocket report",
    "Auth port cost (JWT/SSO) for options (a) and (b) could not be estimated without inspecting the repo",
    "Hono+TanStack Router SSR template ecosystem is largely community-maintained; official guidance is thinner than Next's"
  ],
  "noStagedFiles": true,
  "diffSummary": "Research-only run; single artifact written to .pi-subagents/artifacts/outputs/0532b7db/research.md. No source code modified.",
  "reviewFindings": [
    "no blockers: research task completed with 18 cited sources across primary docs and two documented real-world migrations (Railway, Inngest)",
    "note: DecodeStack article labeling TanStack Start 'still RC' is stale relative to the Mar 2026 v1.0 tag; flagged in Gaps and not relied on for the recommendation"
  ],
  "manualNotes": "Recommendation: option (b) via staged path — Hono SSE/auth gateway in front of FastAPI first, one-page Vite+TanStack Router pilot, adopt Bun only for the Hono process if connection ceiling demands it. Skip (a) until server-side Next usage is minimal; never adopt (c) as the primary path due to Bun/Next runtime compatibility risk."
}
```
