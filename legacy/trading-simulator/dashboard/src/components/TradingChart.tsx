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
  calculateOBV, calculateADL, calculateCMF, calculateVWAP, calculateVWMA, calculateMFI,
  calculateLiquidityPressure, calculateIntensity,
} from '../indicators';
import type { OHLCV } from '../indicators';

interface TradingChartProps {
  ticker: string;
}

export default function TradingChart({ ticker }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);
  const seriesRef = useRef<{
    volume?: ISeriesApi<'Histogram'>;
    mas: ISeriesApi<'Line'>[];
    vwap?: ISeriesApi<'Line'>;
    technical: ISeriesApi<'Line'>[];
    technicalHistogram?: ISeriesApi<'Histogram'>;
    institutional: ISeriesApi<'Line'>[];
  }>({ mas: [], technical: [], institutional: [] });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ohlcvData, setOhlcvData] = useState<OHLCV[]>([]);

  // State
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick');
  const [timeRange, setTimeRange] = useState('6mo');
  const [maPeriods, setMaPeriods] = useState([20, 50, 100, 200]);
  const [maActive, setMaActive] = useState([true, true, false, false]);
  const [technicalIndicator, setTechnicalIndicator] = useState<TechnicalIndicator | null>('RSI');
  const [institutionalIndicators, setInstitutionalIndicators] = useState<Record<InstitutionalIndicator, boolean>>({
    VWAP: false, OBV: false, ADL: false, MFI: false, CMF: false, VWMA: false, LIQP: false, INTENSITY: false,
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

    // Get pane divs
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
      const candleSeries = addCandlestickSeries(mainChart);
      candleSeries.setData(ohlcvData as CandlestickData[]);
    } else {
      const lineSeries = addLineSeries(mainChart, CHART_COLORS.textHi, 2);
      lineSeries.setData(ohlcvData.map(d => ({ time: d.time as any, value: d.close })));
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
    if (institutionalIndicators.LIQP) {
      instDataMap.LIQP = calculateLiquidityPressure(ohlcvData);
    }
    if (institutionalIndicators.INTENSITY) {
      instDataMap.INTENSITY = calculateIntensity(ohlcvData, 14);
    }

    const instColors: Record<string, string> = {
      OBV: '#00BCD4', ADL: '#FF9800', MFI: '#8BC34A', CMF: '#9C27B0', VWMA: '#F44336',
      LIQP: '#00E5FF', INTENSITY: '#FFEB3B',
    };

    Object.entries(instDataMap).forEach(([key, data]) => {
      const series = addLineSeries(instChart, instColors[key], 1);
      series.setData(data as LineData[]);
      seriesRef.current.institutional.push(series);
    });

    // Sync
    syncTimeScales(chartsRef.current);
    syncCrosshairs(chartsRef.current);

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
