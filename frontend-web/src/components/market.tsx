/**
 * The daily market dashboard's visual vocabulary.
 *
 * Everything is SVG or plain markup: the screen has one gauge and three
 * quadrant maps, and adding a charting dependency for that would be heavier
 * than the feature. The colours come from the existing token set.
 */

import { ChangeBadge } from "@/components/ui";
import { fmtNum, fmtPct } from "@/lib/api";
import type {
	GaugeComponent,
	OverviewGauge,
	OverviewMarket,
	Quadrant,
	RotationBlock,
	RotationGroup,
	RotationPoint,
} from "@/lib/api/overview";

const QUADRANT: Record<Quadrant, { label: string; color: string }> = {
	leading: { label: "Leading", color: "var(--up)" },
	weakening: { label: "Weakening", color: "var(--gold)" },
	improving: { label: "Improving", color: "var(--blue)" },
	lagging: { label: "Lagging", color: "var(--down)" },
};

const QUADRANT_ORDER: Quadrant[] = ["leading", "weakening", "improving", "lagging"];

export function MarketSummary({ market }: { market: OverviewMarket }) {
	const total = market.up + market.flat + market.down || 1;
	const upWidth = (market.up / total) * 100;
	const flatWidth = (market.flat / total) * 100;
	const downWidth = (market.down / total) * 100;
	const ihsg = market.ihsg;

	return (
		<div className="border border-[var(--border)] bg-[var(--panel)]">
			<div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
				<div className="bg-[var(--panel)] p-4">
					<div className="flex items-baseline justify-between gap-3">
						<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							IHSG
						</span>
						<ChangeBadge value={ihsg.change_pct} />
					</div>
					<div className="tabular mt-1 font-mono text-[30px] font-bold leading-none text-[var(--text)]">
						{fmtNum(ihsg.close, 2)}
					</div>
					<div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--text-dim)]">
						<Row label="MA50" value={fmtNum(ihsg.ma50, 2)} />
						<Row label="MA100" value={fmtNum(ihsg.ma100, 2)} />
						<Row label="vs MA100" value={fmtPct(ihsg.momentum_vs_ma100_pct)} />
						<Row label="Vol 20d" value={fmtPct(ihsg.volatility_20d_pct)} />
					</div>
				</div>
				<div className="bg-[var(--panel)] p-4">
					<div className="flex items-baseline justify-between gap-3">
						<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							Average stock
						</span>
						<ChangeBadge value={market.average_change_pct} />
					</div>
					<div className="tabular mt-1 font-mono text-[30px] font-bold leading-none text-[var(--text)]">
						{fmtPct(market.average_change_pct)}
					</div>
					<p className="mt-2 font-mono text-[11px] leading-relaxed text-[var(--text-ghost)]">
						{market.universe.total} names · {market.up5} up ≥5% · {market.down5} down ≥5%
					</p>
				</div>
			</div>

			<div className="border-t border-[var(--border)] p-4">
				<div className="flex h-2.5 overflow-hidden rounded-sm bg-[var(--panel-3)]">
					<span style={{ width: upWidth + "%", background: "var(--up)" }} />
					<span style={{ width: flatWidth + "%", background: "var(--text-ghost)" }} />
					<span style={{ width: downWidth + "%", background: "var(--down)" }} />
				</div>
				<div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px]">
					<span style={{ color: "var(--up)" }}>{market.up} naik</span>
					<span className="text-[var(--text-faint)]">{market.flat} tetap</span>
					<span style={{ color: "var(--down)" }}>{market.down} turun</span>
					<span className="ml-auto text-[var(--text-ghost)]">
						breadth {fmtPct(market.breadth_pct)}
					</span>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
				<Stat label="Di atas MA50" value={fmtPct(market.above_ma50_pct)} />
				<Stat label="Dekat high 52W" value={fmtNum(market.near_52w_high, 0)} />
				<Stat label="Dekat low 52W" value={fmtNum(market.near_52w_low, 0)} />
				<Stat label="52W history" value={fmtNum(market.universe.with_52w, 0)} />
			</div>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<span className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">{label}</span>
			<span className="tabular text-[var(--text-dim)]">{value}</span>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="bg-[var(--panel)] px-3 py-2">
			<div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
				{label}
			</div>
			<div className="tabular mt-0.5 font-mono text-[14px] font-semibold text-[var(--text)]">
				{value}
			</div>
		</div>
	);
}

/* ── gauge ─────────────────────────────────────────────────────────────── */

const BAND_COLORS = ["#b91c1c", "#d97706", "#ca8a04", "#15803d", "#166534"];

function gaugePoint(value: number, radius: number): [number, number] {
	const angle = Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
	return [180 + radius * Math.cos(angle), 176 - radius * Math.sin(angle)];
}

function arcPath(start: number, end: number, radius: number): string {
	const [sx, sy] = gaugePoint(start, radius);
	const [ex, ey] = gaugePoint(end, radius);
	const largeArc = end - start > 50 ? 1 : 0;
	return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

export function StressGauge({ gauge }: { gauge: OverviewGauge }) {
	const bands = [
		[0, 25],
		[25, 50],
		[50, 65],
		[65, 85],
		[85, 100],
	];
	const [nx, ny] = gaugePoint(gauge.value, 92);
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="flex items-baseline justify-between gap-3">
				<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
					Market stress
				</span>
				<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
					0 panic · 100 greed
				</span>
			</div>
			<svg viewBox="0 0 360 210" className="mx-auto mt-1 h-[210px] w-full max-w-[420px]" role="img" aria-label="Market stress gauge">
				{bands.map(([start, end], index) => (
					<path
						key={index}
						d={arcPath(start, end, 120)}
						fill="none"
						stroke={BAND_COLORS[index]}
						strokeWidth={18}
						strokeLinecap="butt"
						opacity={0.9}
					/>
				))}
				{[0, 25, 50, 65, 85, 100].map((tick) => {
					const [x, y] = gaugePoint(tick, 103);
					return (
						<text
							key={tick}
							x={x}
							y={y}
							textAnchor="middle"
							fill="var(--text-ghost)"
							fontSize={8}
							fontFamily="ui-monospace, Menlo, Consolas, monospace"
						>
							{tick}
						</text>
					);
				})}
				<line x1={180} y1={176} x2={nx} y2={ny} stroke="var(--text)" strokeWidth={2} />
				<circle cx={180} cy={176} r={4} fill="var(--text)" />
				<text
					x={180}
					y={204}
					textAnchor="middle"
					fill="var(--text)"
					fontSize={22}
					fontWeight={700}
					fontFamily="ui-monospace, Menlo, Consolas, monospace"
				>
					{gauge.value.toFixed(1)}
				</text>
				<text
					x={180}
					y={188}
					textAnchor="middle"
					fill="var(--text-faint)"
					fontSize={10}
					fontFamily="ui-monospace, Menlo, Consolas, monospace"
				>
					{gauge.band_label}
				</text>
			</svg>
			<p className="mt-1 text-[11px] leading-relaxed text-[var(--text-faint)]">{gauge.note}</p>
			<div className="mt-3 space-y-1.5">
				{gauge.components.map((component) => (
					<ComponentRow key={component.key} component={component} />
				))}
			</div>
		</div>
	);
}

function ComponentRow({ component }: { component: GaugeComponent }) {
	const tone =
		component.greed_direction === "up"
			? component.score >= 50
				? "var(--up)"
				: "var(--down)"
			: component.score >= 50
				? "var(--up)"
				: "var(--down)";
	return (
		<div>
			<div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
				<span className="text-[var(--text-faint)]">{component.label}</span>
				<span className="tabular text-[var(--text-dim)]">{formatRaw(component)}</span>
			</div>
			<div className="mt-0.5 h-1 bg-[var(--panel-3)]">
				<div className="h-full" style={{ width: component.score + "%", background: tone }} />
			</div>
		</div>
	);
}

function formatRaw(component: GaugeComponent): string {
	if (Array.isArray(component.raw)) return component.raw[0] + " H / " + component.raw[1] + " L";
	if (component.raw == null) return "—";
	if (component.unit === "%") return fmtPct(component.raw);
	return component.raw.toFixed(1) + " " + component.unit;
}

/* ── rotation map ──────────────────────────────────────────────────────── */

export function RotationMap({
	block,
	title,
	showLabels = true,
	height = 360,
}: {
	block: RotationBlock;
	title: string;
	showLabels?: boolean;
	height?: number;
}) {
	if (!block.available || block.points.length === 0) {
		return (
			<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
				<div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
					{title}
				</div>
				<p className="mt-2 text-[12px] text-[var(--text-faint)]">
					{block.reason ?? "Not enough weekly history for this grouping."}
				</p>
			</div>
		);
	}

	const points = block.points;
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(100, ...xs) - 2;
	const maxX = Math.max(100, ...xs) + 2;
	const minY = Math.min(100, ...ys) - 2;
	const maxY = Math.max(100, ...ys) + 2;
	const width = 560;
	const pad = 28;
	const plotW = width - pad * 2;
	const plotH = height - pad * 2;
	const sx = (value: number) => pad + ((value - minX) / (maxX - minX || 1)) * plotW;
	const sy = (value: number) => pad + ((maxY - value) / (maxY - minY || 1)) * plotH;
	const zeroX = sx(100);
	const zeroY = sy(100);

	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
					{title}
				</span>
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					{points.length} groups · weekly
				</span>
			</div>
			<svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
				<rect x={pad} y={pad} width={Math.max(0, zeroX - pad)} height={Math.max(0, zeroY - pad)} fill="var(--blue)" opacity="0.06" />
				<rect x={zeroX} y={pad} width={Math.max(0, width - pad - zeroX)} height={Math.max(0, zeroY - pad)} fill="var(--up)" opacity="0.07" />
				<rect x={pad} y={zeroY} width={Math.max(0, zeroX - pad)} height={Math.max(0, height - pad - zeroY)} fill="var(--down)" opacity="0.06" />
				<rect x={zeroX} y={zeroY} width={Math.max(0, width - pad - zeroX)} height={Math.max(0, height - pad - zeroY)} fill="var(--gold)" opacity="0.07" />
				<line x1={zeroX} y1={pad} x2={zeroX} y2={height - pad} stroke="var(--border-strong)" strokeWidth={1} />
				<line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="var(--border-strong)" strokeWidth={1} />
				<text x={pad + 4} y={pad + 12} fill="var(--blue)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">IMPROVING</text>
				<text x={width - pad - 60} y={pad + 12} fill="var(--up)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">LEADING</text>
				<text x={pad + 4} y={height - pad - 4} fill="var(--down)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">LAGGING</text>
				<text x={width - pad - 64} y={height - pad - 4} fill="var(--gold)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">WEAKENING</text>

				{points.map((point) => (
					<Tail key={"tail-" + point.group} point={point} sx={sx} sy={sy} />
				))}
				{points.map((point) => {
					const color = QUADRANT[point.quadrant].color;
					return (
						<g key={point.group}>
							<circle cx={sx(point.x)} cy={sy(point.y)} r={3.4} fill={color} opacity={0.9}>
								<title>{point.group + " · " + point.x.toFixed(1) + " / " + point.y.toFixed(1) + " · " + QUADRANT[point.quadrant].label}</title>
							</circle>
							{showLabels && (
								<text
									x={sx(point.x) + 5}
									y={sy(point.y) + 3}
									fill="var(--text-dim)"
									fontSize={8.5}
									fontFamily="ui-monospace, Menlo, Consolas, monospace"
								>
									{point.group.length > 22 ? point.group.slice(0, 21) + "…" : point.group}
								</text>
							)}
						</g>
					);
				})}
				<text x={width / 2} y={height - 4} textAnchor="middle" fill="var(--text-ghost)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">
					RS-Ratio
				</text>
				<text x={10} y={height / 2} textAnchor="middle" transform={`rotate(-90 10 ${height / 2})`} fill="var(--text-ghost)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">
					RS-Momentum
				</text>
			</svg>
		</div>
	);
}

function Tail({
	point,
	sx,
	sy,
}: {
	point: RotationPoint;
	sx: (value: number) => number;
	sy: (value: number) => number;
}) {
	if (!point.tail.length) return null;
	const path = point.tail
		.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`)
		.join(" ");
	return <path d={path} fill="none" stroke={QUADRANT[point.quadrant].color} strokeWidth={1} opacity={0.22} />;
}

/* ── table ─────────────────────────────────────────────────────────────── */

export function TopBottomList({
	rows,
	title,
	limit = 8,
}: {
	rows: RotationGroup[];
	title: string;
	limit?: number;
}) {
	const ordered = [...rows]
		.filter((row) => row.change_pct != null)
		.sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
	const top = ordered.slice(0, limit);
	const bottom = ordered.slice(-limit).reverse();
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<MoverList title={title + " · strongest"} rows={top} />
			<MoverList title={title + " · weakest"} rows={bottom} />
		</div>
	);
}

function MoverList({ title, rows }: { title: string; rows: RotationGroup[] }) {
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)]">
			<div className="border-b border-[var(--border)] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
				{title}
			</div>
			<ul>
				{rows.map((row) => (
					<li key={row.group} className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] px-3 py-1.5 last:border-b-0">
						<span className="truncate font-mono text-[11px] text-[var(--text-dim)]">{row.group}</span>
						<span className="tabular font-mono text-[11px]" style={{ color: (row.change_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
							{fmtPct(row.change_pct)}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export function RotationTable({
	rows,
	limit,
}: {
	rows: RotationGroup[];
	limit?: number;
}) {
	const ordered = [...rows].sort((a, b) => {
		const ai = QUADRANT_ORDER.indexOf(a.quadrant);
		const bi = QUADRANT_ORDER.indexOf(b.quadrant);
		return ai - bi || (b.change_pct ?? -999) - (a.change_pct ?? -999);
	});
	const shown = limit ? ordered.slice(0, limit) : ordered;
	return (
		<div className="max-h-[430px] overflow-auto border border-[var(--border)] bg-[var(--panel)]">
			<table className="w-full border-collapse text-left">
				<thead className="sticky top-0 bg-[var(--panel-2)] font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
					<tr>
						<th className="px-3 py-2">Group</th>
						<th className="px-2 py-2">Quadrant</th>
						<th className="px-2 py-2 text-right">Hari ini</th>
						<th className="px-2 py-2 text-right">#</th>
					</tr>
				</thead>
				<tbody className="font-mono text-[11px]">
					{shown.map((row) => (
						<tr key={row.group} className="border-t border-[var(--border)]">
							<td className="max-w-[190px] truncate px-3 py-1.5 text-[var(--text-dim)]">{row.group}</td>
							<td className="px-2 py-1.5">
								<span
									className="rounded-sm px-1 py-0.5 text-[9px] uppercase tracking-[0.08em]"
									style={{
										color: QUADRANT[row.quadrant].color,
										background: "color-mix(in srgb, currentColor 10%, transparent)",
									}}
								>
									{QUADRANT[row.quadrant].label}
								</span>
							</td>
							<td className="px-2 py-1.5 text-right">
								<span style={{ color: (row.change_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
									{fmtPct(row.change_pct)}
								</span>
							</td>
							<td className="px-2 py-1.5 text-right text-[var(--text-ghost)]">{row.members}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
