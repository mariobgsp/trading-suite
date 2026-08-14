import { createFileRoute } from "@tanstack/react-router";
import { api, fmtNum, type RegimeSnapshot } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton, StatCard } from "@/components/ui";
import { SimpleLineChart } from "@/components/MarketChart";

const REGIME_META: Record<
	string,
	{ label: string; desc: string; tone: string }
> = {
	BULL: {
		label: "BULL",
		desc: "Close > SMA(50) > SMA(200) — all engines active",
		tone: "var(--up)",
	},
	CAUTION: {
		label: "CAUTION",
		desc: "Close > SMA(200), not a full bull — selective setups only",
		tone: "var(--gold)",
	},
	BEAR: {
		label: "BEAR",
		desc: "Close < SMA(200) — defensive posture, B.O.W. only",
		tone: "var(--down)",
	},
	UNKNOWN: {
		label: "UNKNOWN",
		desc: "Regime classification unavailable",
		tone: "var(--text-faint)",
	},
};

export const Route = createFileRoute("/regime")({
	component: RegimePage,
});

function RegimePage() {
	const snap = usePolling<RegimeSnapshot>(
		() => api.get("/api/regime/snapshot"),
		60000,
	);
	const hist = usePolling<{
		symbol: string;
		history: { date: string; close: number }[];
	}>(() => api.get("/api/regime/history"), 60000);

	const meta =
		REGIME_META[snap.data?.regime ?? "UNKNOWN"] ?? REGIME_META.UNKNOWN;
	const points = (hist.data?.history ?? []).map((h) => ({
		date: h.date,
		value: h.close,
	}));

	return (
		<div>
			<SectionHeader
				title="Regime & Bot"
				subtitle="IHSG composite market-regime filter that gates the entry engines"
			/>

			<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
				{snap.loading || !snap.data ? (
					[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)
				) : (
					<>
						<StatCard
							label="Regime"
							value={<span style={{ color: meta.tone }}>{meta.label}</span>}
							sub={meta.desc}
						/>
						<StatCard label="Index Close" value={fmtNum(snap.data.close)} />
						<StatCard
							label="SMA(short) / SMA(long)"
							value={`${fmtNum(snap.data.sma_short)} / ${fmtNum(snap.data.sma_long)}`}
							tone={snap.data.close > snap.data.sma_long ? "up" : "down"}
						/>
						<StatCard
							label="ATR(14)"
							value={fmtNum(snap.data.atr_value)}
							sub={`Hurst ${fmtNum(snap.data.hurst_value, 3)}`}
						/>
					</>
				)}
			</div>

			<div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
				<div className="panel p-4 lg:col-span-2">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						IHSG Composite — 1 Year
					</h2>
					{hist.loading || !points.length ? (
						<Skeleton className="h-64" />
					) : (
						<SimpleLineChart data={points} height={280} color="#56b6e7" />
					)}
				</div>

				<div className="panel p-4">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Engine Permissions
					</h2>
					{snap.loading || !snap.data ? (
						<Skeleton className="h-40" />
					) : snap.data.error ? (
						<p className="text-xs text-[var(--down)]">{snap.data.error}</p>
					) : (
						<div className="space-y-1.5">
							{snap.data.allowed_engines.length === 0 && (
								<p className="text-xs text-[var(--text-faint)]">
									No engines permitted
								</p>
							)}
							{snap.data.allowed_engines.map((e) => (
								<div
									key={e}
									className="flex items-center justify-between rounded bg-[var(--panel-2)] px-3 py-1.5"
								>
									<span className="font-mono text-xs text-[var(--text)]">
										{e}
									</span>
									<span className="text-xs text-[var(--up)]">● active</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			<div className="panel grid-texture p-5">
				<h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-[var(--accent)]">
					Bot pipeline (paper trading)
				</h2>
				<p className="text-sm leading-relaxed text-[var(--text-dim)]">
					The full swing-trading pipeline from{" "}
					<span className="font-mono">bot-trading-simulator</span> is preserved
					under <span className="font-mono">backend/scripts/</span> and{" "}
					<span className="font-mono">backend/core/</span> — ingest OHLCV to
					Parquet, scan the 900+ universe, run the regime filter, and
					paper-trade signals. The FastAPI layer above exposes the regime filter
					and indicators as live endpoints. Run{" "}
					<span className="font-mono text-[var(--text)]">
						python -m scripts.daily
					</span>{" "}
					from <span className="font-mono">backend/</span> for the full
					scheduled workflow.
				</p>
			</div>
		</div>
	);
}
