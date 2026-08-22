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
	up: "#4ade80",
	down: "#fb7185",
	line: "#7dd3fc",
	line2: "#a78bfa",
	line3: "#facc15",
	volume: "rgba(125, 211, 252, 0.22)",
	grid: "rgba(27, 38, 57, 0.9)",
};

export interface ChartOptions {
	showVolume?: boolean;
	overlayIndicators?: string[]; // e.g. ["sma20", "sma50", "sma200", "ema21"]
}

export default function MarketChart({
	history,
	indicators,
	height = 420,
	options,
}: {
	history: HistoryRecord[];
	indicators?: IndicatorColumns;
	height?: number;
	options?: ChartOptions;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const lineSeriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});

	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			height,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: "#73809a",
				fontFamily: "'JetBrains Mono', monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: PALETTE.grid },
				horzLines: { color: PALETTE.grid },
			},
			crosshair: {
				mode: 0,
				vertLine: {
					color: "rgba(125,211,252,0.45)",
					labelBackgroundColor: "#0e7490",
				},
				horzLine: {
					color: "rgba(125,211,252,0.45)",
					labelBackgroundColor: "#0e7490",
				},
			},
			rightPriceScale: { borderColor: "#1b2639" },
			timeScale: { borderColor: "#1b2639", timeVisible: true },
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
				textColor: "#73809a",
				fontFamily: "'JetBrains Mono', monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: PALETTE.grid },
				horzLines: { color: PALETTE.grid },
			},
			rightPriceScale: { borderColor: "#1b2639" },
			timeScale: { borderColor: "#1b2639" },
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
