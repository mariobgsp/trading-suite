import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import type { IChartApi, DeepPartial, ChartOptions } from 'lightweight-charts';

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
  LIQP: '#00E5FF',
  INTENSITY: '#FFEB3B',
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

  charts.forEach((chart) => {
    chart.subscribeCrosshairMove((param) => {
      if (isSyncing) return;
      isSyncing = true;
      // Crosshair position sync requires a series reference; time scale sync
      // handles the main visual sync. We just propagate the callback.
      isSyncing = false;

      if (onCrosshairMove) {
        onCrosshairMove(param.time ? String(param.time) : null);
      }
    });
  });
}
