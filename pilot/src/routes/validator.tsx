import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api, fmtNum, type EntryPlan, type ValidatorResult } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton, Spinner, StatCard } from "@/components/ui";
import AiSummary from "@/components/AiSummary";

const INTENT_TONE = (intent: string): string => {
	if (/SILENT EXIT|DISTRIBUTION|ABANDONED|MARKDOWN|CHURN/.test(intent))
		return "text-[var(--down)]";
	if (/ACCUM|MARKUP|ABSORPTION|GUARDING|SILENT/.test(intent))
		return "text-[var(--up)]";
	if (/LOW VOL|NORMAL/.test(intent)) return "text-[var(--text-faint)]";
	return "text-[var(--gold)]";
};

export const Route = createFileRoute("/validator")({
	component: ValidatorPage,
});

function ValidatorPage() {
	const [ticker, setTicker] = useState("BBRI");
	const [result, setResult] = useState<ValidatorResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await api.get<ValidatorResult>(`/api/validator/${ticker}`);
			setResult(res);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	const s = result?.summary;

	const entry = usePolling<EntryPlan>(
		() => api.get(`/api/analysis/entry/${ticker}`),
		30000,
		ticker,
	);

	return (
		<div>
			<SectionHeader
				title="Bandarmology Validator"
				subtitle="Smart-money detector — VWAP phase, institutional flow, hidden intent radar (IHSG)"
			/>
			<div className="mb-6 flex items-end gap-3">
				<label className="text-[11px] text-[var(--text-faint)]">
					Ticker
					<input
						value={ticker}
						onChange={(e) => setTicker(e.target.value.toUpperCase())}
						onKeyDown={(e) => e.key === "Enter" && void run()}
						className="panel-2 mt-1 w-36 px-3 py-2 font-mono text-sm text-[var(--text)] focus:outline-none"
					/>
				</label>
				<button
					onClick={() => void run()}
					disabled={loading}
					className="rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
				>
					{loading ? <Spinner label="Analyzing…" /> : "Analyze"}
				</button>
			</div>

			<AiSummary page="validator" ticker={ticker} className="mb-4" />

			<EntryPlanPanel
				entry={entry.data}
				loading={entry.loading}
				refreshing={entry.refreshing}
				ticker={ticker}
			/>

			{error && (
				<div className="panel mb-4 border-[var(--down)]/40 p-4 text-sm text-[var(--down)]">
					{error}
				</div>
			)}
			{result?.error && (
				<div className="panel mb-4 p-4 text-sm text-[var(--down)]">
					{result.error}
				</div>
			)}
			{loading && <Skeleton className="h-72" />}

			{s && !loading && (
				<>
					<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
						<StatCard
							label="Close"
							value={fmtNum(s.close)}
							tone={s.change_pct >= 0 ? "up" : "down"}
							sub={`${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}% today`}
						/>
						<StatCard
							label="Bandar Phase"
							value={<span className="text-sm">{s.bandar_phase.phase}</span>}
							sub={`VWAP gap ${s.bandar_phase.gap_pct > 0 ? "+" : ""}${s.bandar_phase.gap_pct.toFixed(2)}%`}
							tone={
								s.bandar_phase.gap_pct < -2
									? "up"
									: s.bandar_phase.gap_pct > 2
										? "down"
										: "accent"
							}
						/>
						<StatCard
							label="Institutional Flow"
							value={s.inst_flow}
							tone={s.inst_flow === "NET BUY" ? "up" : "down"}
							sub={`5-day smoothed ${fmtNum(s.inst_flow_ma, 0)}`}
						/>
						<StatCard
							label="Current Intent"
							value={
								<span className={`text-sm ${INTENT_TONE(s.current_intent)}`}>
									{s.current_intent}
								</span>
							}
							sub={`RSI ${fmtNum(s.rsi)} · Confirmed Flow ${s.conf_flow_index}/4`}
						/>
					</div>

					<div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
						<div className="panel p-4">
							<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
								Liquidity & Flow
							</h2>
							<Row k="Liquidity" v={s.liquidity.status} />
							<Row k="Avg Value/Day" v={s.liquidity.avg_value_display} />
							<Row k="CMF(20)" v={fmtNum(s.cmf, 3)} />
							<Row k="MFI(14)" v={fmtNum(s.mfi, 1)} />
							<Row
								k="Analysis Mode"
								v={
									s.small_cap_mode
										? "Small-cap optimized"
										: "Standard (big/mid)"
								}
							/>
							<Row k="NVI (smart money)" v={s.nvi_status} />
							<Row k="Dormant Index" v={`${s.dormant_index.toFixed(1)}/100`} />
							<Row
								k="Confirmed Flow"
								v={`${s.conf_flow_index}/4 (${s.conf_flow_label})`}
							/>
						</div>

						<div className="panel p-4 lg:col-span-2">
							<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
								Intent Radar — last {result?.radar?.length ?? 0} sessions
							</h2>
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
										{result?.radar?.map((r) => (
											<tr
												key={r.date}
												className="border-b border-[var(--border)]/50"
											>
												<td className="tabular py-1.5 font-mono text-xs">
													{r.date}
												</td>
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
													{r.inst_flow != null
														? r.inst_flow >= 0
															? "▲"
															: "▼"
														: "—"}
												</td>
												<td className="tabular py-1.5 text-right font-mono text-xs">
													{r.conf_flow}/4
												</td>
												<td
													className={`py-1.5 text-xs ${INTENT_TONE(r.intent)}`}
												>
													{r.intent}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				</>
			)}

			{!result && !loading && (
				<div className="panel grid-texture p-16 text-center text-sm text-[var(--text-faint)]">
					Enter a ticker to run the bandarmology analysis —
					accumulation/distribution phase, institutional flow, and the
					hidden-intent radar will render here.
				</div>
			)}
		</div>
	);
}

const VERDICT_TONE: Record<string, string> = {
	ENTER_LONG: "bg-[var(--up)]/15 text-[var(--up)]",
	CONDITIONAL: "bg-[var(--gold)]/15 text-[var(--gold)]",
	WAIT: "bg-[var(--panel-2)] text-[var(--text-dim)]",
	AVOID: "bg-[var(--down)]/15 text-[var(--down)]",
};

function EntryPlanPanel({
	entry,
	loading,
	refreshing,
	ticker,
}: {
	entry: EntryPlan | null;
	loading: boolean;
	refreshing: boolean;
	ticker: string;
}) {
	return (
		<div className="panel p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Entry Plan — {ticker}
				</h2>
				{entry?.narration_model && !loading ? (
					<span className="font-mono text-[10px] text-[var(--text-faint)]">
						{entry.narration_model}
					</span>
				) : refreshing ? (
					<Spinner label="Refreshing…" />
				) : null}
			</div>

			{loading && !entry ? (
				<Skeleton className="h-32" />
			) : entry?.error ? (
				<p className="text-xs text-[var(--down)]">{entry.error}</p>
			) : entry ? (
				<div className="relative">
					{/* Refresh overlay: stale plan stays visible but dimmed with a
					    spinner while new data loads. */}
					{refreshing && entry ? (
						<div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-[var(--panel)]/70 backdrop-blur-[1px]">
							<div className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 shadow-[var(--elev)]">
								<Spinner label="Refreshing entry plan…" />
							</div>
						</div>
					) : null}
					<div className={refreshing ? "opacity-40 transition-opacity" : ""}>
						<div className="space-y-4">
							{/* Verdict + score */}
							<div className="flex flex-wrap items-center gap-3">
								<span
									className={`rounded-md px-3 py-1 font-mono text-xs font-bold ${
										VERDICT_TONE[entry.verdict] ?? "bg-[var(--panel-2)]"
									}`}
								>
									{entry.verdict}
								</span>
								<span className="font-mono text-xs text-[var(--text-dim)]">
									Score {entry.score}/100 · {entry.bias}
								</span>
							</div>

							{/* AI narration */}
							{entry.narration ? (
								<p className="rounded-md bg-[var(--panel-2)] p-3 text-sm leading-relaxed text-[var(--text-dim)]">
									{entry.narration}
								</p>
							) : null}

							{/* Levels */}
							<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
								<div className="panel-2 p-3">
									<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										Entry Zone
									</div>
									<div className="tabular mt-0.5 font-mono text-sm font-bold text-[var(--text)]">
										{entry.entry_zone.from != null
											? `${fmtNum(entry.entry_zone.from)} – ${fmtNum(entry.entry_zone.to)}`
											: "—"}
									</div>
									<div className="mt-0.5 text-[10px] text-[var(--text-faint)]">
										{entry.entry_zone.note ?? ""}
									</div>
								</div>
								<div className="panel-2 p-3">
									<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										Stop Loss
									</div>
									<div className="tabular mt-0.5 font-mono text-sm font-bold text-[var(--down)]">
										{entry.stop_loss != null ? fmtNum(entry.stop_loss) : "—"}
									</div>
									<div className="mt-0.5 text-[10px] text-[var(--text-faint)]">
										{entry.stop_loss != null ? "hard stop" : "no long setup"}
									</div>
								</div>
								<div className="panel-2 p-3">
									<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										Target 1
									</div>
									<div className="tabular mt-0.5 font-mono text-sm font-bold text-[var(--up)]">
										{entry.targets.target1 != null
											? fmtNum(entry.targets.target1)
											: "—"}
									</div>
									<div className="mt-0.5 text-[10px] text-[var(--text-faint)]">
										{entry.targets.target2 != null
											? `Target 2 ${fmtNum(entry.targets.target2)}`
											: ""}
									</div>
								</div>
								<div className="panel-2 p-3">
									<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										R:R
									</div>
									<div className="tabular mt-0.5 font-mono text-sm font-bold text-[var(--text)]">
										{entry.targets.rr != null
											? `${fmtNum(entry.targets.rr, 2)}R`
											: "—"}
									</div>
								</div>
							</div>

							{entry.position_sizing ? (
								<p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--text-faint)]">
									{entry.position_sizing}
								</p>
							) : null}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-[var(--border)]/50 py-1.5 last:border-b-0">
			<span className="text-xs text-[var(--text-faint)]">{k}</span>
			<span className="tabular font-mono text-xs font-semibold text-[var(--text)]">
				{v}
			</span>
		</div>
	);
}
