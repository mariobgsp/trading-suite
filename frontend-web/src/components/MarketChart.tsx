"use client";

import { useEffect, useRef } from "react";
import {
	CandlestickSeries,
	createChart,
	createSeriesMarkers,
	HistogramSeries,
	LineSeries,
	ColorType,
	type IChartApi,
	type ISeriesApi,
	type ISeriesMarkersPluginApi,
	type SeriesMarkerBar,
	type Time,
	type UTCTimestamp,
} from "lightweight-charts";
import type { HistoryRecord, IndicatorColumns } from "@/lib/api";
import { useChartPalette, withAlpha } from "@/lib/theme";

export interface ChartOptions {
	showVolume?: boolean;
	showLpm?: boolean;
	showIntensity?: boolean;
	overlayIndicators?: string[]; // e.g. ["sma20", "sma50", "sma200", "ema21"]
}

/**
 * A horizontal level drawn across the chart. The plan uses these for the
 * 40-session high the name had to break, plus the target and stop it will
 * manage the trade to — so the geometry can be checked against the candles by
 * eye rather than taken on trust.
 */
export interface PriceLine {
	price: number;
	title: string;
	/** `solid` for levels a trade is managed against, `dashed` for context. */
	style?: "solid" | "dashed";
}

/**
 * A marker on one session.
 *
 * Price lines answer "what level"; they cannot answer "why this session". This
 * points at a date instead — the breakout, or the session the plan is for.
 */
export interface ChartAnnotation {
	/** ISO date of the bar to mark. */
	date: string;
	label: string;
	kind: "breakout" | "entry" | "gate" | "regime";
}

export default function MarketChart({
	history,
	indicators,
	height = 420,
	options,
	priceLines,
	annotations,
	stockbitLpm,
	stockbitIntensity,
}: {
	history: HistoryRecord[];
	indicators?: IndicatorColumns;
	height?: number;
	options?: ChartOptions;
	priceLines?: PriceLine[];
	annotations?: ChartAnnotation[];
	stockbitLpm?: (number | null)[];
	stockbitIntensity?: number[];
}) {
	// Chart colours are canvas-painted, so they come from the resolved token
	// set rather than the stylesheet. A new object on every theme flip puts
	// `theme` in the effect deps below and rebuilds the chart with the new
	// palette.
	const theme = useChartPalette();
	const containerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const lineSeriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});
	const lpmRef = useRef<ISeriesApi<"Line"> | null>(null);
	const intensityRef = useRef<ISeriesApi<"Histogram"> | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			height,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: theme.ink,
				fontFamily: "ui-monospace, Menlo, Consolas, monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: theme.grid },
				horzLines: { color: theme.grid },
			},
			crosshair: {
				mode: 0,
				vertLine: {
					color: withAlpha(theme.blue, 0.4),
					labelBackgroundColor: theme.grid,
				},
				horzLine: {
					color: withAlpha(theme.blue, 0.4),
					labelBackgroundColor: theme.grid,
				},
			},
			rightPriceScale: { borderColor: theme.grid },
			timeScale: { borderColor: theme.grid, timeVisible: true },
		});
		chartRef.current = chart;

		const candles = chart.addSeries(CandlestickSeries, {
			upColor: theme.up,
			downColor: theme.down,
			borderUpColor: theme.up,
			borderDownColor: theme.down,
			wickUpColor: theme.up,
			wickDownColor: theme.down,
		});
		seriesRef.current = candles;

		chart.timeScale().fitContent();
		return () => {
			// Null the refs BEFORE chart.remove() so later cleanups (volume,
			// overlays) that read chartRef.current skip instead of touching a
			// destroyed chart ("Value is undefined" crash).
			chartRef.current = null;
			seriesRef.current = null;
			lineSeriesRef.current = {};
			chart.remove();
		};
	}, [height, theme]);

	// Candles
	useEffect(() => {
		const chart = chartRef.current;
		const candles = seriesRef.current;
		if (!chart || !candles) return;
		candles.setData(
			history.map((h) => ({
				time: (new Date(h.date).getTime() / 1000) as UTCTimestamp,
				open: h.open,
				high: h.high,
				low: h.low,
				close: h.close,
			})),
		);
	}, [history, theme]);

	// Horizontal levels: the 40-session high a breakout cleared, and the target
	// and stop the trade is managed to. Redrawn whenever they or the theme move,
	// because the chart is canvas-painted and the colours are baked in.
	const priceLineRefs = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);

	useEffect(() => {
		const candles = seriesRef.current;
		if (!candles) return;

		// lightweight-charts cannot enumerate existing price lines, so the
		// handles we created are kept and removed explicitly. Without this a
		// re-render would stack a fresh set on top of the old one.
		for (const line of priceLineRefs.current) candles.removePriceLine(line);
		priceLineRefs.current = [];

		if (!priceLines?.length) return;
		for (const line of priceLines) {
			if (!Number.isFinite(line.price)) continue;
			priceLineRefs.current.push(
				candles.createPriceLine({
					price: line.price,
					color: theme.gold,
					lineWidth: 1,
					lineStyle: line.style === "dashed" ? 2 : 0, // 2 = dashed, 0 = solid
					axisLabelVisible: true,
					title: line.title,
				}),
			);
		}

		return () => {
			for (const line of priceLineRefs.current) candles.removePriceLine(line);
			priceLineRefs.current = [];
		};
	}, [priceLines, theme]);

	// Session markers. The marker primitive owns its data, so unlike price
	// lines it can be re-set in place: no handles to track, nothing to leak.
	const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

	useEffect(() => {
		const candles = seriesRef.current;
		if (!candles) return;
		const markers: SeriesMarkerBar<Time>[] = (annotations ?? [])
			.filter((a) => Number.isFinite(new Date(a.date).getTime()))
			.map((a): SeriesMarkerBar<Time> => ({
				time: (new Date(a.date).getTime() / 1000) as UTCTimestamp,
				position: a.kind === "entry" ? "aboveBar" : "belowBar",
				color:
					a.kind === "breakout"
						? theme.up
						: a.kind === "entry"
							? theme.gold
							: theme.blue,
				shape: a.kind === "entry" ? "arrowDown" : "arrowUp",
				text: a.label,
			}))
			.sort((x, y) => (x.time as number) - (y.time as number));
		if (!markersRef.current) {
			markersRef.current = createSeriesMarkers(candles, markers);
		} else {
			markersRef.current.setMarkers(markers);
		}
		return () => {
			markersRef.current?.setMarkers([]);
		};
	}, [annotations, theme]);

	// Volume histogram (on the price scale, hidden by default per design)
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart) return;
		if (!options?.showVolume) return;
		const volume = chart.addSeries(HistogramSeries, {
			priceFormat: { type: "volume" },
			priceScaleId: "",
			color: withAlpha(theme.blue, 0.18),
		});
		volume.setData(
			history.map((h) => ({
				time: (new Date(h.date).getTime() / 1000) as UTCTimestamp,
				value: h.volume,
			})),
		);
		return () => {
			// chart may already be torn down (chartRef nulled first)
			if (chartRef.current) chart.removeSeries(volume);
		};
	}, [history, options?.showVolume, theme]);

	// Overlay indicator lines
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !indicators) return;
		const names = options?.overlayIndicators ?? ["sma20", "sma50", "sma200"];
		const colors = [
			theme.blue,
			theme.violet,
			theme.gold,
			theme.blue,
			theme.violet,
		];

		// Remove previously-added overlay lines
		for (const key of Object.keys(lineSeriesRef.current)) {
			if (chartRef.current) chart.removeSeries(lineSeriesRef.current[key]);
		}
		lineSeriesRef.current = {};

		names.forEach((name, idx) => {
			const col = indicators[name];
			if (!col) return;
			const series = chart.addSeries(LineSeries, {
				color: colors[idx % colors.length],
				lineWidth: 1,
				priceLineVisible: false,
				lastValueVisible: false,
			});
			const data = indicators.date
				.map((d, i) => {
					const v = col[i];
					if (v == null || Number.isNaN(Number(v))) return null;
					return {
						time: (new Date(d).getTime() / 1000) as UTCTimestamp,
						value: Number(v),
					};
				})
				.filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
			if (data.length) {
				series.setData(data);
				lineSeriesRef.current[name] = series;
			}
		});
		chart.timeScale().fitContent();
	}, [indicators, options?.overlayIndicators, theme]);

	// Optional LPM-style overlay + intensity histogram.
	//
	// These default OFF. The old default was ON, which meant the Name page drew
	// an unlabeled CMF-normalized line that looked like a bandarmology model. A
	// proxy must opt in and be labeled; the Flow page uses its own separated
	// proxy series instead of this heuristic overlay.
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || history.length < 20) return;
		const showLpm = options?.showLpm === true;
		const showIntensity = options?.showIntensity === true;
		// Always teardown disabled overlays before any early exit — fixes
		// LPM toggle that appeared stuck (both-false returned before cleanup).
		if (!showLpm && lpmRef.current && chartRef.current) {
			try {
				chart.removeSeries(lpmRef.current);
			} catch {
				/* already removed */
			}
			lpmRef.current = null;
		}
		if (!showIntensity && intensityRef.current && chartRef.current) {
			try {
				chart.removeSeries(intensityRef.current);
			} catch {
				/* already removed */
			}
			intensityRef.current = null;
		}
		if (!showLpm && !showIntensity) {
			try {
				chart
					.priceScale("")
					.applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
				chart
					.priceScale("right")
					.applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } });
			} catch {
				/* reset */
			}
			return;
		}
		// Clean previous of still-enabled overlays before recreating
		if (showLpm && lpmRef.current && chartRef.current) {
			try {
				chart.removeSeries(lpmRef.current);
			} catch {
				/* already removed */
			}
			lpmRef.current = null;
		}
		if (showIntensity && intensityRef.current && chartRef.current) {
			try {
				chart.removeSeries(intensityRef.current);
			} catch {
				/* already removed */
			}
			intensityRef.current = null;
		}
		// compute CMF20 raw then normalize to price range
		const cmfVals: (number | null)[] = [];
		for (let i = 0; i < history.length; i++) {
			if (i < 19) {
				cmfVals.push(null);
				continue;
			}
			let sumMfv = 0,
				sumVol = 0;
			for (let k = i - 19; k <= i; k++) {
				const rk = history[k];
				const rg = (Number(rk.high) || 0) - (Number(rk.low) || 0);
				const mfm =
					rg !== 0
						? (Number(rk.close) -
								Number(rk.low) -
								(Number(rk.high) - Number(rk.close))) /
							rg
						: 0;
				const vol = Number(rk.volume) || 0;
				if (Number.isFinite(mfm)) sumMfv += mfm * vol;
				sumVol += vol;
			}
			const cmf = sumVol ? sumMfv / sumVol : 0;
			cmfVals.push(Number.isFinite(cmf) ? cmf : null);
		}
		const closes = history.map((h) => Number(h.close) || 0);
		const minPrice = Math.min(...closes);
		const maxPrice = Math.max(...closes);
		const priceRange = maxPrice - minPrice || 1;
		const validCmfs = cmfVals.filter(
			(v): v is number => v != null && Number.isFinite(v),
		);
		const minCmf = validCmfs.length ? Math.min(...validCmfs) : -0.2;
		const maxCmf = validCmfs.length ? Math.max(...validCmfs) : 0.2;
		const cmfRange = maxCmf - minCmf || 1;
		// raw LPM = close * (1 + cmf*0.15) then normalize
		const rawLpm = history.map((h, i) => {
			const cmf = cmfVals[i];
			if (cmf == null) return null;
			const cl = Number(h.close) || 0;
			return cl * (1 + cmf * 0.15);
		});
		if (showLpm) {
			const lpmData = rawLpm
				.map((v, i) => {
					if (v == null || !Number.isFinite(v)) return null;
					const cmfNorm =
						((cmfVals[i]! - minCmf) / cmfRange) * priceRange + minPrice;
					return {
						time: (new Date(history[i].date).getTime() / 1000) as UTCTimestamp,
						value: cmfNorm,
					};
				})
				.filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
			if (lpmData.length) {
				const lpmSeries = chart.addSeries(LineSeries, {
					color: theme.gold,
					lineWidth: 1,
					priceLineVisible: false,
					lastValueVisible: false,
				});
				lpmSeries.setData(lpmData);
				lpmRef.current = lpmSeries;
			}
		}
		// Intensity: volume/avg20 * body strength -> histogram below (separate scale)
		const vols = history.map((h) => Number(h.volume) || 0);
		const sma = (arr: number[], idx: number, w: number) => {
			const s = Math.max(0, idx - w + 1);
			let sum = 0;
			for (let j = s; j <= idx; j++) sum += arr[j] || 0;
			return sum / Math.max(1, idx - s + 1);
		};
		const _intensityVals = history.map((h, i) => {
			const avg = sma(vols, i, 20);
			const range = (Number(h.high) || 0) - (Number(h.low) || 0);
			const body =
				Math.abs((Number(h.close) || 0) - (Number(h.open) || 0)) /
				(range || Math.max(1, (Number(h.close) || 0) * 0.01));
			const vol = Number(h.volume) || 0;
			return avg > 0
				? (vol / avg) * (0.5 + (Number.isFinite(body) ? body : 0))
				: 0;
		});
		const intensityVals =
			Array.isArray(stockbitIntensity) &&
			stockbitIntensity.length === history.length
				? stockbitIntensity
				: _intensityVals;
		if (!showIntensity) {
			try {
				chart
					.priceScale("right")
					.applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } });
			} catch {
				/* reset */
			}
			return;
		}
		const intensitySeries = chart.addSeries(HistogramSeries, {
			priceScaleId: "",
			priceFormat: { type: "volume" },
			color: withAlpha(theme.up, 0.55),
		});
		intensitySeries.setData(
			history.map((h, i) => {
				const v = intensityVals[i] || 0;
				return {
					time: (new Date(h.date).getTime() / 1000) as UTCTimestamp,
					value: v,
					color:
						v > 1.2
							? withAlpha(theme.up, 0.85)
							: v > 0.8
								? withAlpha(theme.gold, 0.7)
								: withAlpha(theme.ink, 0.15),
				};
			}),
		);
		intensityRef.current = intensitySeries;
		// put intensity scale at bottom 20%
		try {
			chart
				.priceScale("")
				.applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
			chart
				.priceScale("right")
				.applyOptions({ scaleMargins: { top: 0.05, bottom: 0.2 } });
		} catch {
			/* scale apply optional */
		}
		return () => {
			if (chartRef.current) {
				if (lpmRef.current)
					try {
						chart.removeSeries(lpmRef.current);
					} catch {
						/* already removed */
					}
				if (intensityRef.current)
					try {
						chart.removeSeries(intensityRef.current);
					} catch {
						/* already removed */
					}
			}
			lpmRef.current = null;
			intensityRef.current = null;
		};
	}, [
		history,
		options?.showLpm,
		options?.showIntensity,
		stockbitLpm,
		stockbitIntensity,
		theme,
	]);

	return <div ref={containerRef} className="w-full" style={{ height }} />;
}

/** Simple area/line chart for equity curves and index history. */
export function SimpleLineChart({
	data,
	height = 260,
	color,
}: {
	data: { date: string; value: number }[];
	height?: number;
	color?: string;
}) {
	const theme = useChartPalette();
	const lineColor = color ?? theme.blue;
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			height,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: theme.ink,
				fontFamily: "ui-monospace, Menlo, Consolas, monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: theme.grid },
				horzLines: { color: theme.grid },
			},
			rightPriceScale: { borderColor: theme.grid },
			timeScale: { borderColor: theme.grid },
		});
		const series = chart.addSeries(LineSeries, {
			color: lineColor,
			lineWidth: 2,
		});
		series.setData(
			data.map((d) => ({
				time: (new Date(d.date).getTime() / 1000) as UTCTimestamp,
				value: d.value,
			})),
		);
		chart.timeScale().fitContent();
		return () => {
			chart.remove();
		};
	}, [data, height, lineColor, theme]);

	return <div ref={containerRef} className="w-full" style={{ height }} />;
}
