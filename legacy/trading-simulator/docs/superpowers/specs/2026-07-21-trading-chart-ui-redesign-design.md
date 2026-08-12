# Trading Chart System & UI Redesign — Design Spec

**Date:** 2026-07-21
**Scope:** Two decomposed specs — (1) TradingChart component with indicators, (2) UI polish + Stockbit removal
**Stack:** Vite + React + Tailwind CSS v4 + lightweight-charts (TradingView)
**Data source:** Yahoo Finance via Vite proxy (yfinance)

---

## Spec 1: TradingChart Component

### Goal

Replace the current `BacktestCard` + `IndicatorSignalCard` with a single `TradingChart` component that provides a TradingView-like experience: candlestick/line chart with MA overlays, volume, technical indicators, and institutional flow indicators — all toggleable.

### Architecture

```
TradingChart (props: ticker)
├── ChartToolbar
│   ├── ChartTypeToggle (Candle / Line)
│   ├── MAToggleGroup
│   │   ├── MasterToggle [MA on/off]
│   │   ├── MAChip × 4 (editable period, toggleable)
│   ├── TimeframeSelector [1D][1W][1M][3M][6M][1Y][5Y]
│   ├── TechnicalIndicatorToggle [RSI][STOCH][MACD]
│   └── InstitutionalIndicatorToggle [VWAP][OBV][ADL][MFI][CMF][VWMA]
├── MainPane (candlestick/line + active MAs + VWAP overlay)
├── VolumePane (histogram below main)
├── TechnicalSubPane (RSI / Stoch / MACD — one at a time)
└── InstitutionalSubPane (OBV, ADL, MFI, CMF, VWMA — multiple simultaneous)
```

### Pane Heights

| Pane | Height | Notes |
|------|--------|-------|
| Main | ~55% | Candlestick/line + MA overlays + VWAP |
| Volume | ~10% | Histogram bars, colored by up/down |
| Technical | ~20% | One of RSI/Stoch/MACD |
| Institutional | ~15% | Multiple lines (OBV, ADL, MFI, CMF, VWMA) |

### State

```ts
interface ChartState {
  chartType: 'candlestick' | 'line';
  timeRange: string;              // '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y'
  maPeriods: number[];            // [20, 50, 100, 200] — editable
  maActive: boolean[];            // [true, true, false, false]
  technicalIndicator: 'RSI' | 'STOCH' | 'MACD' | null;
  institutionalIndicators: {      // multiple can be active
    VWAP: boolean;
    OBV: boolean;
    ADL: boolean;
    MFI: boolean;
    CMF: boolean;
    VWMA: boolean;
  };
}
```

### Moving Averages

**MA Chip behavior:**
- Single click → toggles that MA line on/off
- Double-click → chip transforms to `<input>`, Enter/blur commits new period
- Colors assigned by sorted position (shortest→longest): red → yellow → green → blue
- Legend shows active MAs with current value at crosshair position

**Default periods:** 20, 50, 100, 200

**MA colors:**
| Position | Color | Hex |
|----------|-------|-----|
| Shortest | Red | `#FF6B6B` |
| 2nd | Yellow | `#FFD93D` |
| 3rd | Green | `#6BCB77` |
| Longest | Blue | `#4D96FF` |

### Technical Indicators

**One at a time** in TechnicalSubPane. Toggle buttons switch which is shown.

| Indicator | Display | Reference Lines |
|-----------|---------|-----------------|
| RSI (14) | Line | 70 (overbought), 30 (oversold) |
| Stochastic (14,3,3) | %K + %D lines | 80, 20 |
| MACD (12,26,9) | MACD line + Signal line + Histogram bars | Zero line |

### Institutional Indicators

**Multiple can be ON simultaneously** in InstitutionalSubPane. Each renders as its own line series.

| # | Indicator | Color | Sub-pane? | Description |
|---|-----------|-------|-----------|-------------|
| 1 | VWAP | `#E040FB` (magenta) | **Main pane** | Volume-weighted average price — price-level indicator |
| 2 | OBV | `#00BCD4` (cyan) | Sub-pane 2 | Cumulative volume flow — accumulation vs distribution |
| 3 | ADL | `#FF9800` (orange) | Sub-pane 2 | Money flow multiplier × volume |
| 4 | MFI | `#8BC34A` (light green) | Sub-pane 2 | RSI with volume — institutional overbought/oversold |
| 5 | CMF | `#9C27B0` (purple) | Sub-pane 2 | Buying/selling pressure over N periods |
| 6 | VWMA | `#F44336` (red) | Sub-pane 2 | Volume-weighted moving average |

### Indicator Calculations

All calculations use existing functions from `indicators.ts` where available. New functions to add:

```ts
// New functions to add in indicators.ts
calculateOBV(data: OHLCV[]): Point[]
calculateADL(data: OHLCV[]): Point[]
calculateCMF(data: OHLCV[], period: number): Point[]
calculateVWAP(data: OHLCV[]): Point[]
calculateVWMA(data: OHLCV[], period: number): Point[]
```

Existing functions reused (already in `indicators.ts`):
- `calculateRSI(data, 14)` → RSI
- `calculateStochasticFull(data, 14, 3, 3)` → Stochastic %K/%D
- `calculateMACD(data)` → MACD line/signal/histogram
- `calculateSMA(data, period)` → Moving averages
- `calculateMFI(data, 14)` → Money Flow Index

### Zoom & Pan

- Built-in `lightweight-charts` scroll-to-zoom and drag-to-pan
- Timeframe buttons call `chart.timeScale().setVisibleRange()` for quick range selection
- Crosshair sync across all panes

### Sync Strategy

- Multiple `IChartApi` instances (one per pane)
- Crosshair sync: `chart.subscribeCrosshairMove()` → update visible values in all panes
- TimeScale sync: `chart.timeScale().subscribeVisibleLogicalRangeChange()` → sync others
- Single `ResizeObserver` on container, proportional pane heights

### Files

| File | Action | Purpose |
|------|--------|---------|
| `src/components/TradingChart.tsx` | **New** | Main chart wrapper with multi-pane layout |
| `src/components/ChartToolbar.tsx` | **New** | Toolbar: MA/tf/indicator controls |
| `src/components/MAChip.tsx` | **New** | Editable MA period chip |
| `src/components/chartUtils.ts` | **New** | Chart creation helpers, pane sync |
| `src/indicators.ts` | **Modify** | Add OBV, ADL, CMF, VWAP, VWMA calculations |
| `src/prices.ts` | **Modify** | Ensure `fetchOHLCV` supports all needed ranges |
| `src/App.tsx` | **Modify** | Replace BacktestCard + IndicatorSignalCard with TradingChart in Market tab |
| `src/index.css` | **Modify** | Add chart toolbar/chip styles |

### BacktestCard

The existing `BacktestCard` (7-strategy backtest vs JCI) is **kept as a separate component** below the `TradingChart` in the Market tab. It uses the same `fetchOHLCV` + `backtestEngine.ts` and provides different value (backtest equity curves) than the TradingChart (live indicators). No conflict — they coexist in the same tab.

### All IDX Stocks

Works for every IDX ticker via Yahoo Finance: `BBCA.JK`, `TLKM.JK`, `BBRI.JK`, `ASII.JK`, `^JKSE` (JCI index), etc. No per-ticker config needed.

---

## Spec 2: UI Polish + Stockbit Removal

### Design Direction

Bloomberg terminal dashboard for active traders. Dark-theme, data-dense, monospace-for-data. Keep the terminal DNA, eliminate AI slop.

**Dials:** `DESIGN_VARIANCE: 5` / `MOTION_INTENSITY: 2` / `VISUAL_DENSITY: 8`

### Changes

| Area | Before (AI Slop) | After (Polished Terminal) |
|------|------------------|--------------------------|
| CSS | 560-line monolith + inline styles | Tailwind v4 utilities + CSS custom properties |
| Spacing | Inconsistent padding, random gaps | Consistent 4px grid rhythm |
| Typography | JetBrains Mono everywhere | JetBrains Mono for data, Inter/Geist for UI chrome |
| Colors | 15+ CSS vars, redundant aliases | 8 core tokens |
| Layout | Flex hacks, no responsive | CSS Grid, responsive collapse |
| Components | Each card re-invents structure | Shared card/header/table primitives |

### Stockbit Removal

**Delete entirely:**
- `src/stockbit.ts`
- `src/StockbitWatchlist.tsx`
- `src/OrderbookCard.tsx`
- `src/BandarmologyCard.tsx`
- `src/ActiveTradeCard.tsx`
- `src/SentinelNewsCard.tsx`

**Refactor to yfinance:**
- `src/EmitenInfoCard.tsx` — use `fetchQuote()` for price/change stats
- `src/KeyStatsCard.tsx` — use yfinance summaryDetail / defaultKeyStatistics

**Keep (already yfinance):**
- `src/prices.ts`
- `src/backtestEngine.ts`
- `src/indicators.ts`
- `src/engine.ts`
- `src/BacktestCard.tsx` (kept — uses yfinance, coexists with TradingChart)
- `src/NewsCard.tsx` (kept — uses non-Stockbit news source, independent of Stockbit removal)

### Tailwind Integration

- Install `tailwindcss` + `@tailwindcss/postcss` (v4)
- Convert `index.css` to Tailwind directives
- Bloomberg color tokens as CSS custom properties referenced via `theme()`
- Keep monospace fonts for data display

### Responsive Layout

```
Desktop (≥1024px):  Sidebar (220px) | Main (tabs + content)
Tablet (768-1023px): Collapsed sidebar | Main
Mobile (<768px):    Full-width stacked
```

### Files

| File | Action |
|------|--------|
| `src/stockbit.ts` | **Delete** |
| `src/StockbitWatchlist.tsx` | **Delete** |
| `src/OrderbookCard.tsx` | **Delete** |
| `src/BandarmologyCard.tsx` | **Delete** |
| `src/ActiveTradeCard.tsx` | **Delete** |
| `src/SentinelNewsCard.tsx` | **Delete** |
| `src/EmitenInfoCard.tsx` | **Refactor** to yfinance |
| `src/KeyStatsCard.tsx` | **Refactor** to yfinance |
| `src/App.tsx` | **Refactor** — remove Stockbit imports, integrate TradingChart |
| `src/index.css` | **Rewrite** — Tailwind + CSS tokens |
| `dashboard/package.json` | **Modify** — add tailwindcss, @tailwindcss/postcss |
| `dashboard/postcss.config.js` | **Create** — Tailwind v4 PostCSS config |

---

## Implementation Order

1. **Spec 1 first** — TradingChart component + indicator calculations
2. **Spec 2 second** — UI polish + Stockbit removal
3. Spec 2 depends on Spec 1 (App.tsx refactoring references TradingChart)

## Testing

- Unit tests: indicator calculations (existing `backtestEngine.test.ts` pattern)
- Visual: manual verification of chart rendering, MA toggles, indicator switching
- Build: `npm run build` must pass with no TypeScript errors
- Lint: `npm run lint` must pass
