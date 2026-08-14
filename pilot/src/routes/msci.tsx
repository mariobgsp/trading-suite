import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmtNum, type MsciWatch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import {
	DataTable,
	NumCell,
	PctCell,
	StaleChip,
	type Features,
} from "@/components/data-table";

type Row = NonNullable<MsciWatch["rows"]>[number];

const columns: ColumnDef<Features, Row, unknown>[] = [
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
		header: "Market Cap",
		accessorKey: "market_cap",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number | null;
			if (v == null)
				return <span className="mono text-[var(--text-faint)]">—</span>;
			return (
				<span className="mono text-[var(--text)]">{fmtNum(v / 1e12, 2)} T</span>
			);
		},
	},
	{
		header: "Volume",
		accessorKey: "volume",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
];

export const Route = createFileRoute("/msci")({
	component: MsciPage,
});

function MsciPage() {
	const data = usePolling<MsciWatch>(
		() => api.get("/api/intel/msci"),
		300000,
		"msci",
	);

	return (
		<div>
			<SectionHeader
				title="MSCI Watch"
				subtitle="MSCI Indonesia constituents, enriched with live price and cap data"
			/>
			{data.loading && !data.data ? (
				<Skeleton className="h-72" />
			) : data.data?.error ? (
				<p className="text-xs text-[var(--down)]">{data.data.error}</p>
			) : data.data ? (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{data.data.count} constituents · membership updated at each
							quarterly index review
							{data.data.missing.length > 0
								? ` · ${data.data.missing.length} missing from live feed`
								: ""}
						</span>
						<StaleChip asOf={data.data.as_of} label="SNAP" />
					</div>
					<DataTable<Row>
						columns={columns}
						data={data.data.rows}
						initialSort={[{ id: "market_cap", desc: true }]}
						rowTone={(r) => (r.change_percent >= 0 ? "up" : "down")}
						empty="No MSCI constituents"
					/>
					<p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
						There is no free MSCI membership API — constituents are curated from
						the quarterly index-review announcements and refreshed at each
						review (Feb/May/Aug/Nov). Float-adjusted caps move a handful of
						names in and out each cycle.
					</p>
				</>
			) : null}
		</div>
	);
}
