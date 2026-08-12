> Part of [[trading-simulator/trading-simulator|trading-simulator]] project

# Backtest Performance Comparison Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-line performance comparison chart to the BacktestCard that overlays normalized stock price (Buy & Hold) vs portfolio equity curves for MACD, RSI, and Stochastic strategies, with labeled legend entries for each.

**Architecture:** Extend `backtestEngine.ts` to produce real equity curves using the indicators from `indicators.ts`, then render all curves on a single `lightweight-charts` chart in `BacktestCard.tsx`. The chart shows normalized % return (starting at 100) so all series are comparable regardless of absolute price differences.

**Tech Stack:** React + TypeScript, lightweight-charts v4, indicators.ts (calculateMACD, calculateRSI, calculateStochasticFull), fetchOHLCV (prices.ts)

---

## Task 1: Extend backtestEngine.ts — Add MACD/RSI/Stoch signal generators

**Files:**
- Modify: `dashboard/src/backtestEngine.ts`

- [ ] **Step 1: Add imports for indicators**

Add to the top of `backtestEngine.ts`:
```typescript
import { calculateMACD, calculateRSI, calculateStochasticFull } from './indicators';
import type { OHLCV } from './indicators';
```

- [ ] **Step 2: Add MACD signal generator function**

Add after the existing `calculateJCIResilience` export:
```typescript
/** 
 * Generate MACD crossover signals.
 * BUY: MACD crosses above Signal line (Golden Cross)
 * SELL: MACD crosses below Signal line (Death Cross)
 */
export function getMACDSignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const macdData = calculateMACD(stockData);
  return (i: number) => {
    if (i < 1 || i >= macdData.length) return null;
    const prev = macdData[i - 1];
    const curr = macdData[i];
    if (prev.macd <= prev.signal && curr.macd > curr.signal) return 'BUY';
    if (prev.macd >= prev.signal && curr.macd < curr.signal) return 'SELL';
    return null;
  };
}
```

- [ ] **Step 3: Add RSI signal generator function**

```typescript
/**
 * Generate RSI signals.
 * BUY:  RSI crosses above 30 (oversold recovery)
 * SELL: RSI crosses below 70 (overbought reversal)
 */
export function getRSISignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const rsiData = calculateRSI(stockData, 14);
  // rsiData is aligned to stockData starting from index `period`
  // Build a time→value map for O(1) lookup
  const rsiMap = new Map(rsiData.map(d => [d.time, d.value]));
  return (i: number) => {
    if (i < 1) return null;
    const prevTime = stockData[i - 1].time;
    const currTime = stockData[i].time;
    const prevRSI = rsiMap.get(prevTime) ?? null;
    const currRSI = rsiMap.get(currTime) ?? null;
    if (prevRSI === null || currRSI === null) return null;
    if (prevRSI <= 30 && currRSI > 30) return 'BUY';
    if (prevRSI >= 70 && currRSI < 70) return 'SELL';
    return null;
  };
}
```

- [ ] **Step 4: Add Stochastic signal generator function**

```typescript
/**
 * Generate Stochastic crossover signals.
 * BUY:  %K crosses above %D when both < 20 (oversold zone)
 * SELL: %K crosses below %D when both > 80 (overbought zone)
 */
export function getStochasticSignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const stochData = calculateStochasticFull(stockData, 14, 3, 3);
  const stochMap = new Map(stochData.map(d => [d.time, d]));
  return (i: number) => {
    if (i < 1) return null;
    const prevTime = stockData[i - 1].time;
    const currTime = stockData[i].time;
    const prev = stochMap.get(prevTime) ?? null;
    const curr = stochMap.get(currTime) ?? null;
    if (!prev || !curr) return null;
    if (prev.k <= prev.d && curr.k > curr.d && curr.d < 20) return 'BUY';
    if (prev.k >= prev.d && curr.k < curr.d && curr.d > 80) return 'SELL';
    return null;
  };
}
```

- [ ] **Step 5: Update simulateBacktest to use 5% SL / 10% trailing stop (matching backtester.py)**

Replace the existing `simulateBacktest` function body with:
```typescript
export function simulateBacktest(
  name: string,
  stockData: OHLCV[],
  getSignal: (i: number) => 'BUY' | 'SELL' | null
): TestResult {
  const STOP_LOSS_PCT = 0.05;
  const TRAILING_STOP_PCT = 0.10;

  let equity = 10000;
  let position = 0;
  let entryPrice = 0;
  let highestPrice = 0;
  let wins = 0;
  let losses = 0;

  const equityCurve: { time: string; value: number }[] = [];

  for (let i = 0; i < stockData.length; i++) {
    const current = stockData[i];

    if (position > 0) {
      // Update trailing high
      if (current.high > highestPrice) highestPrice = current.high;

      let trigger: string | null = null;
      let sellPrice = current.close;

      // Fixed stop loss
      if (current.low <= entryPrice * (1 - STOP_LOSS_PCT)) {
        trigger = 'StopLoss';
        sellPrice = entryPrice * (1 - STOP_LOSS_PCT);
      }
      // Trailing stop (only when we're above entry)
      else if (highestPrice > entryPrice && current.low <= highestPrice * (1 - TRAILING_STOP_PCT)) {
        trigger = 'TrailingStop';
        sellPrice = highestPrice * (1 - TRAILING_STOP_PCT);
      }
      // Sell signal
      else if (getSignal(i) === 'SELL') {
        trigger = 'Signal';
        sellPrice = current.close;
      }

      if (trigger) {
        equity = position * sellPrice;
        if (sellPrice > entryPrice) wins++; else losses++;
        position = 0;
        entryPrice = 0;
        highestPrice = 0;
      }
    } else {
      if (getSignal(i) === 'BUY') {
        position = equity / current.close;
        entryPrice = current.close;
        highestPrice = current.close;
      }
    }

    const currentEquity = position > 0 ? position * current.close : equity;
    equityCurve.push({ time: current.time, value: currentEquity });
  }

  // Close open position at end
  if (position > 0) {
    const finalPrice = stockData[stockData.length - 1].close;
    equity = position * finalPrice;
    if (finalPrice > entryPrice) wins++; else losses++;
  }

  const totalTrades = wins + losses;
  return {
    name,
    trades: totalTrades,
    winRate: totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0,
    totalReturn: Math.round(((equity - 10000) / 10000) * 100),
    equityCurve
  };
}
```

- [ ] **Step 6: Add Buy & Hold equity curve helper**

```typescript
/**
 * Compute a normalized Buy & Hold equity curve starting at 10000.
 * This represents owning the stock for the entire period.
 */
export function getBuyHoldCurve(stockData: OHLCV[]): { time: string; value: number }[] {
  if (stockData.length === 0) return [];
  const startPrice = stockData[0].close;
  return stockData.map(d => ({
    time: d.time,
    value: 10000 * (d.close / startPrice)
  }));
}
```

- [ ] **Step 7: Commit**

```bash
cd /home/mariobgsp/Projects/trading-simulator
git add dashboard/src/backtestEngine.ts
git commit -m "feat(backtest): add real MACD/RSI/Stoch signal generators + buy-hold curve"
```

---

## Task 2: Rewrite BacktestCard.tsx — Multi-line comparison chart

**Files:**
- Modify: `dashboard/src/BacktestCard.tsx`

- [ ] **Step 1: Replace the entire BacktestCard component**

The new component will:
1. Fetch OHLCV data for the stock + JCI
2. Run three real backtests (MACD, RSI, Stoch) using proper signal generators
3. Compute a Buy & Hold curve
4. Normalize all curves to start at 100 (percentage return basis)
5. Render a single lightweight-charts `IChartApi` with 4 line series + a custom HTML legend

Replace the entire file content of `dashboard/src/BacktestCard.tsx` with:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData } from 'lightweight-charts';
import { fetchOHLCV } from './prices';
import {
  simulateBacktest,
  calculateJCIResilience,
  getMACDSignal,
  getRSISignal,
  getStochasticSignal,
  getBuyHoldCurve
} from './backtestEngine';
import type { TestResult } from './backtestEngine';

interface BacktestCardProps {
  emiten: string;
}

interface SeriesConfig {
  name: string;
  color: string;
  data: LineData[];
  finalReturn: number;
}

/** Normalize an equity curve to start at 100 */
function normalize(curve: { time: string; value: number }[]): LineData[] {
  if (curve.length === 0) return [];
  const start = curve[0].value;
  if (start === 0) return [];
  return curve.map(d => ({
    time: d.time as any,
    value: parseFloat(((d.value / start) * 100).toFixed(2))
  }));
}

const SERIES_CONFIGS = [
  { key: 'buyhold',  label: 'Buy & Hold',  color: '#A8A8A8' },
  { key: 'macd',     label: 'MACD Cross',  color: '#FF6600' },
  { key: 'rsi',      label: 'RSI 30/70',   color: '#00C853' },
  { key: 'stoch',    label: 'Stoch 20/80', color: '#00B8D4' },
];

const BacktestCard: React.FC<BacktestCardProps> = ({ emiten }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);
  const [jciResilience, setJciResilience] = useState<number | null>(null);
  const [seriesData, setSeriesData] = useState<SeriesConfig[]>([]);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<'Line'>[]>([]);

  useEffect(() => {
    let active = true;

    async function runBacktest() {
      if (!emiten) return;
      setLoading(true);
      setError('');
      try {
        const [stockData, jciData] = await Promise.all([
          fetchOHLCV(emiten, '5y'),
          fetchOHLCV('^JKSE', '5y'),
        ]);

        if (!active) return;
        if (stockData.length === 0) {
          setError('No data found for ' + emiten);
          setLoading(false);
          return;
        }

        const resilience = calculateJCIResilience(stockData, jciData);
        setJciResilience(resilience);

        // Run all three strategy backtests
        const macdSim  = simulateBacktest('MACD Cross',  stockData, getMACDSignal(stockData));
        const rsiSim   = simulateBacktest('RSI 30/70',   stockData, getRSISignal(stockData));
        const stochSim = simulateBacktest('Stoch 20/80', stockData, getStochasticSignal(stockData));
        setResults([macdSim, rsiSim, stochSim]);

        // Build normalized series
        const buyHoldRaw = getBuyHoldCurve(stockData);
        const configs: SeriesConfig[] = [
          { name: 'Buy & Hold',  color: '#A8A8A8', data: normalize(buyHoldRaw),         finalReturn: parseFloat(((buyHoldRaw[buyHoldRaw.length-1]?.value / buyHoldRaw[0]?.value - 1) * 100).toFixed(1)) },
          { name: 'MACD Cross',  color: '#FF6600', data: normalize(macdSim.equityCurve),  finalReturn: macdSim.totalReturn },
          { name: 'RSI 30/70',   color: '#00C853', data: normalize(rsiSim.equityCurve),   finalReturn: rsiSim.totalReturn },
          { name: 'Stoch 20/80', color: '#00B8D4', data: normalize(stochSim.equityCurve), finalReturn: stochSim.totalReturn },
        ];
        setSeriesData(configs);

        setLoading(false);
      } catch (err: any) {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      }
    }

    runBacktest();
    return () => { active = false; };
  }, [emiten]);

  // Build/update the chart whenever seriesData changes
  useEffect(() => {
    if (!chartContainerRef.current || seriesData.length === 0) return;

    // Destroy old chart
    if (chartInstance.current) {
      chartInstance.current.remove();
      chartInstance.current = null;
      seriesRefs.current = [];
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: '#080808' },
        textColor: '#A8A8A8',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1c1c1c' },
        horzLines: { color: '#1c1c1c' },
      },
      rightPriceScale: {
        borderColor: '#262626',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#262626',
        timeVisible: true,
      },
      crosshair: {
        vertLine: { color: '#FF6600', labelBackgroundColor: '#FF6600' },
        horzLine: { color: '#FF6600', labelBackgroundColor: '#FF6600' },
      },
    });

    chartInstance.current = chart;

    for (const cfg of seriesData) {
      const series = chart.addLineSeries({
        color: cfg.color,
        lineWidth: cfg.name === 'Buy & Hold' ? 1 : 2,
        lineStyle: cfg.name === 'Buy & Hold' ? 1 : 0, // dashed for buy-hold
        title: cfg.name,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      series.setData(cfg.data);
      seriesRefs.current.push(series);
    }

    chart.timeScale().fitContent();

    // Handle resize
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width && chartInstance.current) {
        chartInstance.current.applyOptions({ width });
      }
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
    };
  }, [seriesData]);

  if (loading) {
    return (
      <div className="bb-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--bb-text3)' }}>
        <div style={{ display: 'inline-block', width: 20, height: 20, border: '2px solid #333', borderTopColor: 'var(--bb-amber)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginBottom: 8 }} />
        <div style={{ fontSize: '0.75rem' }}>Running 5y backtest for {emiten}…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bb-panel" style={{ padding: '16px', color: 'var(--bb-red)', fontSize: '0.75rem' }}>
        ⚠ {error}
      </div>
    );
  }

  return (
    <div className="bb-panel">
      {/* Panel header */}
      <div className="bb-panel-header">
        <span className="bb-panel-title">
          BACKTEST · {emiten} · 5Y · MACD / RSI / STOCH vs BUY &amp; HOLD
        </span>
        {jciResilience !== null && (
          <span className={`badge ${jciResilience >= 50 ? 'badge-green' : jciResilience >= 30 ? 'badge-yellow' : 'badge-red'}`}>
            JCI RESILIENCE {jciResilience}%
          </span>
        )}
      </div>

      {/* Strategy stats row */}
      <div style={{ display: 'flex', gap: 1, borderBottom: '1px solid var(--bb-border2)', background: 'var(--bb-border2)' }}>
        {results.map((r, i) => {
          const cfg = seriesData[i + 1]; // skip buy-hold at index 0
          return (
            <div key={r.name} style={{ flex: 1, background: 'var(--bb-panel2)', padding: '8px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: cfg?.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--bb-text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.name}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--bb-text3)', textTransform: 'uppercase' }}>Trades</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#FFF' }}>{r.trades}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--bb-text3)', textTransform: 'uppercase' }}>Win Rate</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: r.winRate >= 50 ? 'var(--bb-green)' : r.winRate >= 40 ? 'var(--bb-yellow)' : 'var(--bb-red)' }}>{r.winRate}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--bb-text3)', textTransform: 'uppercase' }}>Total Return</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: r.totalReturn >= 0 ? 'var(--bb-green)' : 'var(--bb-red)' }}>{r.totalReturn >= 0 ? '+' : ''}{r.totalReturn}%</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Chart legend overlay */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--bb-border)', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.6rem', color: 'var(--bb-text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>LEGEND · NORMALIZED BASE 100</span>
        {seriesData.map(cfg => (
          <span key={cfg.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.65rem', color: 'var(--bb-text2)' }}>
            <span style={{
              display: 'inline-block', width: 20, height: 2,
              background: cfg.color,
              borderTop: cfg.name === 'Buy & Hold' ? `2px dashed ${cfg.color}` : `2px solid ${cfg.color}`,
              flexShrink: 0
            }} />
            <span style={{ color: cfg.color, fontWeight: 700 }}>{cfg.name}</span>
            <span style={{ color: cfg.finalReturn >= 0 ? 'var(--bb-green)' : 'var(--bb-red)' }}>
              {cfg.finalReturn >= 0 ? '+' : ''}{cfg.finalReturn}%
            </span>
          </span>
        ))}
      </div>

      {/* Chart */}
      <div ref={chartContainerRef} style={{ width: '100%' }} />

      {/* JCI Correlation detail */}
      {jciResilience !== null && (
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--bb-border)', fontSize: '0.62rem', color: 'var(--bb-text3)' }}>
          JCI CORRELATION · Stock held up or rose on {jciResilience}% of JCI down-days over the 5-year period
        </div>
      )}
    </div>
  );
};

export default BacktestCard;
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/BacktestCard.tsx
git commit -m "feat(backtest): multi-line performance comparison chart (MACD/RSI/Stoch vs Buy&Hold)"
```

---

## Task 3: Update backtestEngine.ts exports in types (if needed)

**Files:**
- Modify: `dashboard/src/backtestEngine.ts` (export additions only)

- [ ] **Step 1: Verify all new exports are present**

Confirm the following are exported from `backtestEngine.ts`:
- `simulateBacktest` (existing, updated)
- `calculateJCIResilience` (existing)
- `getMACDSignal` (new)
- `getRSISignal` (new)  
- `getStochasticSignal` (new)
- `getBuyHoldCurve` (new)

No changes needed if Task 1 was done correctly.

- [ ] **Step 2: Run existing tests to confirm nothing is broken**

```bash
cd /home/mariobgsp/Projects/trading-simulator/dashboard
npm test -- --run
```

Expected: All existing tests pass (backtestEngine.test.ts and BacktestCard.test.tsx)

---

## Task 4: (Optional) Verify dev server renders correctly

- [ ] **Step 1: Start dev server**

```bash
cd /home/mariobgsp/Projects/trading-simulator/dashboard
npm run dev
```

- [ ] **Step 2: Open browser and select any stock ticker**

Navigate to `http://localhost:5173`, select any stock from the watchlist. Scroll to the Backtest section. Verify:
- Chart loads with 4 labeled lines (Buy & Hold, MACD Cross, RSI 30/70, Stoch 20/80)
- Legend shows each strategy name + color + final % return
- Strategy stats (Trades, Win Rate, Total Return) appear above the chart
- JCI Resilience badge shown in panel header

- [ ] **Step 3: Commit final state**

```bash
git add -A
git commit -m "chore: backtest comparison graph complete"
```
