"use client";

import Link from "next/link";
import { usePolling } from "@/lib/usePolling";
import { api, fmtNum, type Quote, type RegimeSnapshot } from "@/lib/api";
import Shell from "@/components/Shell";
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	StatCard,
} from "@/components/ui";
import { SimpleLineChart } from "@/components/MarketChart";

const WATCHLIST = [
	"BBCA",
	"BBRI",
	"BMRI",
	"BBNI",
	"TLKM",
	"ASII",
	"ADRO",
	"ANTM",
];
const INDEX_SYMBOLS = ["^JKSE", "^JKLQ45", "^JKIDX30"];

export default function OverviewPage() {
	const indices = usePolling<Quote[]>(
		() => api.get("/api/market/indices"),
		30000,
	);
	const watchlist = usePolling<Record<string, Quote>>(
		() =>
			api
				.get<{ quotes: Record<string, Quote> }>(
					`/api/market/quotes?tickers=${WATCHLIST.join(",")}`,
				)
				.then((r) => r.quotes),
		15000,
	);
	const regime = usePolling<RegimeSnapshot>(
		() => api.get("/api/regime/snapshot"),
		60000,
	);

	const indexQuotes = (indices.data ?? []).filter((q) =>
		INDEX_SYMBOLS.includes(q.symbol),
	);

	return (
		<Shell>
			<SectionHeader
				title="Overview"
				subtitle="IHSG market dashboard — indices, watchlist, and regime filter"
				right={
					regime.data ? (
						<div
							className={`panel-2 px-4 py-2 text-sm font-bold ${
								regime.data.regime === "BULL"
									? "text-[var(--up)]"
									: regime.data.regime === "BEAR"
										? "text-[var(--down)]"
										: "text-[var(--gold)]"
							}`}
						>
							REGIME: {regime.data.regime}
						</div>
					) : null
				}
			/>

			{/* Indices strip */}
			<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
				{indices.loading
					? [0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)
					: indexQuotes.map((q) => (
							<StatCard
								key={q.symbol}
								label={q.name ?? q.symbol}
								value={fmtNum(q.price)}
								tone={
									q.change_percent != null && q.change_percent >= 0
										? "up"
										: "down"
								}
								sub={
									<div className="flex items-center gap-2">
										<ChangeBadge value={q.change_percent} />
										<span className="text-[var(--text-faint)]">
											O {fmtNum(q.open)} · H {fmtNum(q.day_high)} · L{" "}
											{fmtNum(q.day_low)}
										</span>
									</div>
								}
							/>
						))}
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
				{/* Watchlist */}
				<div className="panel p-4 lg:col-span-3">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							Watchlist
						</h2>
						<Link
							href="/markets"
							className="text-xs text-[var(--accent)] hover:underline"
						>
							Open Markets →
						</Link>
					</div>
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
								<th className="pb-2">Ticker</th>
								<th className="pb-2 text-right">Last</th>
								<th className="pb-2 text-right">Chg %</th>
								<th className="pb-2 text-right">Volume</th>
								<th className="pb-2 text-right">Day Range</th>
							</tr>
						</thead>
						<tbody>
							{WATCHLIST.map((t) => {
								const q = watchlist.data?.[`${t}.JK`] ?? watchlist.data?.[t];
								return (
									<tr key={t} className="border-b border-[var(--border)]/50">
										<td className="py-2">
											<Link
												href={`/markets?ticker=${t}`}
												className="font-semibold text-[var(--accent)] hover:underline"
											>
												{t}
											</Link>
											<span className="ml-1 text-[10px] text-[var(--text-faint)]">
												JK
											</span>
										</td>
										<td className="tabular py-2 text-right font-mono">
											{q ? (
												fmtNum(q.price)
											) : (
												<span className="text-[var(--text-faint)]">…</span>
											)}
										</td>
										<td className="py-2 text-right">
											{q ? <ChangeBadge value={q.change_percent} /> : "…"}
										</td>
										<td className="tabular py-2 text-right font-mono text-xs text-[var(--text-dim)]">
											{q?.volume ? fmtNum(q.volume, 0) : "…"}
										</td>
										<td className="tabular py-2 text-right font-mono text-xs text-[var(--text-dim)]">
											{q ? `${fmtNum(q.day_low)} – ${fmtNum(q.day_high)}` : "…"}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{/* Right column: regime + IHSG chart */}
				<div className="space-y-6 lg:col-span-2">
					<div className="panel grid-texture p-4">
						<h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							IHSG Composite (^JKSE)
						</h2>
						<RegimeChart />
					</div>

					<div className="panel p-4">
						<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							Market Regime
						</h2>
						{regime.loading ? (
							<Skeleton className="h-20" />
						) : regime.data?.error ? (
							<p className="text-xs text-[var(--down)]">{regime.data.error}</p>
						) : (
							<div className="space-y-2 text-sm">
								<Row k="Classification" v={regime.data?.regime ?? "—"} />
								<Row k="Index Close" v={fmtNum(regime.data?.close)} />
								<Row
									k="SMA short / long"
									v={`${fmtNum(regime.data?.sma_short)} / ${fmtNum(regime.data?.sma_long)}`}
								/>
								<Row k="ATR(14)" v={fmtNum(regime.data?.atr_value)} />
								<Row k="Hurst" v={fmtNum(regime.data?.hurst_value, 3)} />
								<Row k="As of" v={regime.data?.as_of_date ?? "—"} />
							</div>
						)}
					</div>
				</div>
			</div>
		</Shell>
	);
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-[var(--border)]/50 pb-1.5 last:border-0">
			<span className="text-xs text-[var(--text-faint)]">{k}</span>
			<span className="tabular font-mono text-xs font-semibold text-[var(--text)]">
				{v}
			</span>
		</div>
	);
}

function RegimeChart() {
	const data = usePolling<{
		symbol: string;
		history: { date: string; close: number }[];
	}>(() => api.get("/api/regime/history"), 60000);
	if (data.loading || !data.data) return <Skeleton className="h-56" />;
	const points = (data.data.history ?? []).map((h) => ({
		date: h.date,
		value: h.close,
	}));
	if (!points.length)
		return <p className="text-xs text-[var(--text-dim)]">No data</p>;
	return <SimpleLineChart data={points} height={230} />;
}
