/**
 * The plan's visual vocabulary.
 *
 * Three ideas carry the whole screen:
 *
 *  1. The verdict is the largest thing on the page. Open or shut is a fact you
 *     read in a glance, not a setting you go looking for.
 *  2. The measured proof sits next to the verdict, always. A number you cannot
 *     trace is worse than no number, so the win rate, the average and the trade
 *     count travel with every claim.
 *  3. A gate is shown as its own fact with its own value, never as a score out
 *     of ten. "RS 94 vs the 90 it needs" is checkable; "8/10 quality" is not.
 */

import { useState } from "react";
import type {
	Candidate,
	Citation,
	Evidence,
	Gate,
	GateKey,
	Plan,
	Verdict,
	VerdictCheck,
	WatchItem,
} from "@/lib/api/plan";

/* ── formatters ───────────────────────────────────────────────────────────── */

export const idr = (v: number | null | undefined, dp = 0): string =>
	v == null || Number.isNaN(v)
		? "—"
		: new Intl.NumberFormat("id-ID", {
				minimumFractionDigits: dp,
				maximumFractionDigits: dp,
			}).format(v);

export const pct = (v: number | null | undefined, dp = 1): string =>
	v == null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(dp)}%`;

export const pctRaw = (v: number | null | undefined, dp = 1): string =>
	v == null || Number.isNaN(v) ? "—" : `${v.toFixed(dp)}%`;

/** Human gate names. The key is the seam's; the label is ours. */
/**
 * Fallback names for a gate key, for the one place the API sends only a key (the
 * watchlist's `blocked_by`). Wherever a Gate object is at hand its own `label` is
 * preferred: the backend's rule chain is the single vocabulary, and these strings
 * mirror it rather than inventing a second one.
 */
export const GATE_LABEL: Record<string, string> = {
	breakout: "40-session breakout",
	relative_strength: "Relative strength top 10%",
	breadth: "Market breadth",
	quiet_vol: "Quiet before the break",
	weekly_trend: "Weekly trend up",
	index_above_200: "IHSG above its 200-day average",
};

/* ── sections ──────────────────────────────────────────────────────────────── */

/**
 * A section heading for the plan pages.
 *
 * Deliberately not the app's terminal-style `SectionHeader`: that one wraps its
 * title in monospace with a `>` prompt and its subtitle in a `#` comment, which
 * reads as a log rather than as a decision. The plan is read, not parsed, so
 * this uses the sans stack, drops the decoration, and gives the subtitle a
 * measure that fills the column instead of stopping two-thirds across it.
 */
export function Section({
	id,
	title,
	subtitle,
	right,
	children,
}: {
	id?: string;
	title: string;
	subtitle?: string;
	right?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section id={id} className="mt-12 scroll-mt-20 first:mt-0">
			<div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
				<h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h2>
				{right && <span className="font-mono text-[11px] text-[var(--text-ghost)]">{right}</span>}
			</div>
			{subtitle && (
				<p className="mb-5 max-w-[76ch] text-[13px] leading-relaxed text-[var(--text-faint)]">
					{subtitle}
				</p>
			)}
			{children}
		</section>
	);
}

/* ── the verdict ───────────────────────────────────────────────────────────── */

/**
 * The verdict, at the size the decision deserves.
 *
 * Four states and only one of them is a buy. `DATA_UNSAFE` is deliberately the
 * loudest, and it is the backend that withholds the tickets: a screen that says
 * "buy" on a broken bar source is worse than one that says nothing.
 */
export function VerdictHero({ plan }: { plan: Plan }) {
	const v = plan.verdict;
	const tone =
		v.state === "ENTER"
			? "var(--up)"
			: v.state === "DATA_UNSAFE"
				? "var(--down)"
				: "var(--gold)";
	const word: Record<string, string> = {
		ENTER: "Enter",
		WAIT: "Wait",
		NO_TRADE: "No trade",
		DATA_UNSAFE: "Data unsafe",
	};
	return (
		<section
			className="relative overflow-hidden border border-[var(--border)] bg-[var(--panel)]"
			style={{ borderLeftWidth: 3, borderLeftColor: tone }}
			aria-live="polite"
		>
			<div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
				<div className="min-w-0">
					<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
						{plan.session_label} · plan for {plan.horizon}
					</p>
					<div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span
							className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
							style={{ background: tone }}
							aria-hidden
						/>
						<span
							className="font-display text-[30px] leading-none tracking-[-0.01em] sm:text-[38px]"
							style={{ color: tone }}
						>
							{word[v.state] ?? v.state}
						</span>
						<span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
							{v.state}
						</span>
					</div>
					<p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-[var(--text)]">
						{v.headline}
					</p>
					<p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
						{v.detail}
					</p>
					<div className="mt-4 border-l-2 pl-3" style={{ borderColor: tone }}>
						<p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
							Do this
						</p>
						<p className="mt-1 max-w-[64ch] text-[13px] leading-relaxed text-[var(--text)]">
							{v.action}
						</p>
					</div>
					<p className="mt-3 max-w-[64ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
						<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
							What would change it ·{" "}
						</span>
						{v.change_needed}
					</p>
					<p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--text-ghost)]">
						{idr(plan.regime.universe_size)} names above their 200-day average · breadth{" "}
						{pct(plan.regime.breadth, 0)}
						{plan.regime.index_close != null ? ` · IHSG ${idr(plan.regime.index_close)}` : ""}
						<br />
						Look again {v.recheck_on} ·{" "}
						{v.recheck_basis === "exchange_calendar"
							? "from the exchange calendar"
							: "next weekday, holiday unverified"}
					</p>
					{v.state === "ENTER" && (
						<p className="mt-3 max-w-[64ch] text-[12px] leading-relaxed text-[var(--text-dim)]">
							Order by <span className="font-mono text-[var(--text)]">{v.place_by}</span> WIB.{" "}
							{v.place_note}
						</p>
					)}
					{v.state === "DATA_UNSAFE" && <IntegrityList checks={v.integrity} />}
				</div>
				<div className="w-full shrink-0 space-y-3 lg:w-[330px]">
					{v.state === "ENTER" && plan.corrected ? (
						<CorrectedEvidenceCard evidence={plan.corrected} />
					) : null}
					{v.state !== "ENTER" ? <StandDownPanel verdict={v} /> : null}
				</div>
			</div>
		</section>
	);
}

/**
 * The measured case for not trading, where the decision is made.
 *
 * "No trade" is only an answer if it has a reason, and this app's reason is a
 * measurement rather than a mood: the same rules, run in the same band on the
 * same data, lose to costs — and the same book with that band traded draws a 67%
 * drawdown against 7.9% without it.
 */
export function StandDownPanel({ verdict }: { verdict: Verdict }) {
	const c = verdict.stand_down_case;
	if (!c) return null;
	const side = c.sideways;
	const book = c.book;
	const signed = (value: number | null | undefined) =>
		value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
	return (
		<div className="border border-[var(--border)] bg-[var(--panel-2)] p-4">
			<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
				Why flat is the finding
			</p>
			{side?.win_rate != null && side.avg_ret_pct != null ? (
				<p className="mt-2 text-[12px] leading-relaxed text-[var(--text-dim)]">
					The study ran these same rules in the flat band anyway:{" "}
					<span className="text-[var(--text)]">{pct(side.win_rate, 1)} win</span> at{" "}
					<span className="text-[var(--text)]">{signed(side.avg_ret_pct)}</span> a trade. That band
					drifts {signed(side.drift_5s_pct)} per five sessions while a round trip costs{" "}
					{pctRaw(c.round_trip_pct, 2)}, so it would have to capture{" "}
					{side.capture_needed_x ?? "—"}× the drift to pay for itself.
				</p>
			) : null}
			{book?.trend_only?.available && book?.with_sideways?.available ? (
				<p className="mt-2 text-[12px] leading-relaxed text-[var(--text-dim)]">
					Same screen, same period, {idr(book.slots)} slots: with the flat band skipped it books{" "}
					<span className="text-[var(--up)]">{signed(book.trend_only.total_pct)}</span> at a{" "}
					{book.trend_only.max_drawdown_pct?.toFixed(1)}% drawdown. With the band traded,{" "}
					<span className="text-[var(--down)]">{signed(book.with_sideways.total_pct)}</span> at{" "}
					{book.with_sideways.max_drawdown_pct?.toFixed(1)}%.
				</p>
			) : null}
			<p className="mt-3 border-t border-[var(--border)] pt-2.5 font-mono text-[11px] leading-relaxed text-[var(--text-ghost)]">
				This band is {pct(c.bands.sideways, 0)} of{" "}
				{c.sessions_measured != null ? idr(c.sessions_measured) : "—"} measured sessions. Long-run
				median breadth {pct(c.long_run_median, 0)}.
			</p>
		</div>
	);
}

/** The integrity checks, listed rather than summarised when one fails. */
export function IntegrityList({ checks }: { checks: VerdictCheck[] }) {
	if (!checks?.length) return null;
	return (
		<ul className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3">
			{checks.map((check) => (
				<li key={check.key} className="flex gap-2 text-[12px] leading-relaxed">
					<span
						className="mt-[3px] font-mono text-[11px]"
						style={{ color: check.ok ? "var(--up)" : "var(--down)" }}
						aria-hidden
					>
						{check.ok ? "✓" : "✕"}
					</span>
					<span className={check.ok ? "text-[var(--text-faint)]" : "text-[var(--text-dim)]"}>
						<span className="text-[var(--text)]">{check.label}</span> — {check.detail}
					</span>
				</li>
			))}
		</ul>
	);
}

/**
 * The measured result, always on screen.
 *
 * Every number here is read from the study's own results file, so this card is
 * a citation, not a claim. The caveat travels with it because the caveat is
 * part of the number.
 */
export function EvidenceBadge({
	evidence,
	roundTripPct,
}: {
	evidence: Evidence;
	/** The round-trip cost the running chain is measured with, from plan.costs. */
	roundTripPct?: number;
}) {
	const ok = evidence.clears_bar;
	return (
		<div className="w-full shrink-0 border border-[var(--border)] bg-[var(--panel-2)] p-4 lg:w-[300px]">
			<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
				{evidence.role === "searched_census"
					? "Best of the configurations searched"
					: evidence.role === "walk_forward_corrected"
						? "The corrected result"
						: evidence.role === "replay"
							? "One-window replay, not a walk-forward"
							: "Measured on this method"}
			</p>
			<div className="mt-3 grid grid-cols-3 gap-3">
				<div>
					<div
						className="tabular text-[24px] font-bold leading-none"
						style={{ color: ok ? "var(--up)" : "var(--text)" }}
					>
						{pct(evidence.win_rate, 1)}
					</div>
					<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
						win rate
					</div>
				</div>
				<div>
					<div className="tabular text-[24px] font-bold leading-none text-[var(--text)]">
						{evidence.avg_ret_pct != null ? `+${evidence.avg_ret_pct.toFixed(1)}%` : "—"}
					</div>
					<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
						avg / trade
					</div>
				</div>
				<div>
					<div className="tabular text-[24px] font-bold leading-none text-[var(--text)]">
						{evidence.oos_trades != null ? idr(evidence.oos_trades) : "—"}
					</div>
					<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
						out-of-sample
					</div>
				</div>
			</div>
			<p className="mt-3 border-t border-[var(--border)] pt-2.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
				{evidence.measured ? (
					<>
						{roundTripPct != null ? (
							<>Costs of {pctRaw(roundTripPct, 2)} a round trip are inside every trade.{" "}</>
						) : (
							<>Fees and slippage are inside every measured trade.{" "}</>
						)}
						{" "}
						<a
							href="/method#holdout"
							className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text)]"
						>
							What it did on unseen data
						</a>
					</>
				) : (
					"No measured results are available yet — read the rules without a number."
				)}
			</p>
			{evidence.role === "searched_census" && (
				<p className="mt-2 text-[11px] leading-relaxed text-[var(--text-ghost)]">
					A searched figure, not a forecast. This row is one of the configurations the
					study ranked; the holdout is the expectation.
				</p>
			)}
		</div>
	);
}

/* ── gates ─────────────────────────────────────────────────────────────────── */

/** One condition, with its own value. Checkable at a glance. */
export function GateChip({ gate }: { gate: Gate }) {
	const color = gate.passed ? "var(--up)" : "var(--text-ghost)";
	return (
		<span
			className="inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
			style={{
				color,
				borderColor: gate.passed ? "color-mix(in srgb, var(--up) 30%, transparent)" : "var(--border)",
				background: gate.passed ? "color-mix(in srgb, var(--up) 8%, transparent)" : "transparent",
			}}
			title={gate.text}
		>
			<span aria-hidden>{gate.passed ? "✓" : "✕"}</span>
			{gate.label || GATE_LABEL[gate.key] || gate.key}
		</span>
	);
}

/**
 * The full chain, spelled out. This is the "why" surface.
 *
 * A gate the running family does not apply is dimmed and shown with a dash. It
 * is still listed, because hiding it would make the family look simpler than it
 * is — but it must not read as a condition the user failed.
 */
export function GateList({
	gates,
	required,
}: {
	gates: Gate[];
	required?: GateKey[];
}) {
	const applies = required ? new Set(required) : null;
	return (
		<ul className="divide-y divide-[var(--border)] border border-[var(--border)]">
			{gates.map((gate) => {
				const isRequired = applies ? applies.has(gate.key) : true;
				return (
				<li
					key={gate.key}
					className="flex gap-3 p-3"
					style={isRequired ? undefined : { opacity: 0.55 }}
				>
					<span
						className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px]"
						style={{
							color: gate.passed ? "var(--up)" : "var(--text-ghost)",
							background: gate.passed
								? "color-mix(in srgb, var(--up) 12%, transparent)"
								: "var(--panel-3)",
						}}
						aria-hidden
					>
						{gate.passed ? "✓" : isRequired ? "✕" : "–"}
					</span>
					<div className="min-w-0">
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
							{gate.label || GATE_LABEL[gate.key] || gate.key}
						</p>
						<p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-dim)]">
							{gate.text}
						</p>
					</div>
				</li>
				);
			})}
		</ul>
	);
}

/* ── the buy list ──────────────────────────────────────────────────────────── */

export function CandidateRow({ candidate }: { candidate: Candidate }) {
	const [open, setOpen] = useState(false);
	const g = candidate.geometry;
	return (
		<li className="border-b border-[var(--border)] last:border-b-0">
			<div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 px-4 py-4 sm:px-5">
				<a
					href={`/name/${candidate.ticker}`}
					className="font-display text-[22px] leading-none tracking-[-0.01em] text-[var(--text)] hover:underline hover:underline-offset-4"
				>
					{candidate.ticker}
				</a>
				<span className="tabular font-mono text-[15px] text-[var(--text-dim)]">
					{idr(candidate.close)}
				</span>
				{candidate.change_pct != null && (
					<span
						className="font-mono text-[12px]"
						style={{ color: candidate.change_pct >= 0 ? "var(--up)" : "var(--down)" }}
					>
						{candidate.change_pct >= 0 ? "▲" : "▼"} {pctRaw(Math.abs(candidate.change_pct))}
					</span>
				)}
				<span className="ml-auto flex flex-wrap items-center gap-1.5">
					{candidate.gates.map((gate) => (
						<GateChip key={gate.key} gate={gate} />
					))}
				</span>
			</div>

			{/* The exit plan, always visible: this is what the user trades against. */}
			<div className="grid grid-cols-2 gap-px border-y border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
				<Level
					label="Target"
					value={idr(g.target_price)}
					note={`+${g.target_pct}% · ~${g.holding_weeks} weeks`}
					color="var(--up)"
				/>
				<Level
					label="Stop"
					value={idr(g.stop_price)}
					note={`−${g.stop_pct}% · R:R 1 : ${g.reward_risk.toFixed(2)}`}
					color="var(--down)"
				/>
				<Level
					label="Position"
					value={g.position_idr != null ? idr(g.position_idr) : "—"}
					note={
						g.lots != null && g.participation_pct != null
							? `${idr(g.lots)} lots · ${g.participation_pct.toFixed(2)}% of ADV`
							: "not sizeable at 2% of ADV"
					}
					color="var(--text)"
				/>
				<Level
					label="Max loss"
					value={g.max_loss_idr != null ? `−${idr(g.max_loss_idr)}` : "—"}
					note={
						g.risk_pct_of_position != null
							? `${g.risk_pct_of_position.toFixed(1)}% of the position, costs in`
							: `${g.gross_risk_pct}% incl. costs`
					}
					color="var(--text)"
				/>
			</div>

			<div className="px-4 py-2.5 sm:px-5">
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)] hover:text-[var(--text)]"
					aria-expanded={open}
				>
					{open ? "− hide the reasoning" : "+ why this one, and how to hold it"}
				</button>
				{open && (
					<div className="mt-4 grid gap-5 lg:grid-cols-2">
						<GateList gates={candidate.gates} />
						<div className="space-y-4">
							<HowToHold candidate={candidate} />
							{candidate.geometry.notes?.length ? (
								<ul className="space-y-1.5 border-t border-[var(--border)] pt-3">
									{candidate.geometry.notes.map((note) => (
										<li
											key={note}
											className="text-[11px] leading-relaxed text-[var(--text-faint)]"
										>
											{note}
										</li>
									))}
								</ul>
							) : null}
						</div>
					</div>
				)}
			</div>
		</li>
	);
}

function Level({
	label,
	value,
	note,
	color,
}: {
	label: string;
	value: string;
	note: string;
	color: string;
}) {
	return (
		<div className="bg-[var(--panel)] px-4 py-3">
			<div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
				{label}
			</div>
			<div className="tabular mt-1 font-mono text-[16px] font-semibold leading-none" style={{ color }}>
				{value}
			</div>
			<div className="mt-1 font-mono text-[10px] text-[var(--text-ghost)]">{note}</div>
		</div>
	);
}

/** Plain-language instructions. The user asked to be guided, not to infer. */
export function HowToHold({ candidate }: { candidate: Candidate }) {
	const g = candidate.geometry;
	const steps = [
		{
			n: "1",
			t: `Buy at tomorrow's open`,
			d: `Any fill up to about ${idr(g.entry_ref * 1.01)} is fine. Above that you are chasing the breakout and the measured edge no longer applies.`,
		},
		{
			n: "2",
			t: `Sell at ${idr(g.target_price)}`,
			d: `That is +${g.target_pct}% from the last close. This method wins by letting winners run: the stop is far away on purpose, so do not tighten it.`,
		},
		{
			n: "3",
			t: `Stop out at ${idr(g.stop_price)}`,
			d: `${g.stop_pct}% below the entry. ${g.gross_risk_pct}% of that loss is the round-trip cost, which is already inside the measured average.`,
		},
		{
			n: "4",
			t: `Sell after ${g.holding_weeks} weeks if nothing happened`,
			d: `The holding cap is ${g.hold_bars} sessions. Time is an exit: a trade that has not moved by then is not the setup this method measured.`,
		},
	];
	return (
		<ol className="space-y-3">
			{steps.map((s) => (
				<li key={s.n} className="flex gap-3">
					<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border border-[var(--border-strong)] font-mono text-[11px] text-[var(--text-dim)]">
						{s.n}
					</span>
					<div>
						<p className="text-[13px] font-semibold text-[var(--text)]">{s.t}</p>
						<p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-faint)]">{s.d}</p>
					</div>
				</li>
			))}
		</ol>
	);
}

/* ── the watchlist ─────────────────────────────────────────────────────────── */

export function WatchRow({ item }: { item: WatchItem }) {
	return (
		<li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--border)] px-4 py-3 last:border-b-0 sm:px-5">
			<a
				href={`/name/${item.ticker}`}
				className="font-display text-[18px] leading-none text-[var(--text)] hover:underline hover:underline-offset-4"
			>
				{item.ticker}
			</a>
			<span className="tabular font-mono text-[13px] text-[var(--text-dim)]">{idr(item.close)}</span>
			<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				blocked by {GATE_LABEL[item.blocked_by] ?? item.blocked_by}
			</span>
			<span className="ml-auto min-w-0 flex-1 text-right text-[12px] text-[var(--text-faint)] sm:flex-none">
				{item.distance_text}
			</span>
		</li>
	);
}

/* ── evidence tiers ────────────────────────────────────────────────────────── */

function EvidenceStat({
	label,
	value,
	note,
}: {
	label: string;
	value: string;
	note?: string;
}) {
	return (
		<div>
			<div className="tabular text-[22px] font-bold leading-none text-[var(--text)]">
				{value}
			</div>
			<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
				{label}
			</div>
			{note ? (
				<div className="mt-1 font-mono text-[10px] text-[var(--text-ghost)]">{note}</div>
			) : null}
		</div>
	);
}

/** A tier, named. Used wherever a number is shown so no two tiers look alike. */
export function TierTag({ role }: { role: string }) {
	const label =
		role === "walk_forward_corrected"
			? "corrected walk-forward"
			: role === "replay"
				? "one-window replay"
				: "searched — best of many";
	const color = role === "walk_forward_corrected" ? "var(--up)" : "var(--gold)";
	return (
		<span
			className="inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]"
			style={{
				color,
				borderColor: "color-mix(in srgb, currentColor 30%, transparent)",
			}}
		>
			{label}
		</span>
	);
}

/**
 * Where a number came from, in the study's own words.
 *
 * The corrected result has no results file behind it, so the citation is part of
 * the evidence rather than a footnote: the file, the line, the sentence, and the
 * command that regenerates it.
 */
export function ProvenanceList({ citations }: { citations: Citation[] }) {
	if (!citations?.length) return null;
	return (
		<ol className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
			{citations.map((c) => (
				<li key={c.label} className="text-[11px] leading-relaxed text-[var(--text-faint)]">
					<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
						{c.doc}:{c.line}
					</span>{" "}
					<span className="text-[var(--text-dim)]">&ldquo;{c.quote}&rdquo;</span>
				</li>
			))}
		</ol>
	);
}

/**
 * The corrected result: the number the study tells you to trade.
 *
 * Deliberately separate from `EvidenceBadge`, which shows the searched row. Two
 * cards, two tiers, each labelled — the app's claim is that it never presents a
 * searched maximum as an expectation, and a single blended card cannot keep it.
 */
export function CorrectedEvidenceCard({ evidence }: { evidence: Evidence }) {
	const provenance = evidence.provenance ?? [];
	const cited = (label: string) =>
		provenance.find((c) => c.label === label)?.value ?? null;
	const survivorship = cited("tier1_survivorship_avg_ret_pct");
	const holdout = cited("tier1_holdout_avg_ret_pct");
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<TierTag role={evidence.role} />
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					{evidence.source}
				</span>
			</div>
			<div className="mt-4 grid gap-4 sm:grid-cols-4">
				<EvidenceStat
					label="Win rate"
					value={pct(evidence.win_rate, 1)}
					note={
						evidence.win_rate_lo != null && evidence.win_rate_hi != null
							? `Wilson ${pct(evidence.win_rate_lo, 0)}–${pct(evidence.win_rate_hi, 0)}`
							: undefined
					}
				/>
				<EvidenceStat
					label="Avg per trade"
					value={evidence.avg_ret_pct != null ? `+${evidence.avg_ret_pct.toFixed(2)}%` : "—"}
					note={
						evidence.profit_factor != null
							? `profit factor ${evidence.profit_factor.toFixed(2)}`
							: undefined
					}
				/>
				<EvidenceStat
					label="Out-of-sample trades"
					value={idr(evidence.oos_trades)}
					note={
						evidence.n_specs != null
							? `pooled over ${evidence.n_specs} donchian variants`
							: undefined
					}
				/>
				<EvidenceStat
					label="Max drawdown"
					value={
						evidence.max_drawdown_pct != null
							? `−${evidence.max_drawdown_pct.toFixed(1)}%`
							: "—"
					}
					note={
						evidence.book_return_pct != null
							? `10M book +${evidence.book_return_pct.toFixed(1)}%`
							: undefined
					}
				/>
			</div>
			<p className="mt-4 max-w-[86ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
				{evidence.caveat}
			</p>
			{evidence.single_spec_trades != null && (
				<p className="mt-3 max-w-[86ch] text-[12px] leading-relaxed text-[var(--text-dim)]">
					<span className="text-[var(--text)]">
						{idr(evidence.single_spec_trades)} of those trades belong to the window this
						screen runs.
					</span>{" "}
					The rest are the study's other donchian variants pooled into the same published row.
					Quoting the pool as this screen's own sample would overstate it roughly fourfold.
				</p>
			)}
			{(survivorship != null || holdout != null) && (
				<p className="mt-3 max-w-[86ch] border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
					{survivorship != null && (
						<>
							Dropping the best 20% of tickers leaves{" "}
							<span className="text-[var(--text)]">+{survivorship.toFixed(2)}%</span> per
							trade.{" "}
						</>
					)}
					{holdout != null && (
						<>
							On folds no search saw, the same family reads{" "}
							<span className="text-[var(--text)]">+{holdout.toFixed(2)}%</span>.{" "}
						</>
					)}
					Both say the same thing: a high hit rate on a thin, concentrated sample.
				</p>
			)}
			<ProvenanceList citations={provenance} />
		</div>
	);
}
