"use client";

import { api, fmtIdr, type KongloGroup, type KongloResponse } from "@/lib/api";
import Shell from "@/components/Shell";
import { ChangeBadge, SectionHeader, Skeleton } from "@/components/ui";
import { usePolling } from "@/lib/usePolling";

/**
 * Konglo — broker-flow aggregated per konglomerat / taipan group.
 *
 * IDX tickers roll up into well-known conglomerate families; each group
 * shows saham count, average price move, and aggregate official net foreign
 * flow (the one honest per-stock flow signal IDX publishes).
 */
export default function KongloPage() {
	const konglo = usePolling<KongloResponse>(
		() => api.get("/api/intel/konglo"),
		120000,
	);
	const { data } = konglo;
	const groups = data?.groups ?? [];

	return (
		<Shell>
			<SectionHeader
				eyebrow="Konglomerat flow map"
				title="Konglo"
				subtitle="Saham IDX dikelompokkan menurut grup konglomerat / taipan — lihat arah arus asing per keluarga"
				right={
					data?.groups_counted != null ? (
						<div className="font-mono text-xs text-[var(--text-faint)]">
							{data.tickers_mapped} saham · {data.groups_counted} grup
						</div>
					) : undefined
				}
			/>

			{konglo.loading && !data ? (
				<Skeleton className="h-[420px]" />
			) : (
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					{groups.map((g) => (
						<GroupCard key={g.group} group={g} />
					))}
				</div>
			)}
		</Shell>
	);
}

function GroupCard({ group: g }: { group: KongloGroup }) {
	return (
		<div className="panel overflow-hidden">
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
						className={`tabular text-sm font-bold ${
							g.net_foreign_idr >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
						}`}
					>
						{fmtIdr(g.net_foreign_idr, true)}
					</div>
				</div>
			</div>
			<div className="flex items-center justify-between px-4 py-2">
				<span className="text-xs text-[var(--text-faint)]">Avg change</span>
				{g.avg_change_percent != null && (
					<ChangeBadge value={g.avg_change_percent} />
				)}
			</div>
			<div className="px-2 pb-2">
				<table className="w-full">
					<thead>
						<tr className="border-b border-[var(--line)] text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
							<th className="px-2 py-1">Ticker</th>
							<th className="px-2 py-1 text-right">Price</th>
							<th className="px-2 py-1 text-right">Chg</th>
							<th className="px-2 py-1 text-right">Net Foreign</th>
						</tr>
					</thead>
					<tbody>
						{g.members.map((m) => (
							<tr
								key={m.ticker}
								className="border-b border-[var(--line)]/50 last:border-b-0 hover:bg-[var(--panel-2)]"
							>
								<td className="px-2 py-1.5 font-mono text-[12px] font-bold text-[var(--text)]">
									{m.ticker}
								</td>
								<td className="tabular px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text)]">
									{m.price ?? "—"}
								</td>
								<td className="px-2 py-1.5 text-right">
									{m.change_percent != null && <ChangeBadge value={m.change_percent} />}
								</td>
								<td
									className={`tabular px-2 py-1.5 text-right font-mono text-[11px] ${
										(m.net_foreign_idr ?? 0) >= 0
											? "text-[var(--up)]"
											: "text-[var(--down)]"
									}`}
								>
									{fmtIdr(m.net_foreign_idr, true)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
