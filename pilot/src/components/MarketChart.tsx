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
	up: "#26a69a",
	down: "#ef5350",
	line: "#38bdf8",
	line2: "#a78bfa",
	line3: "#fbbf24",
	volume: "rgba(56, 189, 248, 0.25)",
	grid: "rgba(30, 38, 53, 0.5)",
};

export interface ChartOptions {
	showVolume?: boolean; // kept for API compatibility; volume is always on
	overlayIndicators?: string[]; // e.g. ["sma20","sma50","sma200","psar","mfi","cmf","ad_line"]
}

// Pane layout (lightweight-charts v5 multi-pane, indices stable — panes are
// created once at mount and never removed; toggles change series visibility):
//   0: candles + SMA/EMA + PSAR dots
//   1: volume histogram + vol_ma20            (always on)
//   2: stochastic 10,3,3 (stoch_0/stoch_1)    (always on)
//   3: MFI                                    (toggle)
//   4: CMF                                    (toggle)
//   5: A/D line                               (toggle)

export default function MarketChart({
	history,
	indicators,
	height = 720,
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
	const paneSeriesRef = useRef<
		Record<string, ISeriesApi<"Line" | "Histogram">>
	>({});

	// ── Chart + pane creation (once per mount) ─────────────────────────────
	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			height,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: "#8b95a9",
				fontFamily: "'JetBrains Mono', monospace",
				fontSize: 11,
				panes: {
					separatorColor: "rgba(30, 38, 53, 0.9)",
					separatorHoverColor: "rgba(56, 189, 248, 0.6)",
					enableResize: true,
				},
			},
			grid: {
				vertLines: { color: PALETTE.grid },
				horzLines: { color: PALETTE.grid },
			},
			crosshair: {
				mode: 0,
				vertLine: {
					color: "rgba(56,189,248,0.5)",
					labelBackgroundColor: "#0e7490",
				},
				horzLine: {
					color: "rgba(56,189,248,0.5)",
					labelBackgroundColor: "#0e7490",
				},
			},
			rightPriceScale: { borderColor: "#1e2635" },
			timeScale: { borderColor: "#1e2635", timeVisible: true },
		});
		chartRef.current = chart;

		// Pane 0 — candles (default pane, index 0)
		const candles = chart.addSeries(CandlestickSeries, {
			upColor: PALETTE.up,
			downColor: PALETTE.down,
			borderUpColor: PALETTE.up,
			borderDownColor: PALETTE.down,
			wickUpColor: PALETTE.up,
			wickDownColor: PALETTE.down,
		});
		seriesRef.current = candles;

		// Panes 1..5 — created eagerly so indices are stable. Each series
		// carries its own pane index; volume/MA share pane 1, stoch pane 2.
		const volume = chart.addSeries(
			HistogramSeries,
			{ priceFormat: { type: "volume" }, color: PALETTE.volume },
			1,
		);
		const volMa = chart.addSeries(
			LineSeries,
			{ color: PALETTE.line2, lineWidth: 2 },
			1,
		);
		const stochK = chart.addSeries(
			LineSeries,
			{ color: PALETTE.line, lineWidth: 2 },
			2,
		);
		const stochD = chart.addSeries(
			LineSeries,
			{ color: PALETTE.line2, lineWidth: 2 },
			2,
		);
		const mfi = chart.addSeries(
			LineSeries,
			{ color: PALETTE.line3, lineWidth: 2 },
			3,
		);
		const cmf = chart.addSeries(
			LineSeries,
			{ color: PALETTE.line2, lineWidth: 2 },
			4,
		);
		const adl = chart.addSeries(
			LineSeries,
			{ color: PALETTE.line3, lineWidth: 2 },
			5,
		);

		paneSeriesRef.current = {
			volume,
			vol_ma20: volMa,
			stoch_0: stochK,
			stoch_1: stochD,
			mfi,
			cmf,
			ad_line: adl,
		};

		// Relative pane heights: candles dominate, indicators get readable slices.
		const stretch = [10, 2.2, 2.2, 2, 2, 2];
		chart.panes().forEach((pane, i) => {
			pane.setStretchFactor(stretch[i] ?? 2);
		});

		chart.timeScale().fitContent();
		return () => {
			// Null the refs BEFORE chart.remove() so later cleanups skip
			// instead of touching a destroyed chart.
			chartRef.current = null;
			seriesRef.current = null;
			lineSeriesRef.current = {};
			paneSeriesRef.current = {};
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

	// Pane data (volume/MA/stoch always; mfi/cmf/adl toggleable)
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !indicators?.date) return;
		const active = new Set(
			options?.overlayIndicators ?? ["sma20", "sma50", "sma200"],
		);
		const colData = (name: string) =>
			indicators.date
				.map((d, i) => {
					const v = indicators[name]?.[i];
					if (v == null || Number.isNaN(Number(v))) return null;
					return {
						time: (new Date(d).getTime() / 1000) as UTCTimestamp,
						value: Number(v),
					};
				})
				.filter((x): x is { time: UTCTimestamp; value: number } => x !== null);

		const volume = paneSeriesRef.current.volume;
		if (volume) {
			volume.setData(
				history.map((h) => ({
					time: (new Date(h.date).getTime() / 1000) as UTCTimestamp,
					value: h.volume,
				})),
			);
		}

		const panePairs: [keyof typeof paneSeriesRef.current, string][] = [
			["vol_ma20", "vol_ma20"],
			["stoch_0", "stoch_0"],
			["stoch_1", "stoch_1"],
			["mfi", "mfi"],
			["cmf", "cmf"],
			["ad_line", "ad_line"],
		];
		for (const [refKey, colName] of panePairs) {
			const series = paneSeriesRef.current[refKey];
			if (!series) continue;
			series.setData(colData(colName));
			const on =
				colName === "vol_ma20" ||
				colName.startsWith("stoch_") ||
				active.has(colName);
			series.applyOptions({ visible: on });
		}
	}, [indicators, history, options?.overlayIndicators]);

	// Price-scale overlays (SMA/EMA on pane 0) + PSAR dots
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart || !indicators?.date) return;
		const names = (
			options?.overlayIndicators ?? ["sma20", "sma50", "sma200"]
		).filter(
			(n) => n !== "psar" && n !== "mfi" && n !== "cmf" && n !== "ad_line",
		);
		const colors = [
			PALETTE.line,
			PALETTE.line2,
			PALETTE.line3,
			PALETTE.line,
			PALETTE.line2,
		];

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

		// PSAR — dots colored by position (green below = bull, red above = bear)
		const wantSar = (options?.overlayIndicators ?? []).includes("psar");
		for (const key of ["psar_bull", "psar_bear"]) {
			const existing = lineSeriesRef.current[key];
			if (existing && chartRef.current) {
				chartRef.current.removeSeries(existing);
				delete lineSeriesRef.current[key];
			}
		}
		if (wantSar && indicators.psar) {
			const bull = chart.addSeries(LineSeries, {
				color: PALETTE.up,
				lineVisible: false,
				pointMarkersVisible: true,
				pointMarkersRadius: 3,
				priceLineVisible: false,
				lastValueVisible: false,
			});
			const bear = chart.addSeries(LineSeries, {
				color: PALETTE.down,
				lineVisible: false,
				pointMarkersVisible: true,
				pointMarkersRadius: 3,
				priceLineVisible: false,
				lastValueVisible: false,
			});
			const closeByDate = new Map(history.map((h) => [h.date, h.close]));
			const bullData: { time: UTCTimestamp; value: number }[] = [];
			const bearData: { time: UTCTimestamp; value: number }[] = [];
			indicators.date.forEach((d, i) => {
				const v = indicators.psar?.[i];
				const close = closeByDate.get(d) ?? closeByDate.get(d.slice(0, 10));
				if (v == null || close == null || Number.isNaN(Number(v))) return;
				const point = {
					time: (new Date(d).getTime() / 1000) as UTCTimestamp,
					value: Number(v),
				};
				if (close >= Number(v)) bullData.push(point);
				else bearData.push(point);
			});
			if (bullData.length) {
				bull.setData(bullData);
				lineSeriesRef.current.psar_bull = bull;
			}
			if (bearData.length) {
				bear.setData(bearData);
				lineSeriesRef.current.psar_bear = bear;
			}
		}
		chart.timeScale().fitContent();
	}, [indicators, history, options?.overlayIndicators]);

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
				textColor: "#8b95a9",
				fontFamily: "'JetBrains Mono', monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: PALETTE.grid },
				horzLines: { color: PALETTE.grid },
			},
			rightPriceScale: { borderColor: "#1e2635" },
			timeScale: { borderColor: "#1e2635" },
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
