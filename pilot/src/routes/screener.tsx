import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { api, fmtNum, type ScreenerResult } from "@/lib/api";
import { useEventSource } from "@/lib/usePolling";
import { ChangeBadge, SectionHeader, Spinner } from "@/components/ui";

const ACTION_TONE: Record<string, string> = {
	"STRONG BUY": "text-[var(--up)]",
	BUY: "text-[var(--up)]",
	WAIT: "text-[var(--gold)]",
	SELL: "text-[var(--down)]",
	"STRONG SELL": "text-[var(--down)]",
};

type SseFrame = {
	event?: string;
	mode?: string;
	total?: number;
	result?: ScreenerResult;
	count?: number;
	results?: ScreenerResult[];
} & Record<string, unknown>;

export const Route = createFileRoute("/screener")({
	component: ScreenerPage,
});

function ScreenerPage() {
	const [mode, setMode] = useState<"behavior" | "squeeze" | "vault">(
		"behavior",
	);
	const [limit, setLimit] = useState(30);
	const [streamUrl, setStreamUrl] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [results, setResults] = useState<ScreenerResult[]>([]);
	const [progress, setProgress] = useState(0);
	const [total, setTotal] = useState(0);
	const [done, setDone] = useState(false);
	const [singleTicker, setSingleTicker] = useState("");
	const [single, setSingle] = useState<ScreenerResult | null>(null);
	const [singleLoading, setSingleLoading] = useState(false);
	const [streamError, setStreamError] = useState<string | null>(null);

	const handleEvent = useCallback((_event: string, frame: SseFrame) => {
		if (frame.total) setTotal(frame.total);
		if (frame.result) {
			setResults((prev) => {
				const next = [...prev];
				const idx = next.findIndex((r) => r.ticker === frame.result?.ticker);
				if (idx >= 0) next[idx] = frame.result!;
				else next.push(frame.result!);
				return next;
			});
			setProgress((p) => p + 1);
		}
		if (frame.event === "done") {
			setDone(true);
			setRunning(false);
			if (frame.results) setResults(frame.results);
		}
	}, []);

	useEventSource<SseFrame>(
		streamUrl,
		handleEvent,
		!!streamUrl,
		() => {
			// clean completion — already handled in handleEvent for safety
			setRunning(false);
		},
		(message) => {
			// unexpected stream death: surface it instead of hanging
			setRunning(false);
			setStreamError(message);
		},
	);

	const startScan = () => {
		setResults([]);
		setProgress(0);
		setDone(false);
		setStreamError(null);
		setRunning(true);
		// Same-origin in the pilot: /api/* is proxied to FastAPI by Vite (dev)
		// and the Hono server (prod). No NEXT_PUBLIC_* env needed anymore.
		setStreamUrl(`/api/screener/scan/stream?mode=${mode}&limit=${limit}`);
	};

	const stopScan = () => {
		setStreamUrl(null);
		setRunning(false);
	};

	const analyzeSingle = async () => {
		if (!singleTicker) return;
		setSingleLoading(true);
		try {
			const res = await api.get<ScreenerResult>(
				`/api/screener/analyze/${singleTicker}?force=false`,
			);
			setSingle(res);
		} catch (e) {
			setSingle({
				...(single ?? {}),
				ticker: singleTicker,
				action: "ERROR",
			} as ScreenerResult);
			console.error(e);
		} finally {
			setSingleLoading(false);
		}
	};

	const sorted = [...results].sort(
		(a, b) => (b.score ?? -99) - (a.score ?? -99),
	);

	// Vault mode uses a different result shape (ma_score) — display category instead
	const vaultResults = results.filter(
		(r) => "category" in r || "ma_score" in r,
	) as VaultRow[];

	return (
		<div>
			<SectionHeader
				title="Screener"
				subtitle="900+ IDX universe — behavior scoring or MA-squeeze scan, streamed live"
			/>
			<div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Single analysis */}
				<div className="panel p-4">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Single Ticker
					</h2>
					<div className="flex gap-2">
						<input
							value={singleTicker}
							onChange={(e) => setSingleTicker(e.target.value.toUpperCase())}
							onKeyDown={(e) => e.key === "Enter" && void analyzeSingle()}
							placeholder="BBCA"
							className="panel-2 w-full px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
						/>
						<button
							onClick={() => void analyzeSingle()}
							disabled={singleLoading}
							className="shrink-0 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
						>
							{singleLoading ? "…" : "Go"}
						</button>
					</div>

					{single && (
						<div className="mt-4 space-y-2 text-sm">
							<div className="flex items-center justify-between">
								<span className="font-mono font-bold text-[var(--text)]">
									{single.ticker}
								</span>
								<span
									className={`font-bold ${ACTION_TONE[single.action] ?? "text-[var(--text)]"}`}
								>
									{single.action}
								</span>
							</div>
							<DetailRow k="Score" v={String(single.score)} />
							<DetailRow k="Trend" v={single.trend_status} />
							<DetailRow k="MACD" v={single.macd_cross} />
							<DetailRow k="RSI" v={single.rsi_desc} />
							<DetailRow k="Stoch" v={single.stoch} />
							<DetailRow k="OBV" v={single.obv_trend} />
							<DetailRow k="Close" v={fmtNum(single.close)} />
							<DetailRow
								k="Liq/day (est)"
								v={fmtNum(single.liquidity_idr_est, 0)}
							/>
							{single.signals?.length > 0 && (
								<div className="flex flex-wrap gap-1 pt-1">
									{single.signals.map((s) => (
										<span
											key={s}
											className="rounded bg-[var(--panel-2)] px-2 py-0.5 font-mono text-[10px] text-[var(--gold)]"
										>
											{s}
										</span>
									))}
								</div>
							)}
						</div>
					)}
				</div>

				{/* Universe scan controls */}
				<div className="panel p-4 lg:col-span-2">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Universe Scan
					</h2>
					<div className="flex flex-wrap items-end gap-3">
						<label className="text-[11px] text-[var(--text-faint)]">
							Mode
							<select
								value={mode}
								onChange={(e) =>
									setMode(e.target.value as "behavior" | "squeeze" | "vault")
								}
								className="panel-2 mt-1 w-52 px-3 py-2 text-sm text-[var(--text)] focus:outline-none"
							>
								<option value="behavior">Behavior scoring</option>
								<option value="squeeze">MA-squeeze</option>
								<option value="vault">Vault MA-positioning</option>
							</select>
						</label>
						<label className="text-[11px] text-[var(--text-faint)]">
							Tickers
							<select
								value={limit}
								onChange={(e) => setLimit(Number(e.target.value))}
								className="panel-2 mt-1 w-32 px-3 py-2 text-sm text-[var(--text)] focus:outline-none"
							>
								{[10, 30, 50, 100, 200].map((n) => (
									<option key={n} value={n}>
										{n}
									</option>
								))}
							</select>
						</label>
						<button
							onClick={running ? stopScan : startScan}
							className={`rounded-md px-5 py-2 text-sm font-semibold ${
								running
									? "bg-[var(--down)] text-white hover:opacity-90"
									: "bg-[var(--accent)] text-black hover:opacity-90"
							}`}
						>
							{running ? "Stop Scan" : done ? "Rescan" : "Start Scan"}
						</button>
						{running && (
							<Spinner label={`Scanning ${progress}/${total || "…"}…`} />
						)}
						{done && !running && (
							<span className="text-xs text-[var(--up)]">
								Done — {results.length} analyzed
							</span>
						)}
						{streamError && !running && (
							<span className="text-xs text-[var(--down)]">
								⚠ {streamError} — press Start Scan to retry
							</span>
						)}
					</div>

					{running && (
						<div className="mt-4 h-1.5 overflow-hidden rounded bg-[var(--panel-2)]">
							<div
								className="h-full bg-[var(--accent)] transition-all"
								style={{ width: `${total ? (progress / total) * 100 : 5}%` }}
							/>
						</div>
					)}

					<p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
						Live scan pulls 2y of daily OHLCV per ticker through the SQLite
						cache (yfinance is rate-limited; scans are throttled and cached).
						Results stream over SSE as each ticker completes.
					</p>
				</div>
			</div>

			{/* Results table */}
			<div className="panel p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Results ({mode === "vault" ? vaultResults.length : sorted.length})
					</h2>
					<span className="font-mono text-[10px] text-[var(--text-faint)]">
						{mode === "vault"
							? "vault MA-positioning score"
							: "sorted by score"}
					</span>
				</div>
				{mode === "vault" ? (
					vaultResults.length === 0 ? (
						<p className="py-10 text-center text-sm text-[var(--text-faint)]">
							Start a vault scan to populate results.
						</p>
					) : (
						<VaultTable rows={vaultResults as VaultRow[]} />
					)
				) : sorted.length === 0 ? (
					<p className="py-10 text-center text-sm text-[var(--text-faint)]">
						Start a scan to populate results.
					</p>
				) : (
					<div className="max-h-[520px] overflow-auto">
						<table className="w-full text-sm">
							<thead className="sticky top-0 bg-[var(--panel)]">
								<tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
									<th className="pb-2">Ticker</th>
									<th className="pb-2">Action</th>
									<th className="pb-2 text-right">Score</th>
									<th className="pb-2 text-right">Close</th>
									<th className="pb-2 text-right">Chg %</th>
									<th className="pb-2">Trend</th>
									<th className="pb-2 text-right">RSI</th>
									<th className="pb-2">Signals</th>
								</tr>
							</thead>
							<tbody>
								{sorted.map((r) => (
									<tr
										key={r.ticker}
										className="border-b border-[var(--border)]/50 hover:bg-[var(--panel-2)]/50"
									>
										<td className="py-2 font-mono font-semibold text-[var(--accent)]">
											{r.ticker}
										</td>
										<td
											className={`py-2 font-bold ${ACTION_TONE[r.action] ?? ""}`}
										>
											{r.action}
										</td>
										<td className="tabular py-2 text-right font-mono">
											{fmtNum(r.score)}
										</td>
										<td className="tabular py-2 text-right font-mono">
											{fmtNum(r.close)}
										</td>
										<td className="py-2 text-right">
											<ChangeBadge value={r.change_pct} />
										</td>
										<td className="py-2 text-xs text-[var(--text-dim)]">
											{r.trend_status}
										</td>
										<td className="tabular py-2 text-right font-mono">
											{fmtNum(r.rsi)}
										</td>
										<td className="py-2">
											<div className="flex max-w-64 flex-wrap gap-1">
												{r.signals?.slice(0, 4).map((s) => (
													<span
														key={s}
														className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-dim)]"
													>
														{s}
													</span>
												))}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

function DetailRow({ k, v }: { k: string; v: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-[var(--border)]/50 pb-1 last:border-0">
			<span className="text-xs text-[var(--text-faint)]">{k}</span>
			<span className="tabular font-mono text-xs text-[var(--text)]">{v}</span>
		</div>
	);
}

interface VaultRow {
	ticker: string;
	category?: string;
	ma_score?: {
		category?: string;
		score?: number;
		overlay?: string;
		close?: number;
		up_off_52w_low?: number | null;
	};
	score?: number;
	close?: number;
	overlay?: string;
}

function VaultTable({ rows }: { rows: VaultRow[] }) {
	return (
		<div className="max-h-[520px] overflow-auto">
			<table className="w-full text-sm">
				<thead className="sticky top-0 bg-[var(--panel)]">
					<tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
						<th className="pb-2">Ticker</th>
						<th className="pb-2">Category</th>
						<th className="pb-2 text-right">Score</th>
						<th className="pb-2 text-right">Close</th>
						<th className="pb-2 text-right">52w Low Gap</th>
						<th className="pb-2">Overlay</th>
					</tr>
				</thead>
				<tbody>
					{rows
						.sort(
							(a, b) =>
								(b.ma_score?.score ?? b.score ?? -99) -
								(a.ma_score?.score ?? a.score ?? -99),
						)
						.map((r) => {
							const cat = r.category ?? r.ma_score?.category ?? "—";
							const score = r.ma_score?.score ?? r.score ?? null;
							const close = r.ma_score?.close ?? r.close ?? null;
							const overlay = r.overlay ?? r.ma_score?.overlay ?? "ok";
							const upLow = r.ma_score?.up_off_52w_low ?? null;
							const catTone = cat.includes("BEST")
								? "text-[var(--up)]"
								: cat.includes("BUY")
									? "text-[var(--accent)]"
									: cat.includes("AVOID")
										? "text-[var(--down)]"
										: "text-[var(--text-dim)]";
							return (
								<tr
									key={r.ticker}
									className="border-b border-[var(--border)]/50 hover:bg-[var(--panel-2)]/50"
								>
									<td className="py-2 font-mono font-semibold text-[var(--accent)]">
										{r.ticker}
									</td>
									<td className={`py-2 text-xs font-semibold ${catTone}`}>
										{cat}
									</td>
									<td className="tabular py-2 text-right font-mono">
										{score != null ? fmtNum(score) : "—"}
									</td>
									<td className="tabular py-2 text-right font-mono">
										{close != null ? fmtNum(close) : "—"}
									</td>
									<td className="tabular py-2 text-right font-mono text-xs text-[var(--text-dim)]">
										{upLow != null ? `+${fmtNum(upLow)}%` : "—"}
									</td>
									<td className="py-2">
										<span
											className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
												overlay === "T1-AVOID"
													? "bg-[var(--down)]/10 text-[var(--down)]"
													: "bg-[var(--up)]/10 text-[var(--up)]"
											}`}
										>
											{overlay}
										</span>
									</td>
								</tr>
							);
						})}
				</tbody>
			</table>
		</div>
	);
}
