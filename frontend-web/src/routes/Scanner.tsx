/**
 * Scanner — every tradable name, with the screens it belongs to.
 *
 * The backend decides membership; this page only displays and filters it. That
 * is deliberate: a filter chip cannot invent a rule the plan does not run, and
 * the evidence beside a chip is the study's own number rather than a client-side
 * calculation.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { scanApi, type ScanPayload, type ScanRow, type ScanScreenKey } from "@/lib/api/scanner";
import { usePlanRefreshSignal } from "@/lib/refresh";
import { Section, idr, pct, pctRaw } from "@/components/plan";
import { RegimeDriftStrip } from "@/components/regimes";
import { Page } from "./Tonight";

type Sort = "closest" | "momentum" | "breakout" | "quiet" | "turnover" | "ticker";
type Filter = ScanScreenKey | "all";

const SORTS: readonly (readonly [Sort, string])[] = [
	["closest", "Closest to Tier 1"],
	["momentum", "Momentum"],
	["breakout", "40d high"],
	["quiet", "Quietest"],
	["turnover", "Turnover"],
	["ticker", "A–Z"],
];

export default function Scanner() {
	const nonce = usePlanRefreshSignal();
	const [payload, setPayload] = useState<ScanPayload | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<Sort>("closest");

	useEffect(() => {
		let alive = true;
		setFailed(null);
		scanApi
			.get()
			.then((data) => alive && setPayload(data))
			.catch((error: Error) => alive && setFailed(error.message));
		return () => {
			alive = false;
		};
	}, [nonce]);

	const selectedScreen = payload?.screens.find((screen) => screen.key === filter) ?? null;

	const rows = useMemo(() => {
		if (!payload) return [];
		const needle = query.trim().toUpperCase();
		const list = payload.rows.filter(
			(row) =>
				(filter === "all" || row.screens.includes(filter)) &&
				(needle === "" || row.ticker.includes(needle)),
		);
		const sorted = [...list];
		switch (sort) {
			case "momentum":
				return sorted.sort((a, b) => b.rs_rating - a.rs_rating);
			case "breakout":
				return sorted.sort((a, b) => b.breakout_pct - a.breakout_pct);
			case "quiet":
				return sorted.sort(
					(a, b) =>
						a.vol20 / Math.max(a.vol20_threshold, 0.01) -
						b.vol20 / Math.max(b.vol20_threshold, 0.01),
				);
			case "turnover":
				return sorted.sort((a, b) => (b.turnover_idr ?? 0) - (a.turnover_idr ?? 0));
			case "ticker":
				return sorted.sort((a, b) => a.ticker.localeCompare(b.ticker));
			default:
				return sorted.sort(
					(a, b) =>
						b.conditions_passed - a.conditions_passed || b.rs_rating - a.rs_rating,
				);
		}
	}, [payload, filter, query, sort]);

	if (failed) {
		return (
			<Page>
				<h1 data-state="failed" className="font-display text-[30px] text-[var(--text)]">The backend is not answering</h1>
				<p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Start it with <code className="font-mono text-[13px]">./trading-suite run</code> and reload.
					The scanner reads the study's own universe, so the first pass is not instant.
				</p>
				<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">{failed}</p>
			</Page>
		);
	}

	if (!payload) {
		return (
			<Page>
				<p data-state="loading" className="font-mono text-[13px] text-[var(--text-faint)]">
					Screening the universe — the first run can take up to 30 seconds, then it is cached.
				</p>
			</Page>
		);
	}

	return (
		<Page>
			<header className="mb-6">
				<h1 className="font-display text-[32px] leading-tight tracking-[-0.02em] text-[var(--text)] sm:text-[38px]">
					Scanner
				</h1>
				<p className="mt-3 max-w-[76ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Every tradable name in the study's universe, with the same conditions the plan uses.{" "}
					<b className="text-[var(--text)]">No score and no invented indicator</b> — a filter is a
					condition of the measured chain, not a separate strategy. Only Tier 1 carries a measured
					result, and only while the market gate is open.
				</p>
			</header>

			<MarketStrip payload={payload} />
			<RegimeDriftStrip regime={payload.regime} />
			{payload.index_context && <IndexContextLine payload={payload} />}

			<Section
				title={`${idr(rows.length)} of ${idr(payload.rows.length)} names`}
				subtitle={`As of ${payload.session_label}. ${idr(payload.universe.tradable)} of ${idr(
					payload.universe.codes,
				)} codes pass the study's universe floor; ${idr(
					payload.universe.excluded,
				)} are excluded before scoring.`}
			>
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<Chip active={filter === "all"} count={payload.rows.length} onClick={() => setFilter("all")}>
						All tradable
					</Chip>
					{payload.screens.map((screen) => {
						const screenActive = screen.active;
						return (
							<Chip
								key={screen.key}
								active={filter === screen.key}
								count={screen.count}
								disabled={!screenActive}
								title={
									screenActive
										? screen.definition
										: `${screen.label} is not active in this band. ${screen.note}`
								}
								onClick={() => setFilter(screen.key)}
							>
								{screen.label}
							</Chip>
						);
					})}
				</div>

				<div className="mb-4 flex flex-wrap items-center gap-2">
					<input
						type="search"
						aria-label="Find a ticker"
						placeholder="Find a ticker — BBCA"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						className="w-[210px] border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-ghost)] focus:border-[var(--border-strong)]"
					/>
					<label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
						Sort
						<select
							value={sort}
							onChange={(event) => setSort(event.target.value as Sort)}
							className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-[var(--text-dim)] outline-none focus:border-[var(--border-strong)]"
						>
							{SORTS.map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
						Click a ticker for the full answer
					</span>
				</div>

				<ScreenNote screen={selectedScreen} />

				<div className="max-h-[72vh] overflow-auto border border-[var(--border)] bg-[var(--panel)]">
					<table className="w-full min-w-[940px] border-collapse text-left">
						<thead className="sticky top-0 z-10 bg-[var(--panel-2)] font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
							<tr>
								<th className="px-3 py-2">Ticker</th>
								<th className="px-2 py-2 text-right">Last</th>
								<th className="px-2 py-2 text-right">Day</th>
								<th className="px-2 py-2 text-right">40d high</th>
								<th className="px-2 py-2 text-right">Mom</th>
								<th className="px-2 py-2 text-right">Vol20</th>
								<th className="px-2 py-2 text-right">ADV</th>
								<th className="px-2 py-2 text-center">Setup</th>
								<th className="px-3 py-2">Screen</th>
							</tr>
						</thead>
						<tbody className="font-mono text-[11px]">
							{rows.map((row) => (
								<Row key={row.ticker} row={row} />
							))}
							{rows.length === 0 && (
								<tr data-state="empty">
									<td
										colSpan={9}
										className="px-4 py-8 text-center text-[13px] text-[var(--text-faint)]"
									>
										No name passes this filter tonight.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</Section>
		</Page>
	);
}

function MarketStrip({ payload }: { payload: ScanPayload }) {
	const { regime, universe } = payload;
	const color =
		regime.band === "trending"
			? "var(--up)"
			: regime.band === "capitulation"
				? "var(--down)"
				: "var(--gold)";
	return (
		<div className="mb-4 border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
				<span
					className="rounded-sm px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]"
					style={{ color, background: "color-mix(in srgb, currentColor 10%, transparent)" }}
				>
					{regime.band}
				</span>
				<span className="text-[13px] text-[var(--text-dim)]">
					Breadth <b className="text-[var(--text)]">{pct(regime.breadth, 1)}</b>{" "}
					<span className="text-[var(--text-faint)]">
						(needs {pct(regime.breadth_threshold, 0)} to trade)
					</span>
				</span>
				<span className="text-[13px] text-[var(--text-dim)]">
					IHSG <b className="text-[var(--text)]">{idr(regime.index_close)}</b>{" "}
					<span className="text-[var(--text-faint)]">
						{regime.index_above_200 == null
							? "—"
							: regime.index_above_200
								? "above its 200-day average"
								: "below its 200-day average"}
					</span>
				</span>
				<span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
					{idr(universe.tradable)} tradable · {idr(universe.codes)} codes
				</span>
			</div>
			<p className="mt-3 max-w-[88ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
				The index is context, not a gate. The shipped chain has no IHSG condition; it uses breadth,
				the share of stocks above their own 200-day average.{" "}
				<Link
					to="/plan"
					className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text)]"
				>
					Full plan and tickets →
				</Link>
			</p>
		</div>
	);
}

function IndexContextLine({ payload }: { payload: ScanPayload }) {
	const context = payload.index_context;
	if (!context)
		return (
			<p data-state="missing" className="mb-4 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[11px] text-[var(--text-faint)]">
				Index context unavailable for this session.
			</p>
		);
	const corr = (value: number | null) => (value == null ? "—" : value.toFixed(2));
	return (
		<p className="mb-4 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
			<b className="text-[var(--text-dim)]">Index dependence.</b> Median {context.window}-session
			correlation {corr(context.corr_median)} ({corr(context.corr_ex_big_median)} on days the index moved
			at most {context.big_move_pct}%); last 20 sessions {corr(context.corr_20_median)}. Year to date the
			median stock is {pctRaw(context.ytd_stock_median_pct, 1)} against IHSG{" "}
			{pctRaw(context.ytd_index_pct, 1)};{" "}
			{pct(context.share_beating_index, 0)} of names beat the index. The screen does not gate on the
			index.
		</p>
	);
}

function Chip({
	active,
	count,
	disabled = false,
	title,
	onClick,
	children,
}: {
	active: boolean;
	count: number;
	disabled?: boolean;
	title?: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			disabled={disabled}
			data-state={count === 0 ? "zero" : active ? "selected" : disabled ? "disabled" : "filled"}
			title={title}
			onClick={onClick}
			className="flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
			style={{
				borderColor: active ? "var(--accent)" : "var(--border)",
				background: active ? "var(--accent)" : "transparent",
				color: active ? "var(--accent-fg)" : "var(--text-faint)",
			}}
		>
			{children}
			<span
				className="tabular-nums"
				style={{ color: active ? "var(--accent-fg)" : "var(--text-ghost)" }}
			>
				{idr(count)}
			</span>
		</button>
	);
}

function ScreenNote({ screen }: { screen: ScanPayload["screens"][number] | null }) {
	if (!screen) {
		return (
			<p className="mb-4 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
				The filters are conditions from the study's shipped chain. Only{" "}
				<b className="text-[var(--text-dim)]">Tier 1</b> has a measured win rate; the other filters
				explain why a name is in or out. Nothing here is a score.
			</p>
		);
	}
	const measured = screen.measured;
	return (
		<div className="mb-4 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
			<p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
				<b className="text-[var(--text)]">{screen.label}.</b> {screen.definition}
			</p>
			<p className="mt-1 text-[11px] leading-relaxed text-[var(--text-faint)]">{screen.note}</p>
			{measured && (
				<p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
					{screen.kind === "strategy" ? "Measured" : "Sweep"}:{" "}
					<b className="text-[var(--text-dim)]">
						{pct(measured.win_rate ?? measured.sweep_win_rate, 1)} win /{" "}
						{signed(measured.avg_ret_pct ?? measured.sweep_avg_ret_pct)}
					</b>{" "}
					({idr(measured.trades ?? measured.sweep_trades)} trades)
					{measured.holdout_win_rate != null && (
						<>
							{" "}
							· holdout {pct(measured.holdout_win_rate, 1)} /{" "}
							{signed(measured.holdout_avg_ret_pct)}
						</>
					)}
					{measured.clean_win_rate != null && (
						<>
							{" "}
							· clean {pct(measured.clean_win_rate, 1)} /{" "}
							{signed(measured.clean_avg_ret_pct)}
						</>
					)}
					.{" "}
					<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text)]">
						Method and caveat →
					</Link>
				</p>
			)}
		</div>
	);
}

function Row({ row }: { row: ScanRow }) {
	const badges = row.screens.filter(
		(key) => key === "tier1" || key === "tier1_setup" || key === "capitulation",
	);
	return (
		<tr className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
			<td className="px-3 py-1.5">
				<Link
					to="/deep/$ticker"
					params={{ ticker: row.ticker }}
					className="font-display text-[15px] text-[var(--text)] hover:underline hover:underline-offset-4"
				>
					{row.ticker}
				</Link>
			</td>
			<td className="tabular px-2 py-1.5 text-right text-[var(--text-dim)]">{idr(row.close)}</td>
			<td className="tabular px-2 py-1.5 text-right">
				<span style={{ color: (row.change_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
					{pctRaw(row.change_pct, 1)}
				</span>
			</td>
			<td className="tabular px-2 py-1.5 text-right">
				<span style={{ color: row.conditions.breakout ? "var(--up)" : "var(--text-faint)" }}>
					{signed(row.breakout_pct)}
				</span>
			</td>
			<td className="tabular px-2 py-1.5 text-right">
				<span
					style={{
						color: row.conditions.relative_strength ? "var(--text)" : "var(--text-faint)",
					}}
				>
					{row.rs_rating.toFixed(0)}
				</span>
			</td>
			<td className="tabular px-2 py-1.5 text-right">
				<span
					style={{
						color: row.conditions.quiet_vol ? "var(--up)" : "var(--text-faint)",
					}}
				>
					{row.vol20.toFixed(1)}
				</span>
				<span className="ml-1 text-[9px] text-[var(--text-ghost)]">
					≤{row.vol20_threshold.toFixed(1)}
				</span>
			</td>
			<td className="tabular px-2 py-1.5 text-right text-[var(--text-faint)]">
				{compactIdr(row.turnover_idr)}
			</td>
			<td className="px-2 py-1.5">
				<div className="flex items-center justify-center gap-1" title="Breakout · momentum · quiet">
					{(["breakout", "relative_strength", "quiet_vol"] as const).map((key) => (
						<span
							key={key}
							className="h-2.5 w-1.5 rounded-[1px]"
							style={{
								background: row.conditions[key] ? "var(--up)" : "var(--border-strong)",
							}}
						/>
					))}
					<span className="ml-1 text-[9px] text-[var(--text-ghost)]">
						{row.conditions_passed}/3
					</span>
				</div>
			</td>
			<td className="px-3 py-1.5">
				{badges.length === 0 ? (
					<span className="text-[var(--text-ghost)]">—</span>
				) : (
					<span className="flex flex-wrap gap-1">
						{badges.map((key) => (
							<span
								key={key}
								className="rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em]"
								style={{
									color: key === "tier1" ? "var(--up)" : "var(--gold)",
									background:
										key === "tier1"
											? "color-mix(in srgb, var(--up) 10%, transparent)"
											: "color-mix(in srgb, var(--gold) 10%, transparent)",
								}}
							>
								{key === "tier1" ? "T1" : key === "capitulation" ? "CAP" : "SETUP"}
							</span>
						))}
					</span>
				)}
			</td>
		</tr>
	);
}

function signed(value: number | null | undefined): string {
	if (value == null || Number.isNaN(value)) return "—";
	return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function compactIdr(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return "—";
	if (value >= 1e12) return `Rp ${(value / 1e12).toFixed(1)} T`;
	if (value >= 1e9) return `Rp ${(value / 1e9).toFixed(1)} B`;
	if (value >= 1e6) return `Rp ${(value / 1e6).toFixed(0)} M`;
	return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}
