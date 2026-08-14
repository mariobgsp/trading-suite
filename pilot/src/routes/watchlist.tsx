import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { api, fmtNum, type Quote } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import {
	DataTable,
	NumCell,
	PctCell,
	StaleChip,
	type Features,
} from "@/components/data-table";

type WatchRow = {
	ticker: string;
	price: number | null;
	change_percent: number | null;
	volume: number | null;
	liquidity_est: number | null;
	score: number;
};

const columns: ColumnDef<Features, WatchRow, unknown>[] = [
	{
		header: "Rank",
		accessorKey: "score",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
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
		header: "Price",
		accessorKey: "price",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} />,
	},
	{
		header: "Chg",
		accessorKey: "change_percent",
		meta: { align: "right" },
		cell: (c) => <PctCell value={c.getValue() as number} />,
	},
	{
		header: "Volume",
		accessorKey: "volume",
		meta: { align: "right" },
		cell: (c) => <NumCell value={c.getValue() as number} digits={0} />,
	},
	{
		header: "Liquidity (est)",
		accessorKey: "liquidity_est",
		meta: { align: "right" },
		cell: (c) => {
			const v = c.getValue() as number | null;
			if (v == null)
				return <span className="mono text-[var(--text-faint)]">—</span>;
			return (
				<span className="mono text-[var(--text)]">
					{fmtNum(v / 1e9, 1)} M IDR
				</span>
			);
		},
	},
];

export const Route = createFileRoute("/watchlist")({
	component: WatchlistPage,
});

function WatchlistPage() {
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
		<div>
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
						<StaleChip asOf={undefined} label="QUOTES" />
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
						Add tickers to start tracking. Edit the watchlist above — the list
						is stored locally in the backend data directory and enriched with
						live quotes.
					</p>
				</div>
			) : (
				<DataTable<WatchRow>
					columns={columns}
					data={rows}
					initialSort={[{ id: "score", desc: true }]}
					rowTone={(r) => ((r.change_percent ?? 0) >= 0 ? "up" : "down")}
					empty="No watchlist data"
				/>
			)}

			<p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
				Score = momentum (% change) and volume-weighted liquidity, bounded 1-99.
				A crude composite — official institutional flow signals live in Foreign
				Flow and Broker Intel, sourced from IDX.
			</p>
		</div>
	);
}
