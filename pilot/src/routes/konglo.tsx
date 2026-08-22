import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { api, type KongloMember, type KongloResponse } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton, ChangeBadge } from "@/components/ui";
import {
	DataTable,
	IdrCell,
	NumCell,
	PctCell,
	type Features,
} from "@/components/data-table";

export const Route = createFileRoute("/konglo")({
	component: KongloPage,
});

/**
 * Konglo — broker-flow aggregated per konglomerat / taipan group.
 *
 * IDX tickers roll up into well-known conglomerate families; each group
 * shows saham count, average price move, and aggregate official net foreign
 * flow (the one honest per-stock flow signal IDX publishes).
 */
const memberColumns: ColumnDef<Features, KongloMember, unknown>[] = [
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
		header: "Net Foreign",
		accessorKey: "net_foreign_idr",
		meta: { align: "right" },
		cell: (c) => <IdrCell value={c.getValue() as number} />,
	},
];

function KongloPage() {
	const konglo = usePolling<KongloResponse>(
		() => api.get("/api/intel/konglo"),
		120000,
	);
	const { data } = konglo;
	const groups = data?.groups ?? [];

	return (
		<div>
			<SectionHeader
				title="Konglo"
				subtitle="Saham IDX dikelompokkan menurut grup konglomerat / taipan — lihat arah arus asing per keluarga"
				right={
					data?.groups_counted != null ? (
						<div className="font-mono text-xs text-[var(--text-faint)]">
							{data.tickers_mapped} saham · {data.groups_counted} grup
						</div>
					) : null
				}
			/>

			{konglo.loading && !data ? (
				<Skeleton className="h-[420px]" />
			) : (
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					{groups.map((g) => (
						<div key={g.group} className="panel overflow-hidden">
							<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
								<div>
									<div className="text-sm font-bold text-[var(--text)]">{g.group}</div>
									<div className="font-mono text-[11px] text-[var(--text-faint)]">
										{g.count_saham} saham
									</div>
								</div>
								<div className="text-right">
									<div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
										Net Foreign
									</div>
									<div
										className={`mono text-sm font-bold ${
											g.net_foreign_idr >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
										}`}
									>
										<IdrCell value={g.net_foreign_idr} />
									</div>
								</div>
							</div>
							<div className="flex items-center justify-between px-4 py-2">
								<span className="text-xs text-[var(--text-faint)]">Avg change</span>
								<ChangeBadge value={g.avg_change_percent} />
							</div>
							<div className="px-2 pb-2">
								<DataTable<KongloMember>
									columns={memberColumns as never}
									data={g.members}
									empty="—"
								/>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
