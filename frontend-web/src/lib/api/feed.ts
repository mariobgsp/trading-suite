/**
 * The alert feed: the plan's book for tonight, shaped for one glance.
 *
 * Mirrors `backend/app/feed.py`. Nothing here is computed on the client —
 * if a number is not in this shape, it was not measured by the study.
 */

import { api } from "./transport";

export interface FeedEntry {
	rank: number;
	ticker: string;
	name: string | null;
	close: number | null;
	score: number | null;
	rs_rating: number | null;
	entry_ref: number | null;
	target_price: number | null;
	stop_price: number | null;
	target_pct: number | null;
	stop_pct: number | null;
	reward_risk: number | null;
	position_idr: number | null;
	shares: number | null;
	lots: number | null;
	max_loss_idr: number | null;
	entry_session: string | null;
	why: string;
}

export type FeedState = "ENTER" | "WAIT" | "NO_TRADE" | "DATA_UNSAFE";

export interface AlertFeed {
	generated_at: string;
	as_of: string | null;
	session_label: string | null;
	next_session: string | null;
	next_session_basis: string | null;
	horizon: string | null;
	headline: string | null;
	state: FeedState | string;
	regime: { band: string | null; action: string | null; breadth: number | null };
	entries: FeedEntry[];
	book_overflow: FeedEntry[];
	watchlist_count: number;
	no_trade_reasons: string[];
	data_age_days: number | null;
	stale: boolean;
	study: {
		win_rate: number | null;
		avg_ret_pct: number | null;
		oos_trades: number | null;
		role: string | null;
	};
}

const FEED_TTL = 60_000;

export const feedApi = {
	/** The feed rides the plan cache; one minute keeps the glance fresh. */
	get: () => api.getCached<AlertFeed>("/api/alerts/feed", { ttl: FEED_TTL }),
};
