import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import type { IChartApi, LineData, HistogramData } from 'lightweight-charts';
import { readLocalFile } from './github';
import { idr } from './utils';

interface LPIEntry {
  date: string;
  ticker: string;
  lpi_score: number;
  intensity: number;
  bid_pressure: number;
  ask_pressure: number;
  total_bid_volume: number;
  total_ask_volume: number;
  spread: number;
  spread_pct: number;
  last_price: number;
  timestamp: string;
  depth_levels: number;
}

interface LPIChartProps {
  ticker: string;
}

export default function LPIChart({ ticker }: LPIChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [data, setData] = useState<LPIEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    readLocalFile<LPIEntry[]>('lpi_history.json')
      .then(all => {
        if (!active) return;
        const filtered = all
          .filter(e => e.ticker === ticker && e.lpi_score != null)
          .sort((a, b) => a.date.localeCompare(b.date));
        setData(filtered);
        setLoading(false);
      })
      .catch(err => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { active = false; };
  }, [ticker]);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 180,
      layout: {
        background: { type: ColorType.Solid, color: '#050505' },
        textColor: '#666666',
        fontFamily: "'JetBrains Mono', 'Share Tech Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#111111' },
        horzLines: { color: '#111111' },
      },
      rightPriceScale: {
        borderColor: '#1c1c1c',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#1c1c1c',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#FF6600', labelBackgroundColor: '#FF6600', width: 1 },
        horzLine: { color: '#FF6600', labelBackgroundColor: '#FF6600', width: 1 },
      },
    });
    chartRef.current = chart;

    // Zero line
    const zeroSeries = chart.addLineSeries({
      color: '#333333',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    zeroSeries.setData(data.map(d => ({ time: d.date as any, value: 0 })));

    // Upper exhaustion threshold (+0.4)
    const upperSeries = chart.addLineSeries({
      color: '#00C85340',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    upperSeries.setData(data.map(d => ({ time: d.date as any, value: 0.4 })));

    // Lower exhaustion threshold (-0.4)
    const lowerSeries = chart.addLineSeries({
      color: '#FF3B3B40',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lowerSeries.setData(data.map(d => ({ time: d.date as any, value: -0.4 })));

    // LPI histogram (colored bars)
    const histSeries = chart.addHistogramSeries({
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const histData: HistogramData[] = data.map(d => ({
      time: d.date as any,
      value: d.lpi_score,
      color: d.lpi_score >= 0
        ? `rgba(0, 200, 83, ${Math.min(1, Math.abs(d.lpi_score) * 1.5)})`
        : `rgba(255, 59, 59, ${Math.min(1, Math.abs(d.lpi_score) * 1.5)})`,
    }));
    histSeries.setData(histData);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-[#050505] border border-[#1c1c1c] p-3">
        <div className="text-[10px] text-[#555] font-mono">Loading LPI...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#050505] border border-[#1c1c1c] p-3">
        <div className="text-[10px] text-[#FF3B3B] font-mono">LPI: {error}</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-[#050505] border border-[#1c1c1c] p-3">
        <div className="text-[10px] text-[#555] font-mono">NO LPI DATA — run python lpi_calculator.py</div>
      </div>
    );
  }

  const latest = data[data.length - 1];
  const avgScore = data.reduce((s, d) => s + d.lpi_score, 0) / data.length;
  const direction = latest.lpi_score > 0.1 ? 'BUY' : latest.lpi_score < -0.1 ? 'SELL' : 'NEUTRAL';
  const directionColor = direction === 'BUY' ? '#00C853' : direction === 'SELL' ? '#FF3B3B' : '#888';

  return (
    <div className="bg-[#050505] border border-[#1c1c1c]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1c1c1c]">
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-mono text-[#888] tracking-wider uppercase">LPI</span>
          <span className="text-[10px] font-mono" style={{ color: directionColor }}>
            {direction} {latest.lpi_score >= 0 ? '+' : ''}{latest.lpi_score.toFixed(3)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono text-[#555]">
          <span>Intensity: {(latest.intensity * 100).toFixed(0)}%</span>
          <span>Spread: {latest.spread_pct.toFixed(2)}%</span>
          <span>Avg: {avgScore >= 0 ? '+' : ''}{avgScore.toFixed(3)}</span>
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 180 }} />
      <div className="flex items-center gap-4 px-3 py-1 bg-[#080808] border-t border-[#1c1c1c] text-[9px] font-mono text-[#555]">
        <span>Bid Vol: {idr(latest.total_bid_volume)}</span>
        <span>Ask Vol: {idr(latest.total_ask_volume)}</span>
        <span>Depth: {latest.depth_levels} lvls</span>
        <span className="ml-auto">{data.length} sessions</span>
      </div>
    </div>
  );
}