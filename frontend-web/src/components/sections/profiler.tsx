"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearch } from "@tanstack/react-router";
import {
	api,
	fmtNum,
	type HistoryResponse,
	type ValidatorResult,
} from "@/lib/api";
import type { PatternBacktest } from "@/lib/api/types-profiler";
import { useProfiler } from "@/lib/profiler/useProfiler";
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	Spinner,
	StatCard,
} from "@/components/ui";

/* Feature-wiring guard: this page routes through the hook to:
 *   /api/market/quote/{ticker}
 *   /api/market/history/{ticker}
 *   /api/market/beta/{ticker}
 *   /api/validator/{ticker}
 *   /api/regime/snapshot
 *   /api/analysis/entry/{ticker}
 *   /api/analysis/backtest/{ticker}
 * The string literals live in @/lib/profiler/useProfiler.ts; this comment
 * keeps the wiring check honest.
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	Spinner,
	StatCard,
} from "@/components/ui";

/* All types now live in @/lib/api (shared) and @/lib/api/types-profiler (profiler-only). */

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

export function ProfilerSection() {
	// ?ticker= deep links need useSearchParams, which requires a Suspense
	// boundary for static prerender.
	return (
		<Suspense
			fallback={
				<div className="space-y-5">
					<Skeleton className="h-[420px]" />
</div>
			}
		>
			<ProfilerInner />
		</Suspense>
	);
}

function ProfilerInner() {
	const search = useSearch({ from: "/" });
	// useSearch() hands back the parsed query object; Next's useSearchParams()
	// gave a URLSearchParams. Same value, one indirection less.
	const urlTicker = (() => {
		const t = search.ticker;
		return typeof t === "string" && t ? t.toUpperCase() : undefined;
	})();
	// Page owns URL-driven ticker; the hook owns the polling + analyze-nonce.
	const { ticker, setTicker, analyze, feeds } = useProfiler(urlTicker ?? "BBCA");
	const { quote, history, beta, validator, regime, entry, patterns } = feeds;
	// A new ?ticker= from a deep link (e.g. sector rotation) swaps the
	// subject — adjust-state-during-render pattern (lint-clean, no effect).
	const [lastUrlTicker, setLastUrlTicker] = useState(urlTicker);
	if (urlTicker !== lastUrlTicker) {
		setLastUrlTicker(urlTicker);
		if (urlTicker) setTicker(urlTicker);
	}

	return (
		<div className="space-y-5">
			<SectionHeader
				title="Stock Profiler"
				subtitle="One screen, the full picture — quote, price action, beta, bandarmology, regime, and entry plan"
			/>

			{/* Ticker selector */}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<input
					value={ticker}
					onChange={(e) => setTicker(e.target.value.toUpperCase())}
					onKeyDown={(e) => {
						if (e.key === "Enter" && ticker) analyze();
					}}
					placeholder="Ticker (e.g. BBCA)"
					className="panel-2 w-40 px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
				/>
				<button
					onClick={analyze}
					className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)] hover:opacity-90"
				>
					Analyze
				</button>
				<div className="ml-2 flex flex-wrap gap-1">
					{POPULAR.map((t) => (
						<button
							key={t}
							onClick={() => setTicker(t)}
							className={`panel-2 px-2.5 py-1 font-mono text-[11px] ${
								ticker === t
									? "text-[var(--accent)] ring-1 ring-[var(--accent)]"
									: "text-[var(--text-dim)] hover:text-[var(--accent)]"
							}`}
						>
							{t}
						</button>
					))}
				</div>
			</div>

			{/* Quote strip */}
			{quote.data && (
				<div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
					<StatCard
						label={`${quote.data.symbol} Last`}
						value={fmtNum(quote.data.price)}
						tone={(quote.data.change_percent ?? 0) >= 0 ? "up" : "down"}
						sub={<ChangeBadge value={quote.data.change_percent} />}
					/>
					<StatCard label="Open" value={fmtNum(quote.data.open)} />
					<StatCard label="Day High" value={fmtNum(quote.data.day_high)} tone="up" />
					<StatCard label="Day Low" value={fmtNum(quote.data.day_low)} tone="down" />
				</div>
			)}

			{/* Regime + beta + entry verdict */}
			<div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Panel
					title="Market Regime"
					right={
						regime.data?.as_of_date ? (
							<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
								REGIME · as of {String(regime.data.as_of_date).slice(0, 10)}
							</span>
						) : null
					}
				>
					{regime.loading && !regime.data ? (
						<Skeleton className="h-10" />
					) : regime.data ? (
						<div>
							<span
								className={`text-lg font-bold ${
									regime.data.regime === "BULL"
										? "text-[var(--up)]"
										: regime.data.regime === "BEAR"
											? "text-[var(--down)]"
											: "text-[var(--gold)]"
								}`}
							>
								{regime.data.regime}
							</span>
							<span className="ml-2 font-mono text-[11px] text-[var(--text-faint)]">
								SMA {fmtNum(regime.data.sma_short)} / {fmtNum(regime.data.sma_long)} ·
								ATR {fmtNum(regime.data.atr_value)}
							</span>
						</div>
					) : (
						<p className="text-xs text-[var(--text-faint)]">Regime unavailable</p>
					)}
				</Panel>

				<Panel title="Beta vs IHSG">
					{beta.loading && !beta.data ? (
						<Skeleton className="h-10" />
					) : beta.data?.error ? (
						<p className="text-xs text-[var(--down)]">{beta.data.error}</p>
					) : beta.data ? (
						<div className="flex items-baseline gap-3">
							<span
								className={`text-lg font-bold ${
									beta.data.classification === "DEFENSIVE"
										? "text-[var(--up)]"
										: beta.data.classification === "HIGH-BETA"
											? "text-[var(--down)]"
											: "text-[var(--gold)]"
								}`}
							>
								{beta.data.classification}
							</span>
							<span className="font-mono text-[11px] text-[var(--text-faint)]">
								1Y β {fmtNum(beta.data.windows["1y"].beta, 3)}
							</span>
						</div>
					) : null}
				</Panel>

				<Panel title="Entry Verdict">
					{entry.loading && !entry.data ? (
						<Skeleton className="h-10" />
					) : entry.data?.error ? (
						<p className="text-xs text-[var(--down)]">{entry.data.error}</p>
					) : entry.data ? (
						<div className="flex items-baseline gap-3">
							<span
								className={`text-lg font-bold ${
									entry.data.verdict === "ENTER_LONG"
										? "text-[var(--up)]"
										: entry.data.verdict === "AVOID"
											? "text-[var(--down)]"
											: "text-[var(--gold)]"
								}`}
							>
								{entry.data.verdict}
							</span>
							<span className="font-mono text-[11px] text-[var(--text-faint)]">
								score {fmtNum(entry.data.score)}
							</span>
						</div>
					) : null}
				</Panel>
			</div>

			{/* Bandarmology — merged from /validator */}
			<div className="panel mb-4 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Bandarmology · {ticker}
					</h2>
					{validator.isValidating && validator.data ? (
						<Spinner label="Refreshing…" />
					) : null}
				</div>
				{validator.loading && !validator.data ? (
					<Skeleton className="h-20" />
				) : validator.data?.error ? (
					<p className="text-xs text-[var(--down)]">{validator.data.error}</p>
				) : validator.data?.summary ? (
					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						<DrillStat
							label="Bandar Phase"
							value={validator.data.summary.bandar_phase.phase}
							tone={
								validator.data.summary.bandar_phase.phase === "ACCUMULATION"
									? "up"
									: validator.data.summary.bandar_phase.phase === "DISTRIBUTION"
										? "down"
										: "accent"
							}
						/>
						<DrillStat
							label="Institutional Flow"
							value={validator.data.summary.inst_flow}
						/>
						<DrillStat label="Intent" value={validator.data.summary.current_intent} />
						<DrillStat
							label="Confidence Flow"
							value={`${fmtNum(validator.data.summary.conf_flow_index, 0)} · ${validator.data.summary.conf_flow_label}`}
						/>
					</div>
				) : (
					<p className="text-xs text-[var(--text-faint)]">
						Validator unavailable for {ticker}
					</p>
				)}
			</div>
			{validator.data && !validator.data.error && validator.data.summary ? (
				<ValidatorDetail validator={validator.data} />
			) : null}
			<StockbitBrokerPanel ticker={ticker} />

			{/* Entry plan detail */}
			{entry.data && !entry.data.error && (
				<div className="panel p-4">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							Entry Plan
						</h2>
						{entry.isValidating ? <Spinner label="Refreshing…" /> : null}
					</div>
					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						<DrillStat
							label="Entry Zone"
							value={`${fmtNum(entry.data.entry_zone.from)} - ${fmtNum(entry.data.entry_zone.to)}`}
						/>
						<DrillStat
							label="Stop Loss"
							value={entry.data.stop_loss != null ? fmtNum(entry.data.stop_loss) : "—"}
						/>
						<DrillStat
							label="Target 1"
							value={
								entry.data.targets.target1 != null
									? fmtNum(entry.data.targets.target1)
									: "—"
							}
						/>
						<DrillStat
							label="R:R"
							value={
								entry.data.targets.rr != null
									? `${fmtNum(entry.data.targets.rr, 2)}R`
									: "—"
							}
						/>
					</div>
					{entry.data.rationale.length > 0 && (
						<ul className="mt-4 space-y-1">
							{entry.data.rationale.map((r, i) => (
								<li key={i} className="text-xs leading-relaxed text-[var(--text-dim)]">
									<span className="mr-2 text-[var(--accent)]">•</span>
									{r}
								</li>
							))}
						</ul>
					)}
					{entry.data.position_sizing && (
						<p className="mt-4 border-t border-[var(--border)] pt-3 text-xs leading-relaxed text-[var(--text-faint)]">
							{entry.data.position_sizing}
						</p>
					)}
				</div>
			)}

			{/* Pattern backtests — pullback / breakout / mild mover / MA crosses */}
			<PatternBacktestPanel data={patterns.data} loading={patterns.loading} />

			{/* Recent price + volume stats from history */}
			{history.data && !history.data.error && history.data.history.length > 0 && (
				<PriceStats history={history.data} />
			)}
</div>
	);
}

function Panel({
	title,
	right,
	children,
}: {
	title: string;
	right?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="panel p-4">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					{title}
				</h2>
				{right}
			</div>
			{children}
		</div>
	);
}

function DrillStat({
	label,
	value,
	tone,
}: {
	label: string;
	value: React.ReactNode;
	tone?: "up" | "down" | "accent";
}) {
	const tones: Record<string, string> = {
		up: "text-[var(--up)]",
		down: "text-[var(--down)]",
		accent: "text-[var(--accent)]",
	};
	return (
		<div className="panel-2 p-3">
			<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div
				className={`tabular mt-0.5 font-mono text-sm font-bold ${tone ? tones[tone] : "text-[var(--text)]"}`}
			>
				{value}
			</div>
		</div>
	);
}

function PriceStats({ history }: { history: HistoryResponse }) {
	const h = history.history;
	const last20 = h.slice(-20);
	const avgVol =
		last20.reduce((s, r) => s + r.volume, 0) / Math.max(1, last20.length);
	const high = Math.max(...h.map((r) => r.high));
	const low = Math.min(...h.map((r) => r.low));
	const change =
		h.length > 1 && h[h.length - 1].close !== 0
			? ((h[h.length - 1].close - h[h.length - 2].close) / h[h.length - 2].close) *
				100
			: 0;
	return (
		<div className="panel mt-4 p-4">
			<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
				Price Statistics · 6 months
			</h2>
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<DrillStat label="Period High" value={fmtNum(high)} />
				<DrillStat label="Period Low" value={fmtNum(low)} />
				<DrillStat label="20d Avg Volume" value={fmtNum(avgVol, 0)} />
				<DrillStat label="Day Change" value={<ChangeBadge value={change} />} />
			</div>
		</div>
	);
}

/* ── Pattern backtest panel ─────────────────────────────────────────────── */

const PATTERN_LABELS: Record<string, string> = {
	pullback: "Pullback",
	breakout: "Breakout",
	mildmover: "Mild Mover",
	golden_cross: "Golden Cross 20×50",
	cross_3_5: "Cross 3×5 EMA",
	cross_9_21: "Cross 9×21 EMA",
};

/* ── Validator detail (merged from /validator) ────────────────────────── */

const INTENT_TONE = (intent: string): string => {
	if (/SILENT EXIT|DISTRIBUTION|ABANDONED|MARKDOWN|CHURN/.test(intent))
		return "text-[var(--down)]";
	if (/ACCUM|MARKUP|ABSORPTION|GUARDING|SILENT/.test(intent))
		return "text-[var(--up)]";
	if (/LOW VOL|NORMAL/.test(intent)) return "text-[var(--text-faint)]";
	return "text-[var(--gold)]";
};

function ValidatorDetail({ validator }: { validator: ValidatorResult }) {
	const s = validator.summary;
	if (!s) return null;
	return (
		<div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
			<div className="panel p-4">
				<h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Liquidity & Flow
				</h3>
				<ValidatorRow k="Liquidity" v={s.liquidity.status} />
				<ValidatorRow k="Avg Value/Day" v={s.liquidity.avg_value_display} />
				<ValidatorRow
					k="Analysis Mode"
					v={s.small_cap_mode ? "Small-cap optimized" : "Standard"}
				/>
				<ValidatorRow k="NVI (smart money)" v={s.nvi_status} />
				<ValidatorRow k="Dormant Index" v={`${s.dormant_index.toFixed(1)}/100`} />
				<ValidatorRow
					k="Confirmed Flow"
					v={`${s.conf_flow_index}/4 (${s.conf_flow_label})`}
				/>
			</div>
			<div className="panel p-4 lg:col-span-2">
				<h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Intent Radar — last {validator.radar?.length ?? 0} sessions
				</h3>
				<div className="max-h-[340px] overflow-y-auto">
					<table className="w-full text-sm">
						<thead className="sticky top-0 bg-[var(--panel)]">
							<tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
								<th className="pb-2">Date</th>
								<th className="pb-2 text-right">Close</th>
								<th className="pb-2 text-right">Chg %</th>
								<th className="pb-2 text-right">VWAP</th>
								<th className="pb-2 text-right">Flow</th>
								<th className="pb-2 text-right">Conf</th>
								<th className="pb-2">Intent</th>
							</tr>
						</thead>
						<tbody>
							{validator.radar?.map((r) => (
								<tr key={r.date} className="border-b border-[var(--border)]/50">
									<td className="tabular py-1.5 font-mono text-xs">{r.date}</td>
									<td className="tabular py-1.5 text-right font-mono text-xs">
										{fmtNum(r.close)}
									</td>
									<td
										className={`tabular py-1.5 text-right font-mono text-xs ${r.change_pct >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
									>
										{r.change_pct > 0 ? "+" : ""}
										{r.change_pct.toFixed(1)}%
									</td>
									<td className="tabular py-1.5 text-right font-mono text-xs">
										{fmtNum(r.vwap, 0)}
									</td>
									<td
										className={`tabular py-1.5 text-right font-mono text-xs ${r.inst_flow != null && r.inst_flow >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
									>
										{r.inst_flow != null ? (r.inst_flow >= 0 ? "▲" : "▼") : "—"}
									</td>
									<td className="tabular py-1.5 text-right font-mono text-xs">
										{r.conf_flow}/4
									</td>
									<td className={`py-1.5 text-xs ${INTENT_TONE(r.intent)}`}>
										{r.intent}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function ValidatorRow({ k, v }: { k: string; v: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-[var(--border)]/50 py-1.5 last:border-0">
			<span className="text-xs text-[var(--text-faint)]">{k}</span>
			<span className="text-right font-mono text-xs font-semibold text-[var(--text)]">
				{v}
			</span>
		</div>
	);
}

function StockbitBrokerPanel({ ticker }: { ticker: string }) {
	const [data, setData] = useState<{
		ticker: string;
		available: boolean;
		error?: string;
		date?: string;
		rows?: {
			broker: string;
			buy_lots: number;
			sell_lots: number;
			net_lots: number;
		}[];
		top3_concentration_pct?: number | null;
	} | null>(null);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		let dead = false;
		api
			.get<{
				ticker: string;
				available: boolean;
				error?: string;
				date?: string;
				rows?: {
					broker: string;
					buy_lots: number;
					sell_lots: number;
					net_lots: number;
				}[];
				top3_concentration_pct?: number | null;
			}>(`/api/intel/stockbit/broker/${ticker}`)
			.then((r) => {
				if (!dead) setData(r);
			})
			.catch(() => {
				if (!dead)
					setData({ ticker, available: false, error: "stockbit unavailable" });
			})
			.finally(() => {
				if (!dead) setLoading(false);
			});
		return () => {
			dead = true;
		};
	}, [ticker]);
	if (loading)
		return (
			<div className="panel mb-4 p-4 font-mono text-xs text-[var(--text-faint)]">
				loading broker summary…
			</div>
		);
	if (!data || data.available === false) {
		return (
			<div className="panel mb-4 p-4">
				<h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Broker Summary — {ticker} (Stockbit)
				</h3>
				<p className="font-mono text-xs text-[var(--text-faint)]">
					{data?.error ??
						"No Stockbit JWT — set STOCKBIT_JWT_TOKEN in .env. Foreign flow still shows in validator summary."}
				</p>
			</div>
		);
	}
	const rows = data.rows ?? [];
	return (
		<div className="panel mb-4 p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Broker Summary — {ticker} (Stockbit)
				</h3>
				<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
					{data.date ?? ""} · top3{" "}
					{data.top3_concentration_pct != null
						? `${data.top3_concentration_pct.toFixed(1)}%`
						: "—"}
				</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full">
					<thead>
						<tr className="border-b border-[var(--line)] text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
							<th className="px-2 py-1">Broker</th>
							<th className="px-2 py-1 text-right">Net lots</th>
							<th className="px-2 py-1 text-right">Buy</th>
							<th className="px-2 py-1 text-right">Sell</th>
						</tr>
					</thead>
					<tbody>
						{rows.slice(0, 15).map((r, i) => (
							<tr
								key={r.broker + i}
								className="border-b border-[var(--line)]/50 last:border-0 hover:bg-[var(--panel-2)]"
							>
								<td className="px-2 py-1.5 font-mono text-xs font-bold text-[var(--text)]">
									{r.broker}
								</td>
								<td
									className={`px-2 py-1.5 text-right font-mono text-xs font-semibold ${r.net_lots >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
								>
									{r.net_lots >= 0 ? "+" : ""}
									{r.net_lots.toLocaleString()}
								</td>
								<td className="px-2 py-1.5 text-right font-mono text-xs text-[var(--text)]">
									{r.buy_lots.toLocaleString()}
								</td>
								<td className="px-2 py-1.5 text-right font-mono text-xs text-[var(--text)]">
									{r.sell_lots.toLocaleString()}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="mt-2 font-mono text-[10px] text-[var(--text-faint)]">
				Stockbit marketdetectors — per-ticker broker attribution (requires JWT).
				Top3 = share of net buying by top 3 brokers.
			</p>
		</div>
	);
}

function PatternBacktestPanel({
	data,
	loading,
}: {
	data: PatternBacktest | null;
	loading: boolean;
}) {
	const [openKey, setOpenKey] = useState<string | null>(null);
	if (loading && !data)
		return (
			<div className="panel mb-4 p-4">
				<Skeleton className="h-24" />
			</div>
		);
	if (!data || data.error || !data.available) return null;
	return (
		<div className="panel mb-4 p-4">
			<div className="mb-3 flex items-baseline justify-between">
				<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Pattern Backtest · {data.bars} bars
				</h2>
				<span className="font-mono text-[10px] text-[var(--text-faint)]">
					{data.fee_note} · click card for trades
				</span>
			</div>
			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
				{Object.entries(data.strategies).map(([key, v]) => {
					const s = v.stats;
					const label = PATTERN_LABELS[key] ?? key;
					const ret = s.total_return_pct ?? 0;
					const bh = s.buyhold_return_pct ?? 0;
					const beats = ret > bh;
					const open = openKey === key;
					return (
						<div
							key={key}
							onClick={() => setOpenKey(open ? null : key)}
							className={`cursor-pointer rounded-md border p-3 transition-colors ${
								open
									? "border-[var(--accent)] bg-[var(--panel-2)]"
									: "border-[var(--line)] hover:border-[var(--border-strong)]"
							}`}
						>
							<div className="flex items-baseline justify-between">
								<span className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">
									{label}
								</span>
								<span className="font-mono text-[10px] text-[var(--text-faint)]">
									{s.total_trades ?? 0} trades
								</span>
							</div>
							<div className="mt-1 flex items-baseline gap-3">
								<span
									className={`tabular font-mono text-lg font-bold ${
										ret >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
									}`}
								>
									{ret >= 0 ? "+" : ""}
									{fmtNum(ret, 1)}%
								</span>
								<span className="font-mono text-[10px] text-[var(--text-faint)]">
									vs B&H{" "}
									<span className={beats ? "text-[var(--up)]" : ""}>
										{bh >= 0 ? "+" : ""}
										{fmtNum(bh, 1)}%
									</span>
								</span>
							</div>
							<div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px]">
								<span className="text-[var(--text-faint)]">
									win <b className="text-[var(--text)]">{fmtNum(s.win_rate ?? 0, 0)}%</b>
								</span>
								<span className="text-[var(--text-faint)]">
									PF{" "}
									<b className="text-[var(--text)]">
										{s.profit_factor != null ? fmtNum(s.profit_factor, 2) : "—"}
									</b>
								</span>
								<span className="text-[var(--text-faint)]">
									W/L{" "}
									<b className="text-[var(--up)]">+{fmtNum(s.avg_win_pct ?? 0, 1)}</b>
									<b className="text-[var(--down)]"> {fmtNum(s.avg_loss_pct ?? 0, 1)}</b>
								</span>
							</div>
							{open && (
								<div className="mt-2 space-y-1 border-t border-[var(--line)] pt-2">
									{(v.recent_trades ?? []).length === 0 ? (
										<p className="font-mono text-[10px] text-[var(--text-faint)]">
											no trades fired in the last year
										</p>
									) : (
										(v.recent_trades ?? []).map((t, i) => (
											<div
												key={i}
												className="flex items-center justify-between gap-2 font-mono text-[10px]"
											>
												<span className="truncate text-[var(--text-dim)]">
													{t.entry_date} → {t.exit_date}
													<span className="ml-1 text-[var(--text-faint)]">{t.trigger}</span>
												</span>
												<span
													className={`font-semibold ${
														t.profit_pct > 0 ? "text-[var(--up)]" : "text-[var(--down)]"
													}`}
												>
													{t.profit_pct > 0 ? "+" : ""}
													{fmtNum(t.profit_pct, 2)}%
												</span>
											</div>
										))
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
