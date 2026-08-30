"use client";

import { useEffect, useRef } from "react";
import {
	LineSeries,
	HistogramSeries,
	createChart,
	ColorType,
	type IChartApi,
	type ISeriesApi,
	type UTCTimestamp,
} from "lightweight-charts";
import type { HistoryRecord, IndicatorColumns } from "@/lib/api";

const PALETTE = {
	grid: "rgba(27, 38, 57, 0.9)",
	rsi: "#4d9fff",
	stochK: "#a78bfa",
	stochD: "#facc15",
	ref: "rgba(125, 138, 168, 0.55)",
	refOverbought: "rgba(255, 93, 115, 0.45)",
	refOversold: "rgba(63, 214, 140, 0.45)",
};

/** A bounded 0–100 momentum sub-pane (RSI or Stochastic K/D).
 *  Mirrors MarketChart's createChart teardown pattern (null ref before
 *  chart.remove) so toggling a pane never crashes a sibling. */
export type MomentumKind = "rsi" | "stoch" | "intensity";

export default function MomentumPane({
	kind,
	indicators,
	history,
	height = 140,
}: {
	kind: MomentumKind;
	indicators?: IndicatorColumns;
	history?: HistoryRecord[];
	height?: number;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const lineRef = useRef<Record<string, ISeriesApi<"Line">>>({});
	const histRef = useRef<ISeriesApi<"Histogram"> | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			height,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: "#73809a",
				fontFamily: "'JetBrains Mono', monospace",
				fontSize: 10,
			},
			grid: {
				vertLines: { color: PALETTE.grid },
				horzLines: { color: PALETTE.grid },
			},
			crosshair: {
				mode: 0,
				vertLine: {
					color: "rgba(77,159,255,0.35)",
					labelBackgroundColor: "#0e7490",
				},
				horzLine: {
					color: "rgba(77,159,255,0.35)",
					labelBackgroundColor: "#0e7490",
				},
			},
			rightPriceScale: {
				borderColor: "#1f1f24",
				// Bounded 0–100 scale; autoScale false so ref lines stay fixed.
				autoScale: false,
			},
			timeScale: { borderColor: "#1f1f24", timeVisible: true },
		});
		chart.priceScale("right").applyOptions({
			scaleMargins: { top: 0.08, bottom: 0.08 },
			// Pin 0–100 (priceScaleOptions supports these at runtime; the
			// public DeepPartial type omits them, so cast through unknown).
			...((): Record<string, unknown> => {
				const o: Record<string, unknown> = {};
				(o as Record<string, unknown>)["minimum"] = 0;
				(o as Record<string, unknown>)["maximum"] = 100;
				return o;
			})(),
		});
		// Use priceLines to draw fixed 30/70 or 20/80 reference levels.
		// Place them on a throwaway series (the first we'll add) so they
		// anchor to the right edge without a data series of their own.
		chartRef.current = chart;

		// 30/70 for RSI, 20/80 for Stochastic.
		const overbought = kind === "rsi" ? 70 : 80;
		const oversold = kind === "rsi" ? 30 : 20;
		// Anchor series for reference price lines (invisible).
		const anchor = chart.addSeries(LineSeries, {
			color: "transparent",
			lineWidth: 1,
			priceLineVisible: false,
			lastValueVisible: false,
			visible: false,
		});
		if (overbought != null) {
			anchor.createPriceLine({
				price: overbought,
				color: PALETTE.refOverbought,
				lineWidth: 1,
				lineStyle: 2, // dashed
				axisLabelVisible: true,
				title: `OB ${overbought}`,
			});
			anchor.createPriceLine({
				price: 50,
				color: PALETTE.ref,
				lineWidth: 1,
				lineStyle: 3, // dotted
				axisLabelVisible: false,
			});
			anchor.createPriceLine({
				price: oversold as number,
				color: PALETTE.refOversold,
				lineWidth: 1,
				lineStyle: 2,
				axisLabelVisible: true,
				title: `OS ${oversold}`,
			});
		} else {
			// intensity: 1.0 = "at average volume" reference
			anchor.createPriceLine({
				price: 1.0,
				color: PALETTE.ref,
				lineWidth: 1,
				lineStyle: 2,
				axisLabelVisible: true,
				title: "avg vol",
			});
		}

		return () => {
			chartRef.current = null;
			lineRef.current = {};
			chart.remove();
		};
	}, [height, kind]);

	// Data series — rebuild on indicator change. Reuses the anchor's price
	// scale by setting priceScaleId="right" implicitly.
	useEffect(() => {
		const chart = chartRef.current;
		if (!chart) return;

		// Tear down prior data series
		for (const key of Object.keys(lineRef.current)) {
			if (chartRef.current) {
				try {
					chart.removeSeries(lineRef.current[key]);
				} catch {
					/* already removed */
				}
			}
		}
		lineRef.current = {};
		if (histRef.current && chartRef.current) {
			try {
				chart.removeSeries(histRef.current);
			} catch {
				/* already removed */
			}
			histRef.current = null;
		}

		if (kind === "intensity") {
			// Volume/avg20 × body strength — matches MarketChart's intensity
			// computation, but rendered as a histogram in its own pane.
			if (!history || history.length === 0) return;
			const vols = history.map((h) => Number(h.volume) || 0);
			const sma = (idx: number, w: number) => {
				const s = Math.max(0, idx - w + 1);
				let sum = 0;
				for (let j = s; j <= idx; j++) sum += vols[j] || 0;
				return sum / Math.max(1, idx - s + 1);
			};
			const intensity = history.map((h, i) => {
				const avg = sma(i, 20);
				const range = (Number(h.high) || 0) - (Number(h.low) || 0);
				const body =
					Math.abs((Number(h.close) || 0) - (Number(h.open) || 0)) /
					(range || Math.max(1, (Number(h.close) || 0) * 0.01));
				const vol = vols[i];
				return avg > 0
					? (vol / avg) * (0.5 + (Number.isFinite(body) ? body : 0))
					: 0;
			});
			const hist = chart.addSeries(HistogramSeries, {
				priceScaleId: "",
				priceFormat: { type: "volume" },
				color: "rgba(90,200,120,0.7)",
			});
			hist.setData(
				history.map((h, i) => {
					const v = intensity[i] || 0;
					return {
						time: (new Date(h.date).getTime() / 1000) as UTCTimestamp,
						value: v,
						color:
							v > 1.2
								? "rgba(90,200,120,0.85)"
								: v > 0.8
									? "rgba(245,197,66,0.75)"
									: "rgba(255,255,255,0.15)",
					};
				}),
			);
			histRef.current = hist;
			// intensity scale at the bottom 20% so the avg reference stays
			// readable.
			try {
				chart
					.priceScale("")
					.applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
				chart
					.priceScale("right")
					.applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } });
			} catch {
				/* scale apply optional */
			}
			chart.timeScale().fitContent();
			return;
		}

		if (!indicators) return;
		const seriesSpec: { key: string; colKey: string; color: string }[] =
			kind === "rsi"
				? [{ key: "rsi", colKey: "rsi", color: PALETTE.rsi }]
				: [
						{ key: "k", colKey: "stoch_0", color: PALETTE.stochK },
						{ key: "d", colKey: "stoch_1", color: PALETTE.stochD },
					];

		for (const { key, colKey, color } of seriesSpec) {
			const col = indicators[colKey];
			if (!col) continue;
			const series = chart.addSeries(LineSeries, {
				color,
				lineWidth: 1,
				priceLineVisible: false,
				lastValueVisible: true,
			});
			const data = indicators.date
				.map((d, i) => {
					const v = col[i];
					if (v == null) return null;
					const num = Number(v);
					if (!Number.isFinite(num)) return null;
					return {
						time: (new Date(d).getTime() / 1000) as UTCTimestamp,
						value: num,
					};
				})
				.filter((x): x is { time: UTCTimestamp; value: number } => x !== null);
			if (data.length) {
				series.setData(data);
				lineRef.current[key] = series;
			}
		}
		chart.timeScale().fitContent();
	}, [indicators, kind, history]);

	return (
		<div className="w-full" style={{ height }}>
			<div
				aria-hidden
				className="pointer-events-none mb-1 flex items-center gap-3 px-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]"
			>
				<span className="text-[var(--accent)]">▸</span>
				<span>
					{kind === "rsi"
						? "RSI(14)"
						: kind === "stoch"
							? "Stochastic K / D"
							: "Intensity"}
				</span>
				<span className="ml-auto font-mono normal-case opacity-80">
					{kind === "rsi"
						? "0–100 · ref 30/70"
						: kind === "stoch"
							? "0–100 · ref 20/80"
							: "vol / avg20 × body"}
				</span>
			</div>
			<div ref={containerRef} style={{ height: height - 18 }} />
		</div>
	);
}
