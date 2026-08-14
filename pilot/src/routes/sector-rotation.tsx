import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { api, type RotationHistory } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import {
	DataTable,
	NumCell,
	PctCell,
	StaleChip,
	type Features,
} from "@/components/data-table";

type Row = NonNullable<RotationHistory["sectors"]>[number];

const columns: ColumnDef<Features, Row, unknown>[] = [
	{
		header: "Rank",
		accessorKey: "rank",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Sector",
		accessorKey: "sector",
		cell: (c) => (
			<span className="font-semibold text-[var(--text)]">
				{c.getValue() as string}
			</span>
		),
	},
	{
		header: "Tickers",
		accessorKey: "count",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Gainers",
		accessorKey: "gainers",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Losers",
		accessorKey: "losers",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Today",
		accessorKey: "avg_change_percent",
		meta: { align: "right" },
		cell: (c) => <PctCell value={c.getValue() as number} />,
	},
	{
		header: "5d Avg",
		accessorKey: "avg5",
		meta: { align: "right" },
		cell: (c) => <PctCell value={c.getValue() as number} />,
	},
	{
		header: "20d Avg",
		accessorKey: "avg20",
		meta: { align: "right" },
		cell: (c) => <PctCell value={c.getValue() as number} />,
	},
	{
		header: "Rank Δ",
		accessorKey: "rank_delta",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number | null;
			if (v == null)
				return <span className="mono text-[var(--text-faint)]">—</span>;
			// Negative delta = sector gained relative strength (moved up the ranking).
			const gaining = v < 0;
			return (
				<span
					className={`mono font-semibold ${gaining ? "text-[var(--up)]" : "text-[var(--down)]"}`}
				>
					{gaining ? "▲" : "▼"} {Math.abs(v)}
				</span>
			);
		},
	},
];

export const Route = createFileRoute("/sector-rotation")({
	component: SectorRotationPage,
});

function SectorRotationPage() {
	const data = usePolling<RotationHistory>(
		() => api.get("/api/intel/rotation?days=20"),
		300000,
		"rotation",
	);

	return (
		<div>
			<SectionHeader
				title="Sector Rotation"
				subtitle="Daily sector snapshots archived on this server — track strength shifts over 5 and 20 days"
			/>
			{data.loading && !data.data ? (
				<Skeleton className="h-72" />
			) : data.data?.error ? (
				<p className="text-xs text-[var(--down)]">{data.data.error}</p>
			) : data.data ? (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{daysLabel(data.data.days_archived)} · negative rank Δ = gaining
							relative strength
						</span>
						<StaleChip asOf={data.data.as_of} label="SNAP" />
					</div>
					<DataTable<Row>
						columns={columns}
						data={data.data.sectors}
						initialSort={[{ id: "rank", desc: false }]}
						rowTone={(r) => (r.avg_change_percent >= 0 ? "up" : "down")}
						empty="No sector snapshots yet"
					/>
				</>
			) : null}
		</div>
	);
}

function daysLabel(n: number) {
	if (n === 1)
		return "1 day archived — history grows as the daily snapshot accumulates";
	if (n === 0)
		return "snapshot archive warming up — check back after the next fetch";
	return `${n} days archived`;
}
