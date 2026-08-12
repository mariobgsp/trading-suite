import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, LineData } from 'lightweight-charts';
import { fetchOHLCV } from './prices';
import {
  simulateBacktest,
  calculateJCIResilience,
  getMACDSignal,
  getRSISignal,
  getStochasticSignal,
  getFVGSignal,
  getSupportBuySignal,
  getBreakoutSignal,
  getTrendFollowSignal,
  getBuyHoldCurve,
  calculatePearsonCorrelation,
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
  lineStyle?: LineStyle;
  lineWidth?: number;
}

interface CorrelationResult {
  r: number;
  interpretation: string;
  underPressure: boolean;
}

function normalize(curve: { time: string; value: number }[]): LineData[] {
  if (curve.length === 0) return [];
  const start = curve[0].value;
  if (start === 0) return [];
  return curve.map(d => ({
    time: d.time as any,
    value: parseFloat(((d.value / start) * 100).toFixed(2)),
  }));
}

const STRATEGY_META = [
  { label: 'MACD Cross',   color: '#FF6600', description: 'EMA 12/26/9 · Golden/Death Cross · 5% SL · 10% Trailing' },
  { label: 'RSI 30/70',    color: '#00C853', description: 'RSI-14 · Buy >30 · Sell <70 · 5% SL · 10% Trailing' },
  { label: 'Stoch 20/80',  color: '#00B8D4', description: 'Stoch 14,3,3 · K×D crossover <20/>80 · 5% SL' },
  { label: 'FVG Pullback', color: '#B39DDB', description: 'Fair Value Gap · Bullish imbalance pullback · RSI exit' },
  { label: 'Support Buy',  color: '#FF8A65', description: 'Buy 20-bar low dip · SMA rising filter · Trailing stop' },
  { label: 'Breakout',     color: '#F9A825', description: '20-bar high break · Volume 1.3× avg · ATR confirm' },
  { label: 'Trend Follow', color: '#E91E63', description: '20×50 SMA cross · Vol >1.3× avg · 10% trailing stop' },
];

const BacktestCard: React.FC<BacktestCardProps> = ({ emiten }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);
  const [jciResilience, setJciResilience] = useState<number | null>(null);
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null);
  const [seriesData, setSeriesData] = useState<SeriesConfig[]>([]);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);

  useEffect(() => {
    let active = true;

    async function runBacktest() {
      if (!emiten) return;
      setLoading(true);
      setError('');
      setResults([]);
      setSeriesData([]);
      setCorrelation(null);

      try {
        const [stockData, jciData] = await Promise.all([
          fetchOHLCV(emiten, '5y'),
          fetchOHLCV('^JKSE', '5y'),
        ]);

        if (!active) return;
        if (stockData.length === 0) {
          setError('No historical data found for ' + emiten);
          setLoading(false);
          return;
        }

        setJciResilience(calculateJCIResilience(stockData, jciData));
        setCorrelation(calculatePearsonCorrelation(stockData, jciData));

        const macdSim    = simulateBacktest('MACD Cross',   stockData, getMACDSignal(stockData));
        const rsiSim     = simulateBacktest('RSI 30/70',    stockData, getRSISignal(stockData));
        const stochSim   = simulateBacktest('Stoch 20/80',  stockData, getStochasticSignal(stockData));
        const fvgSim     = simulateBacktest('FVG Pullback', stockData, getFVGSignal(stockData));
        const supportSim = simulateBacktest('Support Buy',  stockData, getSupportBuySignal(stockData));
        const brkoutSim  = simulateBacktest('Breakout',     stockData, getBreakoutSignal(stockData));
        const trendSim   = simulateBacktest('Trend Follow', stockData, getTrendFollowSignal(stockData));

        if (!active) return;
        setResults([macdSim, rsiSim, stochSim, fvgSim, supportSim, brkoutSim, trendSim]);

        const buyHoldRaw = getBuyHoldCurve(stockData);
        const jciRaw     = getBuyHoldCurve(jciData);

        const ret = (raw: { time: string; value: number }[]) =>
          raw.length > 1
            ? parseFloat(((raw[raw.length - 1].value / raw[0].value - 1) * 100).toFixed(1))
            : 0;

        const configs: SeriesConfig[] = [
          { name: 'Buy & Hold',   color: '#555e72', data: normalize(buyHoldRaw),           finalReturn: ret(buyHoldRaw),           lineStyle: LineStyle.Dashed, lineWidth: 1 },
          { name: 'JCI (^JKSE)', color: '#8B8000', data: normalize(jciRaw),               finalReturn: ret(jciRaw),               lineStyle: LineStyle.Dashed, lineWidth: 1 },
          { name: 'MACD Cross',   color: '#FF6600', data: normalize(macdSim.equityCurve),   finalReturn: macdSim.totalReturn },
          { name: 'RSI 30/70',    color: '#00C853', data: normalize(rsiSim.equityCurve),    finalReturn: rsiSim.totalReturn },
          { name: 'Stoch 20/80',  color: '#00B8D4', data: normalize(stochSim.equityCurve),  finalReturn: stochSim.totalReturn },
          { name: 'FVG Pullback', color: '#B39DDB', data: normalize(fvgSim.equityCurve),    finalReturn: fvgSim.totalReturn },
          { name: 'Support Buy',  color: '#FF8A65', data: normalize(supportSim.equityCurve),finalReturn: supportSim.totalReturn },
          { name: 'Breakout',     color: '#F9A825', data: normalize(brkoutSim.equityCurve), finalReturn: brkoutSim.totalReturn },
          { name: 'Trend Follow', color: '#E91E63', data: normalize(trendSim.equityCurve),  finalReturn: trendSim.totalReturn },
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

  useEffect(() => {
    if (!chartContainerRef.current || seriesData.length === 0) return;

    if (chartInstance.current) {
      chartInstance.current.remove();
      chartInstance.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: '#050505' },
        textColor: '#666666',
        fontFamily: "'JetBrains Mono', 'Share Tech Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#111111' }, horzLines: { color: '#111111' } },
      rightPriceScale: { borderColor: '#1c1c1c', scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: { borderColor: '#1c1c1c', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: '#FF6600', labelBackgroundColor: '#FF6600', width: 1 },
        horzLine: { color: '#FF6600', labelBackgroundColor: '#FF6600', width: 1 },
      },
    });
    chartInstance.current = chart;

    for (const cfg of seriesData) {
      const series: ISeriesApi<'Line'> = chart.addLineSeries({
        color: cfg.color,
        lineWidth: (cfg.lineWidth ?? 2) as any,
        lineStyle: cfg.lineStyle ?? LineStyle.Solid,
        title: '',
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      series.setData(cfg.data);
    }
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width && chartInstance.current) chartInstance.current.applyOptions({ width });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); };
  }, [seriesData]);

  if (loading) {
    return (
      <div className="bb-panel" style={{ padding: '32px', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block', width: 22, height: 22,
          border: '2px solid #1c1c1c', borderTopColor: '#FF6600',
          borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginBottom: 10,
        }} />
        <div style={{ fontSize: '0.72rem', color: '#555e72' }}>
          Running 5-year backtest for {emiten}…
        </div>
        <div style={{ fontSize: '0.62rem', color: '#333', marginTop: 4 }}>
          Fetching OHLCV · MACD · RSI · Stoch · FVG · Support Buy · Breakout
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bb-panel" style={{ padding: '16px' }}>
        <div style={{ fontSize: '0.72rem', color: '#FF3B3B' }}>⚠ {error}</div>
      </div>
    );
  }

  const resilienceClass = jciResilience !== null
    ? jciResilience >= 50 ? 'badge badge-green' : jciResilience >= 30 ? 'badge badge-yellow' : 'badge badge-red'
    : '';

  const corrColor = correlation === null ? '#666'
    : correlation.r >= 0.4 ? '#FF8A65'
    : correlation.r <= -0.4 ? '#00C853'
    : '#FFD600';

  return (
    <div className="bb-panel">
      {/* Header */}
      <div className="bb-panel-header">
        <span className="bb-panel-title">BACKTEST · {emiten} · 5Y · 7-STRATEGY vs JCI</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {jciResilience !== null && <span className={resilienceClass}>JCI RESILIENCE {jciResilience}%</span>}
        </div>
      </div>

      {/* Strategy Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--bb-border2)', borderBottom: '1px solid var(--bb-border2)' }}>
        {results.map((r, i) => {
          const meta = STRATEGY_META[i];
          return (
            <div key={r.name} style={{ background: 'var(--bb-panel2)', padding: '8px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: '0.63rem', fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.name}</span>
              </div>
              <div style={{ fontSize: '0.56rem', color: 'var(--bb-text3)', marginBottom: 6, lineHeight: 1.4 }}>{meta.description}</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div>
                  <div style={{ fontSize: '0.52rem', color: 'var(--bb-text3)', textTransform: 'uppercase' }}>Trades</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFF', fontFamily: 'JetBrains Mono, monospace' }}>{r.trades}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.52rem', color: 'var(--bb-text3)', textTransform: 'uppercase' }}>Win%</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: r.winRate >= 50 ? 'var(--bb-green)' : r.winRate >= 40 ? 'var(--bb-yellow)' : 'var(--bb-red)' }}>{r.winRate}%</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.52rem', color: 'var(--bb-text3)', textTransform: 'uppercase' }}>5Y Return</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: r.totalReturn >= 0 ? 'var(--bb-green)' : 'var(--bb-red)' }}>
                    {r.totalReturn >= 0 ? '+' : ''}{r.totalReturn}%
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--bb-border)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', background: '#080808' }}>
        <span style={{ fontSize: '0.56rem', color: 'var(--bb-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>NORMALIZED · BASE 100</span>
        {seriesData.map(cfg => (
          <span key={cfg.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.6rem' }}>
            <svg width="18" height="8" style={{ flexShrink: 0 }}>
              {cfg.name === 'Buy & Hold' || cfg.name === 'JCI (^JKSE)'
                ? <line x1="0" y1="4" x2="18" y2="4" stroke={cfg.color} strokeWidth="1.5" strokeDasharray="4 3" />
                : <line x1="0" y1="4" x2="18" y2="4" stroke={cfg.color} strokeWidth="2" />
              }
            </svg>
            <span style={{ color: cfg.color, fontWeight: 700 }}>{cfg.name}</span>
            <span style={{ color: cfg.finalReturn >= 0 ? 'var(--bb-green)' : 'var(--bb-red)', fontWeight: 600 }}>
              {cfg.finalReturn >= 0 ? '+' : ''}{cfg.finalReturn}%
            </span>
          </span>
        ))}
      </div>

      {/* Chart */}
      <div ref={chartContainerRef} style={{ width: '100%' }} />

      {/* Pearson Correlation Panel */}
      {correlation !== null && (
        <div style={{ borderTop: '1px solid var(--bb-border2)', background: '#080808', padding: '14px 16px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 20, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.54rem', color: 'var(--bb-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>PEARSON r · JCI</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: corrColor, lineHeight: 1 }}>
              {correlation.r >= 0 ? '+' : ''}{correlation.r.toFixed(2)}
            </div>
            <div style={{ fontSize: '0.5rem', color: 'var(--bb-text3)', marginTop: 2 }}>5Y DAILY LOG-RETURNS</div>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#DDD', marginBottom: 5, fontWeight: 600 }}>{correlation.interpretation}</div>
            <div style={{ fontSize: '0.6rem', color: 'var(--bb-text3)', lineHeight: 1.6 }}>
              Pearson r measures linear co-movement of daily returns vs JCI. r ≥ 0.4 means the stock typically falls when JCI falls (under market pressure). r ≤ -0.4 suggests defensive characteristics.
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.54rem', color: 'var(--bb-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>UNDER JCI PRESSURE</div>
            <span className={correlation.underPressure ? 'badge badge-red' : 'badge badge-green'} style={{ fontSize: '0.72rem', padding: '5px 12px' }}>
              {correlation.underPressure ? '⚠ YES' : '✓ NO'}
            </span>
          </div>
        </div>
      )}

      {/* Footer */}
      {jciResilience !== null && (
        <div style={{ padding: '4px 14px', borderTop: '1px solid var(--bb-border)', fontSize: '0.58rem', color: 'var(--bb-text3)', fontFamily: 'JetBrains Mono, monospace' }}>
          JCI RESILIENCE · Stock held or rose on {jciResilience}% of days when JCI closed lower · 5-year period
        </div>
      )}
    </div>
  );
};

export default BacktestCard;
