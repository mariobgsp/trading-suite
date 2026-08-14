import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api, fmtNum } from "@/lib/api";
import type {
	BetaResult,
	EntryPlan,
	HistoryResponse,
	Quote,
	RegimeSnapshot,
	ValidatorResult,
} from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	Spinner,
	StatCard,
} from "@/components/ui";
import { StaleChip } from "@/components/data-table";

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

export const Route = createFileRoute("/profiler")({
	component: ProfilerPage,
});

function ProfilerPage() {
	const [ticker, setTicker] = useState("BBCA");
	// Clicking Analyze bumps the nonce: every panel refetches with force=true
	// (fresh recompute — the backend caches the finished entry plan, so
	// repeated clicks stay fast).
	const [analyzeNonce, setAnalyzeNonce] = useState(0);
	// Endpoints without a query string take "?force=true"; the history
	// endpoint already has ?period=6mo, so it takes "&force=true".
	const forceQ = analyzeNonce > 0 ? "?force=true" : "";
	const forceAmp = analyzeNonce > 0 ? "&force=true" : "";

	const quote = usePolling<Quote>(
		() => api.get(`/api/market/quote/${ticker}${forceQ}`),
		30000,
		`${ticker}:${analyzeNonce}`,
	);
	const history = usePolling<HistoryResponse | null>(
		() => api.get(`/api/market/history/${ticker}?period=6mo${forceAmp}`),
		null,
		`${ticker}:${analyzeNonce}`,
	);
	const beta = usePolling<BetaResult>(
		() => api.get(`/api/market/beta/${ticker}${forceQ}`),
		60000,
		`${ticker}:${analyzeNonce}`,
	);
	const validator = usePolling<ValidatorResult | null>(
		() => api.get(`/api/validator/${ticker}${forceQ}`),
		60000,
		`${ticker}:${analyzeNonce}`,
	);
	const regime = usePolling<RegimeSnapshot>(
		() => api.get("/api/regime/snapshot"),
		120000,
		"regime",
	);
	const entry = usePolling<EntryPlan | null>(
		() => api.get(`/api/analysis/entry/${ticker}${forceQ}`),
		120000,
		`${ticker}:${analyzeNonce}`,
	);

	const analyze = () => setAnalyzeNonce((n) => n + 1);

	return (
		<div>
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
					className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
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

			{/* Regime + beta + entry verdict */}
			<div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Panel
					title="Market Regime"
					right={<StaleChip asOf={regime.data?.as_of_date} label="REGIME" />}
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
								SMA {fmtNum(regime.data.sma_short)} /{" "}
								{fmtNum(regime.data.sma_long)} · ATR{" "}
								{fmtNum(regime.data.atr_value)}
							</span>
						</div>
					) : (
						<p className="text-xs text-[var(--text-faint)]">
							Regime unavailable
						</p>
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

			{/* Bandarmology */}
			<div className="panel mb-4 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Bandarmology · {ticker}
					</h2>
					{validator.refreshing && validator.data ? (
						<Spinner label="Refreshing…" />
					) : validator.data ? (
						<StaleChip
							asOf={validator.data.summary ? undefined : undefined}
							label="FLOW"
						/>
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
						<DrillStat
							label="Intent"
							value={validator.data.summary.current_intent}
						/>
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

			{/* Entry plan detail */}
			{entry.data && !entry.data.error && (
				<div className="panel p-4">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							Entry Plan
						</h2>
						{entry.refreshing ? <Spinner label="Refreshing…" /> : null}
					</div>
					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						<DrillStat
							label="Entry Zone"
							value={`${fmtNum(entry.data.entry_zone.from)} - ${fmtNum(entry.data.entry_zone.to)}`}
						/>
						<DrillStat
							label="Stop Loss"
							value={
								entry.data.stop_loss != null
									? fmtNum(entry.data.stop_loss)
									: "—"
							}
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
								<li
									key={i}
									className="text-xs leading-relaxed text-[var(--text-dim)]"
								>
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

			{/* Recent price + volume stats from history */}
			{history.data &&
				!history.data.error &&
				history.data.history.length > 0 && (
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
			? ((h[h.length - 1].close - h[h.length - 2].close) /
					h[h.length - 2].close) *
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
