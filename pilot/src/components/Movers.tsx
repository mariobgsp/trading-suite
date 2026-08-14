import { useState } from "react";
import {
	fmtNum,
	fmtPct,
	type JciMoversResponse,
	type MoverContribution,
} from "@/lib/api";
import { StaleChip } from "@/components/data-table";

/**
 * IDX Movers — JCI point-contribution leaders/laggards.
 *
 * Follows the klinikpenyesalan.com "Market Pulse" movers board: stocks ranked
 * by their point contribution to the JCI move (PTS) with % of index market
 * value, 1D/5D range toggle, and side-by-side LEADERS / LAGGARDS tables.
 */

const MOVE_COLUMNS = [
	"#",
	"TICKER",
	"PRICE",
	"%CHG",
	"PTS",
	"%IDX MV",
] as const;

function MoversTable({
	title,
	rows,
	tone,
	start,
}: {
	title: string;
	rows: MoverContribution[];
	tone: "up" | "down";
	start: number;
}) {
	return (
		<div className="panel min-w-0 flex-1 overflow-hidden">
			<div
				className={`flex items-center justify-between border-b border-[var(--border)] px-3 py-2 ${
					tone === "up" ? "bg-[var(--up)]/5" : "bg-[var(--down)]/5"
				}`}
			>
				<span
					className={`font-mono text-[10px] uppercase tracking-wider ${
						tone === "up" ? "text-[var(--up)]" : "text-[var(--down)]"
					}`}
				>
					{title}
				</span>
				<span className="mono text-[10px] text-[var(--text-faint)]">
					{rows.length}
				</span>
			</div>
			<div className="max-h-[440px] overflow-y-auto">
				<table className="w-full">
					<thead className="sticky top-0 z-10 bg-[var(--panel-2)]">
						<tr>
							{MOVE_COLUMNS.map((c) => (
								<th
									key={c}
									className={`px-2 py-1.5 text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)] ${
										c === "PRICE" ||
										c === "%CHG" ||
										c === "PTS" ||
										c === "%IDX MV"
											? "text-right"
											: ""
									}`}
								>
									{c}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((r, i) => (
							<tr
								key={r.ticker}
								className="border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--panel-2)]"
							>
								<td className="px-2 py-1 font-mono text-[10px] text-[var(--text-faint)]">
									{start + i}
								</td>
								<td className="px-2 py-1 font-mono text-[11px] font-bold text-[var(--text)]">
									{r.ticker}
								</td>
								<td className="px-2 py-1 text-right font-mono text-[10px] text-[var(--text-dim)]">
									{fmtNum(r.price, 0)}
								</td>
								<td
									className={`px-2 py-1 text-right font-mono text-[10px] font-semibold ${
										r.change_pct >= 0
											? "text-[var(--up)]"
											: "text-[var(--down)]"
									}`}
								>
									{r.change_pct >= 0 ? "▲ " : "▼ "}
									{fmtPct(r.change_pct)}
								</td>
								<td
									className={`px-2 py-1 text-right font-mono text-[10px] font-semibold ${
										(r.pts ?? 0) >= 0
											? "text-[var(--up)]"
											: "text-[var(--down)]"
									}`}
								>
									{r.pts != null
										? (r.pts > 0 ? "+" : "") + fmtNum(r.pts, 3)
										: "—"}
								</td>
								<td className="px-2 py-1 text-right font-mono text-[10px] text-[var(--text-dim)]">
									{r.idx_mv_pct != null ? fmtNum(r.idx_mv_pct, 2) + "%" : "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export default function Movers({ data }: { data: JciMoversResponse | null }) {
	const [range, setRange] = useState<1 | 5>(1);
	// Use 1D data unless 5D is explicitly chosen; the backend caches per range.
	const leaders = data?.leaders ?? [];
	const laggards = data?.laggards ?? [];
	const jci = data?.jci;

	return (
		<div>
			{/* Header row: JCI strip + range toggle */}
			<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-4">
					<div className="flex items-baseline gap-2">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							JCI
						</span>
						<span className="tabular font-mono text-sm font-bold text-[var(--text)]">
							{jci != null ? fmtNum(jci, 2) : "—"}
						</span>
					</div>
					{data && (
						<div className="flex gap-3 font-mono text-[10px] text-[var(--text-dim)]">
							<span className="text-[var(--up)]">▲ {data.up_count}</span>
							<span className="text-[var(--down)]">▼ {data.down_count}</span>
							<span className="text-[var(--text-faint)]">
								— {data.flat_count}
							</span>
						</div>
					)}
				</div>
				<div className="flex items-center gap-3">
					<div className="flex overflow-hidden rounded-md border border-[var(--border)]">
						{[1, 5].map((r) => (
							<button
								key={r}
								onClick={() => setRange(r as 1 | 5)}
								className={`px-3 py-1 font-mono text-[10px] ${
									range === r
										? "bg-[var(--panel-2)] text-[var(--accent)]"
										: "text-[var(--text-faint)] hover:text-[var(--text)]"
								}`}
							>
								{r}D
							</button>
						))}
					</div>
					{data?.as_of ? <StaleChip asOf={data.as_of} label="AS OF" /> : null}
				</div>
			</div>

			{/* Leaders / Laggards */}
			{leaders.length === 0 && laggards.length === 0 ? (
				<div className="flex h-32 items-center justify-center border border-dashed border-[var(--border)] text-xs text-[var(--text-faint)]">
					No movers data yet
				</div>
			) : (
				<div className="flex flex-col gap-4 lg:flex-row">
					<MoversTable
						title="LEADERS"
						rows={leaders.slice(0, 20)}
						tone="up"
						start={1}
					/>
					<MoversTable
						title="LAGGARDS"
						rows={laggards.slice(0, 20)}
						tone="down"
						start={1}
					/>
				</div>
			)}

			<p className="mt-2 font-mono text-[9px] text-[var(--text-faint)]">
				PTS = stock's contribution to the JCI move (change × market-cap weight).
				5D uses the most recent published trading day in the range. Source: IDX
				GetStockSummary / GetIndexSummary.
			</p>
		</div>
	);
}
