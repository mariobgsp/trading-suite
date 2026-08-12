# Trading Suite — TanStack Start + Hono Pilot

Migration pilot from Next.js 16 → **TanStack Start (SSR) + Hono (API gateway) on
Node**. **All eight** dashboard routes are ported: Overview, Markets, Portfolio,
Backtest, Screener (incl. live SSE stream), Validator, Sentiment Radar, and
Regime & Bot. The FastAPI backend on `:8000` is untouched.

## Stack (as-installed)

| Piece | Version | Notes |
| --- | --- | --- |
| `@tanstack/react-start` | 1.168.42 | Vite 6 + Nitro server; isomorphic-by-default |
| `@tanstack/react-router` | 1.170.25 | code-based routes, `routeTree.gen.ts` auto-generated |
| `vite` | 6.4.3 | dev server + build |
| `hono` | 4.13.1 | prod API gateway (`server/index.ts`) |
| `react` / `react-dom` | 19.2.8 | same as the Next app |
| `lightweight-charts` | 5.2.x | framework-clean component, reused as-is |

## Run it

```bash
# dev (Vite :3001, /api/* proxied to FastAPI :8000)
cd pilot && bun install && bun run dev

# prod (build then serve via Hono on :3001)
cd pilot && bun run build && bun run start
```

Backend must be up on `:8000` (e.g. `backend/.venv/bin/uvicorn app.main:app --port 8000`).

## How it's wired (the three migration steps in one tree)

1. **Framework swap** — Next App Router → TanStack Start file routes:
   - `src/routes/__root.tsx` ← `src/app/layout.tsx` (fonts via Google Fonts CSS
     instead of `next/font`; `Metadata` → `head()` on the root route)
   - `src/routes/markets.tsx` ← `src/app/markets/page.tsx`
     (`useSearchParams` → `Route.useSearch()` + `validateSearch`)
   - `src/routes/screener.tsx` ← `src/app/screener/page.tsx`
   - `next/link` → TanStack `<Link>`; `usePathname` → `useLocation()`
   - No `"use client"` anywhere — TanStack is isomorphic by default
2. **Same-origin API** — `/api/*` is proxied to FastAPI `:8000` by Vite (dev)
   and by the Hono server (prod). The browser never talks cross-origin, so the
   backend's CORS config is no longer on the SSE path. `process.env.NEXT_PUBLIC_API_URL`
   is gone; `src/lib/api.ts` uses `import.meta.env.VITE_API_URL` (default empty =
   same-origin).
3. **Hono gateway** — `server/index.ts` (prod): serves `dist/client/assets`,
   proxies `/api/*` (REST + SSE pass-through, no request timeout, keepalive),
   and delegates everything else to the TanStack Start SSR handler.

## Validation (all passing)

- `bun run build` (exit 0) — SSR server + client emitted to `dist/`
- Prod: all 8 routes 200 (SSR), CSS asset 200, `/api/regime/snapshot` 200 via
  Hono, SSE stream live (22 KB of `ticker` events in 6 s through the Hono proxy)
- Dev: same matrix green through the Vite proxy
- `bunx tsc --noEmit` clean, `bunx eslint src` clean

## Deliberate deviations from Next behavior

- **No image optimization** — the app never used `next/image`; not needed.
- **Sidebar/launcher list all routes** — all 8 are ported, so the disabled-card
  fallback is now unused; it stays for future apps added to the suite.
- **No tests yet** — repo has zero frontend tests; none were invented.
- **Build output** is `dist/` (not `.output/` as in some TanStack docs) for this
  Vite/plugin combo; `start` targets `dist` accordingly.

## Known gaps

- Fonts load from Google Fonts CDN (Next bundled them locally) — fine for a
  pilot, swap to `unfonts` before prod hardening.
- Hono runs on Node here; Bun runtime was left out deliberately (see research:
  Next-on-Bun ~10x regression, TanStack-on-Bun unbenchmarked, Bun 1.4 Rust
  rewrite in flight).
