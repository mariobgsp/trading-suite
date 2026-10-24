/**
 * Price + flow-pressure chart.
 *
 * The candles use the same `MarketChart` the Name page uses. The flow pane is
 * deliberately separate: a proxy score is not a price level, and drawing it on
 * the candle scale would imply a precision the proxy does not have.
 */

import { useMemo } from "react";
import type { HistoryRecord } from "@/lib/api";
import type { FlowSeries } from "@/lib/api/flow";
import MarketChart from "./MarketChart";

const W = 1000;
const H = 190;
const TOP = 18;
const PLOT_H = 112;
const BAR_TOP = 146;
const BAR_H = 34;

function scoreY(value: number): number {
	const clamped = Math.max(-1, Math.min(1, value));
	return TOP + ((1 - clamped) / 2) * PLOT_H;
}

export default function FlowChart({
	series,
	history,
}: {
	series: FlowSeries;
	history: HistoryRecord[];
}) {
	const chart = useMemo(() => buildFlowPath(series), [series]);

	return (
		<div>
			<div className="border border-[var(--border)] bg-[var(--panel)] p-2">
				<MarketChart
					history={history}
					height={320}
					options={{ showVolume: true }}
				/>
			</div>
			<div className="mt-3 border border-[var(--border)] bg-[var(--panel)] p-4">
				<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
					<div>
						<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							Flow pressure (proxy)
						</span>
						<p className="mt-1 max-w-[68ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
							Dimensionless score in [-1, 1], from Chaikin Money Flow and (where
							available) IDX foreign flow. Not Bandarmetrics LPM. Direction is the
							5-session change; bars below are volume intensity.
						</p>
					</div>
					<span className="font-mono text-[10px] text-[var(--text-ghost)]">
						{series.source.flow}
					</span>
				</div>

				{chart.hasData ? (
					<svg
						viewBox={`0 0 ${W} ${H}`}
						className="h-[190px] w-full"
						role="img"
						aria-label={`Flow pressure proxy for ${series.ticker}`}
					>
						{[1, 0, -1].map((tick) => (
							<g key={tick}>
								<line
									x1={0}
									x2={W}
									y1={scoreY(tick)}
									y2={scoreY(tick)}
									stroke="var(--border)"
									strokeWidth={tick === 0 ? 1 : 0.5}
									strokeDasharray={tick === 0 ? undefined : "3 4"}
								/>
								<text
									x={4}
									y={scoreY(tick) - 3}
									fill="var(--text-ghost)"
									fontSize={10}
									fontFamily="ui-monospace, Menlo, Consolas, monospace"
								>
									{tick > 0 ? "+1" : tick < 0 ? "-1" : "0"}
								</text>
							</g>
						))}

						{chart.bars}
						<path
							d={chart.path}
							fill="none"
							stroke="var(--gold)"
							strokeWidth={1.8}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
						{chart.last && (
							<>
								<circle
									cx={chart.last.x}
									cy={chart.last.y}
									r={3}
									fill="var(--gold)"
								/>
								<text
									x={Math.min(chart.last.x + 6, W - 34)}
									y={Math.max(chart.last.y - 6, 12)}
									fill="var(--gold)"
									fontSize={10}
									fontFamily="ui-monospace, Menlo, Consolas, monospace"
								>
									{chart.last.score.toFixed(2)}
								</text>
							</>
						)}

						<text
							x={4}
							y={BAR_TOP + BAR_H + 3}
							fill="var(--text-ghost)"
							fontSize={9}
							fontFamily="ui-monospace, Menlo, Consolas, monospace"
						>
							intensity
						</text>
						<text
							x={W - 4}
							y={H - 4}
							textAnchor="end"
							fill="var(--text-ghost)"
							fontSize={9}
							fontFamily="ui-monospace, Menlo, Consolas, monospace"
						>
							{series.dates[0] ?? ""} → {series.dates[series.dates.length - 1] ?? ""}
						</text>
					</svg>
				) : (
					<p className="py-10 text-center font-mono text-[12px] text-[var(--text-faint)]">
						No proxy series for {series.ticker}.
					</p>
				)}
			</div>
		</div>
	);
}

function buildFlowPath(series: FlowSeries): {
	hasData: boolean;
	path: string;
	last: { x: number; y: number; score: number } | null;
	bars: React.ReactNode;
} {
	const n = series.dates.length;
	const scores = series.lpm_score;
	const intensities = series.intensity;
	const points = scores
		.map((value, index) => {
			if (value == null || Number.isNaN(value)) return null;
			const x = n <= 1 ? 0 : (index / (n - 1)) * W;
			return { x, y: scoreY(value), value, index };
		})
		.filter((point): point is { x: number; y: number; value: number; index: number } => point !== null);

	const path = points
		.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
		.join(" ");
	const last = points.length
		? { x: points[points.length - 1]!.x, y: points[points.length - 1]!.y, score: points[points.length - 1]!.value }
		: null;

	const validIntensity = intensities.filter(
		(value): value is number => value != null && Number.isFinite(value),
	);
	const maxIntensity = validIntensity.length ? Math.max(...validIntensity) : 1;
	const width = n > 1 ? Math.max(0.6, W / n - 0.4) : W;
	const bars = (
		<g>
			{intensities.map((value, index) => {
				if (value == null || !Number.isFinite(value) || maxIntensity <= 0) return null;
				const height = Math.max(0.5, (value / maxIntensity) * BAR_H);
				const x = n <= 1 ? 0 : (index / (n - 1)) * W - width / 2;
				return (
					<rect
						key={series.dates[index] ?? index}
						x={Math.max(0, x)}
						y={BAR_TOP + BAR_H - height}
						width={width}
						height={height}
						fill="var(--blue)"
						opacity={0.22}
					/>
				);
			})}
		</g>
	);

	return { hasData: points.length > 0, path, last, bars };
}
