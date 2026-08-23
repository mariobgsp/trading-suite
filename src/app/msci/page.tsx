"use client";

import { api, fmtNum } from "@/lib/api";
import Shell from "@/components/Shell";
import { ChangeBadge, NumCell, SectionHeader, Skeleton } from "@/components/ui";
import { usePolling } from "@/lib/usePolling";

interface MsciRow {
	ticker: string;
	name: string;
	sector: string;
	price: number;
	change_percent: number;
	market_cap: number | null;
	volume: number | null;
}

interface MsciWatch {
	count: number;
	missing: string[];
	as_of?: string;
	rows: MsciRow[];
	error?: string;
}

export default function MsciPage() {
	const data = usePolling<MsciWatch>(
		() => api.get("/api/intel/msci"),
		300000,
		"msci",
	);

	const rows = [...(data.data?.rows ?? [])].sort(
		// ponytail: pre-sorted by market cap desc; add column sorting if users need it
		(a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0),
	);

	return (
		<Shell>
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
							{data.data.count} constituents · membership updated at each quarterly
							index review
							{data.data.missing.length > 0
								? ` · ${data.data.missing.length} missing from live feed`
								: ""}
						</span>
						{data.data.as_of ? (
							<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
								SNAP · as of {String(data.data.as_of).slice(0, 10)}
							</span>
						) : null}
					</div>
					<div className="panel overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-[var(--border)] text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
									<th className="px-3 py-2">Ticker</th>
									<th className="px-3 py-2">Name</th>
									<th className="px-3 py-2">Sector</th>
									<th className="px-3 py-2 text-right">Price</th>
									<th className="px-3 py-2 text-right">Chg</th>
									<th className="px-3 py-2 text-right">Market Cap</th>
									<th className="px-3 py-2 text-right">Volume</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr
										key={r.ticker}
										className="border-b border-[var(--line)]/50 last:border-b-0 hover:bg-[var(--panel-2)]"
									>
										<td className="tabular px-3 py-2 font-mono font-bold text-[var(--text)]">
											{r.ticker}
										</td>
										<td className="px-3 py-2 text-[var(--text-dim)]">{r.name}</td>
										<td className="px-3 py-2 text-[var(--text-dim)]">{r.sector}</td>
										<td className="px-3 py-2 text-right">
											<NumCell value={r.price} />
										</td>
										<td className="px-3 py-2 text-right">
											<ChangeBadge value={r.change_percent} />
										</td>
										<td className="tabular px-3 py-2 text-right font-mono text-[11px] text-[var(--text)]">
											{r.market_cap == null ? (
												<span className="text-[var(--text-faint)]">—</span>
											) : (
												`${fmtNum(r.market_cap / 1e12, 2)} T`
											)}
										</td>
										<td className="px-3 py-2 text-right">
											<NumCell value={r.volume} digits={0} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{rows.length === 0 && (
							<p className="px-3 py-6 text-center text-sm text-[var(--text-faint)]">
								No MSCI constituents
							</p>
						)}
					</div>
					<p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
						There is no free MSCI membership API — constituents are curated from the
						quarterly index-review announcements and refreshed at each review
						(Feb/May/Aug/Nov). Float-adjusted caps move a handful of names in and out
						each cycle.
					</p>
				</>
			) : null}
		</Shell>
	);
}
