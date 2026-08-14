import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
	api,
	fmtNum,
	type ForeignFlow,
	type ForeignFlowUniverse,
} from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import {
	DataTable,
	NumCell,
	PctCell,
	StaleChip,
	type Features,
} from "@/components/data-table";

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

type FlowRow = NonNullable<ForeignFlowUniverse["rows"]>[number];

const universeBuyColumns: ColumnDef<Features, FlowRow, unknown>[] = [
	{
		header: "Ticker",
		accessorKey: "ticker",
		cell: (c) => (
			<span className="mono font-bold text-[var(--text)]">
				{c.getValue() as string}
			</span>
		),
	},
	{
		header: "Name",
		accessorKey: "name",
		cell: (c) => (
			<span className="text-[var(--text-dim)]">{c.getValue() as string}</span>
		),
	},
	{ header: "Sector", accessorKey: "sector" },
	{
		header: "Price",
		accessorKey: "price",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} />,
	},
	{
		header: "Chg",
		accessorKey: "change_percent",
		meta: { align: "right" },
		cell: (c) => <PctCell value={c.getValue() as number} />,
	},
	{
		header: "Foreign Buy",
		accessorKey: "foreign_buy_lots",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return (
				<span className="mono font-semibold text-[var(--up)]">
					{fmtNum(v, 0)}
				</span>
			);
		},
	},
	{
		header: "Buy (M IDR)",
		accessorKey: "foreign_buy_idr",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return <NumCell value={v / 1e9} digits={1} />;
		},
	},
	{
		header: "Net Foreign",
		accessorKey: "net_foreign_idr",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return (
				<span
					className={`mono font-semibold ${v >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
				>
					{v >= 0 ? "+" : ""}
					{fmtNum(v / 1e9, 1)} M IDR
				</span>
			);
		},
	},
];

const universeSellColumns: ColumnDef<Features, FlowRow, unknown>[] = [
	{
		header: "Ticker",
		accessorKey: "ticker",
		cell: (c) => (
			<span className="mono font-bold text-[var(--text)]">
				{c.getValue() as string}
			</span>
		),
	},
	{
		header: "Name",
		accessorKey: "name",
		cell: (c) => (
			<span className="text-[var(--text-dim)]">{c.getValue() as string}</span>
		),
	},
	{ header: "Sector", accessorKey: "sector" },
	{
		header: "Price",
		accessorKey: "price",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} />,
	},
	{
		header: "Chg",
		accessorKey: "change_percent",
		meta: { align: "right" },
		cell: (c) => <PctCell value={c.getValue() as number} />,
	},
	{
		header: "Foreign Sell",
		accessorKey: "foreign_sell_lots",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return (
				<span className="mono font-semibold text-[var(--down)]">
					{fmtNum(v, 0)}
				</span>
			);
		},
	},
	{
		header: "Sell (M IDR)",
		accessorKey: "foreign_sell_idr",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return <NumCell value={v / 1e9} digits={1} />;
		},
	},
	{
		header: "Net Foreign",
		accessorKey: "net_foreign_idr",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return (
				<span
					className={`mono font-semibold ${v >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
				>
					{v >= 0 ? "+" : ""}
					{fmtNum(v / 1e9, 1)} M IDR
				</span>
			);
		},
	},
];

export const Route = createFileRoute("/foreignflow")({
	component: ForeignFlowPage,
});

function ForeignFlowPage() {
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
		<div>
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
						Foreign flow comes straight from IDX's official daily summary — no
						token needed.{" "}
						{universe.data?.error ?? "The endpoint did not respond."} The
						backend retries with browser impersonation; try again shortly.
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
							<StaleChip asOf={universe.data.as_of} label="SYNC" />
						) : null}
					</div>
					<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
						<div className="min-w-0">
							<div className="mb-2 flex items-baseline gap-2">
								<h2 className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--up)]">
									▲ Foreign Buy
								</h2>
								<span className="font-mono text-[10px] text-[var(--text-faint)]">
									gross buy lots, highest first
								</span>
							</div>
							<DataTable<FlowRow>
								columns={universeBuyColumns as never}
								data={buyRows}
								initialSort={[{ id: "foreign_buy_lots", desc: true }]}
								rowTone={(r) => (r.net_foreign_idr >= 0 ? "up" : "down")}
								empty="No foreign buy data yet"
							/>
						</div>
						<div className="min-w-0">
							<div className="mb-2 flex items-baseline gap-2">
								<h2 className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--down)]">
									▼ Foreign Sell
								</h2>
								<span className="font-mono text-[10px] text-[var(--text-faint)]">
									gross sell lots, highest first
								</span>
							</div>
							<DataTable<FlowRow>
								columns={universeSellColumns as never}
								data={sellRows}
								initialSort={[{ id: "foreign_sell_lots", desc: true }]}
								rowTone={(r) => (r.net_foreign_idr >= 0 ? "up" : "down")}
								empty="No foreign sell data yet"
							/>
						</div>
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
					<StaleChip asOf={detail.data?.as_of} label="DET" />
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
