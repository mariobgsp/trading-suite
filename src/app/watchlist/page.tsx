"use client";

import { useMemo, useState } from "react";
import { api, fmtNum, type Quote } from "@/lib/api";
import Shell from "@/components/Shell";
import { SectionHeader, Skeleton } from "@/components/ui";
import { usePolling } from "@/lib/usePolling";

type WatchRow = {
	ticker: string;
	price: number | null;
	change_percent: number | null;
	volume: number | null;
	liquidity_est: number | null;
	score: number;
};

export default function WatchlistPage() {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");

	const data = usePolling<{ tickers: string[]; quotes: Quote[] }>(
		() => api.get("/api/portfolio/watchlist"),
		60000,
		"watchlist",
	);

	const rows = useMemo<WatchRow[]>(() => {
		const quotesRaw = data.data?.quotes;
		// Backend returns quotes as a dict keyed by symbol (e.g. BBCA.JK).
		const quoteList: Quote[] = Array.isArray(quotesRaw)
			? quotesRaw
			: quotesRaw && typeof quotesRaw === "object"
				? Object.values(quotesRaw as Record<string, Quote>)
				: [];
		const quotes = quoteList.filter((q) => q.price != null);
		return quotes.map((q) => {
			const change = q.change_percent ?? 0;
			const vol = q.volume ?? 0;
			const liq = q.price != null ? q.price * vol : null;
			// Simple composite: momentum + liquidity weighting, bounded 1-99.
			const score = Math.max(
				1,
				Math.min(
					99,
					Math.round(50 + change * 8 + Math.log10(Math.max(1, vol)) * 6),
				),
			);
			return {
				ticker: q.symbol.replace(/\.JK$/, ""),
				price: q.price,
				change_percent: q.change_percent,
				volume: vol,
				liquidity_est: liq,
				score,
			};
		});
	}, [data.data]);

	const sorted = useMemo(
		() => [...rows].sort((a, b) => b.score - a.score),
		[rows],
	);

	const save = async () => {
		const tickers = draft
			.split(/[,\s]+/)
			.map((t) => t.trim().toUpperCase())
			.filter((t) => t.length > 0 && t.length <= 6);
		if (tickers.length === 0) return;
		await api.post("/api/portfolio/watchlist", { tickers });
		setDraft("");
		setEditing(false);
		void data.refresh();
	};

	return (
		<Shell>
			<SectionHeader
				title="Watchlist Intelligence"
				subtitle="Your watchlist with live quotes and a simple momentum + liquidity ranking"
			/>

			{/* Editor */}
			<div className="mb-4 flex items-center gap-2">
				{editing ? (
					<>
						<input
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && void save()}
							placeholder="Comma-separated tickers, e.g. BBCA, BBRI, BMRI"
							className="panel-2 w-full max-w-md px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
						/>
						<button
							onClick={() => void save()}
							className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
						>
							Save
						</button>
						<button
							onClick={() => setEditing(false)}
							className="panel-2 px-3 py-2 text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
						>
							Cancel
						</button>
					</>
				) : (
					<>
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{data.data?.tickers.length ?? 0} tickers tracked
						</span>
						<button
							onClick={() => setEditing(true)}
							className="panel-2 px-3 py-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--accent)]"
						>
							Edit watchlist
						</button>
					</>
				)}
				<div className="ml-auto">
					{data.data?.quotes?.[0] ? (
						<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
							QUOTES
						</span>
					) : null}
				</div>
			</div>

			{data.loading && !data.data ? (
				<Skeleton className="h-72" />
			) : rows.length === 0 ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						Empty watchlist
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						Add tickers to start tracking. Edit the watchlist above — the list is
						stored locally in the backend data directory and enriched with live
						quotes.
					</p>
				</div>
			) : (
				<div className="panel overflow-x-auto p-2">
					<table className="w-full">
						<thead>
							<tr className="border-b border-[var(--line)] text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
								<th className="px-2 py-1">Rank</th>
								<th className="px-2 py-1">Ticker</th>
								<th className="px-2 py-1 text-right">Price</th>
								<th className="px-2 py-1 text-right">Chg</th>
								<th className="px-2 py-1 text-right">Volume</th>
								<th className="px-2 py-1 text-right">Liquidity (est)</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((r) => (
								<tr
									key={r.ticker}
									className="border-b border-[var(--line)]/50 last:border-b-0 hover:bg-[var(--panel-2)]"
								>
									<td className="tabular px-2 py-1.5 font-mono text-[12px] text-right text-[var(--text-dim)]">
										{r.score}
									</td>
									<td className="tabular px-2 py-1.5 font-mono text-[12px] font-bold text-[var(--text)]">
										{r.ticker}
									</td>
									<td className="tabular px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text)]">
										{fmtNum(r.price)}
									</td>
									<td className="px-2 py-1.5 text-right">
										<span
											className={`tabular font-mono text-[11px] font-semibold ${r.change_percent == null || Number.isNaN(r.change_percent) ? "text-[var(--text-faint)]" : r.change_percent >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
										>
											{r.change_percent == null || Number.isNaN(r.change_percent)
												? "—"
												: `${r.change_percent >= 0 ? "▲ " : "▼ "}${fmtNum(r.change_percent, 2)}%`}
										</span>
									</td>
									<td className="tabular px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text)]">
										{fmtNum(r.volume, 0)}
									</td>
									<td className="px-2 py-1.5 text-right font-mono text-[11px]">
										{r.liquidity_est == null ? (
											<span className="tabular text-[var(--text-faint)]">—</span>
										) : (
											<span className="tabular text-[var(--text)]">
												{fmtNum(r.liquidity_est / 1e9, 1)} M IDR
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
				Score = momentum (% change) and volume-weighted liquidity, bounded 1-99. A
				crude composite — official institutional flow signals live in Foreign Flow
				and Broker Intel, sourced from IDX.
			</p>
		</Shell>
	);
}
