import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
	api,
	fmtIdr,
	fmtNum,
	type BrokerAnalysis,
	type BrokerRadar,
} from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import {
	DataTable,
	NumCell,
	StaleChip,
	type Features,
} from "@/components/data-table";

type RadarRow = NonNullable<BrokerRadar["rows"]>[number];
const radarColumns: ColumnDef<Features, RadarRow, unknown>[] = [
	{
		header: "Broker",
		accessorKey: "broker",
		cell: (c) => (
			<span className="font-semibold text-[var(--text)]">
				{c.getValue() as string}
			</span>
		),
	},
	{
		header: "Code",
		accessorKey: "code",
		cell: (c) => (
			<span className="mono text-[var(--text-faint)]">
				{c.getValue() as string}
			</span>
		),
	},
	{
		header: "Volume",
		accessorKey: "volume",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Value",
		accessorKey: "value_idr",
		meta: { align: "right" },
		cell: (c) => <NumCell value={(c.getValue() as number) / 1e9} digits={1} />,
	},
	{
		header: "Frequency",
		accessorKey: "frequency",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
];

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

export const Route = createFileRoute("/brokerintel")({
	component: BrokerIntelPage,
});

function BrokerIntelPage() {
	const [ticker, setTicker] = useState("BBCA");

	const radar = usePolling<BrokerRadar>(
		() => api.get("/api/intel/broker/radar"),
		90000,
		"radar",
	);
	const detail = usePolling<BrokerAnalysis | null>(
		() => api.get(`/api/intel/broker/${ticker}`),
		60000,
		ticker,
	);

	const unavailable = radar.data && radar.data.available === false;
	const radarRows = (radar.data?.rows ?? []).filter(
		(r) => typeof r.value_idr === "number",
	);

	return (
		<div>
			<SectionHeader
				title="Broker Intel"
				subtitle="Broker activity from IDX — exchange-level volume ranking, plus per-stock foreign flow"
			/>

			{unavailable ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						IDX unavailable
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						{radar.data?.error ?? "The IDX endpoint did not respond."} The
						backend retries with browser impersonation; try again shortly.
					</p>
				</div>
			) : radar.loading && !radar.data ? (
				<Skeleton className="h-72" />
			) : (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{radar.data?.count ?? radarRows.length} brokers · whole IDX
							market, one exchange summary
						</span>
						{radar.data?.as_of ? (
							<StaleChip asOf={radar.data.as_of} label="IDX" />
						) : null}
					</div>
					<DataTable<RadarRow>
						columns={radarColumns}
						data={radarRows}
						initialSort={[{ id: "value_idr", desc: true }]}
						empty="No broker data yet"
					/>
				</>
			)}

			{/* Per-ticker foreign flow (the IDX proxy for "who's accumulating") */}
			<div className="panel mt-6 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Per-ticker foreign flow · {ticker}
					</h2>
					<StaleChip asOf={detail.data?.as_of} label="FLOW" />
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
					<>
						<div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
							<DrillStat
								label="Net Foreign"
								value={
									<span
										className={
											(detail.data.net_foreign_lots ?? 0) >= 0
												? "text-[var(--up)]"
												: "text-[var(--down)]"
										}
									>
										{(detail.data.net_foreign_lots ?? 0) >= 0 ? "+" : ""}
										{fmtNum(detail.data.net_foreign_lots ?? 0, 0)} lots
									</span>
								}
							/>
							<DrillStat
								label="Net Foreign IDR"
								value={
									<span
										className={
											(detail.data.net_foreign_idr ?? 0) >= 0
												? "text-[var(--up)]"
												: "text-[var(--down)]"
										}
									>
										{fmtIdr(detail.data.net_foreign_idr ?? 0, true)}
									</span>
								}
							/>
							<DrillStat
								label="Foreign Buy"
								value={
									<span className="text-[var(--up)]">
										{fmtNum(detail.data.foreign_buy_lots ?? 0, 0)} lots ·{" "}
										{fmtIdr(detail.data.foreign_buy_idr ?? 0, true)}
									</span>
								}
							/>
							<DrillStat
								label="Foreign Sell"
								value={
									<span className="text-[var(--down)]">
										{fmtNum(detail.data.foreign_sell_lots ?? 0, 0)} lots ·{" "}
										{fmtIdr(detail.data.foreign_sell_idr ?? 0, true)}
									</span>
								}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
							<DrillStat
								label="Price"
								value={
									detail.data.price != null ? fmtNum(detail.data.price) : "—"
								}
							/>
							<DrillStat
								label="Volume"
								value={fmtNum(detail.data.total_volume ?? 0, 0)}
							/>
							<DrillStat
								label="Source"
								value={<span className="text-[var(--accent)]">IDX</span>}
							/>
						</div>
						<p className="mt-4 text-[11px] leading-relaxed text-[var(--text-faint)]">
							{detail.data.note ??
								"IDX publishes broker activity exchange-level only."}{" "}
							Per-broker buy/sell per stock is not public exchange data; foreign
							flow is the official per-stock institutional signal.
						</p>
					</>
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
