/** Profiler-only types — per-ticker deep-dive endpoints. */

export interface BetaWindow {
	beta: number | null;
	correlation: number | null;
	excess_return_pct: number | null;
}

export interface BetaResult {
	ticker: string;
	windows: { "3mo": BetaWindow; "6mo": BetaWindow; "1y": BetaWindow };
	classification: string;
	note: string;
	overlap_bars: number;
	error?: string;
}

export interface EntryPlan {
	ticker: string;
	verdict: "ENTER_LONG" | "CONDITIONAL" | "WAIT" | "AVOID";
	score: number;
	bias: "bullish" | "bearish" | "neutral";
	entry_zone: {
		from: number;
		to: number;
		reference: number;
		note: string;
	};
	stop_loss: number | null;
	targets: { target1?: number; target2?: number; rr?: number; note?: string };
	position_sizing: string;
	regime: { regime?: string; as_of?: string };
	beta: { classification: string; beta_1y: number | null };
	technicals: Record<string, unknown>;
	validator: {
		bandar_phase: string;
		inst_flow: string;
		current_intent: string;
		conf_flow_index: number | null;
		dormant_index: number | null;
	};
	conditions: { met: string[]; missing: string[] };
	rationale: string[];
	narration: string;
	narration_model: string;
	error?: string;
}

export interface PatternStats {
	strategy: string;
	total_trades?: number;
	wins?: number;
	losses?: number;
	win_rate?: number;
	avg_win_pct?: number;
	avg_loss_pct?: number;
	total_return_pct?: number;
	buyhold_return_pct?: number;
	profit_factor?: number | null;
}

export interface PatternTrade {
	entry_date: string;
	exit_date: string;
	trigger: string;
	profit_pct: number;
	pnl_idr: number;
}

export interface PatternBacktest {
	ticker: string;
	available: boolean;
	bars: number;
	fee_note: string;
	error?: string;
	strategies: Record<
		string,
		{ stats: PatternStats; error?: string; recent_trades: PatternTrade[] }
	>;
}

/** Profiler-extended ValidatorResult — adds CMF, MFI, and a `score` block on top of the base shape. */
export interface ProfilerValidatorResult {
	ticker: string;
	error?: string;
	summary: {
		close: number;
		change_pct: number;
		liquidity: {
			status: string;
			level: string;
			avg_value_idr: number;
			avg_value_display: string;
			is_small_cap: boolean;
		};
		vwap: number;
		bandar_phase: { phase: string; gap_pct: number };
		inst_flow: string;
		inst_flow_ma: number;
		conf_flow_index: number;
		conf_flow_label: string;
		dormant_index: number;
		cmf?: number | null;
		mfi?: number | null;
		rsi: number;
		nvi_status: string;
		small_cap_mode: boolean;
		current_intent: string;
	};
	score: {
		composite_score: number;
		score_label: string;
		bandar_type: string;
		kapitalisasi: string;
		likuiditas: string | null;
		wyckoff_confidence: number;
		two_layer_alignment: string;
		recommendation: string;
	};
	radar: {
		date: string;
		close: number;
		change_pct: number;
		vwap: number;
		inst_flow: number;
		absorption: number;
		retail: number;
		conf_flow: number;
		intent: string;
	}[];
}
