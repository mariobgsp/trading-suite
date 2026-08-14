import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmtIdr, fmtNum, type JournalStats } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import { DataTable, NumCell, type Features } from "@/components/data-table";

type TickerRow = NonNullable<JournalStats["by_ticker"]>[number];
type MonthRow = { month: string; pnl_idr: number };

const tickerColumns: ColumnDef<Features, TickerRow, unknown>[] = [
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
		header: "Trades",
		accessorKey: "count",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Realized P&L",
		accessorKey: "pnl_idr",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return (
				<span
					className={`mono font-semibold ${v >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
				>
					{v >= 0 ? "+" : ""}
					{fmtIdr(v, true)}
				</span>
			);
		},
	},
];

const monthColumns: ColumnDef<Features, MonthRow, unknown>[] = [
	{
		header: "Month",
		accessorKey: "month",
		cell: (c) => (
			<span className="mono text-[var(--text)]">{c.getValue() as string}</span>
		),
	},
	{
		header: "Realized P&L",
		accessorKey: "pnl_idr",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number;
			return (
				<span
					className={`mono font-semibold ${v >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
				>
					{v >= 0 ? "+" : ""}
					{fmtIdr(v, true)}
				</span>
			);
		},
	},
];

export const Route = createFileRoute("/journal")({
	component: JournalPage,
});

function JournalPage() {
	const stats = usePolling<JournalStats>(
		() => api.get("/api/portfolio/journal/stats"),
		60000,
		"journal-stats",
	);

	return (
		<div>
			<SectionHeader
				title="Trade Journal"
				subtitle="Performance analytics over your FIFO ledger — the same accounting as the Portfolio tool"
			/>
			{stats.loading && !stats.data ? (
				<Skeleton className="h-72" />
			) : stats.data?.note ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						No trades yet
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						{stats.data.note}. Once you log buys and sells in the Portfolio
						tool, this page shows win rate, profit factor, and monthly P&L
						computed from the same FIFO engine.
					</p>
				</div>
			) : stats.data ? (
				<JournalBody stats={stats.data} />
			) : null}
		</div>
	);
}

function JournalBody({ stats }: { stats: JournalStats }) {
	return (
		<>
			{/* KPI strip */}
			<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
				<Kpi label="Closed Trades" value={fmtNum(stats.closed_count ?? 0, 0)} />
				<Kpi
					label="Win Rate"
					value={
						stats.win_rate_pct != null
							? `${fmtNum(stats.win_rate_pct, 1)}%`
							: "—"
					}
					tone={(stats.win_rate_pct ?? 0) >= 50 ? "up" : "down"}
				/>
				<Kpi
					label="Profit Factor"
					value={
						stats.profit_factor != null ? fmtNum(stats.profit_factor, 2) : "—"
					}
					tone={
						(stats.profit_factor ?? 0) >= 1.5
							? "up"
							: (stats.profit_factor ?? 1) < 1
								? "down"
								: "accent"
					}
				/>
				<Kpi
					label="Total P&L"
					value={fmtIdr(stats.total_pnl_idr, true)}
					tone={stats.total_pnl_idr >= 0 ? "up" : "down"}
				/>
			</div>

			{/* Avg win / loss */}
			<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
				<Kpi
					label="Avg Win"
					value={
						stats.avg_win_idr != null ? fmtIdr(stats.avg_win_idr, true) : "—"
					}
					tone="up"
				/>
				<Kpi
					label="Avg Loss"
					value={
						stats.avg_loss_idr != null ? fmtIdr(stats.avg_loss_idr, true) : "—"
					}
					tone="down"
				/>
				<Kpi label="Win/Loss Ratio" value={avgRatio(stats)} tone="accent" />
				<Kpi label="Total Trades" value={fmtNum(stats.trade_count, 0)} />
			</div>

			{/* Monthly P&L bars */}
			{stats.monthly.length > 0 && (
				<div className="panel mb-6 p-4">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Monthly Realized P&L
					</h2>
					<div className="flex h-28 items-end gap-2">
						{stats.monthly.map((m) => (
							<div
								key={m.month}
								className="flex flex-1 flex-col items-center gap-1"
								title={`${m.month}: ${fmtIdr(m.pnl_idr, true)}`}
							>
								<div
									className={`w-full rounded-sm ${m.pnl_idr >= 0 ? "bg-[var(--up)]/70" : "bg-[var(--down)]/70"}`}
									style={{ height: barHeight(m.pnl_idr, stats.monthly) }}
								/>
								<span className="font-mono text-[9px] text-[var(--text-faint)]">
									{m.month.slice(2)}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Tables */}
			<div className="grid gap-4 lg:grid-cols-2">
				<div>
					<h2 className="mb-2 text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
						By Ticker
					</h2>
					<DataTable<TickerRow>
						columns={tickerColumns}
						data={stats.by_ticker}
						empty="No closed trades"
					/>
				</div>
				<div>
					<h2 className="mb-2 text-[11px] uppercase tracking-wider text-[var(--text-dim)]">
						Monthly Series
					</h2>
					<DataTable<MonthRow>
						columns={monthColumns}
						data={stats.monthly}
						empty="No closed trades"
					/>
				</div>
			</div>
		</>
	);
}

function Kpi({
	label,
	value,
	tone = "default",
}: {
	label: string;
	value: React.ReactNode;
	tone?: "up" | "down" | "accent" | "default";
}) {
	const tones: Record<string, string> = {
		default: "text-[var(--text)]",
		up: "text-[var(--up)]",
		down: "text-[var(--down)]",
		accent: "text-[var(--accent)]",
	};
	return (
		<div className="panel p-4">
			<div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div className={`mt-1 font-mono text-xl font-bold ${tones[tone]}`}>
				{value}
			</div>
		</div>
	);
}

function avgRatio(s: JournalStats) {
	if (s.avg_win_idr == null || s.avg_loss_idr == null || s.avg_loss_idr === 0)
		return "—";
	return fmtNum(s.avg_win_idr / s.avg_loss_idr, 2);
}

function barHeight(pnl: number, all: { pnl_idr: number }[]) {
	const max = Math.max(1, ...all.map((m) => Math.abs(m.pnl_idr)));
	const abs = Math.abs(pnl);
	// Min 6% so a lone tiny bar is still visible; scale to container height.
	return `${Math.max(6, (abs / max) * 88)}%`;
}
