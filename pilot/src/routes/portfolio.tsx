import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api, fmtIdr, fmtNum, type PortfolioState } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton, StatCard, Spinner } from "@/components/ui";

export const Route = createFileRoute("/portfolio")({
	component: PortfolioPage,
});

function PortfolioPage() {
	const state = usePolling<PortfolioState>(
		() => api.get("/api/portfolio/state"),
		20000,
	);
	const [form, setForm] = useState({
		action: "BUY",
		ticker: "",
		qty: "100",
		price: "",
		date: new Date().toISOString().slice(0, 10),
		currency: "IDR",
	});
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const qty = Number(form.qty);
		const price = Number(form.price);
		const ticker = form.ticker.trim().toUpperCase();

		// Client-side validation: reject NaN / zero / empty before the backend
		if (!ticker) {
			setMsg({ ok: false, text: "Ticker is required." });
			return;
		}
		if (!Number.isFinite(qty) || qty <= 0) {
			setMsg({ ok: false, text: "Qty must be a positive number." });
			return;
		}
		if (form.action !== "DEPOSIT" && form.action !== "WITHDRAW") {
			if (!Number.isFinite(price) || price <= 0) {
				setMsg({ ok: false, text: "Price must be a positive number." });
				return;
			}
		}

		setBusy(true);
		setMsg(null);
		try {
			await api.post("/api/portfolio/journal", {
				action: form.action,
				ticker,
				qty,
				price,
				date: form.date,
				currency: form.currency,
			});
			setMsg({ ok: true, text: "Entry recorded." });
			setForm((f) => ({ ...f, ticker: "", price: "" }));
			void state.refresh();
		} catch (err) {
			setMsg({
				ok: false,
				text: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setBusy(false);
		}
	};

	const s = state.data;

	return (
		<div>
			<SectionHeader
				title="Portfolio"
				subtitle="FIFO cost-basis ledger — positions, cash, and realized P&L (IDR)"
			/>

			<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
				{state.loading || !s ? (
					[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)
				) : (
					<>
						<StatCard
							label="Net Worth"
							value={fmtIdr(s.net_worth_idr)}
							tone="accent"
							sub={`FX ${fmtNum(s.live_forex_usdidr)}`}
						/>
						<StatCard label="Cash" value={fmtIdr(s.cash_idr)} />
						<StatCard
							label="Market Value"
							value={fmtIdr(s.total_market_value_idr)}
							tone="up"
						/>
						<StatCard
							label="Realized P&L"
							value={fmtIdr(s.realized_pnl_idr)}
							tone={s.realized_pnl_idr >= 0 ? "up" : "down"}
							sub={`${s.total_trades} trades closed`}
						/>
					</>
				)}
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				{/* Positions */}
				<div className="panel p-4 lg:col-span-2">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Positions
					</h2>
					{state.loading ? (
						<Skeleton className="h-40" />
					) : !s?.positions.length ? (
						<p className="py-10 text-center text-sm text-[var(--text-faint)]">
							No open positions. Add your first trade in the journal.
						</p>
					) : (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--text-faint)]">
									<th className="pb-2">Ticker</th>
									<th className="pb-2 text-right">Qty</th>
									<th className="pb-2 text-right">Avg Cost (IDR)</th>
									<th className="pb-2 text-right">Last</th>
									<th className="pb-2 text-right">Value (IDR)</th>
									<th className="pb-2 text-right">Unrealized</th>
									<th className="pb-2 text-right">Lots</th>
								</tr>
							</thead>
							<tbody>
								{s.positions.map((p) => (
									<tr
										key={p.ticker}
										className="border-b border-[var(--border)]/50"
									>
										<td className="py-2.5 font-semibold text-[var(--accent)]">
											{p.ticker}
										</td>
										<td className="tabular py-2.5 text-right font-mono">
											{fmtNum(p.qty)}
										</td>
										<td className="tabular py-2.5 text-right font-mono">
											{fmtNum(p.avg_cost_idr, 0)}
										</td>
										<td className="tabular py-2.5 text-right font-mono text-xs">
											{p.last_price != null ? fmtNum(p.last_price) : "—"}
										</td>
										<td className="tabular py-2.5 text-right font-mono">
											{fmtNum(p.market_value_idr, 0)}
										</td>
										<td
											className={`tabular py-2.5 text-right font-mono ${
												p.unrealized_pnl_idr != null &&
												p.unrealized_pnl_idr >= 0
													? "text-[var(--up)]"
													: "text-[var(--down)]"
											}`}
										>
											{p.unrealized_pnl_idr != null
												? fmtNum(p.unrealized_pnl_idr, 0)
												: "—"}
										</td>
										<td className="py-2.5 text-right font-mono text-xs text-[var(--text-dim)]">
											{p.lots.length}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>

				{/* Journal form */}
				<div className="panel p-4">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Add Journal Entry
					</h2>
					<form onSubmit={submit} className="space-y-3">
						<div className="grid grid-cols-2 gap-2">
							<label className="text-[11px] text-[var(--text-faint)]">
								Action
								<select
									value={form.action}
									onChange={(e) => setForm({ ...form, action: e.target.value })}
									className="panel-2 mt-1 w-full px-2 py-2 text-sm text-[var(--text)] focus:outline-none"
								>
									<option>BUY</option>
									<option>SELL</option>
									<option>DEPOSIT</option>
									<option>WITHDRAW</option>
								</select>
							</label>
							<label className="text-[11px] text-[var(--text-faint)]">
								Ticker
								<input
									value={form.ticker}
									onChange={(e) => setForm({ ...form, ticker: e.target.value })}
									placeholder="BBCA"
									className="panel-2 mt-1 w-full px-2 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
								/>
							</label>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<label className="text-[11px] text-[var(--text-faint)]">
								Qty (1 lot = 100)
								<input
									value={form.qty}
									onChange={(e) => setForm({ ...form, qty: e.target.value })}
									className="panel-2 mt-1 w-full px-2 py-2 font-mono text-sm text-[var(--text)] focus:outline-none"
								/>
							</label>
							<label className="text-[11px] text-[var(--text-faint)]">
								Price
								<input
									value={form.price}
									onChange={(e) => setForm({ ...form, price: e.target.value })}
									placeholder="6375"
									className="panel-2 mt-1 w-full px-2 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
								/>
							</label>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<label className="text-[11px] text-[var(--text-faint)]">
								Date
								<input
									type="date"
									value={form.date}
									onChange={(e) => setForm({ ...form, date: e.target.value })}
									className="panel-2 mt-1 w-full px-2 py-2 font-mono text-sm text-[var(--text)] focus:outline-none"
								/>
							</label>
							<label className="text-[11px] text-[var(--text-faint)]">
								Currency
								<select
									value={form.currency}
									onChange={(e) =>
										setForm({ ...form, currency: e.target.value })
									}
									className="panel-2 mt-1 w-full px-2 py-2 text-sm text-[var(--text)] focus:outline-none"
								>
									<option value="IDR">IDR</option>
									<option value="USD">USD</option>
								</select>
							</label>
						</div>
						<button
							type="submit"
							disabled={busy}
							className="w-full rounded-md bg-[var(--accent)] py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
						>
							{busy ? <Spinner label="Recording…" /> : "Record Entry"}
						</button>
						{msg && (
							<p
								className={`text-xs ${msg.ok ? "text-[var(--up)]" : "text-[var(--down)]"}`}
							>
								{msg.text}
							</p>
						)}
					</form>
				</div>
			</div>
		</div>
	);
}
