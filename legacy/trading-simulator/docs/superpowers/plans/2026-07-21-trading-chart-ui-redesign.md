# Trading Chart System & UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BacktestCard+IndicatorSignalCard with a TradingView-like TradingChart component (candlestick, MAs, volume, 3 technical + 6 institutional indicators), remove Stockbit API, add Tailwind CSS, and polish the Bloomberg terminal UI.

**Architecture:** Build a multi-pane `TradingChart` wrapper around `lightweight-charts` with synchronized crosshair/timeScale. Indicators computed client-side via existing `indicators.ts` functions + 5 new ones. Toolbar provides toggleable MA chips (editable periods), technical indicator switcher, and institutional indicator multi-toggle. UI refactored from inline styles to Tailwind v4 utilities.

**Tech Stack:** Vite, React 19, TypeScript, lightweight-charts 4.x, Tailwind CSS v4, Vitest

---

## Global Constraints

- Data source: Yahoo Finance only (no Stockbit)
- Chart library: lightweight-charts 4.x (already installed)
- Styling: Tailwind CSS v4 with `@tailwindcss/postcss`
- Fonts: JetBrains Mono for data, Inter/Geist for UI chrome
- All indicators calculated client-side from OHLCV arrays
- Works for all IDX tickers via `.JK` suffix (BBCA.JK, TLKM.JK, etc.)
- Build must pass: `npm run build` (TypeScript + Vite)
- Lint must pass: `npm run lint`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `dashboard/src/indicators.ts` | Modify | Add OBV, ADL, CMF, VWAP, VWMA |
| `dashboard/src/indicators.test.ts` | Create | Tests for new indicator functions |
| `dashboard/src/components/chartUtils.ts` | Create | Chart creation, pane sync helpers |
| `dashboard/src/components/MAChip.tsx` | Create | Editable MA period chip |
| `dashboard/src/components/ChartToolbar.tsx` | Create | Toolbar: MA/tf/indicator controls |
| `dashboard/src/components/TradingChart.tsx` | Create | Main chart wrapper with multi-pane |
| `dashboard/src/components/TradingChart.test.tsx` | Create | Smoke test for TradingChart render |
| `dashboard/src/App.tsx` | Modify | Integrate TradingChart, remove Stockbit refs |
| `dashboard/src/EmitenInfoCard.tsx` | Modify | Refactor to yfinance |
| `dashboard/src/KeyStatsCard.tsx` | Modify | Refactor to yfinance |
| `dashboard/src/stockbit.ts` | Delete | Stockbit API client |
| `dashboard/src/StockbitWatchlist.tsx` | Delete | Stockbit watchlist component |
| `dashboard/src/OrderbookCard.tsx` | Delete | Stockbit orderbook |
| `dashboard/src/BandarmologyCard.tsx` | Delete | Stockbit bandarmology |
| `dashboard/src/ActiveTradeCard.tsx` | Delete | Stockbit active trade |
| `dashboard/src/SentinelNewsCard.tsx` | Delete | Stockbit news wire |
| `dashboard/src/index.css` | Rewrite | Tailwind directives + CSS tokens |
| `dashboard/package.json` | Modify | Add tailwindcss, @tailwindcss/postcss |
| `dashboard/postcss.config.js` | Create | Tailwind v4 PostCSS config |

---

## Task 1: Install Tailwind CSS v4

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/postcss.config.js`
- Modify: `dashboard/src/index.css`

**Interfaces:**
- Consumes: existing Vite project structure
- Produces: Tailwind CSS available via `@apply` and utility classes

- [ ] **Step 1: Install Tailwind packages**

```bash
cd dashboard && npm install -D tailwindcss @tailwindcss/postcss
```

- [ ] **Step 2: Create PostCSS config**

Create `dashboard/postcss.config.js`:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 3: Add Tailwind directive to index.css**

Replace the first line of `dashboard/src/index.css` (`@import url(...)`) with:

```css
@import "tailwindcss";

@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap');
```

Keep all existing CSS below the import. Tailwind will layer on top.

- [ ] **Step 4: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/postcss.config.js dashboard/src/index.css
git commit -m "chore: install tailwind css v4"
```

---

## Task 2: Add New Indicator Functions

**Files:**
- Modify: `dashboard/src/indicators.ts`

**Interfaces:**
- Consumes: `OHLCV` type and `Point` type from same file
- Produces: `calculateOBV()`, `calculateADL()`, `calculateCMF()`, `calculateVWAP()`, `calculateVWMA()` — all returning `Point[]`

- [ ] **Step 1: Add calculateOBV**

Append to `dashboard/src/indicators.ts`:

```typescript
/**
 * Calculate On Balance Volume (OBV)
 * Cumulative volume flow: +volume on up days, -volume on down days
 */
export function calculateOBV(data: OHLCV[]): Point[] {
  if (data.length < 2) return [];
  const result: Point[] = [];
  let obv = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) {
      obv += data[i].value;
    } else if (data[i].close < data[i - 1].close) {
      obv -= data[i].value;
    }
    result.push({ time: data[i].time, value: obv });
  }
  return result;
}
```

- [ ] **Step 2: Add calculateADL**

Append to `dashboard/src/indicators.ts`:

```typescript
/**
 * Calculate Accumulation/Distribution Line (ADL)
 * Money flow multiplier × volume
 */
export function calculateADL(data: OHLCV[]): Point[] {
  if (data.length === 0) return [];
  const result: Point[] = [];
  let adl = 0;

  for (let i = 0; i < data.length; i++) {
    const { high, low, close, value } = data[i];
    const hlRange = high - low;
    const mfMultiplier = hlRange === 0 ? 0 : ((close - low) - (high - close)) / hlRange;
    const mfVolume = mfMultiplier * value;
    adl += mfVolume;
    result.push({ time: data[i].time, value: adl });
  }
  return result;
}
```

- [ ] **Step 3: Add calculateCMF**

Append to `dashboard/src/indicators.ts`:

```typescript
/**
 * Calculate Chaikin Money Flow (CMF)
 * Sum of (MF Multiplier × Volume) / Sum of Volume over period
 */
export function calculateCMF(data: OHLCV[], period: number = 20): Point[] {
  if (data.length < period) return [];
  const result: Point[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let mfVolumeSum = 0;
    let volumeSum = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const { high, low, close, value } = data[j];
      const hlRange = high - low;
      const mfMultiplier = hlRange === 0 ? 0 : ((close - low) - (high - close)) / hlRange;
      mfVolumeSum += mfMultiplier * value;
      volumeSum += value;
    }

    const cmf = volumeSum === 0 ? 0 : mfVolumeSum / volumeSum;
    result.push({ time: data[i].time, value: cmf });
  }
  return result;
}
```

- [ ] **Step 4: Add calculateVWAP**

Append to `dashboard/src/indicators.ts`:

```typescript
/**
 * Calculate Volume Weighted Average Price (VWAP)
 * Cumulative (Typical Price × Volume) / Cumulative Volume
 * Resets each trading day (intraday indicator, but works on daily as cumulative)
 */
export function calculateVWAP(data: OHLCV[]): Point[] {
  if (data.length === 0) return [];
  const result: Point[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].value;
    cumulativeVolume += data[i].value;
    const vwap = cumulativeVolume === 0 ? data[i].close : cumulativeTPV / cumulativeVolume;
    result.push({ time: data[i].time, value: vwap });
  }
  return result;
}
```

- [ ] **Step 5: Add calculateVWMA**

Append to `dashboard/src/indicators.ts`:

```typescript
/**
 * Calculate Volume Weighted Moving Average (VWMA)
 * Sum(Price × Volume) / Sum(Volume) over N periods
 */
export function calculateVWMA(data: OHLCV[], period: number = 20): Point[] {
  if (data.length < period) return [];
  const result: Point[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let pvSum = 0;
    let volSum = 0;

    for (let j = i - period + 1; j <= i; j++) {
      pvSum += data[j].close * data[j].value;
      volSum += data[j].value;
    }

    const vwma = volSum === 0 ? data[i].close : pvSum / volSum;
    result.push({ time: data[i].time, value: vwma });
  }
  return result;
}
```

- [ ] **Step 6: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/indicators.ts
git commit -m "feat: add OBV, ADL, CMF, VWAP, VWMA indicator calculations"
```

---

## Task 3: Add Indicator Unit Tests

**Files:**
- Create: `dashboard/src/indicators.test.ts`

**Interfaces:**
- Consumes: all functions from `indicators.ts`
- Produces: passing test suite

- [ ] **Step 1: Create test file with OHLCV fixtures**

Create `dashboard/src/indicators.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  calculateRSI,
  calculateMACD,
  calculateStochasticFull,
  calculateSMA,
  calculateMFI,
  calculateOBV,
  calculateADL,
  calculateCMF,
  calculateVWAP,
  calculateVWMA,
} from './indicators';
import type { OHLCV } from './indicators';

// 30-day rising price fixture
const risingData: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
  time: `2025-01-${String(i + 1).padStart(2, '0')}`,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 100 + i,
  value: 1000000 + i * 10000,
}));

// 30-day falling price fixture
const fallingData: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
  time: `2025-01-${String(i + 1).padStart(2, '0')}`,
  open: 130 - i,
  high: 135 - i,
  low: 125 - i,
  close: 130 - i,
  value: 1000000 + i * 10000,
}));

// Mixed up/down fixture
const mixedData: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
  time: `2025-01-${String(i + 1).padStart(2, '0')}`,
  open: 100 + (i % 2 === 0 ? 5 : -5),
  high: 110 + (i % 2 === 0 ? 5 : -5),
  low: 90 + (i % 2 === 0 ? 5 : -5),
  close: 100 + (i % 2 === 0 ? 3 : -3),
  value: 1000000,
}));
```

- [ ] **Step 2: Add tests for existing indicators**

Append to `dashboard/src/indicators.test.ts`:

```typescript
describe('calculateRSI', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateRSI(risingData.slice(0, 5))).toEqual([]);
  });

  it('returns RSI values for valid data', () => {
    const result = calculateRSI(risingData);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].value).toBeGreaterThanOrEqual(0);
    expect(result[0].value).toBeLessThanOrEqual(100);
  });

  it('rising prices produce high RSI', () => {
    const result = calculateRSI(risingData);
    const last = result[result.length - 1];
    expect(last.value).toBeGreaterThan(50);
  });
});

describe('calculateMACD', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateMACD(risingData.slice(0, 10))).toEqual([]);
  });

  it('returns macd, signal, histogram for valid data', () => {
    const result = calculateMACD(risingData);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('macd');
    expect(result[0]).toHaveProperty('signal');
    expect(result[0]).toHaveProperty('histogram');
  });
});

describe('calculateStochasticFull', () => {
  it('returns k and d values', () => {
    const result = calculateStochasticFull(risingData);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('k');
    expect(result[0]).toHaveProperty('d');
  });
});

describe('calculateSMA', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateSMA(risingData, 50)).toEqual([]);
  });

  it('returns SMA values', () => {
    const result = calculateSMA(risingData, 10);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('calculateMFI', () => {
  it('returns MFI values between 0 and 100', () => {
    const result = calculateMFI(risingData);
    if (result.length > 0) {
      expect(result[0].value).toBeGreaterThanOrEqual(0);
      expect(result[0].value).toBeLessThanOrEqual(100);
    }
  });
});
```

- [ ] **Step 3: Add tests for new indicators**

Append to `dashboard/src/indicators.test.ts`:

```typescript
describe('calculateOBV', () => {
  it('returns empty for single data point', () => {
    expect(calculateOBV(risingData.slice(0, 1))).toEqual([]);
  });

  it('returns OBV values', () => {
    const result = calculateOBV(risingData);
    expect(result.length).toBe(29);
  });

  it('rising prices produce positive OBV trend', () => {
    const result = calculateOBV(risingData);
    const first = result[0].value;
    const last = result[result.length - 1].value;
    expect(last).toBeGreaterThan(first);
  });
});

describe('calculateADL', () => {
  it('returns one value per data point', () => {
    const result = calculateADL(risingData);
    expect(result.length).toBe(risingData.length);
  });

  it('returns ADL values', () => {
    const result = calculateADL(mixedData);
    expect(result.length).toBe(30);
    expect(typeof result[0].value).toBe('number');
  });
});

describe('calculateCMF', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateCMF(risingData.slice(0, 5))).toEqual([]);
  });

  it('returns values between -1 and 1', () => {
    const result = calculateCMF(mixedData, 10);
    for (const point of result) {
      expect(point.value).toBeGreaterThanOrEqual(-1);
      expect(point.value).toBeLessThanOrEqual(1);
    }
  });
});

describe('calculateVWAP', () => {
  it('returns one value per data point', () => {
    const result = calculateVWAP(risingData);
    expect(result.length).toBe(risingData.length);
  });

  it('VWAP is within price range', () => {
    const result = calculateVWAP(risingData);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].value).toBeGreaterThanOrEqual(risingData[i].low);
      expect(result[i].value).toBeLessThanOrEqual(risingData[i].high);
    }
  });
});

describe('calculateVWMA', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateVWMA(risingData.slice(0, 5), 10)).toEqual([]);
  });

  it('returns VWMA values within price range', () => {
    const result = calculateVWMA(risingData, 10);
    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(typeof point.value).toBe('number');
      expect(point.value).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd dashboard && npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/indicators.test.ts
git commit -m "test: add unit tests for all indicator calculations"
```

---

## Task 4: Create chartUtils.ts

**Files:**
- Create: `dashboard/src/components/chartUtils.ts`

**Interfaces:**
- Consumes: `lightweight-charts` API (`createChart`, `IChartApi`, `ISeriesApi`)
- Produces: `createSyncedChart()`, `syncCharts()`, `addCandlestickSeries()`, `addLineSeries()`, `addHistogramSeries()`

- [ ] **Step 1: Create chartUtils.ts with chart creation helpers**

Create `dashboard/src/components/chartUtils.ts`:

```typescript
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, SeriesType, DeepPartial, ChartOptions } from 'lightweight-charts';

export const CHART_COLORS = {
  bg: '#050505',
  grid: '#111111',
  border: '#1c1c1c',
  crosshair: '#FF6600',
  text: '#666666',
  textHi: '#E8E8E8',
  green: '#00C853',
  red: '#FF3B3B',
  volume: 'rgba(255, 102, 0, 0.15)',
};

export const MA_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF'];

export const INDICATOR_COLORS = {
  VWAP: '#E040FB',
  OBV: '#00BCD4',
  ADL: '#FF9800',
  MFI: '#8BC34A',
  CMF: '#9C27B0',
  VWMA: '#F44336',
};

const BASE_OPTIONS: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: CHART_COLORS.bg },
    textColor: CHART_COLORS.text,
    fontFamily: "'JetBrains Mono', 'Share Tech Mono', monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: CHART_COLORS.grid },
    horzLines: { color: CHART_COLORS.grid },
  },
  rightPriceScale: {
    borderColor: CHART_COLORS.border,
  },
  timeScale: {
    borderColor: CHART_COLORS.border,
    timeVisible: true,
    secondsVisible: false,
  },
  crosshair: {
    vertLine: { color: CHART_COLORS.crosshair, labelBackgroundColor: CHART_COLORS.crosshair, width: 1 },
    horzLine: { color: CHART_COLORS.crosshair, labelBackgroundColor: CHART_COLORS.crosshair, width: 1 },
  },
};

export function createSyncedChart(
  container: HTMLElement,
  height: number,
  options?: DeepPartial<ChartOptions>
): IChartApi {
  return createChart(container, {
    ...BASE_OPTIONS,
    width: container.clientWidth,
    height,
    ...options,
  } as any);
}

export function addCandlestickSeries(chart: IChartApi) {
  return chart.addCandlestickSeries({
    upColor: CHART_COLORS.green,
    downColor: CHART_COLORS.red,
    borderUpColor: CHART_COLORS.green,
    borderDownColor: CHART_COLORS.red,
    wickUpColor: CHART_COLORS.green,
    wickDownColor: CHART_COLORS.red,
  });
}

export function addLineSeries(
  chart: IChartApi,
  color: string,
  lineWidth: number = 2,
  lineStyle?: LineStyle
) {
  return chart.addLineSeries({
    color,
    lineWidth: lineWidth as any,
    lineStyle: lineStyle ?? LineStyle.Solid,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
}

export function addHistogramSeries(chart: IChartApi, color: string) {
  return chart.addHistogramSeries({
    color,
    priceLineVisible: false,
    lastValueVisible: false,
  });
}

export function syncTimeScales(charts: IChartApi[]) {
  let isSyncing = false;

  charts.forEach((chart, index) => {
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (isSyncing) return;
      isSyncing = true;
      charts.forEach((other, otherIndex) => {
        if (otherIndex !== index && range) {
          other.timeScale().setVisibleLogicalRange(range);
        }
      });
      isSyncing = false;
    });
  });
}

export function syncCrosshairs(
  charts: IChartApi[],
  onCrosshairMove?: (time: string | null) => void
) {
  let isSyncing = false;

  charts.forEach((chart, index) => {
    chart.subscribeCrosshairMove((param) => {
      if (isSyncing) return;
      isSyncing = true;
      charts.forEach((other, otherIndex) => {
        if (otherIndex !== index) {
          if (param.time) {
            other.setCrosshairPosition(0, param.time);
          } else {
            other.clearCrosshairPosition();
          }
        }
      });
      isSyncing = false;

      if (onCrosshairMove) {
        onCrosshairMove(param.time ? String(param.time) : null);
      }
    });
  });
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/chartUtils.ts
git commit -m "feat: add chart utility functions for synced multi-pane charts"
```

---

## Task 5: Create MACHip Component

**Files:**
- Create: `dashboard/src/components/MAChip.tsx`

**Interfaces:**
- Consumes: none (self-contained)
- Produces: `MAChipProps` interface, `MAChip` component

- [ ] **Step 1: Create MACHip.tsx**

Create `dashboard/src/components/MAChip.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';

export interface MACHipProps {
  period: number;
  color: string;
  active: boolean;
  onToggle: () => void;
  onPeriodChange: (newPeriod: number) => void;
}

export default function MACHip({ period, color, active, onToggle, onPeriodChange }: MACHipProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(period));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleDoubleClick = () => {
    setEditing(true);
    setInputValue(String(period));
  };

  const handleSubmit = () => {
    const val = parseInt(inputValue, 10);
    if (!isNaN(val) && val >= 2 && val <= 500) {
      onPeriodChange(val);
    } else {
      setInputValue(String(period));
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') {
      setInputValue(String(period));
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={2}
        max={500}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        className="w-12 px-1 py-0.5 text-[10px] font-mono bg-[#111] border border-[#333] text-white outline-none"
        style={{ borderColor: color }}
      />
    );
  }

  return (
    <button
      onClick={onToggle}
      onDoubleClick={handleDoubleClick}
      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold border transition-colors"
      style={{
        borderColor: active ? color : '#333',
        background: active ? `${color}15` : 'transparent',
        color: active ? color : '#666',
      }}
      title={`MA-${period} — click to toggle, double-click to edit`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: active ? color : '#333' }}
      />
      {period}
    </button>
  );
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/MAChip.tsx
git commit -m "feat: add editable MA period chip component"
```

---

## Task 6: Create ChartToolbar Component

**Files:**
- Create: `dashboard/src/components/ChartToolbar.tsx`

**Interfaces:**
- Consumes: `MACHip` from Task 5, `MA_COLORS` and `INDICATOR_COLORS` from Task 4
- Produces: `ChartToolbarProps` interface, `ChartToolbar` component

- [ ] **Step 1: Create ChartToolbar.tsx**

Create `dashboard/src/components/ChartToolbar.tsx`:

```tsx
import MACHip from './MAChip';
import { MA_COLORS, INDICATOR_COLORS } from './chartUtils';

export type TechnicalIndicator = 'RSI' | 'STOCH' | 'MACD';
export type InstitutionalIndicator = 'VWAP' | 'OBV' | 'ADL' | 'MFI' | 'CMF' | 'VWMA';

export interface ChartToolbarProps {
  chartType: 'candlestick' | 'line';
  onChartTypeChange: (type: 'candlestick' | 'line') => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  maPeriods: number[];
  maActive: boolean[];
  onMAToggle: (index: number) => void;
  onMAPeriodChange: (index: number, period: number) => void;
  technicalIndicator: TechnicalIndicator | null;
  onTechnicalIndicatorChange: (indicator: TechnicalIndicator | null) => void;
  institutionalIndicators: Record<InstitutionalIndicator, boolean>;
  onInstitutionalToggle: (indicator: InstitutionalIndicator) => void;
}

const TIME_RANGES = [
  { label: '1D', value: '5d' },
  { label: '1W', value: '1mo' },
  { label: '1M', value: '3mo' },
  { label: '3M', value: '6mo' },
  { label: '6M', value: '1y' },
  { label: '1Y', value: '2y' },
  { label: '5Y', value: '5y' },
];

const TECH_INDICATORS: TechnicalIndicator[] = ['RSI', 'STOCH', 'MACD'];
const INST_INDICATORS: InstitutionalIndicator[] = ['VWAP', 'OBV', 'ADL', 'MFI', 'CMF', 'VWMA'];

export default function ChartToolbar({
  chartType, onChartTypeChange,
  timeRange, onTimeRangeChange,
  maPeriods, maActive, onMAToggle, onMAPeriodChange,
  technicalIndicator, onTechnicalIndicatorChange,
  institutionalIndicators, onInstitutionalToggle,
}: ChartToolbarProps) {
  const sortedIndices = maPeriods
    .map((p, i) => ({ period: p, index: i }))
    .sort((a, b) => a.period - b.period)
    .map(item => item.index);

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 bg-[#0a0a0a] border-b border-[#1c1c1c] text-[10px] font-mono">
      {/* Chart Type */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onChartTypeChange('candlestick')}
          className={`px-2 py-0.5 border ${chartType === 'candlestick' ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
        >
          CANDLE
        </button>
        <button
          onClick={() => onChartTypeChange('line')}
          className={`px-2 py-0.5 border ${chartType === 'line' ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
        >
          LINE
        </button>
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* MA Chips */}
      <div className="flex items-center gap-1">
        <span className="text-[#666] font-bold mr-1">MA</span>
        {sortedIndices.map((idx, colorIdx) => (
          <MACHip
            key={idx}
            period={maPeriods[idx]}
            color={MA_COLORS[colorIdx]}
            active={maActive[idx]}
            onToggle={() => onMAToggle(idx)}
            onPeriodChange={(p) => onMAPeriodChange(idx, p)}
          />
        ))}
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* Time Range */}
      <div className="flex items-center gap-0.5">
        {TIME_RANGES.map(tr => (
          <button
            key={tr.value}
            onClick={() => onTimeRangeChange(tr.value)}
            className={`px-2 py-0.5 border ${timeRange === tr.value ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
          >
            {tr.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* Technical Indicators */}
      <div className="flex items-center gap-0.5">
        {TECH_INDICATORS.map(t => (
          <button
            key={t}
            onClick={() => onTechnicalIndicatorChange(technicalIndicator === t ? null : t)}
            className={`px-2 py-0.5 border ${technicalIndicator === t ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* Institutional Indicators */}
      <div className="flex items-center gap-0.5">
        {INST_INDICATORS.map(inst => (
          <button
            key={inst}
            onClick={() => onInstitutionalToggle(inst)}
            className="px-2 py-0.5 border"
            style={{
              borderColor: institutionalIndicators[inst] ? INDICATOR_COLORS[inst] : '#333',
              background: institutionalIndicators[inst] ? `${INDICATOR_COLORS[inst]}15` : 'transparent',
              color: institutionalIndicators[inst] ? INDICATOR_COLORS[inst] : '#666',
            }}
          >
            {inst}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/ChartToolbar.tsx
git commit -m "feat: add chart toolbar with MA, timeframe, and indicator controls"
```

---

## Task 7: Create TradingChart Component

**Files:**
- Create: `dashboard/src/components/TradingChart.tsx`
- Create: `dashboard/src/components/TradingChart.test.tsx`

**Interfaces:**
- Consumes: `chartUtils` from Task 4, `ChartToolbar` from Task 6, `indicators.ts` functions, `fetchOHLCV` from `prices.ts`
- Produces: `TradingChart` component (props: `{ ticker: string }`)

- [ ] **Step 1: Create TradingChart.tsx**

Create `dashboard/src/components/TradingChart.tsx`:

```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import type { IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData } from 'lightweight-charts';
import {
  createSyncedChart, addCandlestickSeries, addLineSeries, addHistogramSeries,
  syncTimeScales, syncCrosshairs, MA_COLORS, CHART_COLORS,
} from './chartUtils';
import ChartToolbar from './ChartToolbar';
import type { TechnicalIndicator, InstitutionalIndicator } from './ChartToolbar';
import { fetchOHLCV } from '../prices';
import {
  calculateSMA, calculateRSI, calculateStochasticFull, calculateMACD,
  calculateOBV, calculateADL, calculateCMF, calculateVWAP, calculateVWMA,
} from '../indicators';
import type { OHLCV } from '../indicators';

interface TradingChartProps {
  ticker: string;
}

export default function TradingChart({ ticker }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);
  const seriesRef = useRef<{
    main?: ISeriesApi<'Candlestick'>;
    volume?: ISeriesApi<'Histogram'>;
    mas: ISeriesApi<'Line'>[];
    vwap?: ISeriesApi<'Line'>;
    technical?: ISeriesApi<'Line'>[];
    technicalHistogram?: ISeriesApi<'Histogram'>;
    institutional: ISeriesApi<'Line'>[];
  }>({ mas: [], technical: [], institutional: [] });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ohlcvData, setOhlcvData] = useState<OHLCV[]>([]);
  const [crosshairTime, setCrosshairTime] = useState<string | null>(null);

  // State
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick');
  const [timeRange, setTimeRange] = useState('6mo');
  const [maPeriods, setMaPeriods] = useState([20, 50, 100, 200]);
  const [maActive, setMaActive] = useState([true, true, false, false]);
  const [technicalIndicator, setTechnicalIndicator] = useState<TechnicalIndicator | null>('RSI');
  const [institutionalIndicators, setInstitutionalIndicators] = useState<Record<InstitutionalIndicator, boolean>>({
    VWAP: false, OBV: false, ADL: false, MFI: false, CMF: false, VWMA: false,
  });

  // Fetch data
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    fetchOHLCV(ticker, timeRange)
      .then(data => {
        if (!active) return;
        if (data.length === 0) {
          setError('No data for ' + ticker);
          setLoading(false);
          return;
        }
        setOhlcvData(data);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { active = false; };
  }, [ticker, timeRange]);

  // Create/update charts
  const buildCharts = useCallback(() => {
    if (!containerRef.current || ohlcvData.length === 0) return;

    // Cleanup old charts
    chartsRef.current.forEach(c => c.remove());
    chartsRef.current = [];
    seriesRef.current = { mas: [], technical: [], institutional: [] };

    const container = containerRef.current;
    const totalHeight = container.clientHeight;
    const mainHeight = Math.floor(totalHeight * 0.55);
    const volumeHeight = Math.floor(totalHeight * 0.10);
    const techHeight = Math.floor(totalHeight * 0.20);
    const instHeight = totalHeight - mainHeight - volumeHeight - techHeight;

    // Main chart
    const mainDiv = container.querySelector('.pane-main') as HTMLDivElement;
    const volumeDiv = container.querySelector('.pane-volume') as HTMLDivElement;
    const techDiv = container.querySelector('.pane-technical') as HTMLDivElement;
    const instDiv = container.querySelector('.pane-institutional') as HTMLDivElement;

    if (!mainDiv || !volumeDiv || !techDiv || !instDiv) return;

    const mainChart = createSyncedChart(mainDiv, mainHeight);
    const volumeChart = createSyncedChart(volumeDiv, volumeHeight);
    const techChart = createSyncedChart(techDiv, techHeight);
    const instChart = createSyncedChart(instDiv, instHeight);

    chartsRef.current = [mainChart, volumeChart, techChart, instChart];

    // Main series
    if (chartType === 'candlestick') {
      seriesRef.current.main = addCandlestickSeries(mainChart);
      seriesRef.current.main.setData(ohlcvData as CandlestickData[]);
    } else {
      const lineSeries = addLineSeries(mainChart, CHART_COLORS.textHi, 2);
      lineSeries.setData(ohlcvData.map(d => ({ time: d.time as any, value: d.close })));
      seriesRef.current.main = lineSeries as any;
    }

    // Volume
    seriesRef.current.volume = addHistogramSeries(volumeChart, CHART_COLORS.volume);
    seriesRef.current.volume!.setData(ohlcvData.map(d => ({
      time: d.time as any,
      value: d.value,
      color: d.close >= d.open ? `${CHART_COLORS.green}40` : `${CHART_COLORS.red}40`,
    } as HistogramData)));

    // MAs on main chart
    const sortedPeriods = [...maPeriods]
      .map((p, i) => ({ period: p, active: maActive[i], origIndex: i }))
      .sort((a, b) => a.period - b.period);

    seriesRef.current.mas = [];
    sortedPeriods.forEach((item, colorIdx) => {
      if (!item.active) return;
      const smaData = calculateSMA(ohlcvData, item.period);
      if (smaData.length === 0) return;
      const series = addLineSeries(mainChart, MA_COLORS[colorIdx], 1);
      series.setData(smaData as LineData[]);
      seriesRef.current.mas.push(series);
    });

    // VWAP on main chart
    if (institutionalIndicators.VWAP) {
      const vwapData = calculateVWAP(ohlcvData);
      const vwapSeries = addLineSeries(mainChart, '#E040FB', 2);
      vwapSeries.setData(vwapData as LineData[]);
      seriesRef.current.vwap = vwapSeries;
    }

    // Technical indicator
    seriesRef.current.technical = [];
    seriesRef.current.technicalHistogram = undefined;
    if (technicalIndicator === 'RSI') {
      const rsiData = calculateRSI(ohlcvData);
      const rsiSeries = addLineSeries(techChart, '#00C853', 1);
      rsiSeries.setData(rsiData as LineData[]);
      seriesRef.current.technical = [rsiSeries];

      // Reference lines at 30 and 70
      const line30 = addLineSeries(techChart, '#FF3B3B80', 1);
      line30.setData(rsiData.map(d => ({ time: d.time as any, value: 30 })));
      const line70 = addLineSeries(techChart, '#FF3B3B80', 1);
      line70.setData(rsiData.map(d => ({ time: d.time as any, value: 70 })));
      seriesRef.current.technical.push(line30, line70);
    } else if (technicalIndicator === 'STOCH') {
      const stochData = calculateStochasticFull(ohlcvData);
      const kSeries = addLineSeries(techChart, '#00B8D4', 1);
      kSeries.setData(stochData.map(d => ({ time: d.time as any, value: d.k })));
      const dSeries = addLineSeries(techChart, '#FF9800', 1);
      dSeries.setData(stochData.map(d => ({ time: d.time as any, value: d.d })));
      seriesRef.current.technical = [kSeries, dSeries];

      // Reference lines at 20 and 80
      const line20 = addLineSeries(techChart, '#FF3B3B80', 1);
      line20.setData(stochData.map(d => ({ time: d.time as any, value: 20 })));
      const line80 = addLineSeries(techChart, '#FF3B3B80', 1);
      line80.setData(stochData.map(d => ({ time: d.time as any, value: 80 })));
      seriesRef.current.technical.push(line20, line80);
    } else if (technicalIndicator === 'MACD') {
      const macdData = calculateMACD(ohlcvData);
      const macdSeries = addLineSeries(techChart, '#FF6600', 1);
      macdSeries.setData(macdData.map(d => ({ time: d.time as any, value: d.macd })));
      const signalSeries = addLineSeries(techChart, '#E91E63', 1);
      signalSeries.setData(macdData.map(d => ({ time: d.time as any, value: d.signal })));
      seriesRef.current.technical = [macdSeries, signalSeries];

      // Histogram
      const histSeries = addHistogramSeries(techChart, '#4D96FF80');
      histSeries.setData(macdData.map(d => ({
        time: d.time as any,
        value: d.histogram,
        color: d.histogram >= 0 ? '#00C85360' : '#FF3B3B60',
      })));
      seriesRef.current.technicalHistogram = histSeries;
    }

    // Institutional indicators (multiple can be active)
    seriesRef.current.institutional = [];
    const instDataMap: Record<string, { time: string; value: number }[]> = {};

    if (institutionalIndicators.OBV) {
      instDataMap.OBV = calculateOBV(ohlcvData);
    }
    if (institutionalIndicators.ADL) {
      instDataMap.ADL = calculateADL(ohlcvData);
    }
    if (institutionalIndicators.MFI) {
      instDataMap.MFI = calculateMFI(ohlcvData);
    }
    if (institutionalIndicators.CMF) {
      instDataMap.CMF = calculateCMF(ohlcvData);
    }
    if (institutionalIndicators.VWMA) {
      instDataMap.VWMA = calculateVWMA(ohlcvData);
    }

    const instColors: Record<string, string> = {
      OBV: '#00BCD4', ADL: '#FF9800', MFI: '#8BC34A', CMF: '#9C27B0', VWMA: '#F44336',
    };

    Object.entries(instDataMap).forEach(([key, data]) => {
      const series = addLineSeries(instChart, instColors[key], 1);
      series.setData(data as LineData[]);
      seriesRef.current.institutional.push(series);
    });

    // Sync
    syncTimeScales(chartsRef.current);
    syncCrosshairs(chartsRef.current, setCrosshairTime);

    mainChart.timeScale().fitContent();
  }, [ohlcvData, chartType, maPeriods, maActive, technicalIndicator, institutionalIndicators]);

  useEffect(() => {
    buildCharts();
    return () => {
      chartsRef.current.forEach(c => c.remove());
      chartsRef.current = [];
    };
  }, [buildCharts]);

  // Resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      chartsRef.current.forEach(c => {
        c.applyOptions({ width: container.clientWidth });
      });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const handleMAToggle = (index: number) => {
    setMaActive(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const handleMAPeriodChange = (index: number, period: number) => {
    setMaPeriods(prev => {
      const next = [...prev];
      next[index] = period;
      return next;
    });
  };

  const handleInstitutionalToggle = (indicator: InstitutionalIndicator) => {
    setInstitutionalIndicators(prev => ({
      ...prev,
      [indicator]: !prev[indicator],
    }));
  };

  if (loading) {
    return (
      <div className="bg-[#0c0c0c] border border-[#1c1c1c] p-8 text-center">
        <div className="inline-block w-5 h-5 border-2 border-[#1c1c1c] border-t-[#FF6600] rounded-full animate-spin mb-2" />
        <div className="text-[11px] text-[#555] font-mono">Loading {ticker}...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#0c0c0c] border border-[#1c1c1c] p-4">
        <div className="text-[11px] text-[#FF3B3B] font-mono">⚠ {error}</div>
      </div>
    );
  }

  return (
    <div className="bg-[#0c0c0c] border border-[#1c1c1c]">
      <ChartToolbar
        chartType={chartType}
        onChartTypeChange={setChartType}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        maPeriods={maPeriods}
        maActive={maActive}
        onMAToggle={handleMAToggle}
        onMAPeriodChange={handleMAPeriodChange}
        technicalIndicator={technicalIndicator}
        onTechnicalIndicatorChange={setTechnicalIndicator}
        institutionalIndicators={institutionalIndicators}
        onInstitutionalToggle={handleInstitutionalToggle}
      />
      <div ref={containerRef} className="w-full" style={{ height: 500 }}>
        <div className="pane-main w-full h-[55%]" />
        <div className="pane-volume w-full h-[10%]" />
        <div className="pane-technical w-full h-[20%]" />
        <div className="pane-institutional w-full h-[15%]" />
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 px-3 py-1 bg-[#080808] border-t border-[#1c1c1c] text-[9px] font-mono">
        <span className="text-[#555]">{ticker}</span>
        {ohlcvData.length > 0 && (
          <span className="text-[#888]">
            O {ohlcvData[ohlcvData.length - 1].open.toFixed(2)} ·
            H {ohlcvData[ohlcvData.length - 1].high.toFixed(2)} ·
            L {ohlcvData[ohlcvData.length - 1].low.toFixed(2)} ·
            C {ohlcvData[ohlcvData.length - 1].close.toFixed(2)}
          </span>
        )}
        {maActive.some(a => a) && (
          <span className="text-[#555]">
            MAs: {maPeriods.filter((_, i) => maActive[i]).join('/')}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create smoke test**

Create `dashboard/src/components/TradingChart.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TradingChart from './TradingChart';

// Mock fetchOHLCV
vi.mock('../prices', () => ({
  fetchOHLCV: vi.fn().mockResolvedValue([]),
}));

describe('TradingChart', () => {
  it('renders loading state', () => {
    render(<TradingChart ticker="BBCA.JK" />);
    expect(screen.getByText(/Loading BBCA.JK/)).toBeDefined();
  });

  it('renders with ticker prop', () => {
    render(<TradingChart ticker="TLKM.JK" />);
    expect(screen.getByText(/Loading TLKM.JK/)).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd dashboard && npm test
```

Expected: Tests pass.

- [ ] **Step 4: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/TradingChart.tsx dashboard/src/components/TradingChart.test.tsx
git commit -m "feat: add TradingChart component with multi-pane indicators"
```

---

## Task 8: Integrate TradingChart into App.tsx

**Files:**
- Modify: `dashboard/src/App.tsx`

**Interfaces:**
- Consumes: `TradingChart` from Task 7
- Produces: Updated Market tab with TradingChart replacing IndicatorSignalCard

- [ ] **Step 1: Add TradingChart import and replace in Market tab**

In `dashboard/src/App.tsx`:

1. Add import at top:
```typescript
import TradingChart from './components/TradingChart';
```

2. Remove import:
```typescript
// DELETE: import IndicatorSignalCard from './IndicatorSignalCard';
```

3. In the Market tab JSX, replace the three-column grid section:
```tsx
// DELETE this block:
<div className="content-grid-market">
  <OrderbookCard emiten={selectedTicker} />
  <BandarmologyCard emiten={selectedTicker} />
  <IndicatorSignalCard emiten={selectedTicker} />
</div>

// REPLACE WITH:
<TradingChart ticker={selectedTicker} />
```

- [ ] **Step 2: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds (OrderbookCard and BandarmologyCard imports will cause errors until removed in Task 10).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/App.tsx
git commit -m "feat: integrate TradingChart into Market tab"
```

---

## Task 9: Delete Stockbit Files

**Files:**
- Delete: `dashboard/src/stockbit.ts`
- Delete: `dashboard/src/StockbitWatchlist.tsx`
- Delete: `dashboard/src/OrderbookCard.tsx`
- Delete: `dashboard/src/BandarmologyCard.tsx`
- Delete: `dashboard/src/ActiveTradeCard.tsx`
- Delete: `dashboard/src/SentinelNewsCard.tsx`
- Modify: `dashboard/src/App.tsx` (remove all Stockbit imports and references)

- [ ] **Step 1: Delete Stockbit files**

```bash
cd dashboard && rm -f src/stockbit.ts src/StockbitWatchlist.tsx src/OrderbookCard.tsx src/BandarmologyCard.tsx src/ActiveTradeCard.tsx src/SentinelNewsCard.tsx
```

- [ ] **Step 2: Remove Stockbit imports from App.tsx**

In `dashboard/src/App.tsx`, remove these imports:
```typescript
// DELETE:
import StockbitWatchlist from './StockbitWatchlist';
import OrderbookCard from './OrderbookCard';
import BandarmologyCard from './BandarmologyCard';
import ActiveTradeCard from './ActiveTradeCard';
import SentinelNewsCard from './SentinelNewsCard';
```

- [ ] **Step 3: Replace StockbitWatchlist in sidebar**

Replace the sidebar content with a local watchlist (reuse existing watchlist state):

```tsx
{/* ── Sidebar ──────────────────────────────────── */}
<div className="app-sidebar">
  <div className="card-header">
    <div className="card-title" style={{ padding: 0, background: 'none', border: 'none', color: 'var(--bb-amber)' }}>
      WATCHLIST
    </div>
  </div>
  {watchlist.length === 0 ? (
    <div className="empty">NO ITEMS</div>
  ) : (
    watchlist.map(ticker => {
      const q = quotes.get(ticker);
      const chg = q?.daily_change_pct;
      const cur = q?.currency || 'IDR';
      const priceIDR = q?.current_price != null
        ? (cur === 'IDR' ? q.current_price : q.current_price * liveForex)
        : null;
      const isPos = (chg ?? 0) >= 0;
      return (
        <div
          key={ticker}
          className={`watch-item ${selectedTicker === ticker ? 'selected' : ''}`}
          onClick={() => handleTickerSelect(ticker)}
        >
          <div>
            <div className="watch-ticker">{ticker}</div>
            <div className="watch-price">{priceIDR != null ? idr(priceIDR) : '—'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ textAlign: 'right' }}>
              <div className="watch-price">{q?.current_price?.toLocaleString('en-US') ?? '—'} {cur !== 'IDR' ? cur : ''}</div>
              <div className={`watch-change ${chg != null ? (isPos ? 'pnl-pos' : 'pnl-neg') : ''}`}>{pct(chg)}</div>
            </div>
            <button className="btn btn-sm btn-red" onClick={e => { e.stopPropagation(); removeFromWatchlist(ticker); }} style={{ padding: '1px 5px', fontSize: '.6rem' }}>✕</button>
          </div>
        </div>
      );
    })
  )}
</div>
```

- [ ] **Step 4: Remove Stockbit references from News tab**

In the News tab, remove SentinelNewsCard:
```tsx
// DELETE:
<SentinelNewsCard />
```

- [ ] **Step 5: Remove tapeItems state (was Stockbit-driven)**

Remove the `tapeItems` state and `onWatchlistLoaded` callback:
```typescript
// DELETE:
const [tapeItems, setTapeItems] = useState<Array<{ ticker: string; price: number; pct: number }>>([]);

// In StockbitWatchlist usage, DELETE:
onWatchlistLoaded={setTapeItems}
```

- [ ] **Step 6: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Run tests**

```bash
cd dashboard && npm test
```

Expected: Tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A dashboard/src/
git commit -m "feat: remove Stockbit API integration and all dependent components"
```

---

## Task 10: Refactor EmitenInfoCard to yfinance

**Files:**
- Modify: `dashboard/src/EmitenInfoCard.tsx`

**Interfaces:**
- Consumes: `fetchQuote` from `prices.ts`
- Produces: Updated EmitenInfoCard using yfinance data

- [ ] **Step 1: Read current EmitenInfoCard**

Read `dashboard/src/EmitenInfoCard.tsx` to understand current structure and what Stockbit data it uses.

- [ ] **Step 2: Rewrite to use yfinance**

Replace the Stockbit API calls with `fetchQuote()` from `prices.ts`. The card should display:
- Ticker name
- Current price
- Daily change %
- High/Low
- Currency

```tsx
import { useState, useEffect } from 'react';
import { fetchQuote } from './prices';
import type { TickerQuote } from './types';

export default function EmitenInfoCard({ emiten }: { emiten: string }) {
  const [quote, setQuote] = useState<TickerQuote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchQuote(emiten)
      .then(q => { if (active) setQuote(q); })
      .catch(() => { if (active) setQuote(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [emiten]);

  if (loading) return <div className="card fade-in" style={{ padding: 12 }}><div className="spinner" /></div>;
  if (!quote) return <div className="card fade-in" style={{ padding: 12 }}><div className="empty">NO DATA</div></div>;

  const isPos = (quote.daily_change_pct ?? 0) >= 0;

  return (
    <div className="bb-security-header">
      <div className="bb-security-top">
        <div>
          <div className="bb-security-ticker">{emiten}</div>
          <div className="bb-security-name">{quote.currency}</div>
        </div>
        <div>
          <div className="bb-security-price">{quote.current_price?.toLocaleString('en-US') ?? '—'}</div>
          <div className={`bb-security-change ${isPos ? 'pnl-pos' : 'pnl-neg'}`}>
            {isPos ? '+' : ''}{quote.daily_change_pct ?? 0}%
          </div>
        </div>
      </div>
      <div className="bb-security-stats">
        <div className="bb-security-stat">
          <span className="label">HIGH</span>
          <span className="val">{quote.high?.toLocaleString('en-US') ?? '—'}</span>
        </div>
        <div className="bb-security-stat">
          <span className="label">LOW</span>
          <span className="val">{quote.low?.toLocaleString('en-US') ?? '—'}</span>
        </div>
        <div className="bb-security-stat">
          <span className="label">PREV CLOSE</span>
          <span className="val">{quote.previous_close?.toLocaleString('en-US') ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/EmitenInfoCard.tsx
git commit -m "refactor: rewrite EmitenInfoCard to use yfinance data"
```

---

## Task 11: Refactor KeyStatsCard to yfinance

**Files:**
- Modify: `dashboard/src/KeyStatsCard.tsx`

**Interfaces:**
- Consumes: `fetchQuote` and new yfinance summary endpoints from `prices.ts`
- Produces: Updated KeyStatsCard using yfinance data

- [ ] **Step 1: Read current KeyStatsCard**

Read `dashboard/src/KeyStatsCard.tsx` to understand current structure.

- [ ] **Step 2: Add yfinance summary fetcher to prices.ts**

Append to `dashboard/src/prices.ts`:

```typescript
/** Fetch extended quote data (summaryDetail + defaultKeyStatistics) */
export async function fetchKeyStats(ticker: string): Promise<any> {
  const url = `/api/yahoo/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Yahoo KeyStats ${ticker}: HTTP ${r.status}`);
  const json = await r.json();
  return json.quoteSummary?.result?.[0] ?? {};
}
```

- [ ] **Step 3: Rewrite KeyStatsCard**

Replace the Stockbit API calls with `fetchKeyStats()` from `prices.ts`. Display key valuation metrics in a simple table format.

```tsx
import { useState, useEffect } from 'react';
import { fetchKeyStats } from './prices';

export default function KeyStatsCard({ emiten }: { emiten: string }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchKeyStats(emiten)
      .then(s => { if (active) setStats(s); })
      .catch(() => { if (active) setStats(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [emiten]);

  if (loading) return <div className="card fade-in" style={{ padding: 12 }}><div className="spinner" /></div>;
  if (!stats) return <div className="card fade-in" style={{ padding: 12 }}><div className="empty">NO DATA</div></div>;

  const summary = stats.summaryDetail || {};
  const keyStats = stats.defaultKeyStatistics || {};

  const rows = [
    { label: 'MARKET CAP', value: summary.marketCap?.fmt ?? '—' },
    { label: 'ENTERPRISE VALUE', value: summary.enterpriseValue?.fmt ?? '—' },
    { label: 'TRAILING P/E', value: summary.trailingPE?.fmt ?? '—' },
    { label: 'FORWARD P/E', value: summary.forwardPE?.fmt ?? '—' },
    { label: 'PEG RATIO', value: keyStats.pegRatio?.fmt ?? '—' },
    { label: 'PRICE/BOOK', value: keyStats.priceToBook?.fmt ?? '—' },
    { label: 'EV/EBITDA', value: summary.evToEbitda?.fmt ?? '—' },
    { label: 'DIVIDEND YIELD', value: summary.dividendYield?.fmt ?? '—' },
    { label: 'PROFIT MARGIN', value: summary.profitMargins?.fmt ?? '—' },
    { label: 'RETURN ON EQUITY', value: keyStats.returnOnEquity?.fmt ?? '—' },
  ];

  return (
    <div className="card fade-in">
      <div className="card-title">KEY STATS — {emiten}</div>
      <table className="keystats-table">
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td className="keystats-label">{r.label}</td>
              <td className="keystats-value">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Verify build passes**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/KeyStatsCard.tsx dashboard/src/prices.ts
git commit -m "refactor: rewrite KeyStatsCard to use yfinance data"
```

---

## Task 12: Polish App.tsx and Verify Full Build

**Files:**
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/index.css` (add remaining Tailwind utilities)

**Interfaces:**
- Consumes: All previous tasks
- Produces: Clean, working app with no Stockbit references

- [ ] **Step 1: Remove unused imports from App.tsx**

Clean up any remaining unused imports. Verify no references to deleted files remain:
```bash
cd dashboard && grep -n "stockbit\|Stockbit\|Orderbook\|Bandarmology\|ActiveTrade\|SentinelNews" src/App.tsx
```

Expected: No matches.

- [ ] **Step 2: Final build verification**

```bash
cd dashboard && npm run build
```

Expected: Clean build, zero errors.

- [ ] **Step 3: Run all tests**

```bash
cd dashboard && npm test
```

Expected: All tests pass.

- [ ] **Step 4: Run lint**

```bash
cd dashboard && npm run lint
```

Expected: No lint errors.

- [ ] **Step 5: Commit**

```bash
git add -A dashboard/
git commit -m "chore: final cleanup — remove unused imports, verify build"
```

---

## Summary

| Task | Deliverable | Dependencies |
|------|-------------|--------------|
| 1 | Tailwind CSS installed | None |
| 2 | 5 new indicator functions | None |
| 3 | Indicator unit tests | Task 2 |
| 4 | chartUtils.ts | None |
| 5 | MACHip component | None |
| 6 | ChartToolbar component | Task 5 |
| 7 | TradingChart component | Tasks 4, 5, 6 |
| 8 | TradingChart integrated in App | Task 7 |
| 9 | Stockbit files deleted | Task 8 |
| 10 | EmitenInfoCard refactored | Task 9 |
| 11 | KeyStatsCard refactored | Task 9 |
| 12 | Final build verification | Tasks 8-11 |
