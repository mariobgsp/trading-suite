/* chart.js — lightweight-charts helpers for the vanilla pages.
 * The library is vendored (vendor/lightweight-charts.js, v5 standalone UMD:
 * global `LightweightCharts`). Palette is read from the live CSS tokens so
 * canvas paint follows the theme; call `rebuildCharts()` after a theme flip.
 * Port of the chart setup in components/MarketChart.tsx + the equity chart
 * in routes/Backtest.tsx (addSeries API, v5).
 */
"use strict";

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function readPalette() {
  return {
    ink: token("--text-faint") || "#6F6E6C",
    grid: token("--border") || "#EAEAEA",
    up: token("--up") || "#15803d",
    down: token("--down") || "#dc2626",
    gold: token("--gold") || "#956400",
    violet: token("--violet") || "#7c3aed",
    blue: token("--blue") || "#2563eb",
  };
}

export function withAlpha(color, alpha) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    let d = hex[1];
    if (d.length === 3) d = d[0] + d[0] + d[1] + d[1] + d[2] + d[2];
    const n = parseInt(d, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return color;
}

function baseOptions(pal, height) {
  const L = window.LightweightCharts;
  return {
    height,
    layout: {
      background: { type: L.ColorType.Solid, color: "transparent" },
      textColor: pal.ink,
      fontFamily: "ui-monospace, Menlo, Consolas, monospace",
      fontSize: 11,
    },
    grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
    crosshair: {
      mode: 0,
      vertLine: { color: withAlpha(pal.blue, 0.4), labelBackgroundColor: pal.grid },
      horzLine: { color: withAlpha(pal.blue, 0.4), labelBackgroundColor: pal.grid },
    },
    rightPriceScale: { borderColor: pal.grid },
    timeScale: { borderColor: pal.grid, timeVisible: true },
  };
}

const ts = (d) => Math.floor(new Date(d).getTime() / 1000);

/** Candle chart with optional volume + SMA-style overlays. Returns {chart, el}. */
export function createCandleChart(el, history, opts = {}) {
  const L = window.LightweightCharts;
  const pal = readPalette();
  const chart = L.createChart(el, baseOptions(pal, opts.height ?? 420));
  const candles = chart.addSeries(L.CandlestickSeries, {
    upColor: pal.up,
    downColor: pal.down,
    borderUpColor: pal.up,
    borderDownColor: pal.down,
    wickUpColor: pal.up,
    wickDownColor: pal.down,
  });
  candles.setData(
    history.map((h) => ({
      time: ts(h.date),
      open: h.open,
      high: h.high,
      low: h.low,
      close: h.close,
    })),
  );

  if (opts.showVolume) {
    const vol = chart.addSeries(L.HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: withAlpha(pal.blue, 0.18),
    });
    vol.setData(history.map((h) => ({ time: ts(h.date), value: h.volume })));
  }

  const names = opts.overlays ?? ["sma20", "sma50"];
  const colors = [pal.blue, pal.violet, pal.gold, pal.blue, pal.violet];
  const dates = opts.indicatorDates ?? [];
  let ci = 0;
  for (const name of names) {
    const col = (opts.indicators ?? {})[name];
    if (!col || !dates.length) continue;
    const line = chart.addSeries(L.LineSeries, {
      color: colors[ci++ % colors.length],
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const data = [];
    for (let i = 0; i < dates.length; i++) {
      const v = col[i];
      if (v == null || Number.isNaN(Number(v))) continue;
      data.push({ time: ts(dates[i]), value: Number(v) });
    }
    if (data.length) line.setData(data);
  }

  const lines = [];
  for (const pl of opts.priceLines ?? []) {
    if (!Number.isFinite(pl.price)) continue;
    lines.push(
      candles.createPriceLine({
        price: pl.price,
        color: pal.gold,
        lineWidth: 1,
        lineStyle: pl.style === "dashed" ? 2 : 0,
        axisLabelVisible: true,
        title: pl.title,
      }),
    );
  }

  if (opts.annotations && opts.annotations.length) {
    const markers = opts.annotations
      .filter((a) => Number.isFinite(new Date(a.date).getTime()))
      .map((a) => ({
        time: ts(a.date),
        position: a.kind === "entry" ? "aboveBar" : "belowBar",
        color: a.kind === "breakout" ? pal.up : a.kind === "entry" ? pal.gold : pal.blue,
        shape: a.kind === "entry" ? "arrowDown" : "arrowUp",
        text: a.label,
      }))
      .sort((x, y) => x.time - y.time);
    L.createSeriesMarkers(candles, markers);
  }

  chart.timeScale().fitContent();
  return { chart, candles, dispose: () => chart.remove() };
}

/** Multi-line equity comparison chart. Returns api {chart, setVisible, dispose}. */
export function createEquityChart(el, curves, colors, opts = {}) {
  const L = window.LightweightCharts;
  const pal = readPalette();
  const chart = L.createChart(el, {
    ...baseOptions(pal, opts.height ?? 420),
    crosshair: { mode: 0 },
  });
  const series = {};
  for (const [key, cfg] of Object.entries(curves)) {
    const s = chart.addSeries(L.LineSeries, {
      color: cfg.color,
      lineWidth: cfg.width ?? 1,
      lineStyle: cfg.dashed ? L.LineStyle.Dashed : undefined,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    s.setData(cfg.points.map((p) => ({ time: p.date, value: p.value })));
    if (cfg.hidden) s.applyOptions({ visible: false });
    series[key] = s;
  }
  chart.timeScale().fitContent();
  return {
    chart,
    setVisible: (key, vis) => series[key]?.applyOptions({ visible: vis }),
    dispose: () => chart.remove(),
  };
}
