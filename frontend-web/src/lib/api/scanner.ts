/**
 * The scanner: every tradable name, with the screens it belongs to.
 *
 * These mirror `backend/app/plan/__init__.py::scan_payload`. The backend decides
 * screen membership; this client only displays and filters it, so the UI cannot
 * invent a rule the plan does not run.
 */

import { api } from "./transport";
import type { Regime } from "./plan";

export type ScanScreenKey =
	| "tier1"
	| "tier1_setup"
	| "capitulation"
	| "breakout"
	| "relative_strength"
	| "quiet_vol";

export interface ScanConditions {
	breakout: boolean;
	relative_strength: boolean;
	quiet_vol: boolean;
}

export interface ScanRow {
	ticker: string;
	close: number;
	change_pct: number | null;
	turnover_idr: number | null;
	breakout_pct: number;
	rs_rating: number;
	vol20: number;
	vol20_threshold: number;
	conditions_passed: number;
	conditions: ScanConditions;
	screens: ScanScreenKey[];
}

export interface ScanMeasured {
	win_rate?: number | null;
	avg_ret_pct?: number | null;
	trades?: number | null;
	source?: string;
	caveat?: string;
	holdout_win_rate?: number | null;
	holdout_avg_ret_pct?: number | null;
	sweep_win_rate?: number | null;
	sweep_avg_ret_pct?: number | null;
	sweep_trades?: number | null;
	clean_win_rate?: number | null;
	clean_avg_ret_pct?: number | null;
	semi_win_rate?: number | null;
	semi_avg_ret_pct?: number | null;
	why?: string | string[];
}

export interface ScanScreen {
	key: ScanScreenKey;
	label: string;
	kind: "strategy" | "setup" | "watch" | "condition";
	active: boolean;
	count: number;
	requires: string[];
	definition: string;
	note: string;
	/** Never set on a condition: a part of the chain is not a strategy. */
	measured: ScanMeasured | null;
}

export interface IndexContext {
	window: number;
	n: number;
	corr_median: number | null;
	corr_ex_big_median: number | null;
	corr_20_median: number | null;
	big_move_pct: number;
	ytd_index_pct: number | null;
	ytd_stock_median_pct: number | null;
	share_beating_index: number | null;
}

export interface ScanUniverse {
	codes: number;
	tradable: number;
	excluded: number;
	on_session: number;
	min_turnover_idr: number;
	min_price_idr: number;
	frozen_max_fraction: number;
}

export interface ScanPayload {
	as_of: string;
	session_label: string;
	next_session: string;
	source: string;
	regime: Regime;
	universe: ScanUniverse;
	thresholds: {
		rs: number;
		breadth: number;
		cap_breadth: number;
		quiet_quantile: number;
		max_breakout_pct: number;
	};
	index_context: IndexContext | null;
	screens: ScanScreen[];
	rows: ScanRow[];
}

const SCAN_TTL = 5 * 60_000;

export const scanApi = {
	/** The scanner is the front page; one universe pass, cached for five minutes. */
	get: (as_of?: string) =>
		api.getCached<ScanPayload>(
			as_of ? `/api/scanner?as_of=${encodeURIComponent(as_of)}` : "/api/scanner",
			{ ttl: SCAN_TTL },
		),
};
