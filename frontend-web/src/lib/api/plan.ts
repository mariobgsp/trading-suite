/**
 * The nightly plan: what the method says to buy, why, and how to exit.
 *
 * These mirror `backend/app/plan/model.py`. Nothing here is computed on the
 * client — if a number is not in this shape, it was not measured by the study.
 */

import { api } from "./transport";

export type GateKey =
	| "breakout"
	| "relative_strength"
	| "breadth"
	| "quiet_vol"
	| "weekly_trend"
	| "index_above_200";

export interface Gate {
	key: GateKey;
	label: string;
	passed: boolean;
	value: number | null;
	threshold: number | null;
	unit: string;
	text: string;
	/** How long the condition has held, when the reason builder supplied it. */
	history: GateHistory | null;
}

/**
 * How long a condition has held, and since when.
 *
 * "RS is 94 and it needs 90" says whether a name qualifies. It does not say why
 * tonight, which is the question someone about to send an order asks.
 */
export interface GateHistory {
	held_sessions: number;
	first_true_session: string | null;
	series: boolean[];
}

/** One session of the run-up to a signal. */
export interface ReasonPoint {
	session: string;
	close: number | null;
	gates_passed: number;
	gates_total: number;
	breakout_pct: number | null;
	vol20: number | null;
	rs_rating: number | null;
	breadth: number | null;
	band: RegimeBand;
}

/**
 * Why this name, on this session, rather than any of the other 900.
 *
 * The gate list says a name qualifies. This says when the conditions turned true,
 * how long they have held, and what the entry actually is.
 */
export interface Reason {
	signal_session: string;
	entry_session: string;
	entry_basis: string;
	known_from: string;
	breakout_date: string | null;
	sessions_since_breakout: number | null;
	window: number;
	seconds: number;
	history: ReasonPoint[];
	levels: {
		donchian_level: number | null;
		entry_ref: number;
		target_price: number;
		stop_price: number;
		tick_idr: number | null;
		holding_weeks: number;
	};
	ar: {
		reference: number;
		up_price: number;
		down_price: number;
		up_pct: number;
		down_pct: number;
		band: string;
		note: string;
	};
}

export interface Geometry {
	entry_basis: string;
	target_pct: number;
	stop_pct: number;
	hold_bars: number;
	entry_ref: number;
	target_price: number;
	stop_price: number;
	gross_risk_pct: number;
	reward_risk: number;
	/** An illustration on Rp1m. `position_idr` is the real size. */
	max_loss_idr_1m: number;
	target_gain_idr_1m: number;
	holding_weeks: number;
	/**
	 * The study's sizing rule: 2% of median 60-session turnover, clamped to
	 * 2M-10M IDR and rejected above 2% participation. Null when the name cannot
	 * be sized at that rule — the study would not take the trade either.
	 */
	position_idr: number | null;
	shares: number | null;
	lots: number | null;
	participation_pct: number | null;
	sizing_basis: "study_adv" | "risk_budget" | "none" | "";
	risk_budget_idr: number | null;
	/** Real risk: shares x (entry - stop) plus costs on the position. */
	max_loss_idr: number | null;
	risk_pct_of_position: number | null;
	tick_idr: number | null;
	/** The IDX overlay: broker fees plus the spread at this price. */
	friction: {
		price?: number;
		tick_idr?: number;
		spread_ticks?: number;
		spread_pct?: number;
		fees_pct?: number;
		total_pct?: number;
		study_model_pct?: number;
		over_study_pct?: number;
		note?: string;
	};
	/** Everything the ticket should say about this size, in plain words. */
	notes: string[];
}

export interface Candidate {
	ticker: string;
	name: string | null;
	close: number;
	change_pct: number | null;
	as_of: string;
	gates: Gate[];
	geometry: Geometry;
	rs_rating: number;
	breadth: number;
	breakout_pct: number;
	vol20: number;
	vol20_median: number;
	turnover_idr: number | null;
	score: number;
	/** The run-up: when each condition turned true, and what the entry is. */
	reason: Reason | null;
}

export interface WatchItem {
	ticker: string;
	name: string | null;
	close: number;
	blocked_by: GateKey;
	distance_pct: number | null;
	distance_text: string;
	rs_rating: number;
	gates_passed: number;
	gates_total: number;
}

export type RegimeBand = "trending" | "sideways" | "capitulation";
export type RegimeAction = "trade" | "flat" | "watch";

/**
 * The market-wide gate, in three bands rather than two.
 *
 * The middle band is the finding, not a gap: the study measured the index
 * drifting about zero over five sessions while a round trip costs 0.50%, so the
 * instruction there is flat. `breadth_open` therefore means "the study says
 * trade this", which is narrower than "breadth is above zero".
 */
export interface Regime {
	breadth: number;
	breadth_threshold: number;
	breadth_open: boolean;
	breadth_median: number;
	index_close: number | null;
	index_above_200: boolean | null;
	index_above_50: boolean | null;
	universe_size: number;
	band: RegimeBand;
	action: RegimeAction;
}

export interface Evidence {
	family: string;
	exit_method: string;
	oos_trades: number | null;
	win_rate: number | null;
	avg_ret_pct: number | null;
	fold_worst_win_rate: number | null;
	fold_best_win_rate: number | null;
	folds_traded: number | null;
	fold_detail: string;
	total_cells_measured: number | null;
	source: string;
	measured: boolean;
	clears_bar: boolean;
	caveat: string;
	/**
	 * Which tier this row belongs to. `searched_census` is a maximum over a
	 * search, not an expectation — docs/22 carried the best of them to unseen
	 * folds and found none held. `walk_forward_corrected` is what the study
	 * publishes after its own correctness pass. `replay` is a one-window
	 * projection. The UI labels the tier rather than quoting the number bare.
	 */
	role: EvidenceTier;
	profit_factor: number | null;
	max_drawdown_pct: number | null;
	book_return_pct: number | null;
	book_max_drawdown_pct: number | null;
	/** Wilson interval on the win rate, when the study computed one. */
	win_rate_lo: number | null;
	win_rate_hi: number | null;
	/**
	 * Where a cited figure came from. Empty for rows read from a results CSV;
	 * populated for the corrected row, whose figures exist only as prose in the
	 * study. See backend/app/plan/citations.py.
	 */
	provenance: Citation[];
	/**
	 * How many parameter variants the row pools. The study's published counts
	 * sum four donchian windows (20/40/50/60) while this screen runs window 40,
	 * so `single_spec_trades` is the sample that describes what you would trade.
	 */
	n_specs: number | null;
	n_cells: number | null;
	single_spec_trades: number | null;
}

/** The three tiers an evidence row can come from. Never blended in the UI. */
export type EvidenceTier = "searched_census" | "walk_forward_corrected" | "replay";

/**
 * One number the study published in prose, with the line that carries it.
 *
 * The corrected result has no results file behind it — the correction was a pass
 * over the study's engine — so the app cites it the way a paper would, and a
 * backend test fails the build if the study stops saying it.
 */
export interface Citation {
	label: string;
	value: number | null;
	unit: string;
	doc: string;
	line: number;
	quote: string;
	regenerate: string;
}

/**
 * docs/22: what happened on folds the search never saw.
 *
 * The reason this is separate from `Evidence` is that the two numbers disagree
 * badly, and collapsing them is how a search result becomes a promise.
 */
export interface Holdout {
	search_cells: number | null;
	search_cells_clearing: number | null;
	winners_tested: number | null;
	winners_surviving: number | null;
	best_holdout_win_rate: number | null;
	best_holdout_avg_ret_pct: number | null;
	win_rate_decay_pp: number | null;
	return_decay_pp: number | null;
	verdict: string;
}

/**
 * docs/24 §1: how often the tape was strong enough to act.
 *
 * Named by threshold rather than by band on purpose — the census counts 0.60,
 * 0.50 and 0.45 and does not resolve the 0.25 line, so nothing here claims a
 * share for a band nobody measured.
 */
export interface RegimeFrequency {
	sessions: number;
	days_b60: number;
	days_b50: number;
	days_b45: number;
	share_trending: number;
	share_below_45: number;
}

/**
 * The app's own shipped rule chain, measured on the folds that ranked it.
 *
 * Reports the spread across every census row that scored this exact
 * configuration rather than the best or the biggest one, because at a gate this
 * strict the rows disagree by several percent per trade and picking the
 * flattering one would repeat the error the holdout exists to correct.
 */
export interface ShippedConfig {
	entry: string;
	exit: string;
	regime_gate: string;
	rows_matched: number;
	search_trades_lo: number | null;
	search_trades_hi: number | null;
	search_win_rate_lo: number | null;
	search_win_rate_hi: number | null;
	search_avg_ret_lo: number | null;
	search_avg_ret_hi: number | null;
	any_row_clears_win_bar: boolean;
	source: string;
	note: string;
}

/** docs/22 §4: the single-window replay, by regime tier. Not fold-comparable. */
export interface FiveYearReplay {
	window: string;
	comparable_to_folds: boolean;
	tiers: {
		tier: string;
		trades: number | null;
		tickers: number | null;
		win_rate: number | null;
		win_rate_lo: number | null;
		win_rate_hi: number | null;
		avg_ret_pct: number | null;
		profit_factor: number | null;
		book_taken: number | null;
		book_total_pct: number | null;
		book_max_drawdown_pct: number | null;
		cost_model: string;
	}[];
	source: string;
	caveat: string;
}

export interface Plan {
	as_of: string;
	session_label: string;
	next_session: string;
	/**
	 * "exchange_calendar" when this date came from ^JKSE's own bar dates,
	 * "next_weekday_unverified" when it is only the next weekday. Only the first
	 * survives a public holiday, and no calendar contains the future.
	 */
	next_session_basis: "exchange_calendar" | "next_weekday_unverified";
	horizon: string;
	method_name: string;
	open: boolean;
	headline: string;
	regime: Regime;
	candidates: Candidate[];
	watchlist: WatchItem[];
	evidence: Evidence;
	/** The same chain, measured after the study's correctness pass. Cited. */
	corrected: Evidence | null;
	ladder: Evidence[];
	costs: {
		fee_buy: number;
		fee_sell: number;
		slippage: number;
		round_trip: number;
		lot_size: number;
		risk_budget_idr: number;
	};
	source: string;
	required_gates: GateKey[];
	coverage: {
		codes?: number;
		benchmark?: string;
		tradable_on_session?: number;
		/** Sessions the exchange never held that the app refused to screen on. */
		phantom_bars_dropped?: number;
		phantom_dates?: string[];
		/** How many sessions the exchange calendar covers. */
		exchange_sessions?: number;
		[key: string]: unknown;
	};
	/** The whole universe ranked by how near it is to clearing the chain. */
	ranked: RankedRow[];
	/** On every plan, not only the Method page: the searched maximum *and*
	 *  what survived unseen data, in the same glance. */
	holdout: Holdout | null;
	frequency: RegimeFrequency | null;
	/** The IDX tables (tick bands, AR bands, fees, sessions) the ticket needs. */
	idx: IdxTables;
	/** One decision for the session, with the measured case behind it. */
	verdict: Verdict;
}

export type VerdictState = "ENTER" | "WAIT" | "NO_TRADE" | "DATA_UNSAFE";

/** Why the verdict is not simply "buy". */
export interface VerdictBlocker {
	key: string;
	label: string;
	severity: "data" | "market" | "size" | "name";
	text: string;
	value: number | null;
	threshold: number | null;
	unit: string;
}

/** One data-integrity test. All of them must pass before a ticket is issued. */
export interface VerdictCheck {
	key: string;
	label: string;
	ok: boolean;
	detail: string;
}

/** The measured argument for standing down, as numbers. */
export interface StandDownCase {
	band: RegimeBand;
	breadth: number;
	threshold: number;
	long_run_median: number;
	sessions_measured: number | null;
	round_trip_pct: number;
	bands: {
		trending: number | null;
		sideways: number | null;
		capitulation: number | null;
	};
	sideways: {
		win_rate: number | null;
		avg_ret_pct: number | null;
		drift_5s_pct: number | null;
		capture_needed_x: number | null;
	};
	capitulation: {
		win_rate: number | null;
		avg_ret_pct: number | null;
		drift_5s_pct: number | null;
	};
	trending: { drift_5s_pct: number | null; capture_achieved_x: number | null };
	book: {
		trend_only: BandBook;
		with_sideways: BandBook;
		slots: number;
		universe: string;
		source: string;
		note: string;
	};
	claim: string;
	provenance: Citation[];
}

export interface BandBook {
	available: boolean;
	label: string;
	trades?: number | null;
	win_rate?: number | null;
	avg_ret_pct?: number | null;
	total_pct?: number | null;
	max_drawdown_pct?: number | null;
}

export interface Verdict {
	state: VerdictState;
	action: string;
	headline: string;
	detail: string;
	primary_blocker: VerdictBlocker | null;
	blockers: VerdictBlocker[];
	change_needed: string;
	recheck_on: string;
	recheck_basis: "exchange_calendar" | "next_weekday_unverified";
	integrity: VerdictCheck[];
	sound: boolean;
	buys: boolean;
	stand_down_case: StandDownCase;
	place_by: string;
	place_note: string;
}

/**
 * The IDX structure the ticket must not hard-code.
 *
 * The rulebook moved on 28 September 2026 and the AR bands become symmetric on
 * 1 January 2027, so these arrive dated from the backend rather than compiled in.
 */
export interface IdxTables {
	lot_size: number;
	min_price_idr: number;
	economic_floor_note: string;
	broker_fee_buy: number;
	broker_fee_sell: number;
	exchange_fee_buy: number;
	exchange_fee_sell: number;
	stamp_duty_idr: number;
	stamp_duty_above_idr: number;
	study_round_trip_pct: number;
	untradeable_from: string;
	untradeable_to: string;
	sessions: { label: string; start: string; end: string; note: string }[];
	tick_bands: { low: number; high: number | null; tick: number }[];
	ar_bands: {
		low: number;
		high: number | null;
		up_pct: number | null;
		down_pct: number | null;
		effective_from: string;
		note: string;
	}[];
}

/** What POST /api/plan/size answers with. */
export interface SizeTicket {
	price: number;
	exit_method: string;
	geometry: Geometry;
	ar: {
		reference: number;
		up_price: number;
		down_price: number;
		up_pct: number;
		down_pct: number;
		band: string;
		note: string;
	};
	position: {
		study_cap_idr: number;
		study_floor_idr: number;
		max_participation: number;
		median_turnover_60: number | null;
	};
	tables: IdxTables;
}

/**
 * One row of the screener.
 *
 * There is no score here, on purpose. A name is either buyable or it is not,
 * and this list is everything that is not — ordered by how many conditions it
 * clears, then how close it is to clearing the one it fails. A composite
 * "quality score" would let a strong name mask three failed conditions, which
 * is precisely the failure this screen exists to prevent.
 */
export interface RankedRow {
	ticker: string;
	close: number;
	gates_passed: number;
	gates_total: number;
	blocked_by: GateKey;
	blocked_text: string;
	/** True when only market-wide gates fail — the name cannot close that itself. */
	waiting_on_market: boolean;
	/** Distance to passing, in that gate's own units. Null when waiting. */
	distance_pct: number | null;
	rs_rating: number;
	gates: {
		key: GateKey;
		label: string;
		passed: boolean;
		value: number | null;
		threshold: number | null;
		unit: string;
		text: string;
	}[];
}

export interface MethodRule {
	key: GateKey;
	label: string;
	source: string;
	explain: string;
	/** Whether the running family actually applies this rule. */
	required: boolean;
}

export interface FamilySummary {
	family: string;
	summary: string;
	breadth: number;
	oos_trades: number | null;
	win_rate: number | null;
	avg_ret_pct: number | null;
	fold_worst_win_rate: number | null;
}

export interface BookRow {
	trades_in_ledger?: string;
	book?: string;
	scope?: string;
	slots?: string;
	mode?: string;
	families?: string;
	taken: string;
	win_rate: string;
	avg_ret_pct: string;
	total_return_pct: string;
	max_dd_pct: string;
	avg_exposure?: string;
	/** Mark-to-market drawdown: deeper than the realised-only one. */
	max_dd_intraday_pct?: string;
	folds?: string;
}

/** How the method behaves as a book, not just per trade. */
export interface Deployment {
	available: boolean;
	book: BookRow | null;
	single_family_book: BookRow | null;
	/** The pick's own book, marked to market after the correctness pass. */
	canonical_book: BookRow | null;
	/** The selection rule tested on folds it was not chosen on. */
	walk_forward_chained_pct: number | null;
	walk_forward_pct_per_year: number | null;
	/** Which method variants those folds were selecting across. */
	walk_forward_selects_over: string[];
	/** Always false. The five-year replay in the same study books it far lower. */
	walk_forward_is_expected_return: boolean;
	walk_forward_caveat: string;
	folds_tested: number;
	source: string[];
	note: string;
}

/** docs/19 §4: the same search re-run with three-month test windows. */
export interface Quarterly {
	available: boolean;
	pick_win_rate: number | null;
	pick_avg_ret_pct: number | null;
	pick_total_return_pct: number | null;
	pick_max_dd_pct: number | null;
	pick_taken: number | null;
	windows_total: number;
	windows_traded: number;
	windows_lost_money: number;
	windows_too_short_for_the_bar: number;
	/** True when the quarterly win rate is under the bar the headline clears. */
	below_bar: boolean;
	source: string[];
	note: string;
}

/** docs/19 §2: the panel is today's listing, applied backwards. */
export interface Survivorship {
	available: boolean;
	/** Which cell of the study's census this is. */
	cell: string;
	baseline_win_rate: number | null;
	baseline_avg_pct: number | null;
	baseline_trades: number | null;
	/** The same cell rebuilt on names that survived. */
	worst_drop_names: number | null;
	worst_drop_share_pct: number | null;
	worst_drop_win_rate: number | null;
	worst_drop_avg_pct: number | null;
	curve: {
		bound: string;
		trades: number | null;
		tickers: number | null;
		win_rate: number | null;
		win_rate_lo: number | null;
		avg_ret_pct: number | null;
		profit_factor: number | null;
	}[];
	source: string[];
	note: string;
}

/** docs/18 §3.1: how much of the headline is the search rather than the market. */
export interface MultipleTesting {
	available: boolean;
	cells_searched: number | null;
	designs_searched: number | null;
	reality_check_p: number | null;
	spa_p: number | null;
	spa_statistic: number | null;
	deflated_sharpe_pct: number | null;
	source: string[];
	note: string;
}

/**
 * What could make the headline number wrong, measured rather than asserted.
 *
 * The headline clears the bar and each of these says something it does not.
 * That is not a contradiction the app should resolve in its own favour; it is
 * the shape of the result, so all of it is shown.
 */
export interface Robustness {
	quarterly: Quarterly;
	survivorship: Survivorship;
	multiple_testing: MultipleTesting;
	/** Plain sentences naming each thing the headline does not tell you. */
	flags: string[];
	headline_is: string;
	/** The robustness passes predate the correctness pass that re-priced the census. */
	revisions_note: string;
}

export interface MethodCard {
	family: string;
	exit_method: string;
	exit_geometry: { target_pct: number; stop_pct: number; hold_bars: number };
	family_summary: string;
	rules: MethodRule[];
	families: FamilySummary[];
	evidence: Evidence;
	/** The corrected tier-1 row, and the provenance behind every cited figure.
	 *  Nullable because a card cached before this change does not carry it. */
	corrected: Evidence | null;
	citations: Citation[];
	evidence_tiers: {
		searched: Evidence;
		corrected: Evidence;
		replay: FiveYearReplay | Record<string, never>;
	};
	/** The corrected figures keyed by label, for the Method page's tier table. */
	corrected_block: Record<string, Citation>;
	ladder: Evidence[];
	bar: { win_rate: number; avg_trade_pct: number; min_trades: number };
	deployment: Deployment;
	robustness: Robustness;
	/** The three answers to "should I believe the headline?". */
	holdout: Holdout | null;
	shipped: ShippedConfig | Record<string, never>;
	five_year: FiveYearReplay | Record<string, never>;
	regime_bands: {
		trending: number;
		capitulation: number;
		frequency: RegimeFrequency | null;
		note: string;
	};
	/** The audit that made the study drop 7.0% of its own trades. */
	tradability: {
		min_price_idr: number;
		max_frozen_fraction: number;
		why: string;
	};
	costs: { round_trip_pct: number; note: string };
	studies_at: string;
}

export interface PlanDetail {
	ticker: string;
	in_plan: boolean;
	as_of: string;
	close: number | null;
	rs_rating: number;
	breadth: number;
	blocked_by?: GateKey | null;
	distance_text?: string;
	gates: Gate[];
	geometry: Geometry | null;
	evidence: Evidence;
	/** The 40-session high the breakout had to clear, for the chart. */
	breakout_level: number | null;
	/** The run-up: the same question as "why not", answered for this name. */
	reason: Reason | null;
	/** Median 60-session turnover, so the ticket can re-size without the plan. */
	turnover_idr: number | null;
}

/** A plan changes when the session closes, so cache it for minutes, not seconds. */
const PLAN_TTL = 5 * 60_000;

export const planApi = {
	/** Tonight's plan. SWR-cached for five minutes: the session it describes
	 *  cannot change intraday, and a universe pass is not free. */
	plan: () => api.getCached<Plan>("/api/plan", { ttl: PLAN_TTL }),
	method: () => api.getCached<MethodCard>("/api/plan/method", { ttl: PLAN_TTL }),
	detail: (ticker: string) =>
		api.getCached<PlanDetail>(`/api/plan/${ticker.toUpperCase()}`, {
			ttl: PLAN_TTL,
		}),
	/** Size one order without a universe pass (docs/21 §8). */
	size: (body: {
		price: number;
		median_turnover_60?: number | null;
		risk_budget_idr?: number | null;
		exit_method?: string | null;
	}) => api.post<SizeTicket>("/api/plan/size", body),
	/** Re-read the study's results, for when a new round lands. */
	refresh: () => api.post<{ refreshed: boolean; as_of: string; open: boolean }>(
		"/api/plan/refresh",
		{},
	),
};