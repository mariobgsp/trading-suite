/**
 * The Flow research surface: card readouts and a proxy series.
 *
 * These types mirror `backend/app/flow/model.py`. `quality` is always
 * `"proxy"` for the flow line; there is no vendor LPM field, on purpose.
 */

import { api } from "./transport";

export type FlowUniverse = "watchlist" | "movers" | "plan" | "tickers";
export type FlowSourceKey = "auto" | "idx" | "stockbit" | "ohlcv";
export type FlowDirection = "rising" | "falling" | "flat" | "unavailable";

export interface FlowSourceInfo {
	bars: string;
	flow: string;
	quality: "proxy" | "measured" | "unavailable";
	as_of: string;
	available: boolean;
	warnings: string[];
}

export interface FlowTechnicals {
	rsi14: number | null;
	stoch_k: number | null;
	stoch_d: number | null;
	supertrend: "bull" | "bear" | null;
	kumo: "above" | "below" | "inside" | null;
	vwap_pct: number | null;
	above_ma20: boolean | null;
	above_ma50: boolean | null;
	from_52w_high_pct: number | null;
	change_5d_pct: number | null;
}

export interface FlowReading {
	direction: FlowDirection;
	slope_5d: number | null;
	score: number | null;
	source: string;
	quality: "proxy" | "measured" | "unavailable";
	available: boolean;
}

export interface FlowCard {
	ticker: string;
	name: string;
	as_of: string;
	price: number | null;
	previous_close: number | null;
	change_pct: number | null;
	value_5d_idr: number | null;
	technicals: FlowTechnicals;
	flow: FlowReading;
	tags: {
		board: string | null;
		syariah: boolean | null;
		source: string;
	};
	source: FlowSourceInfo;
	warnings: string[];
}

export interface FlowCacheMeta {
	hit: boolean;
	fresh: boolean;
	age_seconds: number;
	saved_at: string | null;
	ttl_seconds: number;
	cache_key: string | null;
	warning: string | null;
}

export interface FlowCardsResponse {
	available: boolean;
	universe: string;
	as_of: string;
	count: number;
	cards: FlowCard[];
	source: {
		bars: string;
		flow: string;
		quality: "proxy" | "measured" | "unavailable";
		foreign_available: boolean;
		foreign_as_of: string | null;
		foreign_stale?: boolean;
	};
	warnings: string[];
	parameters: Record<string, string | number>;
	cache?: FlowCacheMeta;
}

export interface FlowSeries {
	ticker: string;
	dates: string[];
	price: (number | null)[];
	lpm_score: (number | null)[];
	lpm_price_space: (number | null)[];
	intensity: (number | null)[];
	foreign_net_idr: (number | null)[];
	money_flow: (number | null)[];
	source: FlowSourceInfo;
	quality: "proxy" | "measured" | "unavailable";
	parameters: Record<string, string | number>;
	warnings: string[];
	cache?: FlowCacheMeta;
}

export interface FlowValidation {
	available: boolean;
	tickers: string[];
	horizon: number;
	days: number;
	source: string;
	quality: "proxy" | "measured" | "unavailable";
	n: number;
	hit_rate_pct: number | null;
	hit_wilson_low_pct: number | null;
	hit_wilson_high_pct: number | null;
	auc: number | null;
	baseline_hit_rate_pct: number | null;
	baseline_auc: number | null;
	by_year: Record<string, { n: number; hit_rate_pct: number | null; auc: number | null }>;
	cross_section: {
		available: boolean;
		n_dates?: number;
		mean_rank_ic?: number;
		mean_top_bottom_pct?: number | null;
	};
	per_ticker: Record<
		string,
		{
			n: number;
			hit_rate_pct: number | null;
			auc: number | null;
			baseline_hit_rate_pct: number | null;
			source: string;
		}
	>;
	vendor_parity: {
		available: boolean;
		reason?: string;
		sample?: number;
		spearman?: number | null;
		mae_raw?: number;
		mae_normalized?: number;
		sign_agreement_pct?: number | null;
		note?: string;
	};
	warnings: string[];
	cache?: FlowCacheMeta;
}

const FLOW_TTL = 60_000;

function query(params: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === "") continue;
		search.set(key, String(value));
	}
	const text = search.toString();
	return text ? `?${text}` : "";
}

export const flowApi = {
	/** Bounded card scan. Cached for a minute; a card is a readout, not a tick. */
	cards: (params: {
		universe?: FlowUniverse;
		tickers?: string;
		limit?: number;
		source?: FlowSourceKey;
		days?: number;
		refresh?: boolean;
	} = {}) => {
		const path = `/api/flow/cards${query({
			universe: params.universe,
			tickers: params.tickers,
			limit: params.limit,
			source: params.source,
			days: params.days,
			refresh: params.refresh ? 1 : undefined,
		})}`;
		return params.refresh
			? api.get<FlowCardsResponse>(path)
			: api.getCached<FlowCardsResponse>(path, { ttl: FLOW_TTL });
	},
	/** Price + proxy-flow series for one name. */
	series: (
		ticker: string,
		days = 120,
		source: FlowSourceKey = "auto",
		refresh = false,
	) => {
		const path = `/api/flow/${ticker.toUpperCase()}${query({
			days,
			source,
			refresh: refresh ? 1 : undefined,
		})}`;
		return refresh
			? api.get<FlowSeries>(path)
			: api.getCached<FlowSeries>(path, { ttl: FLOW_TTL });
	},
	/** Forward-return report. This is not a vendor-parity claim. */
	validate: (body: {
		tickers: string[];
		horizon?: number;
		days?: number;
		source?: FlowSourceKey;
		refresh?: boolean;
	}) => api.post<FlowValidation>("/api/flow/validate", body),
};
