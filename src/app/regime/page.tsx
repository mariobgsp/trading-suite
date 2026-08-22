"use client";

import { api, fmtNum, type RegimeSnapshot } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import Shell from "@/components/Shell";
import { SectionHeader, StatCard } from "@/components/ui";
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

export default function RegimePage() {
	const snap = usePolling<RegimeSnapshot>(
		() => api.getCached<RegimeSnapshot>("/api/regime/snapshot"),
		60000,
		"",
		{ cacheKey: "/api/regime/snapshot" },
	);
	const hist = usePolling<{
		symbol: string;
		history: { date: string; close: number }[];
	}>(() => api.getCached("/api/regime/history"), 60000, "", {
		cacheKey: "/api/regime/history",
	});

	const meta =
		REGIME_META[snap.data?.regime ?? "UNKNOWN"] ?? REGIME_META.UNKNOWN;
	const points = (hist.data?.history ?? []).map((h) => ({
		date: h.date,
		value: h.close,
	}));

	return (
		<Shell>
			<SectionHeader
				eyebrow="SMA 20/50/200 · ATR · Hurst · Pipeline gates"
				title="Regime & Bot"
				subtitle="IHSG composite market-regime filter that gates the entry engines — paper-trade pipeline preserved in backend."
			/>

			<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4 font-mono">
				<StatCard label="Regime" value={snap.data ? <span style={{ color: meta.tone }}>{meta.label}</span> : "—"} sub={snap.data ? meta.desc : "$ regime --sync"} />
				<StatCard label="Index Close" value={snap.data ? fmtNum(snap.data.close) : "—"} />
				<StatCard label="SMA(short) / SMA(long)" value={snap.data ? `${fmtNum(snap.data.sma_short)} / ${fmtNum(snap.data.sma_long)}` : "—"} tone={!snap.data ? "default" : snap.data.close > snap.data.sma_long ? "up" : "down"} />
				<StatCard label="ATR(14)" value={snap.data ? fmtNum(snap.data.atr_value) : "—"} sub={snap.data ? `Hurst ${fmtNum(snap.data.hurst_value, 3)}` : "$ atr --sync"} />
			</div>

			<div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3 font-mono">
				<div className="panel p-4 lg:col-span-2">
					<h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]">$ plot --history | ihsg</h2>
					{!points.length ? (
						<div className="flex h-[280px] items-center justify-center border border-dashed border-[var(--line)] bg-[var(--panel-2)] text-xs text-[var(--text-faint)]">{hist.loading ? "$ fetching history…" : "$ no points"}</div>
					) : (
						<SimpleLineChart data={points} height={280} color="#7dd3fc" />
					)}
				</div>

				<div className="panel p-4">
					<h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-dim)]">$ engines --list</h2>
					{snap.data?.error ? (
						<p className="text-xs text-[var(--down)]">{snap.data.error}</p>
					) : !snap.data ? (
						<p className="font-mono text-xs text-[var(--text-faint)]">$ syncing…</p>
					) : (
						<div className="space-y-1.5">
							{snap.data.allowed_engines.length === 0 ? (
								<p className="text-xs text-[var(--text-faint)]">No engines permitted</p>
							) : (
								snap.data.allowed_engines.map((e) => (
									<div key={e} className="flex items-center justify-between rounded bg-[var(--panel-2)] px-3 py-1.5">
										<span className="font-mono text-xs text-[var(--text)]">{e}</span>
										<span className="text-xs text-[var(--up)]">● active</span>
									</div>
								))
							)}
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
		</Shell>
	);
}
