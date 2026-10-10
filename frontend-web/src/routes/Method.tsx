/**
 * Method — the proof, and the rules that earn it.
 *
 * This page exists because the headline number is only worth anything next to
 * its limits. Every rule names the study file and line it came from, so the
 * claim is checkable rather than asserted.
 */

import { useEffect, useState } from "react";
import { planApi, type BookRow, type MethodCard } from "@/lib/api/plan";
import { EvidenceBadge, Section, idr, pct, pctRaw } from "@/components/plan";
import { Page } from "./Tonight";

export default function Method() {
	const [card, setCard] = useState<MethodCard | null>(null);
	useEffect(() => {
		let alive = true;
		planApi.method().then((m) => alive && setCard(m)).catch(() => {});
		return () => {
			alive = false;
		};
	}, []);

	/* The page renders after the fetch resolves, so the browser has already
	 * tried (and failed) to honour a `#ladder` deep link by the time there is
	 * anything to scroll to. Honour it once the content exists. */
	useEffect(() => {
		if (!card) return;
		const hash = window.location.hash.slice(1);
		if (!hash) return;
		document.getElementById(hash)?.scrollIntoView({ block: "start" });
	}, [card]);

	if (!card) {
		return (
			<Page>
				<p className="font-mono text-[13px] text-[var(--text-faint)]">Loading the method…</p>
			</Page>
		);
	}

	const e = card.evidence;

	return (
		<Page>
			<header className="mb-10">
				<h1 className="font-display text-[34px] leading-[1.1] tracking-[-0.02em] text-[var(--text)] sm:text-[40px]">
					The method, and what it measured
				</h1>
				<p className="mt-3 max-w-[74ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					{card.family} × {card.exit_method}. Every rule below is transcribed from the study at{" "}
					{card.studies_at}, and a test replays the study's own signal code against this app's copy to
					prove the two still agree.
				</p>
			</header>

			{card.holdout && (
				<Section
					id="holdout"
					title="Does it hold up on data the search never saw?"
					subtitle="This is the question the study was asked directly, and it built a holdout to answer it rather than argue. Read this before the headline number above."
				>
					<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
						<p className="max-w-[80ch] text-[14px] leading-relaxed text-[var(--text)]">
							{card.holdout.verdict}
						</p>

						<div className="mt-5 grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-4">
							<Stat
								label="Configurations searched"
								value={idr(card.holdout.search_cells)}
								note="entry × exit cells"
							/>
							<Stat
								label="Cleared both bars"
								value={`${card.holdout.search_cells_clearing ?? 0} / ${card.holdout.search_cells ?? 0}`}
								note="on the folds they were searched on"
							/>
							<Stat
								label="Survived the holdout"
								value={`${card.holdout.winners_surviving ?? 0} / ${card.holdout.winners_tested ?? 0}`}
								note="carried forward unchanged"
							/>
							<Stat
								label="Best on unseen data"
								value={
									card.holdout.best_holdout_win_rate != null
										? `${pct(card.holdout.best_holdout_win_rate, 1)} / +${(card.holdout.best_holdout_avg_ret_pct ?? 0).toFixed(2)}%`
										: "—"
								}
								note="win rate / per trade"
							/>
						</div>

						{card.holdout.win_rate_decay_pp != null && (
							<p className="mt-4 border-t border-[var(--border)] pt-4 font-mono text-[11px] leading-relaxed text-[var(--text-ghost)]">
								Average change from search to holdout:{" "}
								<span className="text-[var(--down)]">
									{card.holdout.win_rate_decay_pp.toFixed(2)}pp win rate
								</span>
								,{" "}
								<span className="text-[var(--down)]">
									{card.holdout.return_decay_pp?.toFixed(2)}pp per trade
								</span>
								. The best cell on unseen data reaches{" "}
								{pct(card.holdout.best_holdout_win_rate ?? 0, 1)} win rate and{" "}
								+{(card.holdout.best_holdout_avg_ret_pct ?? 0).toFixed(2)}% per trade — it clears
								neither bar, and it is the best of everything that was tried.
							</p>
						)}
					</div>

					{card.shipped && "entry" in card.shipped && (
						<div className="mt-4 border border-[var(--border)] bg-[var(--panel)] p-5">
							<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
								The exact rules this app runs, measured on the folds that ranked them
							</p>
							<p className="mt-2 font-mono text-[12px] leading-relaxed text-[var(--text-dim)]">
								{card.shipped.entry}
								<br />
								{card.shipped.exit}
								<br />
								{card.shipped.regime_gate}
							</p>
							<div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
								<Stat
									label="Trades"
									value={`${card.shipped.search_trades_lo ?? 0}–${card.shipped.search_trades_hi ?? 0}`}
									note={`across ${card.shipped.rows_matched} census rows`}
								/>
								<Stat
									label="Win rate"
									value={
										card.shipped.search_win_rate_lo != null
											? `${pct(card.shipped.search_win_rate_lo, 1)}–${pct(card.shipped.search_win_rate_hi ?? 0, 1)}`
											: "—"
									}
									note={
										card.shipped.any_row_clears_win_bar
											? "at least one row reaches 80%"
											: "no row reaches 80%"
									}
								/>
								<Stat
									label="Per trade"
									value={
										card.shipped.search_avg_ret_lo != null
											? `${card.shipped.search_avg_ret_lo > 0 ? "+" : ""}${card.shipped.search_avg_ret_lo.toFixed(2)}% to ${card.shipped.search_avg_ret_hi && card.shipped.search_avg_ret_hi > 0 ? "+" : ""}${(card.shipped.search_avg_ret_hi ?? 0).toFixed(2)}%`
											: "—"
									}
									note="the range, not the best row"
								/>
							</div>
							<p className="mt-4 text-[12px] leading-relaxed text-[var(--text-ghost)]">
								{card.shipped.note}
							</p>
						</div>
					)}
				</Section>
			)}

			<Section
				id="regime"
				title="When it trades, and how often that is"
				subtitle={card.regime_bands.note}
			>
				<div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
					{(["capitulation", "sideways", "trending"] as const).map((band) => {
						const active = band === "trending";
						return (
							<div
								key={band}
								className="p-4"
								style={{ background: active ? "var(--panel-2)" : "var(--panel)" }}
							>
								<div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
									{band}
								</div>
								<div className="mt-2 font-mono text-[15px] font-semibold leading-none text-[var(--text)]">
									{band === "trending"
										? `breadth ≥ ${card.regime_bands.trending.toFixed(2)}`
										: band === "sideways"
											? `${card.regime_bands.capitulation.toFixed(2)} – ${card.regime_bands.trending.toFixed(2)}`
											: `< ${card.regime_bands.capitulation.toFixed(2)}`}
								</div>
								<div className="mt-2 font-mono text-[11px] text-[var(--text-dim)]">
									{band === "trending" ? "trade" : band === "sideways" ? "stay flat" : "watch only"}
								</div>
							</div>
						);
					})}
				</div>

				{card.regime_bands.frequency && (
					<div className="mt-4 border border-[var(--border)] bg-[var(--panel)] p-5">
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							How often, over{" "}
							{idr(card.regime_bands.frequency.sessions)} measured sessions
						</p>
						<div className="mt-4 grid gap-4 sm:grid-cols-4">
							<Stat
								label="Cleared the gate"
								value={pct(card.regime_bands.frequency.share_trending, 1)}
								note={`${idr(card.regime_bands.frequency.days_b60)} sessions`}
							/>
							<Stat
								label="Cleared 0.50"
								value={pct(card.regime_bands.frequency.days_b50 / card.regime_bands.frequency.sessions, 1)}
								note={`${idr(card.regime_bands.frequency.days_b50)} sessions`}
							/>
							<Stat
								label="Cleared 0.45"
								value={pct(card.regime_bands.frequency.days_b45 / card.regime_bands.frequency.sessions, 1)}
								note={`${idr(card.regime_bands.frequency.days_b45)} sessions`}
							/>
							<Stat
								label="Below 0.45"
								value={pct(card.regime_bands.frequency.share_below_45, 1)}
								note="nothing to buy"
							/>
						</div>
						<p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
							About{" "}
							<span className="text-[var(--text-dim)]">
								one session in {Math.round(1 / Math.max(card.regime_bands.frequency.share_trending, 0.0001))}
							</span>{" "}
							qualifies to trade. The rest of the time the screen says &ldquo;not
							yet&rdquo;, which is the market declining to be traded rather than the
							rules misfiring — the study measured the looser gates directly and each extra
							trade they bought was a worse one, so the line stays where the return is.
						</p>
					</div>
				)}
			</Section>

			<Section
				id="tradability"
				title="Names the screen refuses to consider"
				subtitle={card.tradability.why}
			>
				<div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
					<Stat
						label="Minimum price"
						value={idr(card.tradability.min_price_idr)}
						note="IDR per share"
					/>
					<Stat
						label="Maximum frozen share"
						value={pct(card.tradability.max_frozen_fraction, 0)}
						note="of sessions with an unchanged close"
					/>
					<Stat
						label="Effect on the study"
						value="−2.2pp"
						note="win rate, after the audit"
					/>
				</div>
				<p className="mt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
					A name whose close does not move is not one the user can buy or sell, and every
					signal on it is a breakout nobody could have filled. The study found 7.0% of its
					trades came from such names — one ticker alone supplied 4.2% — and correcting for
					it lowered every headline in the study, which is why the app applies the same
					filter before scoring anything.
				</p>
			</Section>

			{card.five_year && "tiers" in card.five_year && (
				<Section
					id="five-year"
					title="Five years in one window"
					subtitle={card.five_year.window}
				>
					<div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
						{card.five_year.tiers.map((t) => (
							<div key={t.tier} className="p-4" style={{ background: "var(--panel)" }}>
								<div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
									{t.tier}
								</div>
								<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-[var(--text-dim)]">
									<span>{idr(t.trades)} trades</span>
									<span>{pct(t.win_rate, 1)}</span>
									<span className={(t.avg_ret_pct ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}>
										{(t.avg_ret_pct ?? 0) >= 0 ? "+" : ""}
										{(t.avg_ret_pct ?? 0).toFixed(2)}% per trade
									</span>
								</div>
								<div className="mt-2 border-t border-[var(--border)] pt-2 font-mono text-[11px] tabular-nums">
									<span className="text-[var(--text-ghost)]">book </span>
									<span className={(t.book_total_pct ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}>
										{(t.book_total_pct ?? 0) >= 0 ? "+" : ""}
										{(t.book_total_pct ?? 0).toFixed(2)}%
									</span>
									{t.book_taken != null && (
										<span className="text-[var(--text-ghost)]"> from {t.book_taken} taken</span>
									)}
								</div>
							</div>
						))}
					</div>
					<p className="mt-3 text-[12px] leading-relaxed text-[var(--text-ghost)]">
						{card.five_year.caveat} The gap between the per-trade column and the book column is the
						point: a slot-filling book takes whichever signals arrive first, and those are not the
						good ones. A method that averages +3.99% per trade and loses 2.64% as a book has not been
						shown to make money.
					</p>
				</Section>
			)}

			<Section
				title="The bar it was measured against"
				subtitle="Stated before the result, because a target chosen after the fact measures nothing."
			>
				<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
					<p className="max-w-[80ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
						A method passes only if it clears{" "}
						<b className="text-[var(--text)]">{pct(card.bar.win_rate, 0)} win rate</b>{" "}
						<b className="text-[var(--text)]">and</b>{" "}
						<b className="text-[var(--text)]">more than +{card.bar.avg_trade_pct.toFixed(0)}%</b> average
						profit per closed trade, out-of-sample, on at least {card.bar.min_trades} trades, with no
						fold below 60%. Fees and slippage — {pctRaw(card.costs.round_trip_pct, 2)} a round trip —
						are inside every trade.
					</p>
				</div>
			</Section>

			<Section
				id="rules"
				title="The rule chain"
				subtitle={`All of these must hold on the close of the last session before a name is buyable. This family is: ${card.family_summary}. No scoring, no weighting, no discretion.`}
			>
				<ol className="border border-[var(--border)] bg-[var(--panel)]">
					{card.rules.map((rule, i) => (
						<li key={rule.key} className="flex gap-4 border-b border-[var(--border)] p-4 last:border-b-0">
							<span className="mt-0.5 font-mono text-[11px] text-[var(--text-ghost)]">
								{String(i + 1).padStart(2, "0")}
							</span>
							<div className="min-w-0">
								<p className="flex flex-wrap items-center gap-x-2 text-[14px] font-semibold text-[var(--text)]">
									{rule.label}
									{!rule.required && (
										<span className="border border-[var(--border)] bg-[var(--panel-3)] px-1.5 py-px font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--text-ghost)]">
											not used here
										</span>
									)}
								</p>
								<p className="mt-1 max-w-[76ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
									{rule.explain}
								</p>
								<p className="mt-1.5 font-mono text-[11px] text-[var(--text-ghost)]">
									{rule.source}
								</p>
							</div>
						</li>
					))}
				</ol>
			</Section>

			{card.families.length > 1 && (
				<Section
					id="families"
					title="Which measured family this runs"
					subtitle="The study cleared both bars with three different sets of conditions. They are not interchangeable — each needs a different market, so they fire on different days. This one trades in the most folds without any fold falling under the study's 60% fragility line."
				>
					<div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
						{card.families.map((f) => {
							const active = f.family === card.family;
							return (
								<div
									key={f.family}
									className="p-4"
									style={{ background: active ? "var(--panel-2)" : "var(--panel)" }}
								>
									<div className="flex items-center justify-between gap-2">
										<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
											{active ? "in use" : "also measured"}
										</span>
										{f.fold_worst_win_rate != null && (
											<span
												className="font-mono text-[10px] tabular-nums"
												style={{
													color:
														f.fold_worst_win_rate < 0.6
															? "var(--gold)"
															: "var(--text-ghost)",
												}}
											>
												worst fold {pct(f.fold_worst_win_rate, 0)}
											</span>
										)}
									</div>
									<p className="mt-2 text-[13px] font-semibold leading-tight text-[var(--text)]">
										{f.summary}
									</p>
									<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-[var(--text-dim)]">
										<span>{idr(f.oos_trades)} trades</span>
										<span>{pct(f.win_rate, 1)}</span>
										<span className="text-[var(--up)]">+{(f.avg_ret_pct ?? 0).toFixed(1)}%</span>
									</div>
								</div>
							);
						})}
					</div>
				</Section>
			)}

			<Section
				title="How it exits"
				subtitle="The stop is far wider than the target, and that is deliberate. The win rate is mostly the probability that a near target is reached before a far one; the average return is what keeps the result honest."
			>
				<div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
					<Stat label="Target" value={`+${card.exit_geometry.target_pct}%`} />
					<Stat label="Stop" value={`−${card.exit_geometry.stop_pct}%`} />
					<Stat
						label="Hold cap"
						value={`${card.exit_geometry.hold_bars} sessions`}
						note={`about ${(card.exit_geometry.hold_bars / 5).toFixed(0)} weeks`}
					/>
				</div>
			</Section>

			<Section
				id="result"
				title="What it measured"
			>
				<div className="grid gap-5 lg:grid-cols-[1fr_320px]">
					<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
						<div className="grid gap-4 sm:grid-cols-3">
							<Stat label="Win rate" value={pct(e.win_rate, 2)} />
							<Stat
								label="Avg per trade"
								value={e.avg_ret_pct != null ? `+${e.avg_ret_pct.toFixed(2)}%` : "—"}
							/>
							<Stat label="Out-of-sample trades" value={idr(e.oos_trades)} />
						</div>
						<div className="mt-5 border-t border-[var(--border)] pt-4">
							<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
								Per fold — trades / win rate / average
							</p>
							<div className="mt-2 flex flex-wrap gap-2">
								{e.fold_detail.split(/\s+/).filter(Boolean).map((part, i) => {
									const [fold, rest] = part.split(":");
									const [trades, wr, avg] = (rest ?? "").split("/");
									return (
										<span
											key={i}
											className="border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-[var(--text-dim)]"
										>
											<span className="text-[var(--text-ghost)]">{fold}</span> {trades}{" "}
											trades · {wr}% · {avg}%
										</span>
									);
								})}
							</div>
						</div>
					</div>
					<EvidenceBadge evidence={e} />
				</div>
			</Section>

			{card.deployment?.available && (
				<Section
					id="book"
					title="What it does as a book, not just per trade"
					subtitle="A win rate per trade says nothing about how much to hold or how deep the drawdown gets. The study measured that separately, at ten positions and equal weight, with costs inside every trade."
				>
					<div className="grid gap-5 lg:grid-cols-[1fr_320px]">
						<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
							<table className="w-full border-collapse text-left">
								<thead>
									<tr className="border-b border-[var(--border)]">
										{["Book", "Taken", "Win", "Total", "Max DD", "Invested"].map(
											(h) => (
												<th
													key={h}
													className="pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]"
												>
													{h}
												</th>
											),
										)}
									</tr>
								</thead>
								<tbody>
									{[
										["This method alone", card.deployment.single_family_book],
										["All qualifying methods, ranked", card.deployment.book],
									].map(([label, row]) => {
										const b = row as BookRow | null;
										if (!b) return null;
										return (
											<tr key={label as string} className="border-b border-[var(--border)] last:border-b-0">
												<td className="py-2.5 text-[13px] text-[var(--text)]">{label as string}</td>
												<td className="py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--text-dim)]">
													{b.taken}
												</td>
												<td className="py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--text-dim)]">
													{b.win_rate}%
												</td>
												<td className="py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--up)]">
													+{b.total_return_pct}%
												</td>
												<td className="py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--down)]">
													{b.max_dd_pct}%
												</td>
												<td className="py-2.5 text-right font-mono text-[12px] tabular-nums text-[var(--text-dim)]">
													{idr(Number(b.avg_exposure) * 100, 0)}%
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
							<p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
								{card.deployment.note}
							</p>
						</div>

						<div className="border border-[var(--border)] bg-[var(--panel-2)] p-5">
							<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
								Not a rate to plan against
							</p>
							<div
								className="tabular mt-2 font-mono text-[30px] font-bold leading-none"
								style={{ color: "var(--text-faint)", textDecoration: "line-through" }}
							>
								{card.deployment.walk_forward_pct_per_year != null
									? `+${card.deployment.walk_forward_pct_per_year}%`
									: "—"}
							</div>
							<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
								per year, walk-forward — struck through on purpose
							</div>
							<p className="mt-4 text-[12px] leading-relaxed text-[var(--text-faint)]">
								{card.deployment.walk_forward_caveat}
							</p>
							{card.five_year && "tiers" in card.five_year && (
								<p className="mt-3 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-ghost)]">
									The same study&rsquo;s five-year replay books the pooled version at{" "}
									<span className="text-[var(--down)]">
										{(card.five_year.tiers.find((t) => t.tier.includes("pooled"))?.book_total_pct ?? 0).toFixed(2)}%
									</span>
									. Both numbers are in the repository. Neither is a rate to plan around, and
									the gap between them is the honest width of this result.
								</p>
							)}
						</div>
					</div>
				</Section>
			)}

			{card.ladder.length > 0 && (
				<Section
					id="ladder"
					title="Every measured row that clears both bars"
					subtitle={`${card.ladder.length} of ${idr(e.total_cells_measured)} measured combinations cleared it. These are not independent methods: they are neighbouring exit geometries of the same entry rules, so they share most of their trades. Read them as one finding, not a list of many.`}
				>
					<div className="overflow-x-auto border border-[var(--border)]">
						<table className="w-full border-collapse text-left">
							<thead className="bg-[var(--panel-2)]">
								<tr>
									{["Entry rule", "Exit", "Trades", "Win rate", "Avg / trade", "Worst fold"].map(
										(h) => (
											<th
												key={h}
												className="border-b border-[var(--border)] px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]"
											>
												{h}
											</th>
										),
									)}
								</tr>
							</thead>
							<tbody>
								{card.ladder.map((row) => (
									<tr
										key={`${row.family}-${row.exit_method}`}
										className="border-b border-[var(--border)] last:border-b-0"
									>
										<td className="px-3 py-2 font-mono text-[11px] text-[var(--text-faint)]">
											{row.family}
										</td>
										<td className="px-3 py-2 font-mono text-[12px] text-[var(--text)]">
											{row.exit_method}
										</td>
										<td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-[var(--text-dim)]">
											{idr(row.oos_trades)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-[var(--text-dim)]">
											{pct(row.win_rate, 2)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-[var(--up)]">
											+{(row.avg_ret_pct ?? 0).toFixed(2)}%
										</td>
										<td
											className="px-3 py-2 text-right font-mono text-[12px] tabular-nums"
											style={{
												color:
													(row.fold_worst_win_rate ?? 1) < 0.6 ? "var(--gold)" : "var(--text-faint)",
											}}
										>
											{pct(row.fold_worst_win_rate, 1)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Section>
			)}

			<Section
				id="robustness"
				title="What could make this number wrong"
				subtitle="Three passes that were left open and then measured. The headline clears the bar and each of these says something it does not — which is not a contradiction to resolve in the app's favour, it is the shape of the result."
			>
				{/* The one that matters most gets the large type: a method quoted at
				    81% that wins 78% when you look at it a quarter at a time is a
				    different claim, and it should not be a footnote. */}
				{card.robustness?.quarterly?.below_bar && (
					<div className="mb-5 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-5">
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							Sampled every three months instead of six
						</p>
						<div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-3">
							<div>
								<div
									className="tabular font-mono text-[30px] font-bold leading-none"
									style={{ color: "var(--gold)" }}
								>
									{(card.robustness.quarterly.pick_win_rate ?? 0).toFixed(1)}%
								</div>
								<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
									win rate
								</div>
							</div>
							<div>
								{/* Struck through rather than shown beside it: the two figures
								    are different measurements, and putting them in a row
								    invites reading the gap as a trend. */}
								<div className="tabular font-mono text-[30px] font-bold leading-none text-[var(--text-faint)] line-through">
									{pct(e.win_rate, 1)}
								</div>
								<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
									on six-month windows
								</div>
							</div>
							<div>
								<div className="tabular font-mono text-[30px] font-bold leading-none text-[var(--text)]">
									{card.robustness.quarterly.windows_lost_money}/
									{card.robustness.quarterly.windows_traded}
								</div>
								<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
									windows lost money
								</div>
							</div>
							<div>
								<div
									className="tabular font-mono text-[30px] font-bold leading-none"
									style={{ color: "var(--text-dim)" }}
								>
									{card.bar.win_rate * 100}%
								</div>
								<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
									the bar
								</div>
							</div>
						</div>
						<p className="mt-4 max-w-[78ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
							The same method, the same data, with the test window cut from six months to a
							quarter. It averages{" "}
							{card.robustness.quarterly.pick_avg_ret_pct != null
								? `${card.robustness.quarterly.pick_avg_ret_pct >= 0 ? "+" : ""}${card.robustness.quarterly.pick_avg_ret_pct.toFixed(2)}%`
								: "—"}{" "}
							per trade and returns{" "}
							{card.robustness.quarterly.pick_total_return_pct != null
								? `+${card.robustness.quarterly.pick_total_return_pct.toFixed(2)}%`
								: "—"}
							, but the win rate falls under the {card.bar.win_rate * 100}% this method is
							credited with. Two quarters
							carry the whole result. A quarter is also too short to hold the 30 trades a cell
							needs before the bar can be scored at all, in{" "}
							{card.robustness.quarterly.windows_too_short_for_the_bar} of the{" "}
							{card.robustness.quarterly.windows_total} windows — so this is not a case of the
							bar being tested quarterly and missed. It is the bar being untestable
							quarterly, and the pooled result when it is measured anyway.
						</p>
						<p className="mt-3 max-w-[78ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
							{card.robustness.revisions_note}
						</p>
					</div>
				)}

				<div className="grid gap-5 lg:grid-cols-2">
					{/* Survivorship: the edge's shape across names. */}
					{card.robustness?.survivorship?.available && (
						<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
							<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
								Remove the best names
							</p>
							<p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
								{card.robustness.survivorship.note}
							</p>
							<div className="mt-4 space-y-1.5">
								{card.robustness.survivorship.curve.map((row) => {
									const stressed = row.bound === "survivorship" || row.bound === "both";
									const bad = (row.avg_ret_pct ?? 0) < 0;
									return (
										<div
											key={row.bound}
											className="flex items-baseline gap-3 font-mono text-[12px] tabular-nums"
											style={stressed ? { color: "var(--gold)" } : undefined}
										>
											<span className="w-28 shrink-0 text-[var(--text-faint)]">{row.bound}</span>
											<span className="w-14 text-right text-[var(--text-ghost)]">
												{idr(row.trades)}
											</span>
											<span className="w-14 text-right">{pct(row.win_rate, 1)}</span>
											<span
												className="w-16 text-right"
												style={{ color: bad ? "var(--down)" : "var(--up)" }}
											>
												{(row.avg_ret_pct ?? 0) >= 0 ? "+" : ""}
												{(row.avg_ret_pct ?? 0).toFixed(2)}%
											</span>
										</div>
									);
								})}
							</div>
							<p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
								Rebuilt on the names that survived, the same cell goes from{" "}
								<span className="text-[var(--up)]">
									+{(card.robustness.survivorship.baseline_avg_pct ?? 0).toFixed(2)}%
								</span>{" "}
								per trade to{" "}
								<span className="text-[var(--down)]">
									{(card.robustness.survivorship.worst_drop_avg_pct ?? 0).toFixed(2)}%
								</span>
								. Survivorship bias only runs one way, so a panel holding the names that died
								would sit below even this — every published return is an upper bound.
							</p>
						</div>
					)}

					{/* Multiple testing: how much of the win rate is the search. */}
					{card.robustness?.multiple_testing?.available && (
						<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
							<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
								How much of this is the search
							</p>
							<p className="mt-2 text-[13px] leading-relaxed text-[var(--text-dim)]">
								{idr(card.robustness.multiple_testing.cells_searched)} trading cells were
								searched with the target already known. Three standard tests, three answers:
							</p>
							<ul className="mt-4 space-y-2.5">
								<Test
									question="Is something in the set real?"
									answer={`yes — p = ${card.robustness.multiple_testing.spa_p?.toFixed(4)}`}
									good
								/>
								<Test
									question="Is the top row better than the best alternative it was mined against?"
									answer={`not distinguishable — p = ${card.robustness.multiple_testing.reality_check_p?.toFixed(2)}`}
								/>
								<Test
									question="Is this exact exit a discovery?"
									answer="no — deflated Sharpe of zero"
								/>
							</ul>
							<p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
								What survives is the <span className="text-[var(--text-dim)]">pattern</span> —
								breakout, plus breadth, plus relative strength, plus quiet volatility. Not this
								particular exit geometry, and not the difference between it and its
								neighbours in the ladder above.
							</p>
						</div>
					)}
				</div>

				{card.robustness?.flags?.length ? (
					<div className="mt-5 border border-[var(--border)] bg-[var(--panel-2)] p-5">
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							In one line each
						</p>
						<ul className="mt-3 space-y-2">
							{card.robustness.flags.map((flag) => (
								<li key={flag} className="flex gap-3 text-[13px] leading-relaxed text-[var(--text-dim)]">
									<span
										className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]"
										aria-hidden
									/>
									<span className="max-w-[86ch]">{flag}</span>
								</li>
							))}
						</ul>
						<p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
							All of which the headline number is: {card.robustness.headline_is}.
						</p>
					</div>
				) : null}
			</Section>

			<Section title="What this is not">
				<div className="border border-[var(--border)] bg-[var(--panel-2)] p-5">
					<ul className="space-y-3">
						{[
							card.holdout
								? `The headline clears the bar; nothing else does. ${card.holdout.search_cells_clearing} of ${card.holdout.search_cells} searched configurations cleared both bars, and ${card.holdout.winners_surviving} of ${card.holdout.winners_tested} held up on data the search never saw.`
								: "The headline clears the bar on the data it was searched on. Whether it survives unseen data has not been measured here.",
							"The result is not evenly earned. It comes from six-month windows; sampled quarterly it wins less, and two quarters carry the profit.",
							"Rebuilt on names that survived, the same cell earns less than zero per trade. The panel is a survivor panel and every return here is an upper bound.",
							"It is long-only and buys liquid IDX names. It says nothing about other markets, intraday holds, or shorting — the short twin measured 54.7% in the same study.",
							"It is one method. The ladder above is neighbouring exit geometries of the same entry rules, not separate discoveries.",
							`Costs of ${pctRaw(card.costs.round_trip_pct, 2)} a round trip are inside every measured trade, but your broker may charge more. Check before sizing.`,
						].map((line) => (
							<li key={line} className="flex gap-3 text-[13px] leading-relaxed text-[var(--text-dim)]">
								<span
									className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-ghost)]"
									aria-hidden
								/>
								<span className="max-w-[86ch]">{line}</span>
							</li>
						))}
					</ul>
				</div>
			</Section>
		</Page>
	);
}

/** One question a statistical test was asked, and its answer, unembellished. */
function Test({
	question,
	answer,
	good = false,
}: {
	question: string;
	answer: string;
	good?: boolean;
}) {
	return (
		<li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
			<span className="text-[var(--text-dim)]">{question}</span>
			<span
				className="font-mono text-[12px]"
				style={{ color: good ? "var(--up)" : "var(--gold)" }}
			>
				{answer}
			</span>
		</li>
	);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
	return (
		<div>
			<div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
				{label}
			</div>
			<div className="tabular mt-1 font-mono text-[22px] font-bold leading-none text-[var(--text)]">
				{value}
			</div>
			{note && <div className="mt-1 font-mono text-[10px] text-[var(--text-ghost)]">{note}</div>}
		</div>
	);
}