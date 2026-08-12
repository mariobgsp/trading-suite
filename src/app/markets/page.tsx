"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtNum, type HistoryResponse, type Quote } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import Shell from "@/components/Shell";
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	StatCard,
} from "@/components/ui";
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
			<SectionHeader title="Markets" subtitle="Loading…" />
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

	const data = usePolling<HistoryResponse | null>(
		() => api.get(`/api/market/history/${ticker}?period=${period}`),
		null,
		`${ticker}:${period}`,
	);
	const quote = usePolling<Quote>(
		() => api.get(`/api/market/quote/${ticker}`),
		15000,
		ticker,
	);

	const toggleOverlay = (name: string) =>
		setOverlays((prev) =>
			prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
		);

	return (
		<Shell>
			<SectionHeader
				title="Markets"
				subtitle="Price action, indicators, and momentum signals"
			/>

			{/* Ticker selector */}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<input
					value={ticker}
					onChange={(e) => setTicker(e.target.value.toUpperCase())}
					onKeyDown={(e) => {
						if (e.key === "Enter" && ticker) void data.refresh();
					}}
					placeholder="Ticker (e.g. BBCA)"
					className="panel-2 w-40 px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
				/>
				<button
					onClick={() => void data.refresh()}
					className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
				>
					Load
				</button>
				<div className="ml-2 flex gap-1">
					{["3mo", "6mo", "1y", "2y"].map((p) => (
						<button
							key={p}
							onClick={() => setPeriod(p)}
							className={`rounded-md px-3 py-1.5 font-mono text-xs ${
								period === p
									? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent)]"
									: "text-[var(--text-dim)] hover:bg-[var(--panel-2)]"
							}`}
						>
							{p}
						</button>
					))}
				</div>
				<div className="ml-auto flex flex-wrap gap-1">
					{["sma20", "sma50", "sma200", "ema21"].map((n) => (
						<button
							key={n}
							onClick={() => toggleOverlay(n)}
							className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] ${
								overlays.includes(n)
									? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent)]"
									: "text-[var(--text-faint)] hover:bg-[var(--panel-2)]"
							}`}
						>
							{n.toUpperCase()}
						</button>
					))}
					<button
						onClick={() => setShowVolume((v) => !v)}
						className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] ${
							showVolume
								? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent)]"
								: "text-[var(--text-faint)] hover:bg-[var(--panel-2)]"
						}`}
					>
						VOL
					</button>
				</div>
			</div>

			{/* Quote strip */}
			{quote.data && (
				<div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
					<StatCard
						label={`${quote.data.symbol} Last`}
						value={fmtNum(quote.data.price)}
						tone={
							quote.data.change_percent != null &&
							quote.data.change_percent >= 0
								? "up"
								: "down"
						}
						sub={<ChangeBadge value={quote.data.change_percent} />}
					/>
					<StatCard label="Open" value={fmtNum(quote.data.open)} />
					<StatCard
						label="Day High"
						value={fmtNum(quote.data.day_high)}
						tone="up"
					/>
					<StatCard
						label="Day Low"
						value={fmtNum(quote.data.day_low)}
						tone="down"
					/>
				</div>
			)}

			{/* Chart */}
			<div className="panel p-4">
				{data.loading || !data.data ? (
					<Skeleton className="h-[420px]" />
				) : data.data.error ? (
					<p className="py-16 text-center text-sm text-[var(--down)]">
						{data.data.error}
					</p>
				) : (
					<>
						<MarketChart
							history={data.data.history}
							indicators={data.data.indicators}
							height={420}
							options={{ showVolume, overlayIndicators: overlays }}
						/>
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
