# Recon: Next.js 16 + FastAPI → TanStack Start + Hono + Bun

Root: `/home/mariobgsp/Project/github/trading-suite`. Frontend is a small, thin SPA: ~3,170 LOC of TS/TSX (`src/`), all pages are client components hitting a FastAPI backend directly from the browser. No route handlers, no middleware, no server components, no `next/image`, no caching/revalidation config. Good news for the migration.

## 1. Frontend surface (`src/`, ~3,166 LOC TS/TSX + 431 CSS)

**Routes** (`src/app/`, ~2,035 LOC) — 9 pages, all `"use client"` (11 `use client` directives in `src/`), all default-exported page components:

- `layout.tsx` (34) — root layout: `next/font/google` (Space_Grotesk, JetBrains_Mono) + `Metadata` export (server component — the only non-client file in `src/app`).
- `page.tsx` (11) — launcher, renders `<Shell><AppsGrid/>`.
- `overview/page.tsx` (223) — 3 `usePolling` loops (30s indices, 15s quotes, 60s regime); `next/link` links.
- `markets/page.tsx` (258) — `useSearchParams` from `next/navigation` (wrapped in `Suspense`), ticker/period-driven polling + 15s quote poll, `MarketChart` (candles + overlays).
- `portfolio/page.tsx` (267) — 20s state poll + `api.post` journal form (only POST in the app).
- `backtest/page.tsx` (235), `validator/page.tsx` (222), `regime/page.tsx` (148), `sentiment/page.tsx` (184) — one-shot fetches / slow polls (sentiment 300s).
- `screener/page.tsx` (453) — SSE consumer via `useEventSource`; hardcodes `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"` to build the EventSource URL.

**Components** (`src/components/`, ~590 LOC):

- `Shell.tsx` (18) — `usePathname` from `next/navigation` for active-tab state. Framework-locked only by that import.
- `Sidebar.tsx` (63), `launcher.tsx` (169) — `next/link` only. Otherwise pure.
- `MarketChart.tsx` (229) — lightweight-charts v5; framework-clean (hooks + refs only).
- `ui.tsx` (111) — pure presentational (StatCard, Skeleton, Spinner, ChangeBadge, SectionHeader).
- `globals.css` (431) — Tailwind v4 + custom CSS vars/animations; no Next dependency.

**Lib** (`src/lib/`, ~541 LOC):

- `api.ts` (259) — the one framework-adjacent lib file: `API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"` at module top (line 4), plus `api.get/post` fetch wrapper and all domain types/formatters. **Swaps cleanly to `import.meta.env` / Bun `Bun.env`**.
- `usePolling.ts` (122) — framework-agnostic polling + `useEventSource` hooks.
- `apps.ts` (160) — pure metadata (nav + endpoint docs).

## 2. Config surface

- `next.config.ts` (8 lines) — **only** `output: "standalone"`. **No rewrites/proxies, no images config, no headers.** The browser calls the backend directly at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`), with CORS handled server-side (`backend/app/main.py:28` CORSMiddleware, `CORS_ORIGINS` default `http://localhost:3000`). No reverse proxy layer at all.
- Backend endpoints consumed: `/api/market/indices`, `/api/market/quotes`, `/api/market/history/{ticker}`, `/api/market/quote/{ticker}`, `/api/portfolio/state`, `/api/portfolio/journal` (POST), `/api/backtest/{ticker}`, `/api/screener/analyze/{ticker}`, `/api/screener/scan/stream` (SSE, `text/event-stream`, `backend/app/routers/screener.py:96-101`), `/api/validator/{ticker}`, `/api/sentiment/news`, `/api/regime/snapshot`, `/api/regime/history`.
- Polling intervals: 15s (quotes), 20s (portfolio), 30s (indices), 60s (regime), 300s (sentiment); history poll is manual only.
- `tsconfig.json` — `paths: {"@/*": ["./src/*"]}`, `jsx: react-jsx`, `moduleResolution: bundler`, `plugins: [{name:"next"}]` (strips fine), `include` references `next-env.d.ts` and `.next/types/**/*.ts` (must delete when Next goes). `next-env.d.ts` exists at root.
- `postcss.config.mjs` — Tailwind v4 `@tailwindcss/postcss` only; framework-clean.
- `eslint.config.mjs` — extends `eslint-config-next/core-web-vitals` + `typescript`; ignores `.next/**`, `next-env.d.ts`. Only Next-tied file here; swap for `eslint-plugin-react-hooks`/typescript configs.
- Env vars: `NEXT_PUBLIC_API_URL` (only NEXT_PUBLIC_* in use), plus backend-only `STOCKBIT_JWT_TOKEN`, `GEMINI_API_KEY`, `CORS_ORIGINS`, cache TTLs.

## 3. Deployment / ops

- `Dockerfile` — 3-stage Next build: `npm ci` → `next build` → runner copies `public/`, `.next/standalone`, `.next/static`; runs `node server.js` via `docker-entrypoint.sh` as non-root user `nextjs`, port 3000. Next `output: standalone` is the only Next-specific coupling.
- `docker-entrypoint.sh` — health-waits on `http://backend:8000/api/health` (60 retries × 2s) then `exec node server.js` (podman-compose workaround).
- `docker-compose.yml` — `backend` (port 8000, uvicorn, SQLite volume `trading_suite_data:/app/data`, healthcheck) + `frontend` (port 3000, `depends_on: service_healthy`). CORS origin injected from env.
- `scripts/run.sh` — local dev launcher: `uvicorn app.main:app --port 8000` (from `backend/.venv`) + `npm run dev`. `scripts/import_history.sh` — git history importer for `legacy/`, **unrelated to the app runtime** (won't break).
- Backend Dockerfile: python:3.12-slim, `uvicorn app.main:app --port 8000`. No nginx anywhere. Ports: 3000 frontend, 8000 backend.

## 4. Migration blast radius

**Framework-locked (breaks first if Next is swapped):**

- `src/app/layout.tsx` — `next/font/google` + `Metadata` + root-layout convention → TanStack Start uses `routes.ts`/root route; fonts need manual `@font-face` or `unfonts`.
- `src/app/markets/page.tsx` (line 4) — `useSearchParams` → TanStack Router `useSearch()`/`Route` search validation.
- `src/components/Shell.tsx` (line 3) — `usePathname` → `useLocation()`/`useRouter().state.location`.
- `src/components/Sidebar.tsx`, `src/components/launcher.tsx`, `src/app/overview/page.tsx` — `next/link` → TanStack `Link` (drop-in, mostly mechanical).
- `src/lib/api.ts` (line 4) + `screener/page.tsx` (line 83) — `process.env.NEXT_PUBLIC_API_URL` → `import.meta.env`/`Bun.env`; module-level env read means one-line change per file.
- Build tooling: `next.config.ts`, `next-env.d.ts`, tsconfig `plugins`/`include` (`.next/types`), eslint-config-next, `Dockerfile` standalone output, docker-entrypoint's `node server.js`, root `package.json` scripts.

**Framework-clean (portable as-is):** `lib/usePolling.ts`, `lib/apps.ts`, `lib/api.ts` types+formatters, `components/ui.tsx`, `components/MarketChart.tsx`, `globals.css`, all page bodies (JSX + hooks). ~2,500 of ~3,170 LOC move untouched.

**Tests:** zero frontend tests in the live tree (root `find` for `*.test.ts*` returns nothing outside `legacy/`). Legacy tests exist only in `legacy/trading-simulator/dashboard/src/` (`BacktestCard.test.tsx`, `backtestEngine.test.ts`, `indicators.test.ts`) — not wired to any current script.

**Risks:** SSE via `EventSource` is origin-bound — if Hono serves the UI, CORS (`CORS_ORIGINS`) and the SSE URL must still point at the FastAPI origin; no change needed if URLs are absolute. `npm run build` currently relies on Next static analysis; TanStack Start will build differently. Bun runtime change does not touch the backend (Python) at all.

## Verdict: framework-clean vs locked

- **Clean:** ~78% of frontend code (all components except 3 imports, all hooks, all lib types, all CSS).
- **Locked:** ~6 imports total (`next/link` ×3, `next/navigation` ×2, `next/font` + `Metadata`), 2 env reads, 1 layout convention, build/ops config.

## Cheapest staging path

1. **Bun-only first (no framework swap):** run `bun install`, `bun run next dev` (Next is Bun-compatible), or swap `npm run dev` in `scripts/run.sh` → keeps everything green while validating Bun.
2. **Then Hono as a sidecar proxy** (optional): replace the Next server with a minimal Hono server serving the static export + proxying `/api/*` to FastAPI — kills the CORS/SSE concerns in one layer and keeps all page code client-side.
3. **Then TanStack Router adoption:** mechanical swap of the 6 imports above; `useSearchParams`→`useSearch` is the only non-trivial one. Keep pages as client components — TanStack Start supports zero-server-render SPAs, matching today's architecture.
4. Delete `next.config.ts`, `next-env.d.ts`, `.next/`, swap `eslint-config-next` for a plain TS/React config; rewire `Dockerfile` to `bun build` + `bun run start` (drop standalone output + entrypoint health-wait or point it at Hono).