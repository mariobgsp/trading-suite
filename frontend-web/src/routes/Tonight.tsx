/**
 * Tonight — the front door.
 *
 * One screen, read top to bottom: the verdict, the gate that explains it, the
 * names, and what to do with each. On a weekend the same screen becomes the
 * week-ahead list, because the horizon comes from the session rather than from
 * the clock.
 */

import { useEffect, useState } from "react";
import { planApi, type Plan } from "@/lib/api/plan";
import {
	CandidateRow,
	EvidenceBadge,
	Section,
	Verdict,
	WatchRow,
	idr,
	pct,
} from "@/components/plan";

function usePlan() {
	const [plan, setPlan] = useState<Plan | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let alive = true;
		planApi
			.plan()
			.then((p) => alive && setPlan(p))
			.catch((e: Error) => alive && setError(e.message));
		return () => {
			alive = false;
		};
	}, []);
	return { plan, error };
}

export default function Tonight() {
	const { plan, error } = usePlan();

	if (error) {
		return (
			<Page>
				<h1 className="font-display text-[30px] text-[var(--text)]">The backend is not answering</h1>
				<p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Start it with <code className="font-mono text-[13px]">./trading-suite run</code> and reload.
					It reads the study's own universe, so the first plan takes a few seconds.
				</p>
				<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">{error}</p>
			</Page>
		);
	}

	if (!plan) {
		return (
			<Page>
				<p className="font-mono text-[13px] text-[var(--text-faint)]">
					Reading the study's universe — a few seconds.
				</p>
			</Page>
		);
	}

	const { regime, candidates, watchlist, evidence, coverage } = plan;
	const needsIndex = plan.required_gates.includes("index_above_200");

	/* The three bands, so the closed screen reads as an instruction rather than a
	 * failure: trade above the trending line, flat in the middle, watch below. */
	const BAND: Record<string, { label: string; action: string; color: string }> = {
		trending: { label: "trending", action: "trade", color: "var(--up)" },
		sideways: { label: "sideways", action: "stay flat", color: "var(--gold)" },
		capitulation: { label: "capitulation", action: "watch only", color: "var(--down)" },
	};
	const band = BAND[regime.band] ?? BAND.sideways;

	return (
		<Page>
			<Verdict
				open={plan.open}
				headline={plan.headline}
				sessionLabel={plan.session_label}
				horizon={plan.horizon}
				evidence={evidence}
				costs={plan.costs}
				coverage={coverage}
				indexClose={regime.index_close}
				universeSize={regime.universe_size}
				nextSession={plan.next_session}
				nextSessionBasis={plan.next_session_basis}
			/>

			{plan.holdout && !plan.holdout.winners_surviving && (
				<div className="mb-6 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-4">
					<p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
						<span className="font-semibold text-[var(--text)]">Before you act on a name:</span>{" "}
						{plan.holdout.search_cells_clearing} of {plan.holdout.search_cells} configurations the
						study searched cleared 80% win rate and +5% per trade together, and{" "}
						{plan.holdout.winners_surviving} of {plan.holdout.winners_tested} held up on folds no
						search had seen. The best of everything tried reached{" "}
						<span className="text-[var(--text)]">
							{pct(plan.holdout.best_holdout_win_rate, 1)} win rate and +
							{(plan.holdout.best_holdout_avg_ret_pct ?? 0).toFixed(2)}% per trade
						</span>
						.{" "}
						<a
							href="/method#holdout"
							className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text)]"
						>
							Read the holdout
						</a>
					</p>
				</div>
			)}

			<Section
				title="The market gate"
				subtitle={
					needsIndex
						? "Two conditions every name shares. While either is shut, no stock in the universe qualifies — that is the method protecting you, not the app failing."
						: "One condition every name shares. While it is shut, no stock in the universe qualifies — that is the method protecting you, not the app failing. The index reading is shown for context, but this method does not trade on it."
				}
			>
				<div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
					<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						Tonight&rsquo;s band
					</span>
					<span className="font-display text-[18px] font-semibold" style={{ color: band.color }}>
						{band.label}
					</span>
					<span className="font-mono text-[12px] text-[var(--text-dim)]">→ {band.action}</span>
				</div>
				<div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
					<Gate
						label="Market breadth"
						ok={regime.breadth_open}
						value={pct(regime.breadth, 1)}
						need={`needs ${pct(regime.breadth_threshold, 0)}`}
						note={`Share of the ${idr(regime.universe_size)} names that traded above their own 200-day average. Over five years its median is ${pct(regime.breadth_median, 0)}. The study measured this band directly and found the index drifts about zero over five sessions while a round trip costs 0.50%, so the flat band is the finding rather than a gap.`}
					/>
					<Gate
						label="IHSG above its 200-day average"
						ok={regime.index_above_200 ?? false}
						required={needsIndex}
						value={regime.index_above_200 ? "Yes" : "No"}
						need={idr(regime.index_close)}
						note={
							needsIndex
								? `The index itself has to be worth buying. It is also ${
										regime.index_above_50 ? "above" : "below"
									} its own 50-day average.`
								: "Context only — this method trades on the universe's own breadth, not on the index."
						}
					/>
				</div>
			</Section>

			<Section
				title={plan.open ? `Buy for ${plan.horizon}` : "Not buying tonight"}
				subtitle={
					plan.open
						? "Every name below cleared all six conditions. Entry, target and stop are already priced for you — you only have to place the order."
						: "The gate is shut, so the honest answer is no names. The study measured its win rate on the trades it did take, which is exactly why it waits for these conditions rather than buying something close."
				}
				right={`${idr(coverage.tradable_on_session as number)} close to firing`}
			>
				{candidates.length > 0 ? (
					<ul className="border border-[var(--border)] bg-[var(--panel)]">
						{candidates.map((c) => (
							<CandidateRow key={c.ticker} candidate={c} />
						))}
					</ul>
				) : (
					<div className="border border-[var(--border)] bg-[var(--panel)] px-6 py-7">
						<p className="max-w-[74ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
							Nothing cleared every condition on {plan.session_label}. Holding out is the
							position here, and it is a measured one: taking something outside these six rules is
							a different strategy that nobody has backtested.
						</p>
					</div>
				)}
			</Section>

			{watchlist.length > 0 && (
				<Section
					title="One condition away"
					subtitle="Not buyable yet. Each of these leads the universe on momentum and sits at its breakout level, so this is the list to watch for the next session."
					right={`${watchlist.length} names`}
				>
					<ul className="border border-[var(--border)] bg-[var(--panel)]">
						{watchlist.map((w) => (
							<WatchRow key={w.ticker} item={w} />
						))}
					</ul>
				</Section>
			)}

			<Section
				title="What this method is worth"
				subtitle="The number at the top is real, and so is its limit. Read this before the first trade, not after."
			>
				<div className="grid gap-5 lg:grid-cols-[1fr_320px]">
					<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
						<p className="max-w-[78ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
							Measured out-of-sample under walk-forward folds on{" "}
							{idr(evidence.oos_trades)} closed trades, with fees and slippage inside every one of
							them. The pooled result is {pct(evidence.win_rate, 1)} of trades winning, averaging{" "}
							{evidence.avg_ret_pct != null ? `+${evidence.avg_ret_pct.toFixed(2)}%` : "—"} each.
							It is not evenly earned — fold by fold it ran{" "}
							<span className="font-mono text-[12px] text-[var(--text)]">
								{evidence.fold_detail || "—"}
							</span>
						</p>
						<p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
							{evidence.caveat}
						</p>
					</div>
					<EvidenceBadge evidence={evidence} roundTripPct={plan.costs.round_trip} />
				</div>
			</Section>
		</Page>
	);
}

function Gate({
	label,
	ok,
	value,
	need,
	note,
	required = true,
}: {
	label: string;
	ok: boolean;
	value: string;
	need: string;
	note: string;
	required?: boolean;
}) {
	return (
		<div className="bg-[var(--panel)] p-5">
			<div className="flex items-baseline justify-between gap-3">
				<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
					{label}
				</span>
				<span
					className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
					style={{
						color: !required ? "var(--text-ghost)" : ok ? "var(--up)" : "var(--gold)",
						background: !required
							? "var(--panel-3)"
							: ok
								? "color-mix(in srgb, var(--up) 12%, transparent)"
								: "color-mix(in srgb, var(--gold) 14%, transparent)",
					}}
				>
					{required ? (ok ? "open" : "shut") : "context"}
				</span>
			</div>
			<div className="tabular mt-2 font-mono text-[30px] font-bold leading-none text-[var(--text)]">
				{value}
			</div>
			<div className="mt-1 font-mono text-[11px] text-[var(--text-ghost)]">{need}</div>
			<p className="mt-3 max-w-[56ch] text-[12px] leading-relaxed text-[var(--text-faint)]">{note}</p>
		</div>
	);
}

export function Page({ children }: { children: React.ReactNode }) {
	return <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">{children}</div>;
}