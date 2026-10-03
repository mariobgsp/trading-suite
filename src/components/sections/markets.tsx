"use client";

import { Suspense, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtNum, type HistoryResponse, type Quote } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { ChangeBadge, SectionHeader, StatCard } from "@/components/ui";
import MarketChart from "@/components/MarketChart";
import MomentumPane from "@/components/MomentumPane";
import ForeignBarsPanel from "@/components/ForeignBarsPanel";

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

export function MarketsSection() {
	return (
		<Suspense fallback={<MarketsLoading />}>
			<MarketsInner />
		</Suspense>
	);
}

function MarketsLoading() {
	return (
		<div className="space-y-5">
			<SectionHeader
				title="Markets"
				subtitle="$ markets --ticker BBCA --period 1y"
			/>
</div>
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
	const [showLpm, setShowLpm] = useState(true);
	const [foreignEnabled, setForeignEnabled] = useState(false);
	// Momentum sub-pane toggles — persist per-user in localStorage so the
	// choice survives reloads and the user doesn't re-enable RSI every time
	// they reopen the page. useSyncExternalStore hydrates on first render
	// (avoids the "setState in effect" cascading-render warning) and keeps
	// the subscribed default stable across SSR/CSR.
	const showRsi = useBoolLocalStorage("markets.showRsi", false);
	const showStoch = useBoolLocalStorage("markets.showStoch", false);
	const showIntensityPane = useBoolLocalStorage(
		"markets.showIntensityPane",
		false,
	);
	const setShowRsi = useLocalStorageSetter("markets.showRsi");
	const setShowStoch = useLocalStorageSetter("markets.showStoch");
	const setShowIntensityPane = useLocalStorageSetter(
		"markets.showIntensityPane",
	);

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
	const lpmPath = `/api/intel/stockbit/lpm/${ticker}?days=60`;
	const stockbitLpm = usePolling<{
		lpm: (number | null)[];
		intensity: number[];
		available: boolean;
	} | null>(
		() =>
			api.getCached<{
				lpm: (number | null)[];
				intensity: number[];
				available: boolean;
			} | null>(lpmPath),
		120000,
		`${ticker}:stockbit-lpm`,
		{ cacheKey: lpmPath },
	);

	const toggleOverlay = (name: string) =>
		setOverlays((prev) =>
			prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
		);

	return (
		<div className="space-y-5">
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
					className="rounded-control bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-[1.05] active:scale-[0.985]"
				>
					Load
				</button>
				<div className="ml-1 flex gap-1">
					{["3mo", "6mo", "1y", "2y"].map((p) => (
						<button
							key={p}
							onClick={() => setPeriod(p)}
							className={`rounded-pill px-3.5 py-1.5 font-mono text-xs font-semibold transition-all ${period === p ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-2)] text-[var(--text-dim)] hover:text-[var(--text)]"}`}
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
					<button
						onClick={() => setShowLpm((v) => !v)}
						className={`rounded-pill px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${showLpm ? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent-dim)]" : "bg-[var(--panel)] text-[var(--text-faint)] hover:bg-[var(--panel-2)]"}`}
					>
						LPM
					</button>
					<button
						onClick={() => setShowIntensityPane(!showIntensityPane)}
						className={`rounded-pill px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${showIntensityPane ? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent-dim)]" : "bg-[var(--panel)] text-[var(--text-faint)] hover:bg-[var(--panel-2)]"}`}
					>
						INTENSITY
					</button>
					<button
						onClick={() => setShowRsi(!showRsi)}
						className={`rounded-pill px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${showRsi ? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent-dim)]" : "bg-[var(--panel)] text-[var(--text-faint)] hover:bg-[var(--panel-2)]"}`}
					>
						RSI
					</button>
					<button
						onClick={() => setShowStoch(!showStoch)}
						className={`rounded-pill px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${showStoch ? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent-dim)]" : "bg-[var(--panel)] text-[var(--text-faint)] hover:bg-[var(--panel-2)]"}`}
					>
						STOCH
					</button>
				</div>
			</div>

			{/* Quote strip — terminal: always inline, never gated */}
			<div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4 font-mono">
				<StatCard
					label={`${ticker} Last`}
					value={quote.data ? fmtNum(quote.data.price) : "—"}
					tone={
						quote.data?.change_percent != null && quote.data.change_percent >= 0
							? "up"
							: quote.data?.change_percent == null
								? "default"
								: "down"
					}
					sub={
						quote.data ? (
							<ChangeBadge value={quote.data.change_percent} />
						) : (
							<span className="text-[var(--text-ghost)]">$ quote --sync</span>
						)
					}
				/>
				<StatCard label="Open" value={quote.data ? fmtNum(quote.data.open) : "—"} />
				<StatCard
					label="Day High"
					value={quote.data ? fmtNum(quote.data.day_high) : "—"}
					tone="up"
				/>
				<StatCard
					label="Day Low"
					value={quote.data ? fmtNum(quote.data.day_low) : "—"}
					tone="down"
				/>
			</div>

			{/* Chart — terminal: never skeleton, stream in place */}
			<div className="panel p-4 font-mono">
				<div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
					<span className="text-[var(--accent)]">▸</span> {ticker} · {period} ·{" "}
					{overlays.join(" ")}{" "}
					{data.isValidating
						? "· syncing…"
						: data.loading && !data.data
							? "· fetching…"
							: "· live"}
				</div>
				{!data.data ? (
					<div className="flex h-[420px] items-center justify-center border border-dashed border-[var(--line)] bg-[var(--panel-2)] text-xs text-[var(--text-faint)]">
						$ load {ticker} --period {period} | fetching…
					</div>
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
							options={{
								showVolume,
								showLpm,
								showIntensity: showIntensityPane,
								overlayIndicators: overlays,
							}}
							stockbitLpm={stockbitLpm.data?.lpm}
							stockbitIntensity={stockbitLpm.data?.intensity}
						/>
						{/* Momentum sub-panes — toggleable, independent, each pinned
						    0–100 with reference lines. Mount order doesn't matter;
						    both are keyed off the same indicators. */}
						{showRsi ? (
							<div className="mt-3 border-t border-[var(--line)] pt-3">
								<MomentumPane
									kind="rsi"
									indicators={data.data.indicators}
									height={140}
								/>
							</div>
						) : null}
						{showStoch ? (
							<div className="mt-3 border-t border-[var(--line)] pt-3">
								<MomentumPane
									kind="stoch"
									indicators={data.data.indicators}
									height={140}
								/>
							</div>
						) : null}
						{showIntensityPane ? (
							<div className="mt-3 border-t border-[var(--line)] pt-3">
								<MomentumPane
									kind="intensity"
									history={data.data.history}
									height={140}
								/>
							</div>
						) : null}
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

			{/* Foreign flow bars — collapsible, backend cached, disabled = no fetch */}
			<ForeignBarsPanel enabled={foreignEnabled} onToggle={setForeignEnabled} />

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
</div>
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

/* ── localStorage hooks ──────────────────────────────────────────────
 * useSyncExternalStore hydrates on first render (no "setState in effect"
 * warning) and keeps the snapshot stable when localStorage is blocked.
 * Writes go through a small subscriber registry so multiple hooks sharing
 * the same key stay in sync.
 */

const lsSubs = new Map<string, Set<() => void>>();

function lsSubscribe(key: string) {
	return (cb: () => void) => {
		let set = lsSubs.get(key);
		if (!set) {
			set = new Set();
			lsSubs.set(key, set);
		}
		set.add(cb);
		return () => {
			set?.delete(cb);
		};
	};
}

function lsGet(key: string, fallback: boolean): boolean {
	try {
		const v = window.localStorage.getItem(key);
		if (v == null) return fallback;
		return v === "1";
	} catch {
		return fallback;
	}
}

function lsSet(key: string, value: boolean) {
	try {
		window.localStorage.setItem(key, value ? "1" : "0");
	} catch {
		/* ignore quota / private-mode */
	}
	const set = lsSubs.get(key);
	if (set) for (const cb of set) cb();
}

function useBoolLocalStorage(key: string, fallback: boolean): boolean {
	// getServerSnapshot keeps SSR deterministic; getSnapshot reads from
	// localStorage on the client.
	return useSyncExternalStore(
		lsSubscribe(key),
		() => lsGet(key, fallback),
		() => fallback,
	);
}

function useLocalStorageSetter(key: string): (next: boolean) => void {
	return (next: boolean) => lsSet(key, next);
}
