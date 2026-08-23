"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtNum, type HistoryResponse, type Quote } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import Shell from "@/components/Shell";
import { ChangeBadge, SectionHeader, StatCard } from "@/components/ui";
import MarketChart from "@/components/MarketChart";

const POPULAR = [
	"BBCA",
	"BBRI",
	"BMRI",
	"BBNI",
	"TLKM",
	"ASII",
	"ADRO",
	"ANTM",
	"MDKA",
	"AMMN",
];

export default function MarketsPage() {
	return (
		<Suspense fallback={<MarketsLoading />}>
			<MarketsInner />
		</Suspense>
	);
}

function MarketsLoading() {
	return (
		<Shell>
			<SectionHeader title="Markets" subtitle="$ markets --ticker BBCA --period 1y" />
		</Shell>
	);
}

function MarketsInner() {
	const params = useSearchParams();
	const initial = params.get("ticker") ?? "BBCA";
	const [ticker, setTicker] = useState(initial.toUpperCase());
	const [period, setPeriod] = useState("1y");
	const [overlays, setOverlays] = useState<string[]>([
		"sma20",
		"sma50",
		"sma200",
	]);
	const [showVolume, setShowVolume] = useState(false);

	const historyPath = `/api/market/history/${ticker}?period=${period}`;
	const quotePath = `/api/market/quote/${ticker}`;
	const data = usePolling<HistoryResponse | null>(
		() => api.getCached<HistoryResponse>(historyPath),
		null,
		`${ticker}:${period}`,
		{ cacheKey: historyPath, keepPreviousData: true },
	);
	const quote = usePolling<Quote>(
		() => api.getCached<Quote>(quotePath),
		15000,
		ticker,
		{ cacheKey: quotePath, keepPreviousData: true },
	);

	const toggleOverlay = (name: string) =>
		setOverlays((prev) =>
			prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
		);

	return (
		<Shell>
			<SectionHeader
				eyebrow="OHLCV · SMA / EMA · Volume"
				title="Markets"
				subtitle="Price action, indicators, and momentum signals — streamed per ticker across 4 periods."
			/>

			{/* Ticker selector */}
			<div className="panel mb-5 flex flex-wrap items-center gap-3 p-3.5 rise-in">
				<input
					value={ticker}
					onChange={(e) => setTicker(e.target.value.toUpperCase())}
					onKeyDown={(e) => {
						if (e.key === "Enter" && ticker) void data.refresh();
					}}
					placeholder="Ticker (e.g. BBCA)"
					className="panel-2 w-36 px-3 py-2 font-mono text-sm font-semibold tracking-wide text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
				/>
				<button
					onClick={() => void data.refresh()}
					className="rounded-control bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-black transition-all hover:brightness-[1.05] active:scale-[0.985]"
				>
					Load
				</button>
				<div className="ml-1 flex gap-1">
					{["3mo", "6mo", "1y", "2y"].map((p) => (
						<button
							key={p}
							onClick={() => setPeriod(p)}
							className={`rounded-pill px-3.5 py-1.5 font-mono text-xs font-semibold transition-all ${period === p ? "bg-[var(--accent)] text-black" : "bg-[var(--panel-2)] text-[var(--text-dim)] hover:text-[var(--text)]"}`}
						>
							{p}
						</button>
					))}
				</div>
				<div className="ml-auto flex flex-wrap gap-1.5">
					{["sma20", "sma50", "sma200", "ema21"].map((n) => (
						<button
							key={n}
							onClick={() => toggleOverlay(n)}
							className={`rounded-pill px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${overlays.includes(n) ? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent-dim)]" : "bg-[var(--panel)] text-[var(--text-faint)] hover:bg-[var(--panel-2)] hover:text-[var(--text-dim)]"}`}
						>
							{n.toUpperCase()}
						</button>
					))}
					<button
						onClick={() => setShowVolume((v) => !v)}
						className={`rounded-pill px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${showVolume ? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent-dim)]" : "bg-[var(--panel)] text-[var(--text-faint)] hover:bg-[var(--panel-2)]"}`}
					>
						VOL
					</button>
				</div>
			</div>

			{/* Quote strip — terminal: always inline, never gated */}
			<div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4 font-mono">
				<StatCard label={`${ticker} Last`} value={quote.data ? fmtNum(quote.data.price) : "—"} tone={quote.data?.change_percent != null && quote.data.change_percent >= 0 ? "up" : quote.data?.change_percent == null ? "default" : "down"} sub={quote.data ? <ChangeBadge value={quote.data.change_percent} /> : <span className="text-[var(--text-ghost)]">$ quote --sync</span>} />
				<StatCard label="Open" value={quote.data ? fmtNum(quote.data.open) : "—"} />
				<StatCard label="Day High" value={quote.data ? fmtNum(quote.data.day_high) : "—"} tone="up" />
				<StatCard label="Day Low" value={quote.data ? fmtNum(quote.data.day_low) : "—"} tone="down" />
			</div>

			{/* Chart — terminal: never skeleton, stream in place */}
			<div className="panel p-4 font-mono">
				<div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
					<span className="text-[var(--accent)]">▸</span> {ticker} · {period} · {overlays.join(" ")} {data.isValidating ? "· syncing…" : data.loading && !data.data ? "· fetching…" : "· live"}
				</div>
				{!data.data ? (
					<div className="flex h-[420px] items-center justify-center border border-dashed border-[var(--line)] bg-[var(--panel-2)] text-xs text-[var(--text-faint)]">$ load {ticker} --period {period} | fetching…</div>
				) : data.data.error ? (
					<p className="py-16 text-center text-sm text-[var(--down)]">{data.data.error}</p>
				) : (
					<>
						<MarketChart history={data.data.history} indicators={data.data.indicators} height={420} options={{ showVolume, overlayIndicators: overlays }} />
						{/* Momentum + latest indicator readout */}
						<div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-6">
							<Readout
								label="Signal"
								value={
									<span
										className={
											data.data.momentum.signal === "BUY" ||
											data.data.momentum.signal === "ACCUMULATE"
												? "text-[var(--up)]"
												: data.data.momentum.signal === "SELL" ||
														data.data.momentum.signal === "REDUCE"
													? "text-[var(--down)]"
													: "text-[var(--gold)]"
										}
									>
										{data.data.momentum.signal}
									</span>
								}
							/>
							<Readout
								label="RSI(14)"
								value={fmtNum(data.data.latest_indicators.rsi)}
							/>
							<Readout
								label="MACD"
								value={fmtNum(data.data.latest_indicators.macd_0)}
							/>
							<Readout
								label="SMA20"
								value={fmtNum(data.data.latest_indicators.sma20)}
							/>
							<Readout
								label="SMA200"
								value={fmtNum(data.data.latest_indicators.sma200)}
							/>
							<Readout
								label="ATR(14)"
								value={fmtNum(data.data.latest_indicators.atr)}
							/>
						</div>
					</>
				)}
			</div>

			{/* Popular tickers */}
			<div className="mt-6 flex flex-wrap gap-2">
				<span className="py-1 text-xs uppercase tracking-wider text-[var(--text-faint)]">
					Popular:
				</span>
				{POPULAR.map((t) => (
					<button
						key={t}
						onClick={() => setTicker(t)}
						className="panel-2 px-3 py-1 font-mono text-xs text-[var(--text-dim)] hover:text-[var(--accent)]"
					>
						{t}
					</button>
				))}
			</div>
		</Shell>
	);
}

function Readout({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="panel-2 p-3">
			<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div className="tabular mt-0.5 font-mono text-sm font-bold text-[var(--text)]">
				{value}
			</div>
		</div>
	);
}
