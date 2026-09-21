"use client";

import { useEffect, useRef } from "react";
import {
	CandlestickSeries,
	createChart,
	HistogramSeries,
	LineSeries,
	ColorType,
	type IChartApi,
	type ISeriesApi,
	type UTCTimestamp,
} from "lightweight-charts";
import type { HistoryRecord, IndicatorColumns } from "@/lib/api";

const PALETTE = {
	up: "#15803d",
	down: "#dc2626",
	line: "#2563eb",
	line2: "#7c3aed",
	line3: "#956400",
	volume: "rgba(37, 99, 235, 0.18)",
	grid: "#EAEAEA",
};

export interface ChartOptions {
	showVolume?: boolean;
	showLpm?: boolean;
	showIntensity?: boolean;
	overlayIndicators?: string[]; // e.g. ["sma20", "sma50", "sma200", "ema21"]
}

export default function MarketChart({
	history,
	indicators,
	height = 420,
	options,
	stockbitLpm,
	stockbitIntensity,
}: {
	history: HistoryRecord[];
	indicators?: IndicatorColumns;
	height?: number;
	options?: ChartOptions;
	stockbitLpm?: (number | null)[];
	stockbitIntensity?: number[];
}) {
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
				textColor: "#6F6E6C",
				fontFamily: "ui-monospace, Menlo, Consolas, monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: PALETTE.grid },
				horzLines: { color: PALETTE.grid },
			},
			crosshair: {
				mode: 0,
				vertLine: {
					color: "rgba(37, 99, 235, 0.4)",
					labelBackgroundColor: "#EAEAEA",
				},
				horzLine: {
					color: "rgba(37, 99, 235, 0.4)",
					labelBackgroundColor: "#EAEAEA",
				},
			},
			rightPriceScale: { borderColor: "#EAEAEA" },
			timeScale: { borderColor: "#EAEAEA", timeVisible: true },
		});
		chartRef.current = chart;

		const candles = chart.addSeries(CandlestickSeries, {
			upColor: PALETTE.up,
			downColor: PALETTE.down,
			borderUpColor: PALETTE.up,
			borderDownColor: PALETTE.down,
			wickUpColor: PALETTE.up,
			wickDownColor: PALETTE.down,
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
	}, [height]);

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
	}, [history]);

	// Volume histogram (on the price scale, hidden by default per design)
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart) return;
		if (!options?.showVolume) return;
		const volume = chart.addSeries(HistogramSeries, {
			priceFormat: { type: "volume" },
			priceScaleId: "",
			color: PALETTE.volume,
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
	}, [history, options?.showVolume]);

	// Overlay indicator lines
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !indicators) return;
		const names = options?.overlayIndicators ?? ["sma20", "sma50", "sma200"];
		const colors = [
			PALETTE.line,
			PALETTE.line2,
			PALETTE.line3,
			PALETTE.line,
			PALETTE.line2,
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
	}, [indicators, options?.overlayIndicators]);

	// LPM overlay (normalized to candle range) + Intensity histogram below
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || history.length < 20) return;
		const showLpm = options?.showLpm !== false;
		const showIntensity = options?.showIntensity !== false;
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
					color: "#956400",
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
			color: "rgba(21, 128, 61, 0.55)",
		});
		intensitySeries.setData(
			history.map((h, i) => {
				const v = intensityVals[i] || 0;
				return {
					time: (new Date(h.date).getTime() / 1000) as UTCTimestamp,
					value: v,
					color:
						v > 1.2
							? "rgba(21, 128, 61, 0.85)"
							: v > 0.8
								? "rgba(149, 100, 0, 0.7)"
								: "rgba(17, 17, 17, 0.15)",
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
	]);

	return <div ref={containerRef} className="w-full" style={{ height }} />;
}

/** Simple area/line chart for equity curves and index history. */
export function SimpleLineChart({
	data,
	height = 260,
	color = PALETTE.line,
}: {
	data: { date: string; value: number }[];
	height?: number;
	color?: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			height,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: "#6F6E6C",
				fontFamily: "ui-monospace, Menlo, Consolas, monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: PALETTE.grid },
				horzLines: { color: PALETTE.grid },
			},
			rightPriceScale: { borderColor: "#EAEAEA" },
			timeScale: { borderColor: "#EAEAEA" },
		});
		const series = chart.addSeries(LineSeries, { color, lineWidth: 2 });
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
	}, [data, height, color]);

	return <div ref={containerRef} className="w-full" style={{ height }} />;
}
