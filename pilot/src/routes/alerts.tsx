import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api, fmtNum, type AlertItem, type AlertsResponse } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";

export const Route = createFileRoute("/alerts")({
	component: AlertsPage,
});

/**
 * D-Signal — market-wide technical alert scanner (BidBot-style).
 *
 * Scans the IDX universe for Premium oversold-accumulation, breakout, and
 * morning-spike signals plus an Above-MA ladder. Results are grouped by
 * signal type so the interesting names surface without scrolling a flat
 * 300-row table; each group is collapsible.
 */
const MARKETS = ["IDX", "US", "Crypto"] as const;

type GroupDef = {
	key: string;
	label: string;
	dot: string;
	match: (r: AlertItem) => boolean;
	desc: string;
};

const GROUPS: GroupDef[] = [
	{
		key: "premium",
		label: "Premium",
		dot: "bg-[var(--gold)]",
		match: (r) => r.d_signal === "PREMIUM",
		desc: "oversold akumulasi — sinyal terkuat",
	},
	{
		key: "breakout",
		label: "Breakout",
		dot: "bg-[var(--accent)]",
		match: (r) => r.d_signal === "BREAKOUT",
		desc: "tembus resistance dengan volume",
	},
	{
		key: "spike_pagi",
		label: "Spike Pagi",
		dot: "bg-[var(--up)]",
		match: (r) => r.spike_pagi,
		desc: "lonjakan pagi hari perdagangan",
	},
	{
		key: "full_ladder",
		label: "Full MA Ladder",
		dot: "bg-[var(--violet)]",
		match: (r) => r.ma_ladder.startsWith("Di atas MA3/"),
		desc: "di atas seluruh MA 3–100",
	},
];

function AlertsPage() {
	const [market, setMarket] = useState<(typeof MARKETS)[number]>("IDX");
	const [q, setQ] = useState("");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const alerts = usePolling<AlertsResponse>(
		() => api.get("/api/alerts?limit=300"),
		120000,
	);
	const { data } = alerts;

	const items = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return needle
			? (data?.items ?? []).filter((r) => r.ticker.toLowerCase().includes(needle))
			: (data?.items ?? []);
	}, [data, q]);

	const toggle = (key: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	return (
		<div>
			<SectionHeader
				title="D-Signal"
				subtitle="Scan sinyal teknikal, posisi MA, dan lonjakan pagi untuk saham IDX — dikelompokkan per sinyal"
			/>

			{/* Market tabs — only IDX has backend data; others stubbed disabled. */}
			<div className="mb-4 flex gap-2">
				{MARKETS.map((m) => (
					<button
						key={m}
						type="button"
						disabled={m !== "IDX"}
						onClick={() => setMarket(m)}
						className={`px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
							market === m
								? "bg-[var(--accent)] text-black"
								: "bg-[var(--panel-2)] text-[var(--text-dim)] hover:text-[var(--text)]"
						}`}
					>
						{m}
					</button>
				))}
				<input
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Filter ticker…"
					className="panel-2 ml-auto w-40 px-2 py-1 font-mono text-[11px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
				/>
			</div>

			{/* Counts strip */}
			<div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<CountCard label="Premium" value={data?.counts.premium} tone="gold" />
				<CountCard label="Breakout" value={data?.counts.breakout} tone="accent" />
				<CountCard label="Spike Pagi" value={data?.counts.spike_pagi} tone="up" />
				<CountCard
					label="Full MA Ladder"
					value={data?.counts.full_ladder}
					tone="default"
				/>
			</div>

			{alerts.loading && !data ? (
				<Skeleton className="h-[420px]" />
			) : data && data.available === false && !items.length ? (
				<div className="panel border-[var(--down)]/40 p-8 text-center">
					<p className="text-sm font-semibold text-[var(--down)]">
						Data tidak tersedia
					</p>
					<p className="mt-1 text-xs text-[var(--text-dim)]">
						{data.error ??
							"Upstream IDX/Yahoo tidak dapat dijangkau — coba lagi nanti."}
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{GROUPS.map((g) => {
						const rows = items.filter(g.match);
						if (rows.length === 0 && !q) return null;
						const isCollapsed = collapsed.has(g.key);
						return (
							<div key={g.key} className="panel overflow-hidden p-0">
								<button
									type="button"
									onClick={() => toggle(g.key)}
									className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--panel-2)]"
								>
									<span className={`h-2 w-2 rounded-full ${g.dot}`} />
									<span className="text-sm font-bold uppercase tracking-wider text-[var(--text)]">
										{g.label}
									</span>
									<span
										className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
											g.key === "premium"
												? "bg-[var(--gold)] text-black"
												: g.key === "breakout"
													? "bg-[var(--accent)] text-black"
													: "panel-2 text-[var(--text-dim)]"
										}`}
									>
										{rows.length}
									</span>
									<span className="hidden truncate text-[11px] text-[var(--text-faint)] sm:inline">
										{g.desc}
									</span>
									<span className="ml-auto font-mono text-[10px] text-[var(--text-faint)]">
										{isCollapsed ? "▸" : "▾"}
									</span>
								</button>
								{!isCollapsed && rows.length > 0 && (
									<div className="border-t border-[var(--line)] px-2 pb-2">
										<AlertRow head />
										{rows.map((r) => (
											<AlertRow key={`${g.key}:${r.ticker}`} row={r} />
										))}
									</div>
								)}
							</div>
						);
					})}
					{items.length > 0 &&
						GROUPS.every((g) => items.filter(g.match).length === 0) && (
							<p className="panel py-6 text-center font-mono text-[10px] text-[var(--text-faint)]">
								Tidak ada sinyal pada scan ini
							</p>
						)}
				</div>
			)}
		</div>
	);
}

function AlertRow({ row, head }: { row?: AlertItem; head?: boolean }) {
	if (head || !row)
		return (
			<div className="flex items-center gap-3 border-b border-[var(--line)] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
				<span className="w-16">Ticker</span>
				<span className="ml-auto w-20 text-right">Price</span>
				<span className="w-16 text-right">Chg</span>
				<span className="w-14 text-right">RSI</span>
				<span className="hidden w-56 md:block">Posisi MA</span>
			</div>
		);
	return (
		<div className="flex items-center gap-3 border-b border-[var(--line)] px-2 py-1.5 last:border-b-0 hover:bg-[var(--panel-2)]">
			<span className="w-16 font-mono text-[12px] font-bold text-[var(--text)]">
				{row.ticker}
			</span>
			<span className="mono ml-auto w-20 text-right text-[11px] text-[var(--text)]">
				{fmtPrice(row.price)}
			</span>
			<span
				className={`mono w-16 text-right text-[11px] font-semibold ${
					row.change_percent >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
				}`}
			>
				{row.change_percent >= 0 ? "+" : ""}
				{fmtNum(row.change_percent, 2)}%
			</span>
			<span className="mono w-14 text-right text-[11px] text-[var(--text-dim)]">
				{row.rsi != null ? fmtNum(row.rsi, 1) : "—"}
			</span>
			<span className="hidden w-56 truncate text-[10px] text-[var(--text-faint)] md:block">
				{row.ma_ladder}
			</span>
		</div>
	);
}

function fmtPrice(v: number) {
	return v >= 1000 ? fmtNum(v, 0) : fmtNum(v, 2);
}

function CountCard({
	label,
	value,
	tone,
}: {
	label: string;
	value: number | undefined;
	tone: "gold" | "accent" | "up" | "default";
}) {
	const tones: Record<string, string> = {
		gold: "text-[var(--gold)]",
		accent: "text-[var(--accent)]",
		up: "text-[var(--up)]",
		default: "text-[var(--text)]",
	};
	return (
		<div className="panel p-4">
			<div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div className={`mt-1 font-mono text-2xl font-bold ${tones[tone]}`}>
				{value ?? "—"}
			</div>
		</div>
	);
}
