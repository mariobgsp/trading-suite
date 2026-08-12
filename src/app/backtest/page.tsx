"use client";

import { useState } from "react";
import { api, fmtIdr, fmtNum, type BacktestResult } from "@/lib/api";
import Shell from "@/components/Shell";
import {
	ChangeBadge,
	SectionHeader,
	Skeleton,
	Spinner,
	StatCard,
} from "@/components/ui";
import { SimpleLineChart } from "@/components/MarketChart";

const STRATEGIES = [
	{ id: "momentum", label: "Momentum (MACD + RSI)" },
	{ id: "meanreversion", label: "Mean Reversion (Stoch + RSI)" },
	{ id: "buyhold", label: "Buy & Hold" },
];

export default function BacktestPage() {
	const [ticker, setTicker] = useState("BBCA");
	const [strategy, setStrategy] = useState("momentum");
	const [period, setPeriod] = useState("2y");
	const [result, setResult] = useState<BacktestResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await api.get<BacktestResult>(
				`/api/backtest/${ticker}?strategy=${strategy}&period=${period}`,
			);
			setResult(res);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	const stats = result?.stats;

	return (
		<Shell>
			<SectionHeader
				title="Backtest"
				subtitle="Momentum / mean-reversion / buy-and-hold with 5% stop-loss, 10% trailing stop, IDR fees"
			/>

			{/* Controls */}
			<div className="panel mb-6 flex flex-wrap items-end gap-3 p-4">
				<label className="text-[11px] text-[var(--text-faint)]">
					Ticker
					<input
						value={ticker}
						onChange={(e) => setTicker(e.target.value.toUpperCase())}
						className="panel-2 mt-1 w-36 px-3 py-2 font-mono text-sm text-[var(--text)] focus:outline-none"
					/>
				</label>
				<label className="text-[11px] text-[var(--text-faint)]">
					Strategy
					<select
						value={strategy}
						onChange={(e) => setStrategy(e.target.value)}
						className="panel-2 mt-1 w-64 px-3 py-2 text-sm text-[var(--text)] focus:outline-none"
					>
						{STRATEGIES.map((s) => (
							<option key={s.id} value={s.id}>
								{s.label}
							</option>
						))}
					</select>
				</label>
				<label className="text-[11px] text-[var(--text-faint)]">
					Period
					<select
						value={period}
						onChange={(e) => setPeriod(e.target.value)}
						className="panel-2 mt-1 w-28 px-3 py-2 text-sm text-[var(--text)] focus:outline-none"
					>
						{["6mo", "1y", "2y", "5y"].map((p) => (
							<option key={p}>{p}</option>
						))}
					</select>
				</label>
				<button
					onClick={() => void run()}
					disabled={loading}
					className="rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
				>
					{loading ? <Spinner label="Running…" /> : "Run Backtest"}
				</button>
			</div>

			{error && (
				<div className="panel mb-4 border-[var(--down)]/40 p-4 text-sm text-[var(--down)]">
					{error}
				</div>
			)}

			{loading && <Skeleton className="h-80" />}

			{result?.error && (
				<div className="panel mb-4 p-4 text-sm text-[var(--down)]">
					{result.error}
				</div>
			)}

			{result && !result.error && stats && (
				<>
					{/* Stats */}
					<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
						<StatCard
							label="Total Return"
							value={`${stats.total_return_pct.toFixed(2)}%`}
							tone={stats.total_return_pct >= 0 ? "up" : "down"}
							sub={`vs buy&hold ${stats.buyhold_return_pct.toFixed(2)}%`}
						/>
						<StatCard
							label="Trades / Win Rate"
							value={`${stats.total_trades} / ${stats.win_rate}%`}
							sub={`${stats.wins}W · ${stats.losses}L`}
						/>
						<StatCard
							label="Max Drawdown"
							value={`${stats.max_drawdown_pct.toFixed(2)}%`}
							tone="down"
						/>
						<StatCard
							label="Final Value"
							value={fmtIdr(stats.final_value)}
							sub={`${fmtIdr(10_000_000)} start`}
						/>
					</div>

					{/* Equity curve */}
					<div className="panel mb-6 p-4">
						<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							Equity Curve — {ticker.toUpperCase()} ({strategy}, {period})
						</h2>
						{result.equity.length ? (
							<SimpleLineChart
								data={result.equity}
								height={280}
								color={stats.total_return_pct >= 0 ? "#34d399" : "#f87171"}
							/>
						) : (
							<p className="py-8 text-center text-xs text-[var(--text-faint)]">
								No equity points
							</p>
						)}
					</div>

					{/* Trade list */}
					<div className="panel p-4">
						<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
							Trades ({result.trades.length})
						</h2>
						{result.trades.length === 0 ? (
							<p className="py-6 text-center text-xs text-[var(--text-faint)]">
								No trades generated
							</p>
						) : (
							<div className="max-h-80 overflow-y-auto">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
											<th className="pb-2">Entry</th>
											<th className="pb-2">Exit</th>
											<th className="pb-2">Trigger</th>
											<th className="pb-2 text-right">Shares</th>
											<th className="pb-2 text-right">Entry</th>
											<th className="pb-2 text-right">Exit</th>
											<th className="pb-2 text-right">P&L %</th>
											<th className="pb-2 text-right">P&L IDR</th>
										</tr>
									</thead>
									<tbody>
										{result.trades.map((t, i) => (
											<tr
												key={i}
												className="border-b border-[var(--border)]/50"
											>
												<td className="tabular py-2 font-mono text-xs">
													{t.entry_date}
												</td>
												<td className="tabular py-2 font-mono text-xs">
													{t.exit_date}
												</td>
												<td className="py-2 text-xs text-[var(--text-dim)]">
													{t.trigger}
												</td>
												<td className="tabular py-2 text-right font-mono text-xs">
													{fmtNum(t.shares, 0)}
												</td>
												<td className="tabular py-2 text-right font-mono text-xs">
													{fmtNum(t.entry_price)}
												</td>
												<td className="tabular py-2 text-right font-mono text-xs">
													{fmtNum(t.exit_price)}
												</td>
												<td className="py-2 text-right">
													<ChangeBadge value={t.profit_pct} />
												</td>
												<td
													className={`tabular py-2 text-right font-mono text-xs ${
														t.pnl_idr >= 0
															? "text-[var(--up)]"
															: "text-[var(--down)]"
													}`}
												>
													{fmtNum(t.pnl_idr, 0)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</>
			)}

			{!result && !loading && (
				<div className="panel grid-texture p-16 text-center text-sm text-[var(--text-faint)]">
					Configure a ticker and strategy, then run the backtest. Equity curve,
					drawdown, win rate, and per-trade P&L will render here.
				</div>
			)}
		</Shell>
	);
}
