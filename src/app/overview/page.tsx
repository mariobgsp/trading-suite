"use client";

import Link from "next/link";
import { usePolling } from "@/lib/usePolling";
import { api, fmtNum, type Quote, type RegimeSnapshot } from "@/lib/api";
import Shell from "@/components/Shell";
import { ChangeBadge, SectionHeader, StatCard } from "@/components/ui";
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
// Only symbols that actually resolve on Yahoo Finance (^JKIDX30 etc. are dead)
const INDEX_SYMBOLS = ["^JKSE", "^JKLQ45"];

export default function OverviewPage() {
	const indices = usePolling<Quote[]>(
		() => api.getCached<Quote[]>("/api/market/indices"),
		30000,
		"",
		{ cacheKey: "/api/market/indices" },
	);
	const watchlistPath = `/api/market/quotes?tickers=${WATCHLIST.join(",")}`;
	const watchlist = usePolling<Record<string, Quote>>(
		() =>
			api
				.getCached<{ quotes: Record<string, Quote> }>(watchlistPath)
				.then((r) => r.quotes),
		15000,
		watchlistPath,
		{ cacheKey: watchlistPath },
	);
	const regime = usePolling<RegimeSnapshot>(
		() => api.getCached<RegimeSnapshot>("/api/regime/snapshot"),
		60000,
		"",
		{ cacheKey: "/api/regime/snapshot" },
	);

	const indexQuotes = (indices.data ?? []).filter((q) =>
		INDEX_SYMBOLS.includes(q.symbol),
	);

	return (
		<Shell>
			<SectionHeader
				eyebrow="Market desk · IDX composite"
				title="Overview"
				subtitle="IHSG market dashboard — indices, watchlist, and the regime filter in one live view."
				right={
					regime.data ? (
						<div
							className={`panel-2 inline-flex items-center gap-2 px-4 py-2 font-mono text-xs font-bold tracking-widest ${
								regime.data.regime === "BULL"
									? "text-[var(--up)]"
									: regime.data.regime === "BEAR"
										? "text-[var(--down)]"
										: "text-[var(--gold)]"
							}`}
						>
							<span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
							REGIME: {regime.data.regime}
						</div>
					) : null
				}
			/>

			{/* Indices strip — terminal: always rendered, never blocks */}
			<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 rise-in font-mono">
				{(indexQuotes.length ? indexQuotes : INDEX_SYMBOLS.map((s) => ({ symbol: s, name: s, price: null, change_percent: null, open: null, day_high: null, day_low: null } as unknown as Quote))).map((q) => (
					<StatCard
						key={q.symbol}
						label={q.name ?? q.symbol}
						value={q.price != null ? fmtNum(q.price) : "—"}
						tone={q.change_percent != null && q.change_percent >= 0 ? "up" : q.change_percent == null ? "default" : "down"}
						sub={
							q.price != null ? (
								<div className="flex items-center gap-2">
									<ChangeBadge value={q.change_percent} />
									<span className="text-[var(--text-faint)]">O {fmtNum(q.open)} · H {fmtNum(q.day_high)} · L {fmtNum(q.day_low)}</span>
								</div>
							) : (
								<span className="text-[var(--text-ghost)]">$ loading…</span>
							)
						}
					/>
				))}
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
				{/* Watchlist */}
				<div className="panel p-5 lg:col-span-3 rise-in-2">
					<div className="mb-4 flex items-center justify-between">
						<h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]">
							Watchlist — 8 names
						</h2>
						<Link
							href="/markets"
							className="inline-flex items-center gap-1 rounded-pill border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1 font-mono text-[11px] font-semibold text-[var(--accent)] transition-colors hover:border-[var(--accent-dim)] hover:bg-[var(--accent-dim)]"
						>
							Open Markets →
						</Link>
					</div>
					<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-[var(--border)] text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
								<th className="pb-3 font-semibold">Ticker</th>
								<th className="pb-3 text-right font-semibold">Last</th>
								<th className="pb-3 text-right font-semibold">Chg %</th>
								<th className="pb-3 text-right font-semibold">Volume</th>
								<th className="pb-3 text-right font-semibold">Day Range</th>
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
				</div>

				{/* Right column: regime + IHSG chart */}
				<div className="space-y-6 lg:col-span-2">
					<div className="panel grid-texture p-5 rise-in-3">
						<h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]">
							IHSG Composite — ^JKSE
						</h2>
						<RegimeChart />
					</div>

					<div className="panel p-5 rise-in-3 font-mono">
						<h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]">$ regime --json</h2>
						{regime.data?.error ? (
							<p className="text-xs text-[var(--down)]">{regime.data.error}</p>
						) : (
							<div className="space-y-2 text-sm">
								<Row k="Classification" v={regime.data?.regime ?? (regime.loading ? "…" : "—")} />
								<Row k="Index Close" v={regime.data ? fmtNum(regime.data.close) : "—"} />
								<Row k="SMA short / long" v={regime.data ? `${fmtNum(regime.data.sma_short)} / ${fmtNum(regime.data.sma_long)}` : "—"} />
								<Row k="ATR(14)" v={regime.data ? fmtNum(regime.data.atr_value) : "—"} />
								<Row k="Hurst" v={regime.data ? fmtNum(regime.data.hurst_value, 3) : "—"} />
								<Row k="As of" v={regime.data?.as_of_date ?? (regime.loading ? "syncing…" : "—")} />
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
	}>(() => api.getCached("/api/regime/history"), 60000, "", {
		cacheKey: "/api/regime/history",
	});
	// terminal: never blocks with skeleton — show axes instantly
	const points = (data.data?.history ?? []).map((h) => ({ date: h.date, value: h.close }));
	if (!points.length) return <div className="flex h-[230px] items-center justify-center border border-dashed border-[var(--line)] bg-[var(--panel-2)] font-mono text-xs text-[var(--text-faint)]">$ plot --history | {data.loading ? "fetching…" : "no data"}</div>;
	return <SimpleLineChart data={points} height={230} />;
}
