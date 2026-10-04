/** Screener, Validator, Sentiment, Regime, Portfolio. */

export interface ScreenerResult {
	ticker: string;
	action: string;
	score: number;
	signals: string[];
	trend_status: string;
	macd_cross: string;
	rsi: number;
	rsi_desc: string;
	stoch: string;
	obv_trend: string;
	close: number;
	change_pct: number;
	avg_volume_20: number;
	liquidity_idr_est: number | null;
	ma9: number | null;
	ma20: number | null;
	ma50: number | null;
	ma200: number | null;
}

/** Bull-divergence SSE server-side tags each row with a derived `divergence` flag. */
export type BullDivRow = ScreenerResult & { divergence?: boolean };

/** Render-projection of a bull-div row: the early/late price+RSI used to compute the divergence. */
export interface BullDivRenderRow {
	ticker: string;
	close: number;
	price_change_pct: number | null;
	early_price: number;
	late_price: number;
	early_rsi: number;
	late_rsi: number;
	rsi_gain: number;
	score: number;
}

export interface ValidatorResult {
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
		rsi: number;
		nvi_status: string;
		small_cap_mode: boolean;
		current_intent: string;
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

export interface SentimentItem {
	date: string;
	date_str: string;
	source: string;
	title: string;
	link: string;
	category: string;
	label: string;
	color: string;
	tags: string[];
	sentiment: "positive" | "negative" | "neutral";
	score: number;
}

export interface SentimentFeed {
	generated_at: string;
	count: number;
	items: SentimentItem[];
}

export interface RegimeSnapshot {
	regime: "BULL" | "CAUTION" | "BEAR" | "UNKNOWN";
	close: number;
	sma_short: number;
	sma_long: number;
	atr_value: number;
	hurst_value: number;
	as_of_date: string;
	allowed_engines: string[];
	error?: string;
}

export interface PortfolioState {
	generated_at: string;
	live_forex_usdidr: number;
	cash_idr: number;
	positions: {
		ticker: string;
		qty: number;
		avg_cost_idr: number;
		last_price: number | null;
		market_value_idr: number;
		unrealized_pnl_idr: number;
		lots: unknown[];
	}[];
	total_market_value_idr: number;
	net_worth_idr: number;
	realized_pnl_idr: number;
	total_trades: number;
	recent_trades: unknown[];
	currency: string;
}
