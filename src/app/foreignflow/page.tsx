"use client";

import { useState } from "react";
import { api, fmtNum, fmtPct } from "@/lib/api";
import Shell from "@/components/Shell";
import { SectionHeader, Skeleton } from "@/components/ui";
import { usePolling } from "@/lib/usePolling";

/* ── Types (copied from pilot/src/lib/api.ts) ────────────────────────────── */

export interface IntelForeignRow {
	broker: string;
	side: "buy" | "sell";
	type: string;
	lots: number;
	value_idr: number;
	avg_price: number;
}

export interface ForeignFlow {
	ticker: string;
	available: boolean;
	error?: string;
	as_of?: string;
	price?: number;
	net_foreign_lots?: number;
	net_foreign_idr?: number;
	foreign_buy_lots?: number;
	foreign_sell_lots?: number;
	foreign_buy_idr?: number;
	foreign_sell_idr?: number;
	total_volume?: number;
	broker_count?: number;
	rows?: IntelForeignRow[];
}

export interface ForeignFlowUniverse {
	available: boolean;
	error?: string;
	count?: number;
	as_of?: string;
	rows?: {
		ticker: string;
		name: string;
		sector: string;
		price: number;
		change_percent: number;
		net_foreign_idr: number;
		net_foreign_lots: number;
		foreign_buy_lots: number;
		foreign_sell_lots: number;
		foreign_buy_idr: number;
		foreign_sell_idr: number;
		volume?: number;
	}[];
}

type FlowRow = NonNullable<ForeignFlowUniverse["rows"]>[number];

const POPULAR = [
	"BBCA",
	"BBRI",
	"BMRI",
	"TLKM",
	"ASII",
	"ADRO",
	"ANTM",
	"MDKA",
	"AMMN",
	"GOTO",
];

/** Change % with sign + arrow (pilot PctCell). */
function PctCell({ value }: { value: number | null | undefined }) {
	if (value == null || Number.isNaN(value)) {
		return <span className="tabular font-mono text-[var(--text-faint)]">—</span>;
	}
	const up = value >= 0;
	return (
		<span
			className={`tabular font-mono font-semibold ${up ? "text-[var(--up)]" : "text-[var(--down)]"}`}
		>
			{up ? "▲ " : "▼ "}
			{fmtPct(value)}
		</span>
	);
}

export default function ForeignFlowPage() {
	const [ticker, setTicker] = useState("BBCA");
	const [showAll, setShowAll] = useState(false);

	const universe = usePolling<ForeignFlowUniverse>(
		() => api.get("/api/intel/foreign/universe"),
		60000,
		"universe",
	);
	const detail = usePolling<ForeignFlow | null>(
		() => api.get(`/api/intel/foreign/${ticker}`),
		60000,
		ticker,
	);

	const unavailable = universe.data && universe.data.available === false;
	const rows = (universe.data?.rows ?? []).filter(
		(r) =>
			typeof r.net_foreign_idr === "number" &&
			typeof r.foreign_buy_lots === "number" &&
			typeof r.foreign_sell_lots === "number",
	);
	// Ranked independently: buyers by gross buy, sellers by gross sell.
	const buySorted = [...rows].sort(
		(a, b) => b.foreign_buy_lots - a.foreign_buy_lots,
	);
	const sellSorted = [...rows].sort(
		(a, b) => b.foreign_sell_lots - a.foreign_sell_lots,
	);
	// Top 10 by default; "See more" reveals the whole board in both tables.
	const PAGE_SIZE = 10;
	const buyRows = showAll ? buySorted : buySorted.slice(0, PAGE_SIZE);
	const sellRows = showAll ? sellSorted : sellSorted.slice(0, PAGE_SIZE);

	return (
		<Shell>
			<SectionHeader
				title="Foreign Flow"
				subtitle="Net foreign per stock and sector — follow where IDX institutional money moves"
			/>

			{unavailable ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						IDX unavailable
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						Foreign flow comes straight from IDX&apos;s official daily summary — no
						token needed. {universe.data?.error ?? "The endpoint did not respond."}{" "}
						The backend retries with browser impersonation; try again shortly.
					</p>
				</div>
			) : universe.loading && !universe.data ? (
				<Skeleton className="h-72" />
			) : (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{showAll
								? `${universe.data?.count ?? rows.length} tickers · IDX daily summary`
								: `Top ${Math.min(PAGE_SIZE, rows.length)} buyers & sellers · click SEE MORE for the full board`}
						</span>
						{universe.data?.as_of ? (
							<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
								SYNC · as of {String(universe.data.as_of).slice(0, 10)}
							</span>
						) : null}
					</div>
					<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
						<FlowTable
							title="▲ Foreign Buy"
							titleClass="text-[var(--up)]"
							note="gross buy lots, highest first"
							rows={buyRows}
							grossLabel="Foreign Buy"
							grossKey="foreign_buy_lots"
							grossIdrKey="foreign_buy_idr"
							grossClass="text-[var(--up)]"
							empty="No foreign buy data yet"
						/>
						<FlowTable
							title="▼ Foreign Sell"
							titleClass="text-[var(--down)]"
							note="gross sell lots, highest first"
							rows={sellRows}
							grossLabel="Foreign Sell"
							grossKey="foreign_sell_lots"
							grossIdrKey="foreign_sell_idr"
							grossClass="text-[var(--down)]"
							empty="No foreign sell data yet"
						/>
					</div>
					{rows.length > PAGE_SIZE && (
						<div className="mt-3 flex justify-center">
							<button
								onClick={() => setShowAll((v) => !v)}
								className="rounded-md bg-[var(--panel-2)] px-4 py-1.5 font-mono text-[11px] text-[var(--text-dim)] transition-colors hover:text-[var(--accent)]"
							>
								{showAll ? "▲ Show less" : "▼ See more"}
							</button>
						</div>
					)}
				</>
			)}

			{/* Per-ticker drill-down */}
			<div className="panel mt-6 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Per-ticker foreign breakdown
					</h2>
					{detail.data?.as_of ? (
						<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
							DET · as of {String(detail.data.as_of).slice(0, 10)}
						</span>
					) : null}
				</div>
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<input
						value={ticker}
						onChange={(e) => setTicker(e.target.value.toUpperCase())}
						onKeyDown={(e) => {
							if (e.key === "Enter" && ticker) void detail.refresh();
						}}
						placeholder="Ticker (e.g. BBCA)"
						className="panel-2 w-36 px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
					/>
					<button
						onClick={() => void detail.refresh()}
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

				{detail.loading && !detail.data ? (
					<Skeleton className="h-40" />
				) : detail.data?.error ? (
					<p className="text-xs text-[var(--down)]">{detail.data.error}</p>
				) : detail.data ? (
					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						<DrillStat
							label="Net Foreign"
							value={
								<span
									className={
										(detail.data.net_foreign_idr ?? 0) >= 0
											? "text-[var(--up)]"
											: "text-[var(--down)]"
									}
								>
									{fmtNum((detail.data.net_foreign_idr ?? 0) / 1e6, 1)} M IDR
								</span>
							}
						/>
						<DrillStat
							label="Net Lots"
							value={fmtNum(detail.data.net_foreign_lots, 0)}
						/>
						<DrillStat
							label="Buy Lots"
							value={
								<span className="text-[var(--up)]">
									{fmtNum(detail.data.foreign_buy_lots, 0)}
								</span>
							}
						/>
						<DrillStat
							label="Sell Lots"
							value={
								<span className="text-[var(--down)]">
									{fmtNum(detail.data.foreign_sell_lots, 0)}
								</span>
							}
						/>
					</div>
				) : null}
			</div>
		</Shell>
	);
}

/* ── Universe table (replaces pilot DataTable + column defs) ─────────────── */

function FlowTable({
	title,
	titleClass,
	note,
	rows,
	grossLabel,
	grossKey,
	grossIdrKey,
	grossClass,
	empty,
}: {
	title: string;
	titleClass: string;
	note: string;
	rows: FlowRow[];
	grossLabel: string;
	grossKey: "foreign_buy_lots" | "foreign_sell_lots";
	grossIdrKey: "foreign_buy_idr" | "foreign_sell_idr";
	grossClass: string;
	empty: string;
}) {
	return (
		<div className="min-w-0">
			<div className="mb-2 flex items-baseline gap-2">
				<h2
					className={`font-mono text-[11px] font-bold uppercase tracking-wider ${titleClass}`}
				>
					{title}
				</h2>
				<span className="font-mono text-[10px] text-[var(--text-faint)]">
					{note}
				</span>
			</div>
			<div className="panel overflow-hidden">
				<table className="w-full">
					<thead>
						<tr className="border-b border-[var(--line)] text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
							<th className="px-2 py-1">Ticker</th>
							<th className="px-2 py-1">Name</th>
							<th className="hidden px-2 py-1 md:table-cell">Sector</th>
							<th className="px-2 py-1 text-right">Price</th>
							<th className="px-2 py-1 text-right">Chg</th>
							<th className="px-2 py-1 text-right">{grossLabel}</th>
							<th className="hidden px-2 py-1 text-right lg:table-cell">
								{grossLabel} (M IDR)
							</th>
							<th className="px-2 py-1 text-right">Net Foreign</th>
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr>
								<td
									colSpan={8}
									className="px-2 py-3 font-mono text-[11px] text-[var(--text-faint)]"
								>
									{empty}
								</td>
							</tr>
						) : (
							rows.map((r) => (
								<tr
									key={r.ticker}
									className="border-b border-[var(--line)]/50 last:border-b-0 hover:bg-[var(--panel-2)]"
								>
									<td className="px-2 py-1.5 font-mono text-[12px] font-bold text-[var(--text)]">
										{r.ticker}
									</td>
									<td className="max-w-[14ch] truncate px-2 py-1.5 text-[12px] text-[var(--text-dim)]">
										{r.name}
									</td>
									<td className="hidden px-2 py-1.5 font-mono text-[11px] text-[var(--text-faint)] md:table-cell">
										{r.sector}
									</td>
									<td className="tabular px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text)]">
										{fmtNum(r.price)}
									</td>
									<td className="px-2 py-1.5 text-right">
										<PctCell value={r.change_percent} />
									</td>
									<td
										className={`tabular px-2 py-1.5 text-right font-mono text-[11px] font-semibold ${grossClass}`}
									>
										{fmtNum(r[grossKey], 0)}
									</td>
									<td className="tabular hidden px-2 py-1.5 text-right font-mono text-[11px] lg:table-cell">
										{fmtNum(r[grossIdrKey] / 1e9, 1)}
									</td>
									<td
										className={`tabular px-2 py-1.5 text-right font-mono text-[11px] font-semibold ${
											r.net_foreign_idr >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
										}`}
									>
										{r.net_foreign_idr >= 0 ? "+" : ""}
										{fmtNum(r.net_foreign_idr / 1e9, 1)} M IDR
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function DrillStat({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div className="panel-2 p-3">
			<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div className="tabular mt-0.5 font-mono text-sm font-bold text-[var(--text)]">
				{value}
			</div>
		</div>
	);
}
