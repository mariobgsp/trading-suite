/**
 * The daily market dashboard's visual vocabulary.
 *
 * Everything is SVG or plain markup: the screen has one gauge and three
 * quadrant maps, and adding a charting dependency for that would be heavier
 * than the feature. The colours come from the existing token set.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChangeBadge } from "@/components/ui";
import { fmtNum, fmtPct } from "@/lib/api";
import { marketApi, type SectorMembers } from "@/lib/api/market";
import type {
	BenchmarkTail,
	ContributionRow,
	GaugeComponent,
	IndexContribution,
	IndexQuote,
	MoverRow,
	MoversBlock,
	SectorDayBlock,
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

// ── IHSG hero ────────────────────────────────────────────────────────────

export function IhsgHero({
	market,
	tail,
	indices,
}: {
	market: OverviewMarket;
	tail?: BenchmarkTail;
	indices?: IndexQuote[];
}) {
	const ihsg = market.ihsg;
	const above100 =
		ihsg.close != null && ihsg.ma100 != null ? ihsg.close > ihsg.ma100 : null;
	const secondaries = (indices ?? [])
		.filter((row) => row.name && row.name !== "IHSG")
		.slice(0, 3);

	return (
		<div className="border border-[var(--border)] bg-[var(--panel)]">
			<div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
				<div className="border-b border-[var(--border)] p-5 lg:border-b-0 lg:border-r">
					<div className="flex items-baseline justify-between gap-3">
						<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							IHSG · {market.as_of ?? tail?.as_of ?? "—"}
						</span>
						<ChangeBadge value={ihsg.change_pct} />
					</div>
					<div className="tabular mt-1 font-display text-[46px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
						{fmtNum(ihsg.close, 2)}
					</div>
					<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--text-dim)]">
						<Chip label="MA50" value={fmtNum(ihsg.ma50, 0)} />
						<Chip label="MA100" value={fmtNum(ihsg.ma100, 0)} />
						<Chip
							label="vs MA100"
							value={fmtPct(ihsg.momentum_vs_ma100_pct)}
							tone={
								ihsg.momentum_vs_ma100_pct == null
									? undefined
									: ihsg.momentum_vs_ma100_pct >= 0
										? "up"
										: "down"
							}
						/>
						<Chip
							label="di atas MA100"
							value={above100 == null ? "—" : above100 ? "ya" : "tidak"}
							tone={above100 == null ? undefined : above100 ? "up" : "down"}
						/>
						<Chip label="Vol 20d" value={fmtPct(ihsg.volatility_20d_pct)} />
					</div>
				</div>
				<div className="p-4">
					<Sparkline tail={tail} changePct={ihsg.change_pct} />
					{secondaries.length > 0 && (
						<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2 font-mono text-[10px]">
							{secondaries.map((row) => (
								<span key={row.name} className="flex items-baseline gap-1.5">
									<span className="text-[var(--text-ghost)]">{row.name}</span>
									<span className="tabular text-[var(--text-dim)]">
										{fmtNum(row.close, 0)}
									</span>
									<span
										className="tabular"
										style={{
											color:
												(row.change_pct ?? 0) >= 0
													? "var(--up)"
													: "var(--down)",
										}}
									>
										{fmtPct(row.change_pct)}
									</span>
								</span>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function Chip({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "up" | "down";
}) {
	return (
		<span className="flex items-baseline gap-1">
			<span className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
				{label}
			</span>
			<span
				className="tabular"
				style={{
					color: tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : undefined,
				}}
			>
				{value}
			</span>
		</span>
	);
}

function Sparkline({
	tail,
	changePct,
}: {
	tail?: BenchmarkTail;
	changePct: number | null;
}) {
	const points = (tail?.points ?? []).filter((point) => point.close != null);
	const label = tail?.available
		? points.length + " sesi"
		: "riwayat tidak tersedia";
	if (points.length < 2) {
		return (
			<div className="flex h-[72px] items-end">
				<span className="font-mono text-[11px] text-[var(--text-ghost)]">
					{label} — sparkline menunggu riwayat
				</span>
			</div>
		);
	}
	const values = points.map((point) => point.close as number);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const width = 460;
	const height = 64;
	const pad = 3;
	const chartTop = 12;
	const sx = (index: number) => (index / (points.length - 1)) * (width - pad * 2) + pad;
	const sy = (value: number) =>
		height - pad - ((value - min) / (max - min || 1)) * (height - pad * 2 - chartTop);
	const positive = (changePct ?? 0) >= 0;
	const stroke = positive ? "var(--up)" : "var(--down)";
	const line = points
		.map((point, index) => {
			const command = index === 0 ? "M" : "L";
			return command + sx(index).toFixed(1) + " " + sy(point.close as number).toFixed(1);
		})
		.join(" ");
	const lastX = sx(points.length - 1).toFixed(1);
	const lastY = sy(values[values.length - 1]).toFixed(1);
	const area = line + " L" + lastX + " " + (height - pad).toFixed(1) + " L" + pad + " " + (height - pad).toFixed(1) + " Z";
	const minLabel = fmtNum(min, 0);
	const maxLabel = fmtNum(max, 0);

	return (
		<div>
			<div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
				<span>{label}</span>
				<span className="tabular">{minLabel + " – " + maxLabel}</span>
			</div>
			<svg
				viewBox={"0 0 " + width + " " + height}
				className="mt-0.5 h-[64px] w-full"
				role="img"
				aria-label="IHSG sparkline"
			>
				<defs>
					<linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={stroke} stopOpacity={0.16} />
						<stop offset="100%" stopColor={stroke} stopOpacity={0} />
					</linearGradient>
				</defs>
				<path d={area} fill="url(#sparkfill)" stroke="none" />
				<path d={line} fill="none" stroke={stroke} strokeWidth={1.4} />
				<circle cx={lastX} cy={lastY} r={2.4} fill={stroke} />
			</svg>
		</div>
	);
}

// ── breadth ──────────────────────────────────────────────────────────────

export function BreadthBar({ market }: { market: OverviewMarket }) {
	const total = market.up + market.flat + market.down || 1;
	const avgTone = (market.average_change_pct ?? 0) >= 0 ? "up" : "down";
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)]">
			<div className="border-b border-[var(--border)] px-4 py-2.5">
				<div className="flex items-baseline justify-between gap-3">
					<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						Simetri pasar
					</span>
					<span className="font-mono text-[10px] text-[var(--text-ghost)]">
						{market.universe.total} saham
					</span>
				</div>
				<div className="mt-2 flex h-2.5 overflow-hidden rounded-sm bg-[var(--panel-3)]">
					<span style={{ width: (market.up / total) * 100 + "%", background: "var(--up)" }} />
					<span style={{ width: (market.flat / total) * 100 + "%", background: "var(--text-ghost)" }} />
					<span style={{ width: (market.down / total) * 100 + "%", background: "var(--down)" }} />
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
			<div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
				<Stat label="Saham rata-rata" value={fmtPct(market.average_change_pct)} tone={avgTone} />
				<Stat label="Naik ≥5%" value={String(market.up5)} tone="up" />
				<Stat label="Turun ≥5%" value={String(market.down5)} tone="down" />
				<Stat label="Di atas MA50" value={fmtPct(market.above_ma50_pct)} />
			</div>
			<p className="border-t border-[var(--border)] px-4 py-2 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
				Dekat high 52W {market.near_52w_high} · dekat low 52W {market.near_52w_low} pada{" "}
				{market.universe.with_52w} saham berriwayat. Simetri menjelaskan hari, bukan bulan.
			</p>
		</div>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "up" | "down";
}) {
	return (
		<div className="bg-[var(--panel)] px-3 py-2">
			<div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
				{label}
			</div>
			<div
				className="tabular mt-0.5 font-mono text-[14px] font-semibold"
				style={{
					color: tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text)",
				}}
			>
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
	onPickGroup,
	activeGroup,
}: {
	block: RotationBlock;
	title: string;
	showLabels?: boolean;
	height?: number;
	onPickGroup?: (group: string) => void;
	activeGroup?: string | null;
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
	const clickable = typeof onPickGroup === "function";

	// Labels collide into a smear once groups cluster within a few pixels.
	// Two-tier plan: try the named label first (obstacles include every dot,
	// not just other labels); when no free spot exists around the dot, fall
	// back to a number chip that matches the rotation table's row number.
	const labels: { x: number; y: number; text: string; group: string; active: boolean }[] = [];
	const chips: { x: number; y: number; n: number; group: string; color: string; active: boolean }[] = [];
	if (showLabels || clickable) {
		const charW = 5.0;
		const lineH = 9.5;
		const dotR = 5.5;
		const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
		// numbering mirrors RotationTable ordering: quadrant first, then day
		// change within the quadrant, so map chip N equals table row N.
		const numbering = new Map<string, number>();
		[...block.groups]
			.sort((a, b) => {
				const q = QUADRANT_ORDER;
				return q.indexOf(a.quadrant) - q.indexOf(b.quadrant) || (b.change_pct ?? -999) - (a.change_pct ?? -999);
			})
			.forEach((g, i) => numbering.set(g.group, i + 1));
		const fits = (box: { x0: number; x1: number; y0: number; y1: number }) =>
			box.x0 >= 2 && box.x1 <= width - 2 && box.y0 >= pad - 4 && box.y1 <= height - 2 &&
			!boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
		const ordered = [...points].sort((a, b) => sx(b.x) - sx(a.x) || sy(a.y) - sy(b.y));
		for (const point of ordered) {
			const cx = sx(point.x);
			const cy = sy(point.y);
			// dots are obstacles for every label, including neighbours
			boxes.push({ x0: cx - dotR, x1: cx + dotR, y0: cy - dotR, y1: cy + dotR });
		}
		for (const point of ordered) {
			const text = point.group.length > 22 ? point.group.slice(0, 21) + "…" : point.group;
			const w = text.length * charW + 12;
			const cx = sx(point.x);
			const cy = sy(point.y);
			const active = activeGroup === point.group;
			const chipN = numbering.get(point.group) ?? 0;
			const candidates = [
				{ x: cx + 8, y: cy + 3.5 },
				{ x: cx + 8, y: cy - 5.5 },
				{ x: cx - w - 8, y: cy + 3.5 },
				{ x: cx - w - 8, y: cy - 5.5 },
				{ x: cx + 26, y: cy + 3.5 },
				{ x: cx + 26, y: cy - 5.5 },
				{ x: cx + 8, y: cy + 14 },
				{ x: cx + 8, y: cy - 16.5 },
				{ x: cx - w - 26, y: cy + 3.5 },
				{ x: cx - w - 26, y: cy - 5.5 },
			];
			let placedName = false;
			for (const candidate of candidates) {
				const box = { x0: candidate.x, x1: candidate.x + w, y0: candidate.y - lineH + 2, y1: candidate.y + 3 };
				if (fits(box)) {
					boxes.push(box);
					labels.push({ x: candidate.x, y: candidate.y, text, group: point.group, active });
					placedName = true;
					break;
				}
			}
			if (!placedName) {
				// number chip 12x12 beside the dot, four tiny spots, last-ditch
				// offset further right when all four collide with something
				const chipW = 11;
				const chipH = 9.5;
				const spots = [
					{ x: cx + 7, y: cy - chipH / 2 },
					{ x: cx - 7 - chipW, y: cy - chipH / 2 },
					{ x: cx - chipW / 2, y: cy - 6.5 - chipH },
					{ x: cx - chipW / 2, y: cy + 6.5 },
					{ x: cx + 20, y: cy - chipH / 2 },
				];
				boxes.push({ x0: cx - dotR, x1: cx + dotR, y0: cy - dotR, y1: cy + dotR });
				let placed = false;
				for (const spot of spots) {
					const box = { x0: spot.x, x1: spot.x + chipW, y0: spot.y, y1: spot.y + chipH };
					if (fits(box)) {
						boxes.push(box);
						chips.push({ x: spot.x + chipW / 2, y: spot.y + chipH - 2.2, n: chipN, group: point.group, color: QUADRANT[point.quadrant].color, active });
						placed = true;
						break;
					}
				}
				if (!placed) {
					chips.push({ x: cx + 20, y: cy + 2.6, n: chipN, group: point.group, color: QUADRANT[point.quadrant].color, active });
				}
			}
		}
	}


	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
					{title}
				</span>
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					{points.length} groups · weekly{clickable ? " · klik titik untuk isinya" : ""}
				</span>
			</div>
			<svg viewBox={"0 0 " + width + " " + height} className="h-auto w-full" role="img" aria-label={title}>
				<rect x={pad} y={pad} width={Math.max(0, zeroX - pad)} height={Math.max(0, zeroY - pad)} fill="var(--blue)" opacity="0.05" />
				<rect x={zeroX} y={pad} width={Math.max(0, width - pad - zeroX)} height={Math.max(0, zeroY - pad)} fill="var(--up)" opacity="0.06" />
				<rect x={pad} y={zeroY} width={Math.max(0, zeroX - pad)} height={Math.max(0, height - pad - zeroY)} fill="var(--down)" opacity="0.05" />
				<rect x={zeroX} y={zeroY} width={Math.max(0, width - pad - zeroX)} height={Math.max(0, height - pad - zeroY)} fill="var(--gold)" opacity="0.06" />
				<line x1={zeroX} y1={pad} x2={zeroX} y2={height - pad} stroke="var(--border-strong)" strokeWidth={1} />
				<line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="var(--border-strong)" strokeWidth={1} />
				<text x={pad + 4} y={pad + 12} fill="var(--blue)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">IMPROVING</text>
				<text x={width - pad - 60} y={pad + 12} fill="var(--up)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">LEADING</text>
				<text x={pad + 4} y={height - pad - 4} fill="var(--down)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">LAGGING</text>
				<text x={width - pad - 64} y={height - pad - 4} fill="var(--gold)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">WEAKENING</text>

				{points.map((point) => (
					<Tail key={"tail-" + point.group} point={point} sx={sx} sy={sy} />
				))}
				{chips.map((chip) => (
					<g key={"chip-" + chip.group}
						className="cursor-pointer"
						onClick={clickable ? () => onPickGroup?.(chip.group) : undefined}
					>
						<circle cx={chip.x} cy={chip.y} r={5} fill={chip.active ? "var(--text)" : "var(--panel)"} stroke={chip.active ? "var(--text)" : chip.color} strokeWidth={0.8} />
						<text x={chip.x} y={chip.y + 2.4} textAnchor="middle" fontSize={7} fontWeight={700} fontFamily="ui-monospace, Menlo, Consolas, monospace" fill={chip.active ? "var(--accent-fg)" : chip.color}>{chip.n}</text>
					</g>
				))}
				{points.map((point) => {
					const color = QUADRANT[point.quadrant].color;
					const px = sx(point.x);
					const py = sy(point.y);
					const isActive = activeGroup === point.group;
					return (
						<g
							key={point.group}
							onClick={clickable ? () => onPickGroup?.(point.group) : undefined}
							className={clickable ? "cursor-pointer" : undefined}
						>
							<circle cx={px} cy={py} r={isActive ? 5.4 : 3.4} fill={color} opacity={0.92}>
								<title>{point.group + " · " + point.x.toFixed(1) + " / " + point.y.toFixed(1) + " · " + QUADRANT[point.quadrant].label}</title>
							</circle>
							<circle cx={px} cy={py} r={9} fill="transparent" />
						</g>
					);
				})}
				{labels.map((label) => (
					<text
						key={"lbl-" + label.group}
						x={label.x}
						y={label.y}
						fill={label.active ? "var(--text)" : "var(--text-dim)"}
						fontSize={8.5}
						fontWeight={label.active ? 700 : 400}
						fontFamily="ui-monospace, Menlo, Consolas, monospace"
					>
						{label.text}
					</text>
				))}
				<text x={width / 2} y={height - 4} textAnchor="middle" fill="var(--text-ghost)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">
					RS-Ratio
				</text>
				<text x={10} y={height / 2} textAnchor="middle" transform={"rotate(-90 10 " + height / 2 + ")"} fill="var(--text-ghost)" fontSize={9} fontFamily="ui-monospace, Menlo, Consolas, monospace">
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
	// The map's fallback number chips use this exact ordering, so chip N on
	// the map is always row N here.
	const numbering = new Map(ordered.map((row, i) => [row.group, i + 1]));
	const shown = limit ? ordered.slice(0, limit) : ordered;
	return (
		<div className="max-h-[430px] overflow-auto border border-[var(--border)] bg-[var(--panel)]">
			<table className="w-full border-collapse text-left">
				<thead className="sticky top-0 bg-[var(--panel-2)] font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
					<tr>
						<th className="px-2 py-2">№</th><th className="px-3 py-2">Group</th>
						<th className="px-2 py-2">Quadrant</th>
						<th className="px-2 py-2 text-right">Hari ini</th>
						<th className="px-2 py-2 text-right">#</th>
					</tr>
				</thead>
				<tbody className="font-mono text-[11px]">
					{shown.map((row) => (
						<tr key={row.group} className="border-t border-[var(--border)]">
							<td className="px-2 py-1.5 text-center text-[var(--text-faint)]">{numbering.get(row.group)}</td><td className="max-w-[190px] truncate px-3 py-1.5 text-[var(--text-dim)]">{row.group}</td>
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

// ── movers: gainers / losers / most active ───────────────────────────────

function idrShort(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return "—";
	if (value >= 1e12) return "Rp " + (value / 1e12).toFixed(2) + " T";
	if (value >= 1e9) return "Rp " + (value / 1e9).toFixed(1) + " M";
	if (value >= 1e6) return "Rp " + (value / 1e6).toFixed(1) + " Jt";
	return "Rp " + Math.round(value).toLocaleString("id-ID");
}

export function MoversPanel({ movers }: { movers?: MoversBlock }) {
	if (!movers) {
		return (
			<div className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[12px] text-[var(--text-faint)]">
				Movers dirangkum saat snapshot v2 dibangun; section ini hadir setelahnya.
			</div>
		);
	}
	if (!movers.available) {
		return (
			<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
				<p className="font-mono text-[11px] text-[var(--text-faint)]">
					Movers tidak tersedia sekarang ({movers.reason ?? "sumber tidak lengkap"}). Print
					harian muncul ketika pasar telah tutup.
				</p>
			</div>
		);
	}
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<MoverRowList title="Naik paling dalam" rows={movers.gainers} metric="change" />
			<MoverRowList title="Jatuh paling dalam" rows={movers.losers} metric="change" />
			<MoverRowList title="Paling aktif (nilai)" rows={movers.most_active} metric="value" />
			<p className="col-span-full font-mono text-[10px] text-[var(--text-ghost)]">
				{movers.value_note ?? "nilai transaksi = perkiraan harga × volume (lembar)"}. Klik
				sebuah baris untuk membuka Deep Dive saham tersebut.
			</p>
		</div>
	);
}

function MoverRowList({
	title,
	rows,
	metric,
}: {
	title: string;
	rows: MoverRow[];
	metric: "change" | "value";
}) {
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)]">
			<div className="border-b border-[var(--border)] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				{title}
			</div>
			{rows.length === 0 ? (
				<p className="px-3 py-4 font-mono text-[11px] text-[var(--text-ghost)]">
					Tidak ada yang lolos saringan ini hari ini.
				</p>
			) : (
				<ul>
					{rows.map((row) => (
						<li key={row.ticker} className="border-b border-[var(--border)] last:border-b-0">
							<Link
								to={"/deep/" + row.ticker}
								className="flex items-baseline justify-between gap-3 px-3 py-1.5 transition-colors hover:bg-[var(--panel-3)]"
							>
								<span className="flex min-w-0 items-baseline gap-2">
									<span className="font-mono text-[12px] font-semibold text-[var(--text)]">
										{row.ticker}
									</span>
									<span className="truncate font-mono text-[10px] text-[var(--text-ghost)]">
										{row.name}
									</span>
								</span>
								<span className="flex shrink-0 items-baseline gap-2">
									<span className="tabular font-mono text-[11px] text-[var(--text-dim)]">
										{metric === "value" ? idrShort(row.value) : fmtNum(row.price, 0)}
									</span>
									<span
										className="tabular w-[64px] text-right font-mono text-[11px] font-semibold"
										style={{
											color: (row.change_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)",
										}}
									>
										{fmtPct(row.change_pct)}
									</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

// ── index contribution ───────────────────────────────────────────────────

const CONTRIBUTION_RAIL =
	"linear-gradient(90deg, transparent calc(50% - 0.5px), var(--border) calc(50% - 0.5px), var(--border) calc(50% + 0.5px), transparent calc(50% + 0.5px))";

export function ContributionPanel({
	contribution,
	asOf,
}: {
	contribution?: IndexContribution;
	asOf?: string | null;
}) {
	if (!contribution) {
		return (
			<div className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[12px] text-[var(--text-faint)]">
				Penguraian kontribusi mengikuti snapshot v2; tampil setelah build pertama.
			</div>
		);
	}
	if (!contribution.available) {
		return (
			<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
				<p className="font-mono text-[11px] leading-relaxed text-[var(--text-faint)]">
					Penguraian kontribusi tidak tersedia{" "}
					<span className="text-[var(--text-ghost)]">
						({contribution.reason ?? "tanpa data bobot"})
					</span>
					. Menyangkal lebih jujur daripada mengarang bobot.
				</p>
			</div>
		);
	}
	const scale = Math.max(
		0.05,
		Math.max(
			...contribution.top.map((row) => Math.abs(row.contribution_pct ?? 0)),
			...contribution.bottom.map((row) => Math.abs(row.contribution_pct ?? 0)),
		),
	);
	const calibrated = contribution.calibration === "calibrated";
	const calibrationNote =
		contribution.calibration === "no_index_change"
			? "perubahan indeks tidak tersedia"
			: "model terlalu kecil untuk dikalibrasi";
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)]">
			<div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
				<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
					Penggerak IHSG · {asOf ?? "—"} · indeks {fmtPct(contribution.actual_change_pct)}
				</span>
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					{calibrated
						? "faktor kalibrasi ×" + fmtNum(contribution.factor, 3)
						: calibrationNote}
				</span>
			</div>
			<div className="px-4 py-3" style={{ backgroundImage: CONTRIBUTION_RAIL, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" }}>
				{contribution.top.length + contribution.bottom.length === 0 && (
					<p className="py-2 font-mono text-[11px] text-[var(--text-faint)]">
						Indeks tidak bergerak; tidak ada yang menggerakkannya.
					</p>
				)}
				{contribution.top.map((row) => (
					<ContributionRowView key={"up-" + row.ticker} row={row} scale={scale} positive />
				))}
				{contribution.bottom.map((row) => (
					<ContributionRowView
						key={"dn-" + row.ticker}
						row={row}
						scale={scale}
						positive={false}
					/>
				))}
			</div>
			<p className="border-t border-[var(--border)] px-4 py-2 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
				Bobot = kapitalisasi total (proxy, {contribution.n_used} saham); bagian yang tak
				ditampilkan mengikuti skala yang sama. Model Σ {fmtPct(contribution.model_change_pct)}{" "}
				dikalibrasi ke perubahan IHSG {fmtPct(contribution.actual_change_pct)} — bobot IDN
				float-adjusted tidak tersedia di sini, dan UI mengatakannya, bukan menyembunyikannya.
			</p>
		</div>
	);
}

function ContributionRowView({
	row,
	scale,
	positive,
}: {
	row: ContributionRow;
	scale: number;
	positive: boolean;
}) {
	const value = row.contribution_pct ?? 0;
	const half = (Math.abs(value) / scale) * 42;
	const barStyle = positive
		? { left: "50%", width: half + "%", background: "var(--up)" }
		: { right: "50%", width: half + "%", background: "var(--down)" };
	const pp = (value >= 0 ? "+" : "") + (value ?? 0).toFixed(2) + "pp";
	return (
		<Link
			to={"/deep/" + row.ticker}
			className="relative block py-[3px] transition-opacity hover:opacity-80"
		>
			<div className="relative h-[16px]">
				<div className="absolute top-[4px] h-[8px] rounded-[2px]" style={barStyle} />
			</div>
			<div className="pointer-events-none absolute inset-0 flex items-center justify-between px-1">
				<span className="font-mono text-[10px] font-semibold text-[var(--text)]">
					{row.ticker}
					<span className="ml-1.5 font-normal text-[var(--text-ghost)]">
						{fmtNum(row.weight_pct, 1) + "% · " + fmtPct(row.change_pct)}
					</span>
				</span>
				<span
					className="tabular font-mono text-[10px] font-semibold"
					style={{ color: positive ? "var(--up)" : "var(--down)" }}
				>
					{pp}
				</span>
			</div>
		</Link>
	);
}

// ── sector day ───────────────────────────────────────────────────────────

export function SectorDayPanel({
	sectorDay,
	active,
	onPick,
}: {
	sectorDay?: SectorDayBlock;
	active?: { name: string; field: "sector" | "industry" } | null;
	onPick?: (name: string) => void;
}) {
	if (!sectorDay) {
		return (
			<div className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[12px] text-[var(--text-faint)]">
				Tabel sektor harian mengikuti snapshot v2.
			</div>
		);
	}
	if (!sectorDay.available) {
		return (
			<div className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[11px] text-[var(--text-faint)]">
				Perubahan harian per sektor tidak tersedia ({sectorDay.reason ?? "tanpa data"}).
			</div>
		);
	}
	const rows = sectorDay.sectors.slice(0, 12);
	return (
		<div className="overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
			<table className="w-full border-collapse text-left">
				<thead className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
					<tr className="border-b border-[var(--border)]">
						<th className="px-3 py-2">Sektor</th>
						<th className="px-2 py-2 text-right">Rata-rata</th>
						<th className="px-2 py-2 text-center">Naik/Turun</th>
						<th className="px-2 py-2">Penggerak</th>
						<th className="px-2 py-2">Penahan</th>
					</tr>
				</thead>
				<tbody className="font-mono text-[11px]">
					{rows.map((row) => {
						const tone =
							(row.avg_change_pct ?? 0) > 0
								? "var(--up)"
								: (row.avg_change_pct ?? 0) < 0
									? "var(--down)"
									: "var(--text-faint)";
						const isActive = active?.name === row.sector;
						return (
							<tr
								key={row.sector}
								className={
									"cursor-pointer border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--panel-3)] " +
									(isActive ? "bg-[var(--panel-3)]" : "")
								}
								onClick={() => onPick?.(row.sector)}
							>
								<td className="max-w-[220px] truncate px-3 py-1.5 text-[var(--text-dim)]">
									<span className={isActive ? "font-semibold text-[var(--text)]" : undefined}>
										{row.sector}
									</span>
									<span className="ml-2 text-[9px] uppercase tracking-[0.08em] text-[var(--text-ghost)]">
										{row.members} saham · klik
									</span>
								</td>
								<td className="px-2 py-1.5 text-right">
									<span className="tabular" style={{ color: tone }}>
										{fmtPct(row.avg_change_pct)}
									</span>
								</td>
								<td className="whitespace-nowrap px-2 py-1.5 text-center text-[var(--text-faint)]">
									<span style={{ color: "var(--up)" }}>{row.up}</span>
									{" / "}
									<span style={{ color: "var(--down)" }}>{row.down}</span>
									{row.flat > 0 ? <span> / {row.flat}</span> : null}
								</td>
								<td className="px-2 py-1.5">
									{row.best ? (
										<Link to={"/deep/" + row.best.ticker} className="underline-offset-2 hover:underline" onClick={(event) => event.stopPropagation()}>
											<span className="font-semibold text-[var(--text)]">{row.best.ticker}</span>{" "}
											<span style={{ color: "var(--up)" }}>{fmtPct(row.best.change_pct)}</span>
										</Link>
									) : (
										<span className="text-[var(--text-ghost)]">—</span>
									)}
								</td>
								<td className="px-2 py-1.5">
									{row.worst ? (
										<Link to={"/deep/" + row.worst.ticker} className="underline-offset-2 hover:underline" onClick={(event) => event.stopPropagation()}>
											<span className="font-semibold text-[var(--text)]">{row.worst.ticker}</span>{" "}
											<span style={{ color: "var(--down)" }}>{fmtPct(row.worst.change_pct)}</span>
										</Link>
									) : (
										<span className="text-[var(--text-ghost)]">—</span>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

// ── one group's members (expanded on click) ─────────────────────────────

export function SectorMembersView({
	sector,
	field,
}: {
	sector: string;
	field: "sector" | "industry";
}) {
	const [data, setData] = useState<SectorMembers | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		setData(null);
		setError(null);
		marketApi
			.sectorMembers(sector, field, 48)
			.then((next) => alive && setData(next))
			.catch((err: Error) => alive && setError(err.message));
		return () => {
			alive = false;
		};
	}, [sector, field]);

	return (
		<div className="border border-[var(--border)] bg-[var(--panel-2)] p-3">
			{error && (
				<p className="font-mono text-[11px] text-[var(--down)]">
					Isi sektor tidak bisa diambil: {error}
				</p>
			)}
			{!error && !data && (
				<p className="px-1 py-2 font-mono text-[11px] text-[var(--text-faint)]">
					Membuka anggota sektor — satu volley dari scan cache…
				</p>
			)}
			{data && !data.available && (
				<p className="px-1 py-2 font-mono text-[11px] text-[var(--text-faint)]">
					{data.reason ?? "anggota sektor tidak tersedia"} — panel tidak mengarang saham.
				</p>
			)}
			{data && data.available && (
				<>
					<div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-2 font-mono text-[10px] text-[var(--text-ghost)]">
						<span>
							{data.count} saham · {data.up} naik / {data.down} turun{" "}
							{data.flat > 0 ? "/ " + data.flat + " tetap" : ""} · rata-rata{" "}
							<span style={{ color: (data.avg_change_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
								{fmtPct(data.avg_change_pct)}
							</span>
						</span>
						{data.shown < data.count && <span>menampilkan {data.shown} penggerak teratas</span>}
					</div>
					<div className="grid gap-x-4 gap-y-px font-mono text-[11px] sm:grid-cols-2 lg:grid-cols-3">
						{data.members.map((member) => (
							<Link
								key={member.ticker}
								to={"/deep/" + member.ticker}
								className="flex items-baseline justify-between gap-2 border-b border-[var(--border-soft)] px-1 py-1 hover:bg-[var(--panel-3)]"
							>
								<span className="flex min-w-0 items-baseline gap-2">
									<span className="font-semibold text-[var(--text)]">{member.ticker}</span>
									<span className="truncate text-[10px] text-[var(--text-ghost)]">{member.name}</span>
								</span>
								<span className="flex shrink-0 items-baseline gap-2">
									<span className="tabular text-[10px] text-[var(--text-dim)]">{fmtNum(member.price, 0)}</span>
									<span
										className="tabular w-[56px] text-right"
										style={{
											color: (member.change_percent ?? 0) >= 0 ? "var(--up)" : "var(--down)",
										}}
									>
										{fmtPct(member.change_percent)}
									</span>
								</span>
							</Link>
						))}
					</div>
					<p className="px-1 pt-2 font-mono text-[9px] text-[var(--text-ghost)]">
						Sumber: scan TradingView cache 5 menit — urutan menurut perubahan hari ini. Klik
						saham untuk membuka Deep Dive.
					</p>
				</>
			)}
		</div>
	);
}
