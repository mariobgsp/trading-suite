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

/* ── Market intelligence (free feeds) ─────────────────────────────────────── */

/** Broker row shape for the IDX-backed foreign-flow feeds. */
export interface IntelForeignRow {
	broker: string;
	side: "buy" | "sell";
	type: string;
	lots: number;
	value_idr: number;
	avg_price: number;
}

export interface ForeignFlow {
	ticker: string;
	available: boolean;
	error?: string;
	as_of?: string;
	price?: number;
	net_foreign_lots?: number;
	net_foreign_idr?: number;
	foreign_buy_lots?: number;
	foreign_sell_lots?: number;
	foreign_buy_idr?: number;
	foreign_sell_idr?: number;
	total_volume?: number;
	broker_count?: number;
	rows?: IntelForeignRow[];
}

export interface ForeignFlowUniverse {
	available: boolean;
	error?: string;
	count?: number;
	as_of?: string;
	rows?: {
		ticker: string;
		name: string;
		sector: string;
		price: number;
		change_percent: number;
		net_foreign_idr: number;
		net_foreign_lots: number;
		foreign_buy_lots: number;
		foreign_sell_lots: number;
		foreign_buy_idr: number;
		foreign_sell_idr: number;
		volume?: number;
	}[];
}

export interface BrokerAnalysis {
	ticker: string;
	available: boolean;
	error?: string;
	as_of?: string;
	note?: string;
	price?: number;
	total_volume?: number;
	net_foreign_lots?: number;
	net_foreign_idr?: number;
	foreign_buy_lots?: number;
	foreign_sell_lots?: number;
	foreign_buy_idr?: number;
	foreign_sell_idr?: number;
}

export interface BrokerRadarRow {
	broker: string;
	code?: string;
	net_lots: number;
	net_idr: number;
	type: string;
	ticker_count: number;
	tickers: string[];
	volume?: number;
	value_idr?: number;
	frequency?: number;
}

export interface BrokerRadar {
	available: boolean;
	error?: string;
	covered_tickers?: number;
	count?: number;
	as_of?: string;
	rows?: BrokerRadarRow[];
}

export interface AnnouncementItem {
	title?: string;
	link?: string;
	url?: string;
	date?: string;
	category?: string;
	ticker?: string;
	[field: string]: unknown;
}

export interface Announcements {
	available: boolean;
	error?: string;
	count?: number;
	as_of?: string;
	items?: AnnouncementItem[];
}

export interface RotationSector {
	sector: string;
	count: number;
	gainers: number;
	losers: number;
	avg_change_percent: number;
	avg5: number | null;
	avg20: number | null;
	rank: number | null;
	rank_delta: number | null;
}

export interface RotationHistory {
	as_of?: string;
	days_archived: number;
	dates: string[];
	sectors: RotationSector[];
	error?: string;
}

export interface MsciRow {
	ticker: string;
	name: string;
	sector: string;
	price: number;
	change_percent: number;
	market_cap: number | null;
	volume: number | null;
}

export interface MsciWatch {
	count: number;
	missing: string[];
	as_of?: string;
	rows: MsciRow[];
	error?: string;
}

export interface JournalStats {
	trade_count: number;
	closed_count?: number;
	note?: string;
	win_rate_pct: number | null;
	profit_factor: number | null;
	avg_win_idr: number | null;
	avg_loss_idr: number | null;
	total_pnl_idr: number;
	monthly: { month: string; pnl_idr: number }[];
	by_ticker: { ticker: string; pnl_idr: number; count: number }[];
	recent: Record<string, unknown>[];
}

export interface OwnershipStructure {
	ticker: string;
	available: boolean;
	error?: string;
	note?: string;
	as_of?: string;
	name?: string;
	sector?: string;
	sub_sector?: string;
	listing_date?: string;
	shareholders?: {
		name: string;
		shares: number | null;
		percent: number | null;
		category: string;
		controlling: boolean;
	}[];
	board?: {
		direktur: { name: string; position: string }[];
		komisaris: { name: string; position: string }[];
	};
	subsidiaries?: { name: string; percent: number | null }[];
}

export interface OwnershipSnapshot {
	date: string;
	holders: {
		name: string;
		percent: number | null;
		category: string;
		controlling: boolean;
	}[];
}

export interface OwnershipChanges {
	from_date: string;
	to_date: string;
	entered: { name: string; percent: number | null }[];
	exited: { name: string; percent: number | null }[];
	changed: { name: string; from: number; to: number; delta: number }[];
	crossed: {
		name: string;
		from: number;
		to: number;
		threshold: number;
		dir: "above" | "below";
	}[];
}

export interface OwnershipHistory {
	ticker: string;
	available: boolean;
	snapshots: OwnershipSnapshot[];
	changes: OwnershipChanges | null;
}

export interface HeatmapRow {
	ticker: string;
	name: string;
	sector: string;
	price: number;
	change_pct: number | null;
	market_cap: number;
	listed_shares: number;
	volume: number;
	value_idr: number;
	foreign_net: number;
}

export interface HeatmapResponse {
	available: boolean;
	error?: string;
	count?: number;
	as_of?: string;
	rows: HeatmapRow[];
}

export interface MoverContribution {
	ticker: string;
	name: string;
	price: number;
	change_pct: number;
	pts: number | null;
	idx_mv_pct: number | null;
	volume: number;
	value_idr: number;
}

export interface JciMoversResponse {
	available: boolean;
	error?: string;
	as_of?: string;
	trade_date?: string;
	jci: number | null;
	range_days: number;
	up_count: number;
	down_count: number;
	flat_count: number;
	leaders: MoverContribution[];
	laggards: MoverContribution[];
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
