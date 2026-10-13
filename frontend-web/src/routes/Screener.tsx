/**
 * Screener — every name, ranked by how near it is to being buyable.
 *
 * This replaces the old behaviour/squeeze screener, which listed rules the study
 * measured but that did *not* clear its bar. That is a different thing from the
 * plan, and mixing the two in one list would be misleading: a name on this
 * screen has still failed a condition and carries no measured win rate.
 *
 * So this screen uses exactly the rules the plan uses, over exactly the same
 * universe, and its only job is the ordering the plan throws away. Nothing here
 * is a buy signal, and the header says so.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { planApi, type Plan, type RankedRow } from "@/lib/api/plan";
import { usePlanRefreshSignal } from "@/lib/refresh";
import { Section, idr } from "@/components/plan";
import { RegimeDriftStrip } from "@/components/regimes";
import { Page } from "./Tonight";

type Sort = "gates" | "rs" | "near" | "ticker";

export default function Screener() {
	const nonce = usePlanRefreshSignal();
	const [plan, setPlan] = useState<Plan | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [sort, setSort] = useState<Sort>("gates");
	const [onlyNear, setOnlyNear] = useState(false);
	const [expanded, setExpanded] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		planApi
			.plan()
			.then((p) => alive && setPlan(p))
			.catch((e: Error) => alive && setFailed(e.message));
		return () => {
			alive = false;
		};
	}, [nonce]);

	const rows = useMemo(() => {
		if (!plan) return [];
		const list = [...plan.ranked];
		const near = list.filter((r) => !r.waiting_on_market);
		const base = onlyNear && near.length ? near : list;
		switch (sort) {
			case "rs":
				return base.sort((a, b) => b.rs_rating - a.rs_rating);
			case "near":
				return base.sort(
					(a, b) =>
						b.gates_passed - a.gates_passed ||
						(a.distance_pct ?? 1e9) - (b.distance_pct ?? 1e9),
				);
			case "ticker":
				return base.sort((a, b) => a.ticker.localeCompare(b.ticker));
			default:
				return base;
		}
	}, [plan, sort, onlyNear]);

	if (failed) {
		return (
			<Page>
				<p className="text-[14px] text-[var(--text-dim)]">
					The backend is not answering. Start it, then reload. ({failed})
				</p>
			</Page>
		);
	}

	if (!plan) {
		return (
			<Page>
				<p className="font-mono text-[13px] text-[var(--text-faint)]">
					Scoring the universe — a few seconds.
				</p>
			</Page>
		);
	}

	const waiting = plan.ranked.filter((r) => r.waiting_on_market).length;

	return (
		<Page>
			<header className="mb-8">
				<h1 className="font-display text-[32px] leading-tight tracking-[-0.02em] text-[var(--text)] sm:text-[38px]">
					Screener
				</h1>
				<p className="mt-3 max-w-[74ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Every name in the universe, put through the same conditions as tonight's plan and ranked by
					how near it came to clearing them.{" "}
					<b className="text-[var(--text)]">None of these are buy signals</b> — each one failed at
					least one condition. The ranking exists so you can watch a name approach the line, not
					because the study says to buy it.
				</p>
			</header>

			<RegimeDriftStrip regime={plan.regime} />

			{plan.capitulation_watch?.length > 0 && (
				<p className="mb-6 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-4 text-[13px] leading-relaxed text-[var(--text-dim)]">
					<span className="font-semibold text-[var(--text)]">Capitulation watch:</span> 
					{plan.capitulation_watch.length} name
					{plan.capitulation_watch.length === 1 ? "" : "s"} match the study tier-3
					bounce conditions tonight. That tier failed the study 80% win and +5% per
					trade bar on every sweep cell and broke under quarterly windows, so these are
					watched, never bought. See tonight plan for the full record.
				</p>
			)}

			<Section
				title={`${idr(rows.length)} names ranked`}
				subtitle={`As of ${plan.session_label}. ${
					waiting
						? `${waiting} are waiting only on the market, which they cannot close on their own.`
						: "Every name below is waiting on a condition of its own."
				}`}
			>
				<div className="mb-4 flex flex-wrap items-center gap-3">
					<SortToggle
						options={[
							["gates", "Closest"],
							["near", "Nearest miss"],
							["rs", "Momentum"],
							["ticker", "A–Z"],
						]}
						value={sort}
						onChange={setSort}
					/>
					<label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-[var(--text-faint)]">
						<input
							type="checkbox"
							checked={onlyNear}
							onChange={(e) => setOnlyNear(e.target.checked)}
							className="accent-[var(--accent)]"
						/>
						Only names that can close it themselves
					</label>
					<span className="ml-auto font-mono text-[11px] text-[var(--text-ghost)]">
						{plan.required_gates.length} conditions
					</span>
				</div>

				<ul className="border border-[var(--border)] bg-[var(--panel)]">
					{rows.map((row) => (
						<Row
							key={row.ticker}
							row={row}
							open={expanded === row.ticker}
							onToggle={() =>
								setExpanded((v) => (v === row.ticker ? null : row.ticker))
							}
						/>
					))}
					{rows.length === 0 && (
						<li className="px-5 py-6 text-[13px] text-[var(--text-faint)]">
							Nothing matches that filter.
						</li>
					)}
				</ul>
			</Section>
		</Page>
	);
}

function Row({
	row,
	open,
	onToggle,
}: {
	row: RankedRow;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<li className="border-b border-[var(--border)] last:border-b-0">
			{/* The whole row toggles, not just the glyph: eighty identical "+"
			    buttons is a poor target and a poor accessible name at once, and
			    on a list this long the row is what the eye is aiming at. The
			    ticker stays a separate link so it never swallows the click. */}
			<div
				onClick={onToggle}
				className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 hover:bg-[var(--panel-2)] sm:px-5"
			>
				{/* Conditions cleared, as filled pips. Read as a count, not a score. */}
				<span className="flex shrink-0 items-center gap-0.5" aria-hidden>
					{Array.from({ length: row.gates_total }).map((_, i) => (
						<span
							key={i}
							className="h-3 w-1.5 rounded-[1px]"
							style={{
								background: i < row.gates_passed ? "var(--up)" : "var(--border-strong)",
							}}
						/>
					))}
				</span>
				<Link
					to="/name/$ticker"
					params={{ ticker: row.ticker }}
					onClick={(e) => e.stopPropagation()}
					className="font-display text-[18px] leading-none text-[var(--text)] hover:underline hover:underline-offset-4"
				>
					{row.ticker}
				</Link>
				<span className="tabular font-mono text-[13px] text-[var(--text-dim)]">
					{idr(row.close)}
				</span>
				<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
					{row.gates_passed}/{row.gates_total}
				</span>
				<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
					mom {row.rs_rating.toFixed(0)}
				</span>

				<span className="ml-auto flex items-center gap-3">
					{row.waiting_on_market ? (
						<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
							waiting on the market
						</span>
					) : (
						<span className="font-mono text-[11px] tabular-nums text-[var(--gold)]">
							{row.distance_pct != null
								? row.blocked_by === "quiet_vol"
									? `${row.distance_pct.toFixed(0)}% too volatile`
									: `${row.distance_pct.toFixed(1)}% away`
								: ""}
						</span>
					)}
					{/* A real button, so the row is reachable by keyboard and has a
					    name. The row itself is also clickable for the mouse, which
					    is why this stops propagation. */}
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onToggle();
						}}
						aria-expanded={open}
						aria-label={`why ${row.ticker} is not buyable yet`}
						className="flex h-5 w-5 items-center justify-center border border-[var(--border)] font-mono text-[11px] leading-none text-[var(--text-faint)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
					>
						{open ? "−" : "+"}
					</button>
				</span>
			</div>

			{open && (
				<div className="border-t border-[var(--border)] px-4 py-3 sm:px-5">
					<ul className="divide-y divide-[var(--border)]">
						{row.gates.map((g) => (
							<li key={g.key} className="flex gap-3 py-2">
								<span
									className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full font-mono text-[9px]"
									style={{
										color: g.passed ? "var(--up)" : "var(--text-ghost)",
										background: g.passed
											? "color-mix(in srgb, var(--up) 12%, transparent)"
											: "var(--panel-3)",
									}}
									aria-hidden
								>
									{g.passed ? "✓" : "✕"}
								</span>
								<div className="min-w-0">
									<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
										{g.label}
										{g.value != null && g.threshold != null ? (
											<span className="ml-2 normal-case tracking-normal text-[var(--text-ghost)]">
												{g.value.toFixed(2)} vs {g.threshold.toFixed(2)} needed
											</span>
										) : null}
									</p>
									<p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-dim)]">
										{g.text}
									</p>
								</div>
							</li>
						))}
					</ul>
					<p className="mt-3 text-[12px] text-[var(--text-faint)]">
						Full entry and exit plan for {row.ticker}:{" "}
						<Link
							to="/name/$ticker"
							params={{ ticker: row.ticker }}
							className="underline underline-offset-2 hover:text-[var(--text-dim)]"
						>
							open {row.ticker}
						</Link>
					</p>
				</div>
			)}
		</li>
	);
}

function SortToggle({
	options,
	value,
	onChange,
}: {
	options: readonly (readonly [Sort, string])[];
	value: Sort;
	onChange: (v: Sort) => void;
}) {
	return (
		<div className="flex items-center gap-px border border-[var(--border)]">
			{options.map(([key, label]) => (
				<button
					key={key}
					type="button"
					onClick={() => onChange(key)}
					className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors"
					style={{
						background: value === key ? "var(--accent)" : "transparent",
						color: value === key ? "var(--accent-fg)" : "var(--text-faint)",
					}}
				>
					{label}
				</button>
			))}
		</div>
	);
}