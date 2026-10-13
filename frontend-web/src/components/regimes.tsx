/**
 * The regime layer, on screen (docs/25, docs/26).
 *
 * Three things the study measured after it shipped the chain, and that the
 * verdict leans on:
 *
 *   1. what each breadth band actually did over the next five sessions - the
 *      number the flat/watch instruction is cut on, aggregated from the
 *      study's own 262k-session diagnostic;
 *   2. the tier-3 capitulation watch: the one non-trending rule that came
 *      anywhere near the bar, carried with the sweeps and stresses that
 *      refused it, so a watch never reads as a ticket;
 *   3. the regime ledger on the Method page: holdouts, frozen replays, tiers,
 *      the flow census and the exit census, every number read from an
 *      artifact the backend re-reads on each request.
 */

import type {
	CapitulationEvidence,
	FlowCensus,
	Plan,
	Regime,
	RegimeBand,
	RegimeCard,
} from "@/lib/api/plan";
import { Section, pctRaw } from "@/components/plan";

const BAND_LABEL: Record<string, string> = {
	trending: "trending",
	sideways: "sideways",
	capitulation: "capitulation",
};

const BAND_RANGE: Record<string, string> = {
	trending: "breadth at or above 60%",
	sideways: "breadth 25-60%",
	capitulation: "breadth under 25%",
};

/**
 * Tonight's band, with what that band measured over the next five sessions.
 *
 * The band line alone says flat or watch; this says what flat or watch was
 * worth, over every session the study screened - so the instruction is a
 * measured one rather than an assertion.
 */
export function RegimeDriftStrip({ regime }: { regime: Regime }) {
	const drift = regime.measured_drift;
	if (!drift || drift.mean_drift_5s_pct == null) return null;
	const positive = drift.mean_drift_5s_pct >= 0;
	return (
		<div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
			<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
				Measured 5-session drift in this band
			</span>
			<span className="tabular font-mono text-[18px] font-bold" style={{ color: positive ? "var(--up)" : "var(--down)" }}>
				{pctRaw(drift.mean_drift_5s_pct, 2)}
			</span>
			<span className="font-mono text-[11px] text-[var(--text-ghost)]">
				over {drift.sessions.toLocaleString()} sessions across {drift.folds} folds
			</span>
			<span className="ml-auto max-w-[46ch] text-[11px] leading-snug text-[var(--text-faint)]">
				{BAND_LABEL[regime.band]} means {BAND_RANGE[regime.band]}. Session-weighted
				aggregate of the study's own diagnostic of unconditional forward returns,
				on the same band edges the verdict uses. The study's prose table quotes
				+0.77% / +0.14% / +2.11% for these bands from its own sample.
			</span>
		</div>
	);
}

/**
 * The tier-3 capitulation watch, with its refusals attached.
 *
 * Never a ticket. Every cell of the sweep that produced these conditions has
 * HIT=False, and the rule's apparent edge on semi-annual folds fell apart on
 * quarterly windows and under the survivorship haircut. The panel shows the
 * names, the five conditions that flagged them, and that record - in the same
 * glance, because a lead shown without its failures is a recommendation.
 */
export function CapitulationWatch({ plan }: { plan: Plan }) {
	const items = plan.capitulation_watch ?? [];
	if (!items.length) return null;
	const ev = plan.capitulation_evidence;
	return (
		<Section
			title="Tier-3 capitulation watch"
			subtitle="Names the study's capitulation-bounce rule would have flagged tonight. This is a lead, not a result: every measured cell of the sweep failed the 80% win / +5% per trade bar, and the rule broke on quarterly windows and under the survivorship haircut. Nothing here is an order."
			right={items.length + " name" + (items.length === 1 ? "" : "s")}
		>
			<ul className="border border-[var(--border)] bg-[var(--panel)]">
				{items.map((item) => (
					<li key={item.ticker} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--border)] px-4 py-3 last:border-b-0 sm:px-5">
						<span className="font-display text-[18px] leading-none text-[var(--text)]">{item.ticker}</span>
						<span className="tabular font-mono text-[13px] text-[var(--text-dim)]">{item.close.toFixed(0)}</span>
						<span className="font-mono text-[11px] text-[var(--text-ghost)]">rsi2 {item.rsi2?.toFixed(1) ?? "—"}</span>
						<span className="font-mono text-[11px] text-[var(--text-ghost)]">5-session {pctRaw(item.ret5, 2)}</span>
						<span className="font-mono text-[11px] text-[var(--text-ghost)]">{pctRaw(item.dist_200_pct, 1)} vs its 200-day</span>
						<span className="font-mono text-[11px] text-[var(--text-ghost)]">atr {pctRaw(item.atr14_pct, 1)}</span>
						<span className="ml-auto rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--gold)]" style={{ background: "color-mix(in srgb, var(--gold) 14%, transparent)" }}>
							watch only
						</span>
					</li>
				))}
			</ul>
			{ev && <CapitulationEvidenceBlock ev={ev} />}
		</Section>
	);
}

/**
 * The measured record behind the watch, as the study's own tables read it.
 */
function CapitulationEvidenceBlock({ ev }: { ev: CapitulationEvidence }) {
	const illiquid = ev.sweep.illiquid;
	const liquid = ev.sweep.liquid_control;
	return (
		<div className="mt-4 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-4">
			<p className="max-w-[80ch] text-[13px] leading-relaxed text-[var(--text-dim)]">{ev.why}</p>
			<dl className="mt-4 grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
				{illiquid && (
					<EvidenceCell
						label="Illiquid sweep, cfg 6"
						value={pctRaw(illiquid.t3_win_rate, 1) + " / +" + illiquid.t3_avg_ret_pct.toFixed(2) + "%"}
						sub={illiquid.t3_n + " trades, " + illiquid.t3_folds + " folds, HIT=" + String(illiquid.hit)}
					/>
				)}
				{liquid && (
					<EvidenceCell
						label="Liquid control"
						value={pctRaw(liquid.t3_win_rate, 1) + " / +" + liquid.t3_avg_ret_pct.toFixed(2) + "%"}
						sub={liquid.t3_n + " trades, HIT=" + String(liquid.hit)}
					/>
				)}
				{ev.clean_universe.win_rate != null && (
					<EvidenceCell
						label="Clean universe"
						value={pctRaw(ev.clean_universe.win_rate, 2) + " / " + (ev.clean_universe.avg_ret_pct ?? 0).toFixed(2) + "%"}
						sub="the study abandoned the tier after the price-frozen repair"
					/>
				)}
				{ev.quarterly && (
					<EvidenceCell
						label="Quarterly stress"
						value={pctRaw(ev.quarterly.win_rate, 1) + " / +" + ev.quarterly.avg_ret_pct.toFixed(2) + "%"}
						sub={ev.quarterly.n + " trades, pf " + ev.quarterly.profit_factor.toFixed(2)}
					/>
				)}
			</dl>
		</div>
	);
}

function EvidenceCell({
	label,
	value,
	sub,
}: {
	label: string;
	value: string;
	sub: string;
}) {
	return (
		<div className="bg-[var(--panel)] px-4 py-3">
			<div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">{label}</div>
			<div className="tabular mt-1 font-mono text-[16px] font-bold text-[var(--text)]">{value}</div>
			<div className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">{sub}</div>
		</div>
	);
}
/**
 * The regime ledger, for the Method page.
 *
 * Rounds 28-30 of the study searched the bearish, sideways and
 * institutional-activity regimes, carried the winners to unseen folds, then
 * re-measured them on quarterly windows and under the survivorship haircut.
 * This section is that record: what was searched, what held, what died, and
 * the flow and exit censuses beside it. Every figure is read from an artifact
 * on each request - none of it is stored in the front end.
 */
export function RegimeSection({
	card,
	capitulation,
}: {
	card: RegimeCard | null;
	capitulation: CapitulationEvidence | null;
}) {
	if (!card) return null;
	const bands = card.bands;
	const holdout = card.holdout;
	const replays = card.replays;
	const tiers = card.tiers;
	const flow = card.flow;
	const exits = card.exits;
	return (
		<Section
			id="regimes"
			title="The three regimes, measured"
			subtitle={THE_REGIME_SUBTITLE}
		>
			{bands && (
				<div className="mb-8">
					<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						What each band did over the next five sessions
					</h3>
					<div className="overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
						<table className="w-full min-w-[640px] border-collapse text-left">
							<thead>
								<tr className="border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
									<th className="px-4 py-2">Band</th>
									<th className="px-4 py-2">Breadth</th>
									<th className="px-4 py-2 text-right">Mean drift</th>
									<th className="px-4 py-2 text-right">Median</th>
									<th className="px-4 py-2 text-right">Sessions</th>
									<th className="px-4 py-2 text-right">Folds</th>
								</tr>
							</thead>
							<tbody className="font-mono text-[12px] text-[var(--text-dim)]">
								{(Object.keys(bands) as RegimeBand[]).map((key) => {
									const row = bands[key];
									const positive = (row.mean_drift_5s_pct ?? 0) >= 0;
									return (
										<tr key={key} className="border-b border-[var(--border)] last:border-b-0">
											<td className="px-4 py-2 text-[var(--text)]">{BAND_LABEL[key] ?? key}</td>
											<td className="px-4 py-2 text-[var(--text-faint)]">{BAND_RANGE[key] ?? EMPTY}</td>
											<td className="px-4 py-2 text-right tabular-nums" style={{ color: positive ? UPTONE : DOWNTONE }}>
												{pctRaw(row.mean_drift_5s_pct, 2)}
											</td>
											<td className="px-4 py-2 text-right tabular-nums">{pctRaw(row.median_drift_5s_pct, 2)}</td>
											<td className="px-4 py-2 text-right tabular-nums">{row.sessions.toLocaleString()}</td>
											<td className="px-4 py-2 text-right tabular-nums">{row.folds}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					<p className="mt-2 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
						Capitulation is the only non-trending band with a positive drift, and it
						is still not tradable as measured: the tier-3 rule built for it failed
						the bar on every sweep cell and broke under quarterly windows.
						{card.bands_note ? " " + card.bands_note : ""}
					</p>
				</div>
			)}

			{holdout && (
				<div className="mb-8">
					<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						Unseen folds: did any regime cell hold?
					</h3>
					<div className="overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
						<table className="w-full min-w-[720px] border-collapse text-left">
							<thead>
								<tr className="border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
									<th className="px-4 py-2">Regime</th>
									<th className="px-4 py-2 text-right">Cells re-run</th>
									<th className="px-4 py-2 text-right">Held</th>
									<th className="px-4 py-2">Best on unseen folds</th>
									<th className="px-4 py-2 text-right">Win</th>
									<th className="px-4 py-2 text-right">Avg</th>
								</tr>
							</thead>
							<tbody className="font-mono text-[12px] text-[var(--text-dim)]">
								{Object.entries(holdout.regimes).map(([key, row]) => (
									<tr key={key} className="border-b border-[var(--border)] last:border-b-0">
										<td className="px-4 py-2 text-[var(--text)]">{row.label}</td>
										<td className="px-4 py-2 text-right tabular-nums">{row.cells_tested}</td>
										<td className="px-4 py-2 text-right tabular-nums" style={{ color: row.holds ? UPTONE : GOLDTONE }}>
											{row.holds}
										</td>
										<td className="px-4 py-2">{row.best_hold.family}</td>
										<td className="px-4 py-2 text-right tabular-nums">{pctRaw(row.best_hold.win_rate, 1)}</td>
										<td className="px-4 py-2 text-right tabular-nums">{pctRaw(row.best_hold.avg_ret_pct, 2)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="mt-2 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
						The study ranked each cell on the search half, then re-ran the top
						twenty-five unchanged on folds no search had touched. Held is how many
						still cleared the bar there.
					</p>
				</div>
			)}

			{replays && (
				<div className="mb-8">
					<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						The frozen winners, and what stress did to them
					</h3>
					<div className="overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
						<table className="w-full min-w-[820px] border-collapse text-left">
							<thead>
								<tr className="border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
									<th className="px-4 py-2">Regime</th>
									<th className="px-4 py-2">Frozen spec</th>
									<th className="px-4 py-2 text-right">Replay</th>
									<th className="px-4 py-2 text-right">Book</th>
									<th className="px-4 py-2 text-right">After survivorship</th>
									<th className="px-4 py-2 text-right">Quarterly</th>
								</tr>
							</thead>
							<tbody className="font-mono text-[12px] text-[var(--text-dim)]">
								{Object.entries(replays.replays).map(([key, row]) => {
									const q = replays.quarterly[key];
									return (
										<tr key={key} className="border-b border-[var(--border)] last:border-b-0">
											<td className="px-4 py-2 text-[var(--text)]">{BAND_LABEL[key] ?? key}</td>
											<td className="px-4 py-2 text-[var(--text-faint)]">{row.family + SPACER + row.side + COMMA + row.trades + TRADES}</td>
											<td className="px-4 py-2 text-right tabular-nums">{pctRaw(row.win_rate, 1) + SLASH + pctRaw(row.avg_ret_pct, 2)}</td>
											<td className="px-4 py-2 text-right tabular-nums">{pctRaw(row.book_total_pct, 1) + PAREN + pctRaw(row.book_max_dd_pct, 1) + DD}</td>
											<td className="px-4 py-2 text-right tabular-nums" style={{ color: DOWNTONE }}>
												{pctRaw(row.survivorship_win_rate, 1) + SLASH + pctRaw(row.survivorship_avg_ret_pct, 2)}
											</td>
											<td className="px-4 py-2 text-right tabular-nums">
												{q ? pctRaw(q.win_rate, 1) + SLASH + pctRaw(q.avg_ret_pct, 2) + LOSING(q) : EMPTY}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					<p className="mt-2 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
						Each row is the rank-one spec the regime search froze, projected over
						the full history and then re-measured on three-month windows and with the
						best-performing names removed. Both stresses turn every regime negative.
					</p>
				</div>
			)}

			{tiers && (
				<div className="mb-8">
					<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						Tier 1, tier 2 and tier 3: full panel, survivorship, quarterly
					</h3>
					<div className="overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
						<table className="w-full min-w-[760px] border-collapse text-left">
							<thead>
								<tr className="border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
									<th className="px-4 py-2">Tier</th>
									<th className="px-4 py-2 text-right">Full panel</th>
									<th className="px-4 py-2 text-right">Survivorship</th>
									<th className="px-4 py-2 text-right">Trend folds</th>
									<th className="px-4 py-2 text-right">Quarterly</th>
								</tr>
							</thead>
							<tbody className="font-mono text-[12px] text-[var(--text-dim)]">
								{Object.entries(tiers.tiers).map(([key, block]) => (
									<tr key={key} className="border-b border-[var(--border)] last:border-b-0">
										<td className="px-4 py-2 text-[var(--text)]">{TIER_LABEL[key] ?? key}</td>
										{BOUNDS.map((bound) => {
											const row = block.bounds[bound];
											return (
												<td key={bound} className="px-4 py-2 text-right tabular-nums">
													{row ? pctRaw(row.win_rate, 1) + SLASH + pctRaw(row.avg_ret_pct, 2) + COUNT(row.n) : EMPTY}
												</td>
											);
										})}
										<td className="px-4 py-2 text-right tabular-nums">
											{block.quarterly ? pctRaw(block.quarterly.win_rate, 1) + SLASH + pctRaw(block.quarterly.avg_ret_pct, 2) + COUNT(block.quarterly.n) : EMPTY}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="mt-2 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
						Tier 2 is the same rules forced to trade the flat band, which is the
						loss the verdict avoids. Tier 3 is the capitulation bounce. Both are shown
						with their stressed rows, because a tier table without them is a headline
						with better lighting.
					</p>
				</div>
			)}

			<div className={TWO_COL}>
				{flow && (
					<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
						<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							Do flow indicators lead?
						</h3>
						<p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
							{FLOW_TEXT(flow)}
						</p>
						<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">{flow.source}</p>
					</div>
				)}
				{exits && (
					<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
						<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
							The exit census
						</h3>
						<p className="mb-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
							Every exit method the study pooled out-of-sample, so the switcher
							quotes measured numbers rather than an opinion about exits.
						</p>
						<ul className="divide-y divide-[var(--border)]">
							{exits.exits.slice(0, 8).map((row) => (
								<li key={row.exit_method} className="flex flex-wrap items-baseline gap-x-3 py-2 font-mono text-[12px] text-[var(--text-dim)]">
									<span className="text-[var(--text)]">{row.exit_method}</span>
									<span className="text-[var(--text-ghost)]">{row.trades + TRADES}</span>
									<span className="ml-auto tabular-nums">{pctRaw(row.win_rate, 1) + WIN}</span>
									<span className="tabular-nums" style={{ color: row.avg_ret_pct >= 0 ? UPTONE : DOWNTONE }}>
										{pctRaw(row.avg_ret_pct, 2) + AVG}
									</span>
								</li>
							))}
						</ul>
						<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">{exits.source}</p>
					</div>
				)}
			</div>

			{capitulation && (
				<div className="mt-8">
					<h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						The capitulation tier, and why it is a watch
					</h3>
					<CapitulationEvidenceBlock ev={capitulation} />
				</div>
			)}
		</Section>
	);
}

/* ── the small vocabulary the section above shares ───────────────────────── */

const THE_REGIME_SUBTITLE =
	"The verdict is cut on breadth bands. These are the rounds that measured what, if anything, is tradable inside each band - and refused nearly all of it. Every figure below is read from the artifacts on each request.";

const EMPTY = "—";
const SLASH = " / ";
const SPACER = " ";
const COMMA = ", ";
const TRADES = " trades";
const WIN = " win";
const AVG = " avg";
const DD = " dd";
const UPTONE = "var(--up)";
const DOWNTONE = "var(--down)";
const GOLDTONE = "var(--gold)";
const TWO_COL = "grid gap-5 lg:grid-cols-2";
const BOUNDS = ["full", "survivorship", "trend"];

const TIER_LABEL: Record<string, string> = {
	tier1: "Tier 1 - the shipped chain",
	tier2: "Tier 2 - the flat band",
	tier3: "Tier 3 - capitulation",
};

function FLOW_TEXT(flow: FlowCensus): string {
	const head =
		"The study measured " + flow.indicators +
		" flow indicators for their forward AUC against breadth. The best flow reading is " +
		flow.best_flow.indicator + " at " + flow.best_flow.auc.toFixed(3) +
		", against breadth at " + flow.breadth_auc.toFixed(3) + ". ";
	return (
		head +
		(flow.breadth_leads
			? "Volume flow lags price breadth rather than leading it, so no flow gate is applied."
			: "A flow indicator now out-measures breadth; the app should be revisited.")
	);
}

const PAREN = " (";
const COUNT = (n: number) => PAREN + n + ")";
const LOSING = (q: { losing_windows: number; windows: number }) =>
	PAREN + q.losing_windows + " of " + q.windows + " windows losing)";
