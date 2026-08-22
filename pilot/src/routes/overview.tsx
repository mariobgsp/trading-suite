import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { usePolling } from "@/lib/usePolling";
import {
	api,
	fmtNum,
	type AlertsResponse,
	type ForeignFlowUniverse,
	type HeatmapResponse,
	type JciMoversResponse,
	type KongloResponse,
	type Quote,
	type RegimeSnapshot,
} from "@/lib/api";
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	StatCard,
} from "@/components/ui";
import { SimpleLineChart } from "@/components/MarketChart";
import Heatmap from "@/components/Heatmap";
import Movers from "@/components/Movers";
import { StaleChip } from "@/components/data-table";

const INDEX_SYMBOLS = ["^JKSE", "^JKLQ45", "^JKIDX30"];

export const Route = createFileRoute("/overview")({
	component: OverviewPage,
});

/**
 * Market Pulse — the simplified overview.
 *
 * One screen, four things: the index strip, the IDX heatmap (whole market at
 * a glance), the JCI movers board (who moved the index), and the regime
 * filter. The AI summary and the duplicate gainers/losers + sector panels
 * moved out — the heatmap and movers now cover that ground with richer data.
 */
function OverviewPage() {
	const indices = usePolling<Quote[]>(
		() => api.get("/api/market/indices"),
		30000,
	);
	const heatmap = usePolling<HeatmapResponse>(
		() => api.get("/api/intel/heatmap"),
		120000,
		"heatmap",
	);
	const movers = usePolling<JciMoversResponse>(
		() => api.get("/api/intel/movers?range_days=1&limit=50"),
		60000,
		"movers",
	);
	const regime = usePolling<RegimeSnapshot>(
		() => api.get("/api/regime/snapshot"),
		60000,
	);
	const alerts = usePolling<AlertsResponse>(
		() => api.get("/api/alerts?limit=300"),
		120000,
		"alerts",
	);
	const foreign = usePolling<ForeignFlowUniverse>(
		() => api.get("/api/intel/foreign/universe"),
		120000,
		"foreign",
	);
	const konglo = usePolling<KongloResponse>(
		() => api.get("/api/intel/konglo"),
		120000,
		"konglo",
	);

	const indexQuotes = (indices.data ?? []).filter((q) =>
		INDEX_SYMBOLS.includes(q.symbol),
	);

	return (
		<div>
			<SectionHeader
				title="Market Pulse"
				subtitle="The whole IDX board at a glance — who moved, who's hot, and the regime filter"
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
								tone={q.change_percent != null && q.change_percent >= 0 ? "up" : "down"}
								sub={
									<div className="flex items-center gap-2">
										<ChangeBadge value={q.change_percent} />
										<span className="text-[var(--text-faint)]">
											O {fmtNum(q.open)} · H {fmtNum(q.day_high)} · L {fmtNum(q.day_low)}
										</span>
									</div>
								}
							/>
						))}
			</div>

			{/* Market breadth + D-Signal + Konglo top strip */}
			<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
				<StatCard
					label="Advancers"
					value={movers.data?.up_count ?? "—"}
					tone="up"
					sub="vs JCI movers board"
				/>
				<StatCard
					label="Decliners"
					value={movers.data?.down_count ?? "—"}
					tone="down"
					sub="vs JCI movers board"
				/>
				<Link to="/alerts" className="block">
					<StatCard
						label="D-Signal · Breakout"
						value={alerts.data?.counts.breakout ?? "—"}
						tone="accent"
						sub={`${alerts.data?.counts.premium ?? "—"} premium · ${alerts.data?.counts.full_ladder ?? "—"} full MA`}
					/>
				</Link>
				<StatCard
					label="Konglo · Groups"
					value={konglo.data?.groups_counted ?? "—"}
					tone={konglo.data?.tickers_mapped ? "up" : "default"}
					sub={`${konglo.data?.tickers_mapped ?? "—"} saham mapped`}
				/>
			</div>

			{/* IDX Heatmap */}
			<div className="panel p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						IDX Heatmap
					</h2>
					{heatmap.data?.as_of ? (
						<StaleChip asOf={heatmap.data.as_of} label="AS OF" />
					) : null}
				</div>
				{heatmap.loading && !heatmap.data ? (
					<Skeleton className="h-[420px]" />
				) : heatmap.data?.error ? (
					<p className="py-10 text-center text-xs text-[var(--down)]">
						{heatmap.data.error}
					</p>
				) : (
					<Heatmap rows={heatmap.data?.rows ?? []} height={460} />
				)}
			</div>

			{/* IDX Movers — JCI point contribution */}
			<div className="panel mt-6 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						IDX Movers · JCI Point Contribution
					</h2>
				</div>
				{movers.loading && !movers.data ? (
					<Skeleton className="h-72" />
				) : movers.data?.error ? (
					<p className="py-10 text-center text-xs text-[var(--down)]">
						{movers.data.error}
					</p>
				) : (
					<Movers data={movers.data} />
				)}
			</div>

			{/* Regime */}
			<div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
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
