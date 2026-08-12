import { createFileRoute, Link } from "@tanstack/react-router";
import { usePolling } from "@/lib/usePolling";
import { api, fmtNum, type Quote, type RegimeSnapshot } from "@/lib/api";
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	StatCard,
} from "@/components/ui";
import { SimpleLineChart } from "@/components/MarketChart";
import AiSummary from "@/components/AiSummary";
import type { Mover, SectorsResponse } from "@/lib/api";

const INDEX_SYMBOLS = ["^JKSE", "^JKLQ45", "^JKIDX30"];

export const Route = createFileRoute("/overview")({
	component: OverviewPage,
});

function OverviewPage() {
	const indices = usePolling<Quote[]>(
		() => api.get("/api/market/indices"),
		30000,
	);
	const gainers = usePolling<Mover[]>(
		() =>
			api
				.get<{ movers: Mover[] }>("/api/market/movers?side=gainers&limit=10")
				.then((r) => r.movers),
		60000,
	);
	const losers = usePolling<Mover[]>(
		() =>
			api
				.get<{ movers: Mover[] }>("/api/market/movers?side=losers&limit=10")
				.then((r) => r.movers),
		60000,
	);
	const sectors = usePolling<SectorsResponse>(
		() => api.get("/api/market/sectors"),
		300000,
	);
	const regime = usePolling<RegimeSnapshot>(
		() => api.get("/api/regime/snapshot"),
		60000,
	);

	const indexQuotes = (indices.data ?? []).filter((q) =>
		INDEX_SYMBOLS.includes(q.symbol),
	);

	return (
		<div>
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

			<AiSummary page="overview" className="mb-6" />

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
				{/* Top gainers / losers — live from TradingView scanner scrape */}
				<div className="panel p-4 lg:col-span-3">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							Top Gainers / Losers
						</h2>
						<Link
							to="/markets"
							className="text-xs text-[var(--accent)] hover:underline"
						>
							Open Markets →
						</Link>
					</div>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<MoversTable
							title="Top Gainers"
							rows={gainers.data ?? []}
							loading={gainers.loading && !gainers.data}
						/>
						<MoversTable
							title="Top Losers"
							rows={losers.data ?? []}
							loading={losers.loading && !losers.data}
						/>
					</div>
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

			{/* Sector rotation */}
			<div className="panel p-4">
				<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Sector Rotation
				</h2>
				{sectors.loading && !sectors.data ? (
					<Skeleton className="h-16" />
				) : !sectors.data?.sectors?.length ? (
					<p className="text-xs text-[var(--text-faint)]">
						Sector data unavailable — retrying…
					</p>
				) : (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
						{sectors.data.sectors.slice(0, 12).map((s) => (
							<div key={s.sector} className="panel-2 p-3">
								<div className="truncate text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
									{s.sector}
								</div>
								<div
									className={`mt-1 font-mono text-sm font-bold ${
										s.avg_change_percent >= 0
											? "text-[var(--up)]"
											: "text-[var(--down)]"
									}`}
								>
									{fmtNum(s.avg_change_percent, 2)}%
								</div>
								<div className="mt-0.5 text-[10px] text-[var(--text-faint)]">
									{s.gainers}↑ / {s.losers}↓ · {s.count} tkrs
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function MoversTable({
	title,
	rows,
	loading,
}: {
	title: string;
	rows: Mover[];
	loading: boolean;
}) {
	return (
		<div>
			<h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">
				{title}
			</h3>
			{loading ? (
				<Skeleton className="h-48" />
			) : rows.length === 0 ? (
				<p className="text-xs text-[var(--text-faint)]">No data yet…</p>
			) : (
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
							<th className="pb-2">Ticker</th>
							<th className="pb-2 text-right">Last</th>
							<th className="pb-2 text-right">Chg %</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((m) => (
							<tr
								key={m.symbol}
								className="border-b border-[var(--border)]/50 last:border-0"
							>
								<td className="py-1.5">
									<Link
										to="/markets"
										search={{ ticker: m.symbol }}
										className="font-semibold text-[var(--accent)] hover:underline"
									>
										{m.symbol}
									</Link>
								</td>
								<td className="tabular py-1.5 text-right font-mono">
									{fmtNum(m.price)}
								</td>
								<td className="py-1.5 text-right">
									<ChangeBadge value={m.change_percent} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
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
