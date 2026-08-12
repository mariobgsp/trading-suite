/**
 * Typed API client for the Trading Suite backend.
 *
 * Pilot: the API is same-origin (`/api/*` is proxied to FastAPI on :8000 by
 * Vite in dev and by the Hono server in prod), so the base defaults to empty
 * and is overridable with VITE_API_URL. This is the one-line env change the
 * recon flagged (Next `process.env.NEXT_PUBLIC_*` -> Vite `import.meta.env`).
 */

export const API_BASE: string =
	(import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, init);
	if (!res.ok) {
		let detail = res.statusText;
		try {
			const body = await res.json();
			detail = body.detail ?? body.error ?? detail;
		} catch {
			/* keep statusText */
		}
		throw new ApiError(res.status, String(detail));
	}
	return res.json() as Promise<T>;
}

export const api = {
	get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
	post: <T>(path: string, body: unknown) =>
		request<T>(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
};

/* ── Domain types ─────────────────────────────────────────────────────────── */

export interface Quote {
	symbol: string;
	name?: string;
	price: number | null;
	previous_close: number | null;
	open: number | null;
	day_high: number | null;
	day_low: number | null;
	volume: number | null;
	change: number | null;
	change_percent: number | null;
}

export interface HistoryRecord {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface IndicatorColumns {
	date: string[];
	[name: string]: (string | number | null)[];
}

export interface MomentumSignal {
	signal: "BUY" | "SELL" | "ACCUMULATE" | "REDUCE" | "HOLD" | "UNKNOWN";
	score: number;
	reasons: string[];
}

export interface HistoryResponse {
	symbol: string;
	period: string;
	interval: string;
	history: HistoryRecord[];
	indicators: IndicatorColumns;
	latest_indicators: Record<string, number | null>;
	momentum: MomentumSignal;
	error?: string;
}

export interface BacktestTrade {
	entry_date: string | null;
	exit_date: string;
	trigger: string;
	entry_price: number;
	exit_price: number;
	shares: number;
	profit_pct: number;
	pnl_idr: number;
}

export interface BacktestStats {
	strategy: string;
	total_trades: number;
	wins: number;
	losses: number;
	win_rate: number;
	avg_win_pct: number;
	avg_loss_pct: number;
	total_return_pct: number;
	annualized_return_pct: number;
	max_drawdown_pct: number;
	final_value: number;
	buyhold_return_pct: number;
	profit_factor: number | null;
	fees_pct?: string;
}

export interface BacktestResult {
	symbol: string;
	period: string;
	interval: string;
	trades: BacktestTrade[];
	equity: { date: string; value: number }[];
	stats: BacktestStats;
	error?: string;
}

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
		cmf?: number | null;
		mfi?: number | null;
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

export interface Mover {
	symbol: string;
	name: string;
	price: number;
	change: number | null;
	change_percent: number;
	sector: string;
	market_cap: number | null;
	volume: number | null;
}

export interface MoversResponse {
	side: "gainers" | "losers";
	count: number;
	as_of: string;
	movers: Mover[];
}

export interface SectorPerf {
	sector: string;
	avg_change_percent: number;
	count: number;
	gainers: number;
	losers: number;
}

export interface SectorsResponse {
	count: number;
	tickers: number;
	as_of: string;
	sectors: SectorPerf[];
}

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

/* ── Formatters ───────────────────────────────────────────────────────────── */

export const fmtIdr = (
	v: number | null | undefined,
	compact = false,
): string => {
	if (v == null || Number.isNaN(v)) return "—";
	if (compact) {
		if (Math.abs(v) >= 1e12) return `Rp ${(v / 1e12).toFixed(2)} T`;
		if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(1)} M`;
		if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(1)} Jt`;
	}
	return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
};

export const fmtNum = (v: number | null | undefined, digits = 2): string => {
	if (v == null || Number.isNaN(v)) return "—";
	return v.toLocaleString("id-ID", { maximumFractionDigits: digits });
};

export const fmtPct = (v: number | null | undefined): string => {
	if (v == null || Number.isNaN(v)) return "—";
	const sign = v > 0 ? "+" : "";
	return `${sign}${v.toFixed(2)}%`;
};
