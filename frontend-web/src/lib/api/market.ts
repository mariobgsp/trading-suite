/**
 * The quote and identity read the Deep Dive tab opens with.
 *
 * Every field is nullable on purpose: a typo in the ticker must render the
 * page's missing-name state, never a failed screen.
 */

import { api } from "./transport";

export interface TickerProfile {
	ticker: string;
	found: boolean;
	symbol_yf: string | null;
	name: string | null;
	sector: string | null;
	industry: string | null;
	market_cap: number | null;
	volume: number | null;
	price: number | null;
	change: number | null;
	change_percent: number | null;
	prev_close: number | null;
	quote_live: boolean;
}

export const marketApi = {
	/** Identity labels plus the live quote, in one call. */
	profile: (ticker: string, force = false) =>
		api.getCached<TickerProfile>(
			`/api/market/profile/${ticker.trim().toUpperCase()}${force ? "?force=1" : ""}`,
			{ ttl: 120_000 },
		),
	/** One group's constituents from the live scan, ranked by the day's move. */
	sectorMembers: (sector: string, field: "sector" | "industry" = "sector", limit = 40) =>
		api.get<SectorMembers>(
			`/api/market/sector-members?sector=${encodeURIComponent(sector.trim())}&field=${field}&limit=${limit}`,
		),};


export interface SectorMembersMember {
	ticker: string;
	name: string;
	price: number | null;
	change_percent: number | null;
	market_cap: number | null;
	value: number | null;
}

export interface SectorMembers {
	sector: string;
	field: "sector" | "industry";
	available: boolean;
	reason: string | null;
	count: number;
	shown: number;
	avg_change_pct: number | null;
	up: number;
	down: number;
	flat: number;
	members: SectorMembersMember[];
}
