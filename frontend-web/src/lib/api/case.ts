/**
 * The invest case for one name: a fundamental pillar and a technical pillar.
 *
 * These types mirror `backend/app/case.py`. The two pillars are never merged:
 * each carries its own criteria, its own count, and its own warnings. `trend`
 * is only knowable once the local ownership archive has two snapshots.
 */

import { api } from "./transport";

export type CriterionState = "supportive" | "caution" | "against" | "unknown";
export type VerdictState = "supportive" | "mixed" | "weak" | "unknown";
export type StakeTrend = "rising" | "falling" | "flat" | "unknown";

export interface Criterion {
	key: string;
	label: string;
	display: string;
	state: CriterionState;
	detail: string;
}

export interface PillarVerdict {
	state: VerdictState;
	supportive: number;
	caution: number;
	against: number;
	unknown: number;
	measured: number;
	total: number;
}

export interface Pillar {
	name: "fundamental" | "technical";
	label: string;
	available: boolean;
	verdict: PillarVerdict;
	criteria: Criterion[];
	warnings: string[];
	as_of?: string;
}

export interface ShareStructure {
	available: boolean;
	shares_outstanding: number | null;
	total_source: string | null;
	owner_shares: number | null;
	owner_pct: number | null;
	public_shares: number | null;
	public_pct: number | null;
	trend: StakeTrend;
	delta_pp: number | null;
	from_date: string | null;
	to_date: string | null;
	holders_entered: number | null;
	holders_exited: number | null;
	snapshots: number;
	trend_detail: string;
	warnings: string[];
}

export interface Disclosure {
	title: string;
	category: string;
	date: string;
	link: string | null;
}

export interface NewsItem {
	title: string;
	source: string;
	date: string;
	date_str: string;
	link: string | null;
}

export interface Feed<T> {
	available: boolean;
	items: T[];
	warnings: string[];
}

export interface CaseCacheMeta {
	hit: boolean;
	fresh: boolean;
	age_seconds: number;
	saved_at: string | null;
	ttl_seconds: number;
}

export interface CaseReport {
	available: boolean;
	ticker: string;
	name: string;
	as_of: string;
	fundamental: Pillar;
	technical: Pillar;
	ownership: ShareStructure;
	disclosures: Feed<Disclosure>;
	news: Feed<NewsItem>;
	warnings: string[];
	cache?: CaseCacheMeta;
}

const CASE_TTL = 15 * 60_000;

export const caseApi = {
	/** The two-pillar case for one name; the backend caches the assembly 15 min. */
	assess: (ticker: string, refresh = false) =>
		api.getCached<CaseReport>(
			`/api/case/${ticker.toUpperCase()}${refresh ? "?refresh=1" : ""}`,
			{ ttl: CASE_TTL },
		),
};
