"use client";

import { useState } from "react";
import { api, fmtNum, type ValidatorResult } from "@/lib/api";
import Shell from "@/components/Shell";
import { SectionHeader, StatCard } from "@/components/ui";

const INTENT_TONE = (intent: string): string => {
	if (/SILENT EXIT|DISTRIBUTION|ABANDONED|MARKDOWN|CHURN/.test(intent))
		return "text-[var(--down)]";
	if (/ACCUM|MARKUP|ABSORPTION|GUARDING|SILENT/.test(intent))
		return "text-[var(--up)]";
	if (/LOW VOL|NORMAL/.test(intent)) return "text-[var(--text-faint)]";
	return "text-[var(--gold)]";
};

export default function ValidatorPage() {
	const [ticker, setTicker] = useState("BBRI");
	const [result, setResult] = useState<ValidatorResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async () => {
		setLoading(true);
		setError(null);
		try {
			// cached: second analyze of same ticker within 60s is instant
			const path = `/api/validator/${ticker}`;
			const cached = api.peek<ValidatorResult>(path);
			if (cached) {
				setResult(cached);
				setLoading(false);
				// still revalidate stale in background
				void api
					.getCached<ValidatorResult>(path)
					.then((fresh) => setResult(fresh))
					.catch(() => {});
				return;
			}
			const res = await api.getCached<ValidatorResult>(path);
			setResult(res);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	const s = result?.summary;

	return (
		<Shell>
			<SectionHeader
				eyebrow="VWAP phase · Institutional flow · Intent radar"
				title="Bandarmology Validator"
				subtitle="Smart-money detector — VWAP phase, institutional flow, and hidden intent radar for IHSG tickers."
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
					className="rounded bg-[var(--accent)] px-5 py-2 font-mono text-sm font-semibold text-black hover:brightness-[1.05] disabled:opacity-50"
				>
					{loading ? "$ validator --running…" : "$ validator --analyze"}
				</button>
			</div>

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
			{loading && <div className="border border-dashed border-[var(--line)] bg-[var(--panel-2)] p-4 font-mono text-xs text-[var(--text-faint)]">$ validator {ticker} | analyzing…</div>}

			{s && (
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
				<div className="panel grid-texture p-8 font-mono text-xs leading-relaxed text-[var(--text-faint)]">
					<div className="text-[var(--accent)]">$ validator --help</div>
					<div className="mt-1">Enter a ticker to run bandarmology analysis. Instant — no spinner wait.</div>
				</div>
			)}
		</Shell>
	);
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-[var(--border)]/50 py-1.5 last:border-0">
			<span className="text-xs text-[var(--text-faint)]">{k}</span>
			<span className="text-right font-mono text-xs font-semibold text-[var(--text)]">
				{v}
			</span>
		</div>
	);
}
