import { useEffect, useMemo, useRef, useState } from "react";
import {
	hierarchy,
	treemap,
	treemapSquarify,
	type HierarchyRectangularNode,
} from "d3-hierarchy";
import { fmtIdr, fmtNum, fmtPct } from "@/lib/api";
import type { HeatmapRow } from "@/lib/api";

/**
 * IDX Heatmap — squarified treemap of the IDX universe.
 *
 * Follows the klinikpenyesalan.com "Market Pulse" idiom exactly:
 *   - tile SIZE = √market cap (squared layout via d3-hierarchy)
 *   - tile COLOR = daily % change clamped to ±6% (neutral -> green/red)
 *   - grouped by SECTOR, click a sector to drill into it (breadcrumb back)
 *   - hover shows a floating group panel (featured ticker + scrollable rows)
 *
 * Scale fit: the full IDX is ~960 names with a ~160,000:1 cap spread. Rendering
 * every microcap shatters the squarify layout into slivers + dead holes
 * (measured coverage collapsed to <40%). Like Finviz/KP we keep cap-weighted
 * sector weight but cluster each sector's smallest names into a single
 * "OTHER ×N" tile, so every rendered tile stays legible (coverage >95%, no
 * sub-pixel tiles).
 *
 * Custom SVG, no chart library — d3-hierarchy is used only for the squarify
 * layout math (~15 KB), matching the reference site's hand-rolled approach.
 */

const NEUTRAL = "#9aa3ab";
const UP = "#2e9e5b";
const DOWN = "#e5484d";
const CLAMP = 6; // percent

// Microcap clustering: per sector, keep the largest names until they cover
// this fraction of the sector's cap, then fold the rest into one OTHER tile
// (bounded by MAX_PER_SECTOR so a single sector can't monopolize the board).
const COVER_TARGET = 0.965;
const MAX_PER_SECTOR = 42;
const MAX_PER_SECTOR_DRILL = 90;

/**
 * Tile-size value for the treemap.
 *
 * Linear market cap gives a ~164,000:1 max/min ratio (BBCA 778T vs a 5B
 * microcap), which squeezes every small cap into an invisible sliver.
 * Sqrt-scaling compresses that to ~400:1 — the standard market-map
 * convention (TradingView, klinikpenyesalan) — so the whole board stays
 * readable while mega-caps still lead.
 */
function tileValue(marketCap: number): number {
	return Math.sqrt(Math.max(1, marketCap));
}

function tileColor(changePct: number | null | undefined): string {
	if (changePct == null || Number.isNaN(changePct)) return NEUTRAL;
	const t = Math.max(-CLAMP, Math.min(CLAMP, changePct)) / CLAMP; // -1..1
	if (t >= 0) {
		// neutral -> green
		const r = Math.round(0x9a + (0x2e - 0x9a) * t);
		const g = Math.round(0xa3 + (0x9e - 0xa3) * t);
		const b = Math.round(0xab + (0x5b - 0xab) * t);
		return `rgb(${r},${g},${b})`;
	}
	const u = -t;
	const r = Math.round(0x9a + (0xe5 - 0x9a) * u);
	const g = Math.round(0xa3 + (0x48 - 0xa3) * u);
	const b = Math.round(0xab + (0x4d - 0xab) * u);
	return `rgb(${r},${g},${b})`;
}

interface HMNode {
	name: string;
	value: number;
	children?: HMNode[];
	row?: HeatmapRow;
}

interface Tile {
	ticker: string;
	name: string;
	marketCap: number;
	price: number;
	changePct: number | null;
	foreignNet: number;
	x: number;
	y: number;
	w: number;
	h: number;
	isOther?: boolean;
}

interface SectorGroup {
	sector: string;
	totalCap: number;
	tiles: Tile[];
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * Build the sector -> stock tree, clustering each sector's smallest names into
 * a synthetic OTHER tile. Sector sizes stay honest — OTHER carries the folded
 * names' summed cap, so the sector's footprint still reflects its full weight.
 */
function buildNodes(
	rows: HeatmapRow[],
	drillSector: string | null,
	maxPerSector: number,
): HMNode[] {
	const sectorMap = new Map<string, HeatmapRow[]>();
	for (const r of rows) {
		if (drillSector && r.sector !== drillSector) continue;
		const list = sectorMap.get(r.sector) ?? [];
		list.push(r);
		sectorMap.set(r.sector, list);
	}
	const out: HMNode[] = [];
	for (const [sector, stocks] of sectorMap) {
		const sorted = [...stocks].sort(
			(a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0),
		);
		const totalCap = sorted.reduce(
			(s, r) => s + Math.max(1, r.market_cap ?? 0),
			0,
		);
		const kept: HeatmapRow[] = [];
		const folded: HeatmapRow[] = [];
		let cum = 0;
		for (let i = 0; i < sorted.length; i++) {
			const r = sorted[i];
			const cap = Math.max(1, r.market_cap ?? 0);
			if (cum < COVER_TARGET * totalCap && kept.length < maxPerSector) {
				kept.push(r);
				cum += cap;
			} else {
				folded.push(r);
			}
		}
		const children: HMNode[] = kept.map((r) => ({
			name: r.ticker,
			value: tileValue(r.market_cap ?? 0),
			row: r,
		}));
		if (folded.length > 0) {
			const foldCap = folded.reduce(
				(s, r) => s + Math.max(1, r.market_cap ?? 0),
				0,
			);
			const wSum = foldCap;
			const wAvg =
				wSum > 0
					? folded.reduce(
							(s, r) =>
								s + (r.change_pct ?? 0) * Math.max(1, r.market_cap ?? 0),
							0,
						) / wSum
					: null;
			children.push({
				name: `OTHER (${folded.length})`,
				value: tileValue(foldCap),
				row: {
					ticker: "OTHER",
					name: `Others (${folded.length})`,
					sector,
					market_cap: foldCap,
					price: 0,
					change_pct: wAvg,
					listed_shares: folded.reduce((s, r) => s + (r.listed_shares ?? 0), 0),
					volume: folded.reduce((s, r) => s + (r.volume ?? 0), 0),
					value_idr: folded.reduce((s, r) => s + (r.value_idr ?? 0), 0),
					foreign_net: folded.reduce((s, r) => s + (r.foreign_net ?? 0), 0),
				},
			});
		}
		out.push({
			name: sector,
			value: 0, // computed from leaves — never double-count sector totals
			children,
		});
	}
	return out;
}

function layoutSquarify(
	rows: HeatmapRow[],
	width: number,
	height: number,
	drillSector: string | null,
): SectorGroup[] {
	const maxPerSector = drillSector ? MAX_PER_SECTOR_DRILL : MAX_PER_SECTOR;
	const sectors = buildNodes(rows, drillSector, maxPerSector);
	if (sectors.length === 0) return [];

	const root: HierarchyRectangularNode<HMNode> = treemap<HMNode>()
		.size([width, height])
		.paddingInner(1)
		.round(true)
		.tile(treemapSquarify)(
		hierarchy<HMNode>({ name: "root", value: 0, children: sectors }).sum(
			(d) => d.value ?? 0,
		),
	);

	const groups: SectorGroup[] = [];
	for (const secNode of root.children ?? []) {
		const tiles: Tile[] = [];
		let totalCap = 0;
		for (const leaf of secNode.children ?? []) {
			const row = leaf.data.row;
			if (!row) continue;
			const x = leaf.x0;
			const y = leaf.y0;
			const w = Math.max(0, leaf.x1 - leaf.x0);
			const h = Math.max(0, leaf.y1 - leaf.y0);
			if (w < 1 || h < 1) continue; // drop degenerate sub-pixel tiles
			totalCap += Math.max(1, row.market_cap ?? 0);
			tiles.push({
				ticker: row.ticker,
				name: row.name,
				marketCap: row.market_cap ?? 0,
				price: row.price ?? 0,
				changePct: row.change_pct,
				foreignNet: row.foreign_net ?? 0,
				x,
				y,
				w,
				h,
				isOther: row.ticker === "OTHER",
			});
		}
		if (tiles.length === 0) continue;
		const xs = tiles.map((t) => t.x);
		const ys = tiles.map((t) => t.y);
		const xe = tiles.map((t) => t.x + t.w);
		const ye = tiles.map((t) => t.y + t.h);
		groups.push({
			sector: secNode.data.name,
			totalCap,
			tiles,
			minX: Math.min(...xs),
			minY: Math.min(...ys),
			maxX: Math.max(...xe),
			maxY: Math.max(...ye),
		});
	}
	return groups;
}

/** Overlay sector label pill at the group's top-left, without reserving layout. */
function sectorPillText(name: string, maxWidth: number): string {
	const up = name.toUpperCase();
	if (up.length * 5.6 + 12 <= maxWidth) return up;
	// Truncate: "CONSUMER NON-DURABLES" -> "CONSUMER N…" within pill width
	const budget = Math.max(2, Math.floor((maxWidth - 14) / 5.6));
	return up.slice(0, Math.max(1, budget - 1)) + "…";
}

export default function Heatmap({
	rows,
	height = 600,
}: {
	rows: HeatmapRow[];
	height?: number;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(1200);
	const [drill, setDrill] = useState<string | null>(null);
	const [hoverSector, setHoverSector] = useState<string | null>(null);
	const [fullscreen, setFullscreen] = useState(false);

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setWidth(el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Keyboard: Escape exits drill-down.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && drill) setDrill(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [drill]);

	// Layout must use the ACTUAL render height (h), not the non-fullscreen
	// prop, or fullscreen leaves a giant void at the bottom.
	const h = fullscreen ? Math.max(700, window.innerHeight - 160) : height;
	const groups = useMemo(
		() => layoutSquarify(rows, width, h, drill),
		[rows, width, h, drill],
	);
	const hoverTiles = useMemo(() => {
		const g = groups.find((x) => x.sector === hoverSector);
		return g ? [...g.tiles].sort((a, b) => b.marketCap - a.marketCap) : [];
	}, [groups, hoverSector]);

	return (
		<div
			ref={wrapRef}
			className={`relative ${fullscreen ? "fixed inset-4 z-40 overflow-auto bg-[var(--bg)] p-4" : ""}`}
		>
			{/* Toolbar */}
			<div className="mb-2 flex flex-wrap items-center gap-3">
				<span className="mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
					SIZE = √ MARKET CAP
				</span>
				<div className="flex items-center gap-1 font-mono text-[10px] text-[var(--text-faint)]">
					<span>−{CLAMP}%</span>
					<div
						className="h-2 w-36 rounded-sm"
						style={{
							background:
								"linear-gradient(90deg, " +
								DOWN +
								" 0%, " +
								NEUTRAL +
								" 50%, " +
								UP +
								" 100%)",
						}}
					/>
					<span>+{CLAMP}%</span>
				</div>
				{drill ? (
					<button
						onClick={() => setDrill(null)}
						className="rounded-md bg-[var(--panel-2)] px-2 py-1 font-mono text-[10px] text-[var(--accent)] transition-colors hover:text-[var(--text)] active:translate-y-px"
					>
						‹ ALL · {drill.toUpperCase()}
					</button>
				) : (
					<span className="font-mono text-[10px] text-[var(--text-faint)]">
						· CLICK A SECTOR TO ZOOM IN
					</span>
				)}
				<button
					onClick={() => setFullscreen((f) => !f)}
					className="ml-auto rounded-md bg-[var(--panel-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-dim)] transition-colors hover:text-[var(--accent)] active:translate-y-px"
				>
					{fullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN"}
				</button>
			</div>

			{/* Treemap */}
			<svg
				width={width}
				height={h}
				viewBox={`0 0 ${width} ${h}`}
				className="block rounded-md border border-[var(--border)] bg-[var(--bg)]"
			>
				{groups.map((g) => {
					const pillW = Math.min(
						g.sector.length * 5.6 + 12,
						Math.max(0, g.maxX - g.minX - 4),
					);
					const pillText = sectorPillText(
						g.sector,
						Math.max(0, g.maxX - g.minX - 4),
					);
					return (
						<g key={g.sector} onClick={() => !drill && setDrill(g.sector)}>
							{g.tiles.map((t) => {
								// Sector pill owns the group's top-left; suppress the
								// ticker of tiles that would render underneath it.
								const underPill =
									!drill && t.x < g.minX + pillW + 2 && t.y < g.minY + 16;
								// Folded tiles label as OTHERS (compact); widen to "Others (N)"
								// only when the tile is big enough to hold it.
								const baseLabel = t.isOther ? "OTHERS" : t.ticker;
								const labelText =
									t.isOther && t.w >= t.name.length * 6 + 8
										? t.name
										: baseLabel;
								const tickerW = labelText.length * 6 + 8;
								const label =
									!underPill && t.w >= tickerW && t.h >= 14 ? labelText : null;
								return (
									<g
										key={t.ticker}
										onMouseEnter={() => setHoverSector(g.sector)}
										onMouseLeave={() => setHoverSector(null)}
										style={{ cursor: "pointer" }}
									>
										<rect
											x={t.x}
											y={t.y}
											width={t.w}
											height={t.h}
											fill={tileColor(t.changePct)}
											stroke="var(--bg)"
											strokeWidth={1}
											rx={1}
										/>
										{label && (
											<text
												x={t.x + 3}
												y={t.y + 11}
												fontSize={10}
												fontFamily="var(--font-mono)"
												fill="rgba(0,0,0,0.85)"
												fontWeight={700}
											>
												{label}
											</text>
										)}
										{label && t.h >= 28 && t.w >= 40 && (
											<text
												x={t.x + 3}
												y={t.y + 22}
												fontSize={9}
												fontFamily="var(--font-mono)"
												fill="rgba(0,0,0,0.7)"
											>
												{t.changePct != null
													? `${t.changePct > 0 ? "+" : ""}${fmtNum(t.changePct, 2)}%`
													: "—"}
											</text>
										)}
									</g>
								);
							})}
							{/* Sector label pill (overlay, no layout reservation) */}
							{pillText && (
								<g pointerEvents="none">
									<rect
										x={g.minX + 2}
										y={g.minY + 2}
										width={pillW}
										height={14}
										rx={3}
										fill="rgba(8,12,18,0.72)"
									/>
									<text
										x={g.minX + 8}
										y={g.minY + 12}
										fontSize={9}
										fontFamily="var(--font-mono)"
										fill="rgba(255,255,255,0.92)"
										fontWeight={700}
										letterSpacing="0.04em"
									>
										{pillText}
									</text>
								</g>
							)}
						</g>
					);
				})}
			</svg>

			{/* Hover group panel */}
			{hoverSector && (
				<div className="pointer-events-none absolute left-4 top-14 z-10 w-72 rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 shadow-[var(--elev-hi)]">
					<div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
						{hoverSector}
					</div>
					{hoverTiles.slice(0, 1).map((t) => (
						<div
							key={t.ticker}
							className="mb-2 rounded-md bg-[var(--panel-2)] p-2"
						>
							<div className="flex items-baseline justify-between">
								<span className="font-mono text-xs font-bold text-[var(--text)]">
									{t.ticker}
								</span>
								<span
									className={`mono text-xs font-semibold ${(t.changePct ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
								>
									{(t.changePct ?? 0) >= 0 ? "▲ " : "▼ "}
									{fmtPct(t.changePct)}
								</span>
							</div>
							<div className="mono text-[10px] text-[var(--text-faint)]">
								{t.name.slice(0, 34)} · MKT CAP {fmtIdr(t.marketCap, true)}
							</div>
						</div>
					))}
					<div className="max-h-48 space-y-0.5 overflow-y-auto">
						{hoverTiles.slice(1, 15).map((t) => (
							<div
								key={t.ticker}
								className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] pb-0.5 last:border-b-0"
							>
								<span className="mono text-[10px] text-[var(--text)]">
									{t.ticker}
								</span>
								<span className="mono text-[10px] text-[var(--text-faint)]">
									{fmtNum(t.price)}
								</span>
								<span
									className={`mono text-[10px] font-semibold ${(t.changePct ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
								>
									{fmtPct(t.changePct)}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
