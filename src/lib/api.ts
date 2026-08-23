/** Typed API client for the Trading Suite backend — with SWR cache + dedupe. */

export const API_BASE =
	process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		...init,
		// Let our own cache layer decide freshness — don't let the browser/http cache stale us
		cache: "no-store",
	});
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

// Re-export cache helpers via api namespace for callers that need invalidation
import {
	dedupedFetch,
	getFromCache,
	invalidateCache,
	peekCache,
	resolveTTL,
	setCache,
} from "./cache";

type GetOpts = RequestInit & {
	ttl?: number; // override TTL ms
	swr?: boolean; // default true for GET — serve stale while revalidating
};

async function cachedGet<T>(path: string, opts: GetOpts = {}): Promise<T> {
	const { ttl, swr = true, ...init } = opts;
	const key = path; // cache key is the path (query included)
	const hit = getFromCache<T>(key);
	const ttlMs = resolveTTL(path, ttl);

	// Fresh hit -> instant return, no network
	if (hit && !hit.stale) return hit.data;

	// Stale hit + swr -> return stale immediately while revalidating in background
	if (hit && hit.stale && swr) {
		// fire-and-forget revalidation; next caller will see fresh data
		void dedupedFetch<T>(key, () => request<T>(path, init), ttlMs).catch(
			() => {},
		);
		return hit.data;
	}

	// No hit or stale without swr -> fetch (deduped) and wait
	return dedupedFetch<T>(key, () => request<T>(path, init), ttlMs);
}

export const api = {
	get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
	/** SWR-aware GET — uses memory+sessionStorage + dedupe */
	getCached: <T>(path: string, opts?: GetOpts) => cachedGet<T>(path, opts),
	post: <T>(path: string, body: unknown) =>
		request<T>(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	/** Prefetch/warm — fire and forget, deduped */
	prefetch: (path: string, ttl?: number) => {
		void cachedGet(path, { ttl, swr: false }).catch(() => {});
	},
	peek: peekCache,
	invalidate: invalidateCache,
	/** Low-level cache set — useful for optimistic updates */
	setCache,
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

export interface BacktestValidation {
	is_return_pct: number;
	oos_return_pct: number;
	consistent: boolean;
}

export interface BacktestResult {
	symbol: string;
	period: string;
	interval: string;
	trades: BacktestTrade[];
	equity: { date: string; value: number }[];
	stats: BacktestStats;
	validation?: BacktestValidation | null;
	error?: string;
}

/* ── D-Signal alerts ── */

export interface AlertItem {
	ticker: string;
	price: number;
	change_percent: number;
	rsi: number | null;
	above_ma: number[];
	ma_ladder: string;
	d_signal: "PREMIUM" | "BREAKOUT" | null;
	spike_pagi: boolean;
}

export interface AlertsResponse {
	count: number;
	scanned: number;
	failed: number;
	available: boolean;
	error?: string | null;
	counts: {
		premium: number;
		breakout: number;
		spike_pagi: number;
		full_ladder: number;
	};
	items: AlertItem[];
}

/* ── Konglo ── */

export interface KongloMember {
	ticker: string;
	price: number | null;
	change_percent: number | null;
	net_foreign_idr: number | null;
}

export interface KongloGroup {
	group: string;
	count_saham: number;
	avg_change_percent: number | null;
	net_foreign_idr: number;
	members: KongloMember[];
}

export interface KongloResponse {
	available: boolean;
	error?: string;
	groups_counted: number;
	tickers_mapped: number;
	groups: KongloGroup[];
}

/* ── Ownership ── */

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

export interface OwnerHoldingsMatch {
	ticker: string;
	name?: string;
	percent: number | null;
	category: string;
	controlling: boolean;
	as_of?: string;
}

export interface OwnerHoldingsIssuer {
	ticker: string;
	name?: string;
}

export interface OwnerHoldings {
	query: string;
	available: boolean;
	issuers_scanned: number;
	matches: OwnerHoldingsMatch[];
	issuers?: OwnerHoldingsIssuer[];
}

/* ── Sector rotation ── */

export interface ValidAccum {
	ticker: string;
	name?: string;
	days: number;
	price_move: number;
	peak_move?: number | null;
	buy_share: number;
	stage: string;
	flow_agrees?: boolean;
}

export interface RotationMover {
	ticker: string;
	name?: string;
	price: number | null;
	change_percent: number;
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
	movers?: {
		gainers: RotationMover[];
		losers: RotationMover[];
	};
	valid_accumulation?: ValidAccum[];
}

export interface RotationHistory {
	as_of?: string;
	days_archived: number;
	dates: string[];
	sectors: RotationSector[];
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
