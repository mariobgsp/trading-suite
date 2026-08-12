# Research: Migrating Next.js 16 App Router → TanStack Start + Hono + Bun (2025–2026)

**Baseline:** Next.js 16 released 2025-10-21/22 (stable Turbopack, Cache Components, React 19.2). Your app (Next 16.3 + React 19 + Tailwind 4, REST + SSE to FastAPI) is a client-heavy dashboard — exactly the profile that migration evidence says gains least from App Router's server-first model.

## Summary

TanStack Start went stable v1.0 on 2026-03-18 after a Sep 2025 RC, is built on Vite + Nitro (not Hono), and now has first-party migration docs plus two notable production migrations (Inngest, Railway). Hono (v4.13.0, Aug 2026) is mature and standalone — typically used *alongside* TanStack Start (its Nitro server) for the API layer, not inside it. Bun (1.3.14 stable; 1.4.0 Rust rewrite in canary) runs both Hono and Next.js dev, but has known SSE idle-timeout and native-addon gaps. A staged migration (frontend-first, keep FastAPI) is defensible; a full swap is not yet low-risk.

## Findings

### 1. TanStack Start — production readiness

1. **Version/status:** RC announced 2025-09-22; v1.0 tagged 2026-03-18. Current packages ~1.168.35 (Aug 3, 2026); `@tanstack/start` ~11k weekly downloads. Fast release cadence (weekly bumps) is itself a risk. [RC blog](https://tanstack.com/blog/announcing-tanstack-start-v1), [release stream](https://github.com/TanStack/router/releases/tag/release-2026-08-03-2216) *(high confidence)*
2. **Runtime:** Runs on **Vite + Nitro** — TanStack explicitly ditched Vinxi adapters ("TanStack Start = Nitro + Vite + TanStack Router"). Not Hono. SSR streaming, middleware, typed loaders, `createServerFn`, and file-based server routes are all first-class. [Why TanStack Start is Ditching Adapters](https://tanstack.com/blog/why-tanstack-start-is-ditching-adapters), [Nitro SSR example](https://nitro.build/examples/vite-ssr-tss-react) *(high)*
3. **Model vs Next:** Isomorphic-by-default — all code runs both sides unless wrapped in `createServerFn` (opposite of Next's server-by-default RSC). Data loading = route loaders + TanStack Query (fits your charts/SSE dashboard well). RSC exists only as experimental `@tanstack/react-start-rsc` (0.1.x). [Official comparison](https://tanstack.com/start/latest/docs/framework/react/comparison), [migration skill](https://github.com/tanstack/router/blob/main/packages/react-start/skills/lifecycle/migrate-from-nextjs/SKILL.md) *(high)*
4. **Production evidence:** Inngest migrated off Next.js to TanStack Start (blog 2026-01-30): local page loads 10–12s → 2–3s, 83% local dev time reduction, ~3 weeks one engineer — while Start was still RC. [Inngest blog](https://www.inngest.com/blog/migrating-off-nextjs-tanstack-start) *(high)*. Railway moved 200+ routes off Next.js in two PRs (builds 10+ min → <2 min) but to **Vite + TanStack Router**, not Start. [Railway blog](https://blog.railway.com/p/moving-railways-frontend-off-nextjs) *(medium — not the same stack)*
5. **Gaps:** no built-in image optimization (migration guide prescribes `@unpic/react`); auth is DIY (official session/OAuth/CSRF guide exists); ecosystem/plugins much smaller than Next. [Migrate from Next.js guide](https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js), [auth server primitives](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives) *(high)*

### 2. Hono — server layer

6. **Version:** v4.13.0 (2026-08-03) — core perf up to 1.25x, QUERY method, Method-Not-Allowed middleware. v4.12.4 (2026-03-03) fixed an **SSE injection vulnerability** (CR/LF in `event`/`id`/`retry`; GHSA-p6xx-57qc-3wxr) — pin ≥4.12.4. [Releases](https://github.com/honojs/hono/releases/tag/v4.13.0), [v4.12.4](https://github.com/honojs/hono/releases/tag/v4.12.4) *(high)*
2. **Capabilities:** JSX with async components + Suspense, SSG, Client Components, `streamSSE` helper, WebSocket helper with adapters for Bun, Node (`@hono/node-server`), Deno, Cloudflare Workers/Pages. Middleware ecosystem is solid (auth, JWT, cache, ETag, CORS, rate-limit). [JSX](https://hono.dev/docs/guides/jsx), [WebSocket helper](https://hono.dev/docs/helpers/websocket) *(high)*
3. **Standalone vs inside Start:** TanStack Start's server is Nitro; Hono is not part of it. Community pattern = TanStack Start for SSR + Hono as the API layer (via Nitro handler or standalone); community repo shows wiring Hono into Start's request handler. [isnifer/tanstack-start-ssr-hono](https://github.com/isnifer/tanstack-start-ssr-hono) *(medium — community, not official)*

### 3. Bun — runtime

9. **Version:** 1.2 on 2025-01-22; stable **1.3.14** (2026-05-13, HTTP/3 in Bun.serve, Bun.cron). **1.4.0 is a full Zig→Rust rewrite, in canary (announced 2026-07-08); Bun was acquired by Anthropic Dec 2025** — runtime churn to monitor before committing. [Bun 1.2](https://bun.com/blog/bun-v1.2), [Rust rewrite](https://bun.com/blog/bun-in-rust) *(high)*
2. **Next.js compat:** `bun --bun next dev/build/start` is officially documented; Vercel added a native Bun runtime (beta) via `bunVersion` in vercel.json. So Bun *can* run your current Next 16 app, but it's secondary support, not the blessed path. [Bun + Next.js guide](https://bun.sh/docs/guides/ecosystem/nextjs), [Vercel Bun beta](https://bun.sh/blog/vercel-adds-native-bun-support) *(high)*
3. **Performance:** Hono's own benchmarks show ~64k req/s (Bun) vs ~27k (Node) on bun-http-framework-benchmark, but third-party runs show variance — one macOS/Windows test found Node+Hono faster. `@hono/node-server` README shows ~85k req/s (Node). Treat "Bun is always faster" as workload-dependent. [Hono benchmarks](https://hono.dev/docs/concepts/benchmarks), [oven discussion #21998](https://github.com/oven-sh/bun/discussions/21998), [node-server](https://github.com/honojs/node-server/) *(medium)*
4. **Known production issues:** native addons (e.g., bcrypt) are the main blocker (JavaScriptCore vs V8); npm packages with node-assuming postinstall scripts; `node:` compat is high but not 100%. [Node compat docs](https://bun.com/docs/runtime/nodejs-compat), [production write-up](https://abrarqasim.com/blog/bun-1-in-production-six-months-of-tradeoffs/) *(medium — anecdotal)*

### 4. Migration evidence & pain points
 1. **Guides:** official [Migrate from Next.js](https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js) covers route conversion, API mapping, Server Actions → `createServerFn`, middleware, data fetching; third-party [Dev Encyclopedia guide](https://devencyclopedia.com/blog/nextjs-to-tanstack-start-migration) aggregates Railway/Inngest lessons. *(high)*
 2. **Pain points reported:** isomorphic-by-default confusion; bundling leaks between client/server; image optimization (`next/image` → Unpic); auth reimplementation; and dev-mode vs prod-behavior differences (Inngest warns "don't rely on dev mode alone"). No i18n story found in Start docs — gap. [Inngest blog](https://www.inngest.com/blog/migrating-off-nextjs-tanstack-start), [SKILL.md](https://github.com/tanstack/router/blob/main/packages/react-start/skills/lifecycle/migrate-from-nextjs/SKILL.md) *(high)*

### 5. SSE on Hono/TanStack Start + Bun
 1. **Hono SSE is production-usable** (`streamSSE` + abort handling) with Bun's native WebSocket/stream support, but three real gotchas: (a) `Bun.serve` **default idleTimeout ~10s kills quiet SSE streams** — must set `idleTimeout: 0` and/or keepalives [bun issue #27479](https://github.com/oven-sh/bun/issues/27479); (b) Hono `streamSSE` closes without periodic writes unless you `sleep` between events [hono issue #2050](https://github.com/honojs/hono/issues/2050); (c) Bun 1.1.26/1.1.27 had SSE disconnect/regression bugs (fixed later) [issue #13811](https://github.com/oven-sh/bun/issues/13811). Bun handles long-lived connections OK **with explicit timeouts/keepalives**; proxies (Fly.io) add their own idle limits — send heartbeats. [Bun SSE guide](https://bun.com/docs/guides/http/sse), [Fly.io post](https://ryanlabouve.com/writing/sse-streaming-on-fly/) *(high)*

## Recommended migration posture: **Staged, frontend-first — not a full swap**

- **Keep the FastAPI backend (REST + SSE) as-is** — it's already runtime-agnostic and none of the frameworks improve it; SSE heartbeats + `idleTimeout` config are required regardless of framework.
- **Stage 1 (low risk, now):** run existing Next 16.3 dev/build on Bun (`bun --bun next dev`) to capture Bun DX/perf with zero migration; pin Hono ≥4.12.4 only if you extract the SSE proxy/BFF layer.
- **Stage 2 (pilot):** prototype 1–2 dashboard routes in TanStack Start (loaders + `createServerFn` + TanStack Query) alongside the Next app; Inngest/Railway show this is the winning pattern for client-heavy, real-time UIs, and official migration docs now exist.
- **Stage 3 (commit):** only after the pilot and after Bun 1.4 (Rust) stabilizes — or keep Node as the Start/Hono runtime if native-addon or SSE issues bite. The main blocker is not maturity of any single piece but the combination's novelty: TanStack Start v1 is ~5 months old, Bun 1.4 is a runtime rewrite in progress, and Hono-in-Start is community-shaped, not official.

## Gaps

- No benchmark found for TanStack Start SSR on Bun vs Node (request/sec, cold start) — only framework-level Hono benchmarks.
- No production reports of TanStack Start + Hono + Bun as a *combined* stack; evidence covers pairs.
- TanStack Start i18n and caching semantics (ISR-equivalent) vs Next 16 Cache Components are undocumented; needs hands-on validation.
- Railway migrated to TanStack Router (SPA) — does not validate Start SSR in production at scale.

## Sources

- Kept: [TanStack Start v1 RC](https://tanstack.com/blog/announcing-tanstack-start-v1); [Ditching Adapters](https://tanstack.com/blog/why-tanstack-start-is-ditching-adapters); [Start vs Next](https://tanstack.com/start/latest/docs/framework/react/comparison); [Migrate from Next.js](https://tanstack.com/start/latest/docs/framework/react/migrate-from-next-js); [Inngest migration](https://www.inngest.com/blog/migrating-off-nextjs-tanstack-start); [Railway migration](https://blog.railway.com/p/moving-railways-frontend-off-nextjs); [Hono releases](https://github.com/honojs/hono/releases); [Hono SSE vuln v4.12.4](https://github.com/honojs/hono/releases/tag/v4.12.4); [Hono benchmarks](https://hono.dev/docs/concepts/benchmarks); [Bun 1.2](https://bun.com/blog/bun-v1.2); [Bun Rust rewrite](https://bun.com/blog/bun-in-rust); [Bun+Next.js](https://bun.sh/docs/guides/ecosystem/nextjs); [Bun SSE guide](https://bun.com/docs/guides/http/sse); [bun#27479](https://github.com/oven-sh/bun/issues/27479); [hono#2050](https://github.com/honojs/hono/issues/2050); [Next.js 16](https://nextjs.org/blog/next-16).
- Dropped: InfoQ/MakerKit/Medium roundups (aggregated, no primary numbers); LinkedIn benchmark post (unverifiable methodology); npm pages (403/version churn not useful vs GitHub releases).
