# Scout Report: trading-suite → app-launcher / apps-section dashboard redesign

Repo: `/home/mariobgsp/Project/github/trading-suite` (Next.js 16.3.0 App Router + FastAPI backend on :8000).
No files were edited. All paths relative to repo root.

---

## 1. Full src/ tree

```
src/
├── app/
│   ├── favicon.ico
│   ├── globals.css          design tokens + utility classes (Tailwind v4)
│   ├── layout.tsx           root layout, <html class="dark">
│   ├── page.tsx             "/"  Overview dashboard (currently the landing page)
│   ├── backtest/page.tsx    "/backtest"
│   ├── markets/page.tsx     "/markets"
│   ├── portfolio/page.tsx   "/portfolio"
│   ├── regime/page.tsx      "/regime"
│   ├── screener/page.tsx    "/screener"
│   ├── sentiment/page.tsx   "/sentiment"
│   └── validator/page.tsx   "/validator"
├── components/
│   ├── MarketChart.tsx      lightweight-charts wrappers (MarketChart, SimpleLineChart)
│   ├── Shell.tsx            layout shell (Sidebar + <main>)
│   ├── Sidebar.tsx          nav sidebar
│   └── ui.tsx               shared UI primitives
└── lib/
    ├── api.ts               typed API client, domain types, formatters
    └── usePolling.ts        usePolling + useEventSource hooks
```

There are **8 routes** total, no route groups, no (app) sub-tree, no nested layouts, no middleware. `favicon.ico` is the only static asset in `app/`.

---

## 2. Every page route — what it does and which backend endpoint(s) it calls

All pages are `"use client"`, all wrap content in `<Shell>`, all talk to the FastAPI backend via `src/lib/api.ts` (`API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"`, api.ts:1-2).

### `/` — Overview (`src/app/page.tsx`, 81 lines)

- Polls `GET /api/market/indices` (30s), `GET /api/market/quotes?tickers=BBCA,BBRI,...` (15s), `GET /api/regime/snapshot` (60s) — page.tsx:18-32.
- Renders indices StatCard strip, watchlist table (links to `/markets?ticker=X`), IHSG composite chart via `SimpleLineChart` fed by `GET /api/regime/history` (page.tsx:152-158), market-regime panel.
- This is the current landing page — **the page most likely to become/replace the app launcher** or be demoted under a new launcher route.

### `/markets` — Markets (`src/app/markets/page.tsx`, ~230 lines)

- `useSearchParams` reads `?ticker=`, ticker input + period (3mo/6mo/1y/2y), overlay toggles (sma20/50/200, ema21), volume toggle.
- Calls `GET /api/market/history/{ticker}?period={period}` (no poll; refreshKey `ticker:period`) and `GET /api/market/quote/{ticker}` (15s) — markets/page.tsx:57-62.
- Renders `MarketChart` (candles + overlays + volume), momentum/indicator readout grid, popular-ticker chips. Wrapped in `<Suspense>` due to `useSearchParams`.

### `/portfolio` — Portfolio (`src/app/portfolio/page.tsx`, ~250 lines)

- Polls `GET /api/portfolio/state` (20s) — portfolio/page.tsx:13.
- Journal form POSTs to `POST /api/portfolio/journal` (action BUY/SELL/DEPOSIT/WITHDRAW, ticker, qty, price, date, currency) — portfolio/page.tsx:75-80.
- Renders net-worth/cash/market-value/realized-P&L StatCards, positions table, journal form.

### `/backtest` — Backtest (`src/app/backtest/page.tsx`, ~250 lines)

- On demand `GET /api/backtest/{ticker}?strategy={strategy}&period={period}` (strategies: momentum, meanreversion, buyhold) — backtest/page.tsx:24-35.
- Renders stat cards, equity curve via `SimpleLineChart`, trade table.

### `/screener` — Screener (`src/app/screener/page.tsx`, ~330 lines)

- SSE stream: `GET /api/screener/scan/stream?mode=behavior|squeeze|vault&limit=N` via `useEventSource` (built URL at screener/page.tsx:100-106).
- Single-ticker: `GET /api/screener/analyze/{ticker}?force=false` — screener/page.tsx:128.
- Renders progress bar, streaming results table (behavior/squeeze) and VaultTable (vault mode, typed loosely as `VaultRow`).

### `/validator` — Validator (`src/app/validator/page.tsx`, ~230 lines)

- On demand `GET /api/validator/{ticker}` — validator/page.tsx:22.
- Renders StatCards (bandar phase, inst flow, intent), liquidity/flow panel, intent-radar table.

### `/sentiment` — Sentiment Radar (`src/app/sentiment/page.tsx`, ~180 lines)

- Polls `GET /api/sentiment/news` (300s) — sentiment/page.tsx:12.
- Category/tag filter chips, headline cards, sentiment dots.

### `/regime` — Regime & Bot (`src/app/regime/page.tsx`, ~150 lines)

- Polls `GET /api/regime/snapshot` and `GET /api/regime/history` (60s) — regime/page.tsx:39-43.
- Regime StatCards, IHSG chart via `SimpleLineChart`, engine-permissions panel, bot-pipeline blurb.

### Backend endpoint inventory (for launcher cards / search indexing)

From `backend/app/routers/*`:

- market.py: `/api/market/indices`, `/quote/{ticker}`, `/quotes`, `/history/{ticker}`, `/beta/{ticker}`, `/forex`, `/cache/stats`
- portfolio.py: `/state`, `/watchlist` GET/POST, `/journal` GET/POST, `/pending-orders` GET/POST
- backtest.py: `/strategies`, `/{ticker}`
- screener.py: `/tickers`, `/analyze/{ticker}`, `/squeeze/{ticker}`, `/scan`, `/vault/{ticker}`, `/scan/stream` (SSE)
- validator.py: `/{ticker}`
- sentiment.py: `/news`, `/idx`
- regime.py: `/snapshot`, `/history`, `/stockbit`, `/stockbit/detector/{ticker}`
- main.py: `/`, `/api/health`

---

## 3. `src/app/globals.css` — design tokens, utilities, Tailwind v4 (75 lines total)

- Line 1: `@import "tailwindcss";` — Tailwind v4 via PostCSS plugin (`@tailwindcss/postcss` in postcss.config.mjs). **No `@theme` block anywhere** — all tokens are plain CSS custom properties on `:root`, so Tailwind's default palette is still active; custom colors are used as arbitrary values (`text-[var(--up)]`, `bg-[var(--panel)]`).
- Design tokens `:root` (globals.css:4-15):

  ```
  --bg: #0a0e14;  --panel: #10141d;  --panel-2: #151b27;
  --border: #1e2635;  --border-strong: #2a3548;
  --text: #e6eaf2;  --text-dim: #8b95a9;  --text-faint: #5c6577;
  --accent: #38bdf8;  --up: #34d399;  --down: #f87171;
  --gold: #fbbf24;  --violet: #a78bfa;
  ```

- Fonts (globals.css:21-24): `"Inter", ui-sans-serif, ...` for html/body; `.font-mono`/`.tabular` use `"JetBrains Mono", ui-monospace, ...`. **Fonts are NOT loaded** — no `next/font` import anywhere in src/ (grep confirmed zero matches), no @font-face, no CDN link. They fall back to system fonts today.
- Utility classes:
  - `.panel` / `.panel-2` (globals.css:46-54): card backgrounds + 1px border + radius (10px / 8px).
  - `.flash-up` / `.flash-down` (globals.css:56-75): ticker-flash keyframe animations.
  - `.cursor-blink` (globals.css:77-82): terminal-style blinking cursor.
  - `.skeleton` (globals.css:84-101): shimmer gradient loading block (paired with `<Skeleton>` component).
  - `.grid-texture` (globals.css:118-126): subtle 32px accent grid background (used on hero/empty panels).
  - Custom scrollbar styling (globals.css:29-42), focus-visible rings using `--accent` (globals.css:103-108).
- No `.dark` selector exists in any CSS — theme is fixed dark via literal hex values; `.dark` class on `<html>` is inert styling-wise (see §6).

---

## 4. `src/components/ui.tsx` — exported components (129 lines)

| Export | Props | Purpose |
| --- | --- | --- |
| `ChangeBadge` (ui.tsx:6-23) | `{ value: number\|null\|undefined; suffix?: string; className?: string }` | ▲/▼ green/red pct chip via `fmtPct` |
| `StatCard` (ui.tsx:27-49) | `{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default"\|"up"\|"down"\|"accent" }` | KPI card on `.panel` |
| `SectionHeader` (ui.tsx:53-69) | `{ title: string; subtitle?: string; right?: React.ReactNode }` | h1 + subtitle + right slot |
| `Skeleton` (ui.tsx:73-75) | `{ className?: string }` (default `"h-24"`) | `.skeleton` div |
| `Spinner` (ui.tsx:79-84) | `{ label?: string }` | accent border spinner |
| `NumCell` (ui.tsx:88-91) | `{ value: number\|null\|undefined; digits?: number }` | mono right-aligned number cell |

Imports `fmtNum, fmtPct` from `@/lib/api`. No Button, no Card-with-title primitive, no Icon component — launcher redesign will need to add these.

---

## 5. `src/components/Shell.tsx` + `Sidebar.tsx` — layout

### Shell.tsx (14 lines)

- `"use client"`; computes `active` from `usePathname()`: root → `/`, else first path segment (Shell.tsx:7).
- Layout: `<div class="flex h-screen overflow-hidden bg-[var(--bg)]">` → `<Sidebar active>` + `<main class="flex-1 overflow-y-auto">` → inner `mx-auto max-w-[1400px] px-6 py-6` container (Shell.tsx:9-13).

### Sidebar.tsx (48 lines)

- `NAV` array (Sidebar.tsx:4-14) — **8 items, icons are Unicode glyphs, not an icon library**:

  ```
  / Overview ◈ · /markets Markets ▤ · /portfolio Portfolio ▤
  /backtest Backtest ↻ · /screener Screener ◫ · /validator Validator ◉
  /sentiment Sentiment Radar ◈ · /regime Regime & Bot ◮
  ```

- Header: "TS" accent logo tile + "Trading Suite / IDX · IHSG · LQ45" (Sidebar.tsx:20-32).
- Footer: "Merged from 6 repos" block (Sidebar.tsx:39-47).
- Fixed `w-56`, border-right, `bg-[var(--panel)]`. Active item = `bg-[var(--panel-2)] font-semibold text-[var(--accent)]`.

---

## 6. Charts — `src/components/MarketChart.tsx`

Two exports, both client components using **lightweight-charts v5** (the `liveline` package is installed but **not imported anywhere** — see §8):

### `MarketChart` (MarketChart.tsx:32-188)

- Props: `{ history: HistoryRecord[]; indicators?: IndicatorColumns; height?: number (420); options?: ChartOptions }` where `ChartOptions = { showVolume?: boolean; overlayIndicators?: string[] }` (MarketChart.tsx:29-31).
- Hardcoded dark palette (MarketChart.tsx:15-22): up `#26a69a`, down `#ef5350`, line `#38bdf8`, line2 `#a78bfa`, line3 `#fbbf24`, volume rgba accent, grid `rgba(30,38,53,0.5)`.
- Layout: transparent background, textColor `#8b95a9` (= `--text-dim`), font `'JetBrains Mono', monospace` size 11 (MarketChart.tsx:45-54). Colors are literal hex, NOT read from CSS vars.
- **Theme handling: none.** No theme prop; the chart is dark-only with a hardcoded palette matching the app's dark palette by hand.
- Teardown pattern: refs nulled *before* `chart.remove()` to avoid "Value is undefined" crash (MarketChart.tsx:69-76); volume/overlay effects guard on `chartRef.current` after teardown.

### `SimpleLineChart` (MarketChart.tsx:190-232)

- Props: `{ data: { date: string; value: number }[]; height?: number (260); color?: string (PALETTE.line) }`.
- Same hardcoded dark layout; used for equity curves, regime/index history.

### `liveline` (available alternative, NOT wired up)

- `node_modules/liveline/package.json` — v0.0.7, "Real-time animated charts for React — line, candlestick, multi-series", MIT, ESM+CJS with types.
- Exports (from `node_modules/liveline/dist/index.d.ts`): props `data: LivelinePoint[]`, `value: number`, `series?`, `theme?: 'light'|'dark'`, `color?`, `window?`, `grid?`, `badge?`, `momentum?`, `fill?`, `loading?`, `paused?`, `emptyText?`, `scrub?`, `degen?`, `windows?`, `orderbook?`, `referenceLine?`, `formatValue?`, `formatTime?`, etc. Has a built-in `theme` prop — interesting for a redesign, but it is **not imported anywhere in src/** (`grep -rn liveline src/` = nothing).

---

## 7. Tooling & config

- **package.json** scripts: `dev` (next dev), `build` (next build), `start` (next start), `lint` (eslint). **No `typecheck` script.** Deps: `lightweight-charts ^5.2.0`, `liveline ^0.0.7`, `next 16.3.0`, `react/react-dom 19.2.8`; devDeps: `@tailwindcss/postcss ^4`, `tailwindcss ^4`, `eslint ^9`, `eslint-config-next 16.3.0`, `typescript ^5`.
- **eslint.config.mjs**: flat config from `eslint-config-next/core-web-vitals` + `.../typescript`, with `globalIgnores` for `.next/**`, `out/**`, `build/**`, `next-env.d.ts`, `legacy/**`, `backend/**`, `node_modules/**`.
- **next.config.ts**: only `output: "standalone"`.
- **postcss.config.mjs**: only `@tailwindcss/postcss` plugin.
- **tsconfig.json**: strict, `paths: { "@/*": ["./src/*"] }`, excludes `node_modules`, `legacy`, `backend`; includes `.next/dev/types`.
- **Dark-mode only: yes.** Body colors are fixed dark hexes in globals.css; every page hardcodes dark-appropriate classes; no light theme, no `prefers-color-scheme` handling, no `next-themes`.

---

## 8. Existing launcher/icon-set/landing bits + the `.dark` class + liveline

- **Apps grid / app-launcher / icon set: none exist.** No component, no route, no data file. The only "icons" are the 8 Unicode glyphs in `Sidebar.tsx:4-14`. `/` (Overview) is a full dashboard, not a launcher or landing page.
- **`.dark` on `<html>`: YES** — `src/app/layout.tsx:12`: `<html lang="en" className="dark">`. Note: no CSS anywhere references `.dark` (grep confirmed), and `:root` (not `.dark`) holds the tokens, so the class is decorative today. A redesign that wants theme switching or CSS-var-driven components should be aware.
- **liveline: installed.** `package.json` lists `liveline ^0.0.7` (added in the uncommitted working tree — `git status` shows `package.json` and `package-lock.json` modified), package present at `node_modules/liveline` (dist/, README, LICENSE, types). **Zero usage in src/** — nothing imports it yet.
- **Working-tree state**: modified (uncommitted): `backend/app/market.py`, `backend/app/screener.py`, `backend/app/services/fifo_engine.py`, `docker-entrypoint.sh`, `eslint.config.mjs`, `next.config.ts`, `package.json`, `package-lock.json`, `src/app/portfolio/page.tsx`, `src/app/validator/page.tsx`, plus untracked `.pi-subagents/`. Last commit `6a7921f fix: resolve audit findings across frontend, backend, and infra`.
- **public/**: only default Next.js SVGs (file/globe/next/vercel/window) — no app icons, no logos usable for launcher tiles.
- **AGENTS.md caveat**: repo carries a note that this Next.js version has breaking changes vs. training data; check `node_modules/next/dist/docs/` before writing code.

---

## 9. Key facts for the redesign (compressed)

1. 8 routes, all client components wrapped in `<Shell>` (Sidebar + centered `<main>`); launcher can slot in as a new `/` page or a new route with the Overview pushed to `/overview`.
2. The natural "app" inventory for launcher tiles: the 8 nav items; per-app metadata (name, icon, description, href, endpoints) currently lives only in `Sidebar.tsx:4-14` and each page's `SectionHeader` subtitle.
3. Design tokens are plain CSS vars in globals.css `:root` — no `@theme`; new components should keep using `var(--*)` arbitrary values (or migrate to `@theme` if desired).
4. `ui.tsx` lacks Button/Card/Icon primitives; launcher grid cards will need them.
5. Charts: `MarketChart` (candles+indicators) and `SimpleLineChart` (lines) via lightweight-charts v5, hardcoded dark palette, transparent background — they will sit fine inside `.panel` cards on any launcher/dashboard page. `liveline` v0.0.7 is installed but unused; it offers a `theme` prop and is an option for new "live" mini-charts in launcher cards.
6. Dark-mode only; `<html class="dark">` present but inert CSS-wise.
7. No `typecheck` npm script; `tsc` via `npx tsc --noEmit` is the equivalent (tsconfig `noEmit: true`).
8. Backend API surface is stable and already fully mapped (see §2); launcher cards can show live status using existing endpoints (`/api/market/indices`, `/api/regime/snapshot`, `/api/portfolio/state`, `/api/sentiment/news`).

---

## 10. Confidence & gaps

- **Confidence: high** for all enumerated facts — every file was read in full, routes verified against the src tree, backend routes grepped from the routers, liveline presence verified on disk, git state inspected.
- **Gaps:**
  - Backend endpoint *parameter* details (e.g., exact query params for `/api/screener/scan`, `/api/backtest/strategies`) not fully read — only route signatures. Pages already show the params each page uses, which is the relevant surface for the redesign.
  - `backend/app/market.py` and `screener.py` are in the dirty working tree; if the redesign depends on new/modified endpoints, diff those files first.
  - No inspection of `node_modules/next/dist/docs/` (AGENTS.md recommends reading relevant guides before writing Next.js 16 code).
