import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
} from "d3-force";
import {
	api,
	fmtNum,
	type OwnershipHistory,
	type OwnershipStructure,
} from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import {
	DataTable,
	NumCell,
	StaleChip,
	type Features,
} from "@/components/data-table";

type ShareholderRow = NonNullable<OwnershipStructure["shareholders"]>[number];

const shareholderColumns: ColumnDef<Features, ShareholderRow, unknown>[] = [
	{
		header: "Name",
		accessorKey: "name",
		cell: (c) => (
			<span className="font-semibold text-[var(--text)]">
				{c.getValue() as string}
			</span>
		),
	},
	{
		header: "Category",
		accessorKey: "category",
		cell: (c) => (
			<span className="text-[var(--text-dim)]">{c.getValue() as string}</span>
		),
	},
	{
		header: "Shares",
		accessorKey: "shares",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Holding %",
		accessorKey: "percent",
		meta: { align: "right" },
		cell: (c) => (
			<span className="mono text-[var(--text)]">
				{fmtNum(c.getValue() as number, 2)}%
			</span>
		),
	},
	{
		header: "Controlling",
		accessorKey: "controlling",
		cell: (c) =>
			c.getValue() ? (
				<span className="mono text-[var(--gold)]">CONTROLLING</span>
			) : (
				<span className="mono text-[var(--text-faint)]">—</span>
			),
	},
];

const POPULAR = ["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "ADRO"];

export const Route = createFileRoute("/ownership")({
	component: OwnershipPage,
});

function OwnershipPage() {
	const [ticker, setTicker] = useState("BBCA");
	const data = usePolling<OwnershipStructure | null>(
		() => api.get(`/api/intel/ownership/${ticker}`),
		60000,
		ticker,
	);
	const history = usePolling<OwnershipHistory | null>(
		() => api.get(`/api/intel/ownership/${ticker}/history`),
		60000,
		ticker,
	);

	const unavailable = data.data && data.data.available === false;

	return (
		<div>
			<SectionHeader
				title="Ownership & Disclosures"
				subtitle="Shareholder structure straight from IDX — who controls the float, at what percentage"
			/>

			{/* Ticker selector */}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<input
					value={ticker}
					onChange={(e) => setTicker(e.target.value.toUpperCase())}
					onKeyDown={(e) => {
						if (e.key === "Enter" && ticker) void data.refresh();
					}}
					placeholder="Ticker (e.g. BBCA)"
					className="panel-2 w-36 px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
				/>
				<button
					onClick={() => void data.refresh()}
					className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
				>
					Load
				</button>
				<div className="ml-2 flex flex-wrap gap-1">
					{POPULAR.map((t) => (
						<button
							key={t}
							onClick={() => setTicker(t)}
							className={`panel-2 px-2.5 py-1 font-mono text-[11px] ${
								ticker === t
									? "text-[var(--accent)] ring-1 ring-[var(--accent)]"
									: "text-[var(--text-dim)] hover:text-[var(--accent)]"
							}`}
						>
							{t}
						</button>
					))}
				</div>
			</div>

			{unavailable ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						IDX unavailable
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						{data.data?.error}. The IDX endpoints are behind Cloudflare
						fingerprinting; the backend retries with browser impersonation. Try
						again shortly.
					</p>
				</div>
			) : data.loading && !data.data ? (
				<Skeleton className="h-48" />
			) : data.data?.error ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--down)]">
						Lookup failed
					</div>
					<p className="mt-2 text-sm text-[var(--text-dim)]">
						{data.data.error}
					</p>
				</div>
			) : data.data ? (
				<>
					{/* Company header */}
					<div className="panel mb-4 p-4">
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
								{data.data.name ?? ticker}
							</h2>
							<StaleChip asOf={data.data.as_of} label="IDX" />
						</div>
						{(data.data.sector ||
							data.data.sub_sector ||
							data.data.listing_date) && (
							<div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-[var(--text-faint)]">
								{data.data.sector ? (
									<span>SECTOR {data.data.sector}</span>
								) : null}
								{data.data.sub_sector ? (
									<span>SUB {data.data.sub_sector}</span>
								) : null}
								{data.data.listing_date ? (
									<span>
										LISTED {String(data.data.listing_date).slice(0, 10)}
									</span>
								) : null}
							</div>
						)}
					</div>

					{/* Connection web — company, holders, board, subsidiaries */}
					<OwnershipGraph
						ticker={ticker}
						name={data.data.name ?? ticker}
						shareholders={data.data.shareholders ?? []}
						direktur={data.data.board?.direktur ?? []}
						komisaris={data.data.board?.komisaris ?? []}
						subsidiaries={data.data.subsidiaries ?? []}
					/>

					{/* Shareholders */}
					{data.data.shareholders && data.data.shareholders.length > 0 ? (
						<div className="panel mb-4 p-4">
							<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
								Shareholders · {ticker}
							</h2>
							<DataTable<ShareholderRow>
								columns={shareholderColumns}
								data={data.data.shareholders}
								initialSort={[{ id: "percent", desc: true }]}
								empty="No shareholder data"
							/>
						</div>
					) : (
						<div className="panel mb-4 p-4">
							<p className="text-xs text-[var(--text-faint)]">
								No shareholder data for {ticker}.
							</p>
						</div>
					)}

					{/* Ownership changes — snapshot diff archive */}
					{history.data && history.data.snapshots.length > 0 && (
						<div className="panel mb-4 p-4">
							<div className="mb-3 flex items-baseline justify-between">
								<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
									Ownership changes
								</h2>
								<span className="font-mono text-[10px] text-[var(--text-faint)]">
									{history.data.snapshots.length} snapshot
									{history.data.snapshots.length === 1 ? "" : "s"} archived
								</span>
							</div>
							{history.data.changes ? (
								<div className="space-y-4">
									<ChangeGroup
										title={`Entered · ${history.data.changes.from_date} → ${history.data.changes.to_date}`}
										items={history.data.changes.entered.map((e) => ({
											label: e.name,
											value:
												e.percent != null ? `${fmtNum(e.percent, 2)}%` : "",
											tone: "up" as const,
										}))}
									/>
									<ChangeGroup
										title={`Exited · ${history.data.changes.from_date} → ${history.data.changes.to_date}`}
										items={history.data.changes.exited.map((e) => ({
											label: e.name,
											value:
												e.percent != null ? `${fmtNum(e.percent, 2)}%` : "",
											tone: "down" as const,
										}))}
									/>
									{history.data.changes.changed.length > 0 && (
										<ChangeGroup
											title="Holding % moved"
											items={history.data.changes.changed.map((c) => ({
												label: c.name,
												value: `${fmtNum(c.from, 2)}% → ${fmtNum(c.to, 2)}%`,
												tone:
													(c.delta ?? 0) >= 0
														? ("up" as const)
														: ("down" as const),
											}))}
										/>
									)}
									{history.data.changes.crossed.length > 0 && (
										<div>
											<div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--gold)]">
												Threshold crossed
											</div>
											<ul className="space-y-1">
												{history.data.changes.crossed.map((c, i) => (
													<li
														key={i}
														className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-1 last:border-b-0"
													>
														<span className="text-xs text-[var(--text)]">
															{c.name}
															<span className="ml-2 text-[var(--text-faint)]">
																came {c.dir} the {fmtNum(c.threshold, 0)}% line
															</span>
														</span>
														<span className="mono text-[10px] text-[var(--text-faint)]">
															{fmtNum(c.from, 2)}% → {fmtNum(c.to, 2)}%
														</span>
													</li>
												))}
											</ul>
										</div>
									)}
								</div>
							) : (
								<p className="text-xs text-[var(--text-faint)]">
									Archive started — a second distinct snapshot is needed to show
									changes. It accumulates automatically as fresh ownership data
									loads.
								</p>
							)}
						</div>
					)}

					{/* Board */}
					{data.data.board &&
						(data.data.board.direktur.length > 0 ||
							data.data.board.komisaris.length > 0) && (
							<div className="grid gap-4 lg:grid-cols-2">
								{data.data.board.direktur.length > 0 && (
									<div className="panel p-4">
										<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
											Direktur
										</h2>
										<BoardList rows={data.data.board.direktur} />
									</div>
								)}
								{data.data.board.komisaris.length > 0 && (
									<div className="panel p-4">
										<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
											Komisaris
										</h2>
										<BoardList rows={data.data.board.komisaris} />
									</div>
								)}
							</div>
						)}
				</>
			) : null}

			<div className="panel mt-6 p-4">
				<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Source and limits
				</h2>
				<ul className="space-y-2 text-xs leading-relaxed text-[var(--text-dim)]">
					<li>
						<span className="mr-2 text-[var(--accent)]">•</span>
						Data comes from IDX's{" "}
						<span className="mono">GetCompanyProfilesDetail</span> — the
						issuer-disclosed shareholder snapshot, no auth, refreshed daily by
						IDX.
					</li>
					<li>
						<span className="mr-2 text-[var(--accent)]">•</span>
						Ownership changes come from a per-ticker snapshot archive that
						accumulates automatically as fresh data loads — a second distinct
						snapshot enables entered/exited/changed diffs and threshold watch (5
						/ 25 / 50% lines).
					</li>
					<li>
						<span className="mr-2 text-[var(--accent)]">•</span>
						IDX publishes what issuers disclose; treasury, warkat, and
						institutional buckets appear as reported.
					</li>
				</ul>
			</div>
		</div>
	);
}

function BoardList({ rows }: { rows: { name: string; position: string }[] }) {
	return (
		<ul className="space-y-2">
			{rows.map((r, i) => (
				<li
					key={i}
					className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2 last:border-b-0"
				>
					<span className="text-xs text-[var(--text)]">{r.name}</span>
					<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
						{r.position}
					</span>
				</li>
			))}
		</ul>
	);
}

function ChangeGroup({
	title,
	items,
}: {
	title: string;
	items: { label: string; value: string; tone: "up" | "down" }[];
}) {
	if (items.length === 0) return null;
	return (
		<div>
			<div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{title}
			</div>
			<ul className="space-y-1">
				{items.map((it, i) => (
					<li
						key={i}
						className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-1 last:border-b-0"
					>
						<span className="text-xs text-[var(--text)]">{it.label}</span>
						<span
							className={`mono text-[10px] font-semibold ${
								it.tone === "up" ? "text-[var(--up)]" : "text-[var(--down)]"
							}`}
						>
							{it.value}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/* ── Connection web ───────────────────────────────────────────────────────── */

interface GraphNode {
	id: string;
	label: string;
	sub: string;
	kind: "holder" | "board" | "subsidiary";
	percent: number | null;
}

interface SimNode {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

const GRAPH_W = 760;
const GRAPH_H = 460;
const CENTER = { x: GRAPH_W / 2, y: GRAPH_H / 2 };
const RING_R = 150;

const KIND_COLOR: Record<GraphNode["kind"], string> = {
	holder: "var(--gold)",
	board: "var(--accent)",
	subsidiary: "var(--violet)",
};

/**
 * Connection web for one issuer: company in the center, spokes out to
 * controlling shareholders (gold), board members (accent), and subsidiaries
 * (violet). Radial layout + d3-force physics (per-node idle drift, link
 * tension) with an Obsidian-style animation layer: entrance stagger,
 * hover-neighbor highlight + dim, edge luminance, click-to-focus, 2.5D
 * depth (z-scaled size/opacity/blur + parallax tilt).
 *
 * Crowd handling: subsidiaries are capped (largest SUBS_CAP + an OTHERS
 * fold), satellites are ring-batched (MAX_PER_RING per ring), and captions
 * are gated — in dense graphs only ≥5% holders, the hovered node, and the
 * center keep labels so the whole web stays readable.
 *
 * Physics runs in an effect only (SSR-safe) and is skipped under
 * prefers-reduced-motion; static radial layout is the SSR/fallback render.
 */
function OwnershipGraph({
	ticker,
	name,
	shareholders,
	direktur,
	komisaris,
	subsidiaries,
}: {
	ticker: string;
	name: string;
	shareholders: ShareholderRow[];
	direktur: { name: string; position: string }[];
	komisaris: { name: string; position: string }[];
	subsidiaries: { name: string; percent?: number | null }[];
}) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [focusId, setFocusId] = useState<string | null>(null);
	// 2.5D parallax: mouse position tilts the whole scene slightly; far nodes
	// shift less than near nodes, selling the depth illusion.
	const [tilt, setTilt] = useState({ x: 0, y: 0 });

	// Crowd handling knobs.
	const MAX_PER_RING = 8;
	const RING_STEP = 64;
	const SUBS_CAP = 12;

	const nodes = useMemo<GraphNode[]>(() => {
		const out: GraphNode[] = [];
		// Shareholder names repeat (e.g. several "Masyarakat" buckets); node ids
		// must stay unique or React keys collide and the sim links misresolve.
		const seen = new Map<string, number>();
		const uniq = (key: string) => {
			const n = (seen.get(key) ?? 0) + 1;
			seen.set(key, n);
			return n === 1 ? key : `${key}#${n}`;
		};
		for (const s of shareholders) {
			const pct = typeof s.percent === "number" ? s.percent : null;
			out.push({
				id: uniq(`h:${s.name}`),
				label: s.name,
				sub: pct != null ? `${fmtNum(pct, 2)}%` : s.category,
				kind: "holder",
				percent: pct,
			});
		}
		for (const d of direktur) {
			out.push({
				id: uniq(`d:${d.name}`),
				label: d.name,
				sub: "DIREKTUR · " + (d.position || "").toUpperCase(),
				kind: "board",
				percent: null,
			});
		}
		for (const k of komisaris) {
			out.push({
				id: uniq(`k:${k.name}`),
				label: k.name,
				sub: "KOMISARIS · " + (k.position || "").toUpperCase(),
				kind: "board",
				percent: null,
			});
		}
		// Subsidiaries: keep the largest SUBS_CAP, fold the rest into OTHERS so
		// the left side doesn't turn into a purple blob (TLKM has 69).
		for (const a of [...subsidiaries]
			.sort(
				(x, y) =>
					(typeof (y.percent ?? 0) === "number" ? (y.percent ?? 0) : 0) -
					(typeof (x.percent ?? 0) === "number" ? (x.percent ?? 0) : 0),
			)
			.slice(0, SUBS_CAP)) {
			out.push({
				id: uniq(`s:${a.name}`),
				label: a.name,
				sub:
					typeof a.percent === "number"
						? `SUBSIDIARY · ${fmtNum(a.percent, 1)}%`
						: "SUBSIDIARY",
				kind: "subsidiary",
				percent: typeof a.percent === "number" ? a.percent : null,
			});
		}
		if (subsidiaries.length > SUBS_CAP) {
			out.push({
				id: "s:OTHERS",
				label: `OTHERS (${subsidiaries.length - SUBS_CAP})`,
				sub: "FOLDED SUBSIDIARIES",
				kind: "subsidiary",
				percent: null,
			});
		}
		return out;
	}, [shareholders, direktur, komisaris, subsidiaries]);

	const holders = useMemo(
		() => nodes.filter((n) => n.kind === "holder"),
		[nodes],
	);
	const others = useMemo(
		() => nodes.filter((n) => n.kind !== "holder"),
		[nodes],
	);

	// Ring-batched radial placement: holders arc on the right, board +
	// subsidiaries on the left; each batch of MAX_PER_RING sits on its own
	// ring (RING_R, RING_R+RING_STEP, …). Each satellite gets a stable depth
	// z in [0,1] (0 = far) for the 2.5D effect.
	const layout = useMemo(() => {
		const pos = new Map<string, { x: number; y: number; z: number }>();
		const place = (list: GraphNode[], startAngle: number, endAngle: number) => {
			const n = list.length;
			list.forEach((node, i) => {
				const ring = Math.floor(i / MAX_PER_RING);
				const slot = i % MAX_PER_RING;
				const slotsInRing = Math.min(MAX_PER_RING, n - ring * MAX_PER_RING);
				const t = slotsInRing === 1 ? 0.5 : slot / (slotsInRing - 1);
				const angle = startAngle + t * (endAngle - startAngle);
				const radius = RING_R + ring * RING_STEP;
				// Deterministic per-id depth (stable across renders).
				let h = 0;
				for (const ch of node.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
				const z = 0.15 + ((h % 1000) / 1000) * 0.85;
				pos.set(node.id, {
					x: CENTER.x + Math.cos(angle) * radius,
					y: CENTER.y + Math.sin(angle) * radius,
					z,
				});
			});
		};
		place(holders, -Math.PI * 0.39, Math.PI * 0.39);
		place(others, Math.PI * 0.61, Math.PI * 1.39);
		return pos;
	}, [holders, others]);

	const holderTotal = holders.reduce((s, n) => s + (n.percent ?? 0), 0);

	// d3-force physics: satellites are spring-linked to the center (link
	// distance = radial anchor) with soft repulsion and centering, plus a
	// perpetual jitter so the graph idles with per-node drift like Obsidian.
	// Effect-only (SSR-safe); skipped under prefers-reduced-motion.
	const [physPos, setPhysPos] = useState<Map<
		string,
		{ x: number; y: number; z: number }
	> | null>(null);
	const simRef = useRef<ReturnType<typeof forceSimulation> | null>(null);
	useEffect(() => {
		const reduce =
			typeof window !== "undefined" &&
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		if (reduce) return;
		simRef.current?.stop();
		const simNodes: SimNode[] = nodes.map((n) => {
			const a = layout.get(n.id) ?? CENTER;
			return { id: n.id, x: a.x, y: a.y, vx: 0, vy: 0 };
		});
		const center: SimNode = {
			id: "__center__",
			x: CENTER.x,
			y: CENTER.y,
			vx: 0,
			vy: 0,
		};
		const all = [...simNodes, center];
		const links = nodes.map((n) => {
			const a = layout.get(n.id) ?? CENTER;
			const d = Math.hypot(a.x - CENTER.x, a.y - CENTER.y);
			return { source: center.id, target: n.id, distance: d };
		});
		const sim = forceSimulation(all as never)
			.force(
				"link",
				forceLink(links as never)
					.id((d) => (d as { id: string }).id)
					.distance((l) => (l as unknown as { distance: number }).distance)
					.strength(0.12),
			)
			.force("charge", forceManyBody().strength(-14))
			.force("x", forceX(CENTER.x).strength(0.03))
			.force("y", forceY(CENTER.y).strength(0.03))
			// Perpetual jitter: small random impulses keep the graph idling with
			// visible per-node drift even after the springs reach equilibrium.
			.force("jitter", () => {
				for (const d of all) {
					if (d.id === "__center__") continue;
					d.vx += (Math.random() - 0.5) * 0.16;
					d.vy += (Math.random() - 0.5) * 0.16;
				}
			})
			.velocityDecay(0.85)
			.alpha(0.5)
			.alphaTarget(0.3) // never fully settles — perpetual gentle drift
			.alphaMin(0.05);
		sim.on("tick", () => {
			setPhysPos(
				new Map(
					all.slice(0, -1).map((d) => {
						const a = layout.get(d.id);
						return [d.id, { x: d.x, y: d.y, z: a?.z ?? 0.5 }] as const;
					}),
				),
			);
		});
		simRef.current = sim;
		return () => {
			sim.stop();
			simRef.current = null;
		};
	}, [nodes, layout]);

	// Radial topology: every satellite connects to the center, so the
	// "neighbors" of a hovered/focused node are that node + the center.
	const activeId = hoveredId ?? focusId;
	const highlight = (id: string) =>
		activeId !== null && (id === activeId || id === "__center__");
	const isDimmed = (id: string) => activeId !== null && !highlight(id);
	const dimmedClass = (id: string) => (isDimmed(id) ? "graph-dim" : "");

	const CENTER_ID = "__center__";
	const centerDimmed = activeId !== null;

	// Caption gating: dense graphs drop captions for low-signal nodes so the
	// web stays readable — only big holders (≥5%), the hovered/focused node,
	// and the OTHERS fold keep labels.
	const crowded = nodes.length > 42;
	const captionFor = (n: GraphNode) =>
		!crowded ||
		n.id === activeId ||
		n.id === CENTER_ID ||
		(n.kind === "holder" && (n.percent ?? 0) >= 5) ||
		n.id === "s:OTHERS";

	// Number of rings actually used (for guide circles + canvas height).
	const maxRing = Math.max(
		Math.ceil(holders.length / MAX_PER_RING),
		Math.ceil(others.length / MAX_PER_RING),
	);
	const ringsUsed = Math.max(1, maxRing);
	const viewH = Math.max(
		GRAPH_H,
		CENTER.y + RING_R + (ringsUsed - 1) * RING_STEP + 70,
	);

	return (
		<div className="panel mb-4 p-4">
			<div className="mb-1 flex items-baseline gap-2">
				<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Connection web · {ticker}
				</h2>
				<span className="font-mono text-[10px] text-[var(--text-faint)]">
					{nodes.length} nodes · {holders.length} holders ·{" "}
					{direktur.length + komisaris.length} board · {subsidiaries.length}{" "}
					subsidiaries
				</span>
			</div>
			<div className="mb-3 flex flex-wrap gap-4 font-mono text-[10px] text-[var(--text-faint)]">
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-2 w-2 rounded-full bg-[var(--gold)]" />
					Shareholder
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
					Board
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-2 w-2 rounded-full bg-[var(--violet)]" />
					Subsidiary
				</span>
				{holderTotal > 0 && (
					<span className="text-[var(--text-dim)]">
						Σ disclosed {fmtNum(holderTotal, 1)}%
					</span>
				)}
				{crowded && (
					<span className="text-[var(--gold)]">
						labels gated · hover to reveal
					</span>
				)}
			</div>
			<svg
				viewBox={`0 0 ${GRAPH_W} ${viewH}`}
				className="block w-full"
				role="img"
				aria-label={`Ownership connections for ${name}`}
				onMouseMove={(e) => {
					if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
						return;
					const rect = e.currentTarget.getBoundingClientRect();
					const nx = (e.clientX - rect.left) / rect.width - 0.5;
					const ny = (e.clientY - rect.top) / rect.height - 0.5;
					setTilt({ x: nx * 9, y: ny * 7 });
				}}
				onMouseLeave={() => setTilt({ x: 0, y: 0 })}
			>
				<g
					style={{
						transform: `rotateX(${tilt.y}deg) rotateY(${-tilt.x}deg)`,
						transformOrigin: "50% 50%",
						transition: "transform 0.35s ease-out",
						willChange: "transform",
					}}
				>
					{/* ring guides — one per used ring */}
					{Array.from({ length: ringsUsed }).map((_, ring) => (
						<circle
							key={`ring:${ring}`}
							cx={CENTER.x}
							cy={CENTER.y}
							r={RING_R + ring * RING_STEP}
							fill="none"
							stroke="var(--line)"
							strokeDasharray="3 5"
						/>
					))}
					{/* edges */}
					{nodes.map((n) => {
						const p = (physPos ?? layout).get(n.id);
						if (!p) return null;
						const lit = activeId !== null && n.id === activeId;
						return (
							<line
								key={`e:${n.id}`}
								className={`graph-edge ${dimmedClass(n.id)} ${lit ? "graph-edge-lit" : ""}`}
								x1={CENTER.x}
								y1={CENTER.y}
								x2={p.x}
								y2={p.y}
								stroke={KIND_COLOR[n.kind]}
								strokeWidth={
									n.kind === "holder" && (n.percent ?? 0) >= 5 ? 1.6 : 1
								}
								strokeOpacity={0.28 + p.z * 0.35}
							/>
						);
					})}
					{/* center node */}
					<g
						className={centerDimmed ? "graph-dim" : ""}
						onMouseEnter={() => setHoveredId(CENTER_ID)}
						onMouseLeave={() => setHoveredId(null)}
						onClick={() => setFocusId(focusId === CENTER_ID ? null : CENTER_ID)}
						style={{ cursor: "pointer" }}
					>
						<circle
							cx={CENTER.x}
							cy={CENTER.y}
							r={40}
							fill="var(--panel-2)"
							stroke="var(--border-strong)"
							strokeWidth={1.5}
						/>
						<text
							x={CENTER.x}
							y={CENTER.y - 4}
							textAnchor="middle"
							fontFamily="var(--font-mono)"
							fontSize={13}
							fontWeight={700}
							fill="var(--text)"
						>
							{ticker}
						</text>
						<text
							x={CENTER.x}
							y={CENTER.y + 12}
							textAnchor="middle"
							fontFamily="var(--font-mono)"
							fontSize={8}
							fill="var(--text-faint)"
						>
							{name.length > 26 ? name.slice(0, 25) + "…" : name}
						</text>
					</g>
					{/* satellite nodes — rendered far → near so depth stacks */}
					{[...nodes]
						.sort((a, b) => {
							const za = (physPos ?? layout).get(a.id)?.z ?? 0.5;
							const zb = (physPos ?? layout).get(b.id)?.z ?? 0.5;
							return za - zb;
						})
						.map((n, i) => {
							const p = (physPos ?? layout).get(n.id);
							if (!p) return null;
							// 2.5D: near nodes (z→1) larger/brighter/sharp, far nodes
							// (z→0) smaller/dimmer/blurred. Radius also scales with
							// √holding% so big holders dominate the depth field. In
							// crowded graphs dots shrink so rings stay separated.
							const baseR =
								n.kind === "holder"
									? 8 + Math.sqrt(Math.max(0.5, n.percent ?? 0.5)) * 2.4
									: 7;
							const crowdR = crowded ? 0.78 : 1;
							const r = Math.max(3.2, baseR * crowdR * (0.72 + p.z * 0.55));
							const isBig = n.kind === "holder" && (n.percent ?? 0) >= 5;
							const lit = activeId !== null && n.id === activeId;
							const entryDelay = Math.min(0.4, i * 0.018);
							// Parallax: near nodes shift more with the tilt.
							const px = p.x + (p.z - 0.5) * tilt.x * 3.2;
							const py = p.y + (p.z - 0.5) * tilt.y * 3.2;
							const fillOp = isBig ? 0.55 + p.z * 0.45 : 0.14 + p.z * 0.5;
							const showCaption = captionFor(n);
							return (
								<g
									key={`n:${n.id}`}
									className={`graph-node ${dimmedClass(n.id)} ${lit ? "graph-node-lit" : ""}`}
									style={{ animationDelay: `${entryDelay}s` }}
									onMouseEnter={() => setHoveredId(n.id)}
									onMouseLeave={() => setHoveredId(null)}
									onClick={() => setFocusId(focusId === n.id ? null : n.id)}
								>
									<circle
										cx={px}
										cy={py}
										r={r}
										fill={KIND_COLOR[n.kind]}
										fillOpacity={lit ? 1 : fillOp}
										stroke={KIND_COLOR[n.kind]}
										strokeWidth={isBig ? 1.6 : 1}
										style={{
											filter: lit
												? "none"
												: `blur(${((1 - p.z) * 1.2).toFixed(2)}px)`,
										}}
									/>
									{/* Inside big holder nodes: the holding % (dark-on-gold). */}
									{isBig && n.percent != null && r > 14 && (
										<text
											x={px}
											y={py + 3}
											textAnchor="middle"
											fontFamily="var(--font-mono)"
											fontSize={8.5}
											fontWeight={700}
											fill="#0a0e14"
										>
											{fmtNum(n.percent, 1)}%
										</text>
									)}
									{/* Caption — gated in crowded graphs, always for the
									    hovered/focused node so details are one hover away. */}
									{showCaption && (
										<text
											x={px}
											textAnchor={px < CENTER.x ? "end" : "start"}
											y={py + r + 11}
											fontFamily="var(--font-mono)"
											fontSize={8.5}
											fill={isBig ? "var(--text)" : "var(--text-faint)"}
											fontWeight={isBig ? 700 : 400}
										>
											{n.label.length > 18
												? n.label.slice(0, 17) + "…"
												: n.label}
										</text>
									)}
								</g>
							);
						})}
				</g>
			</svg>
		</div>
	);
}
