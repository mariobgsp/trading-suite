/**
 * Daily market dashboard types.
 *
 * The snapshot is computed by a background job and persisted in SQLite. The
 * client never triggers a universe scan; it polls status while a build runs.
 */

import { api } from "./transport";

export type Quadrant = "leading" | "weakening" | "improving" | "lagging";

export interface OverviewIhsg {
	close: number | null;
	change_pct: number | null;
	ma50: number | null;
	ma100: number | null;
	momentum_vs_ma100_pct: number | null;
	volatility_20d_pct: number | null;
}

export interface OverviewMarket {
	as_of: string | null;
	history_as_of: string | null;
	universe: {
		total: number;
		with_ma50: number;
		with_52w: number;
		above_ma50: number;
		near_52w_high: number;
		near_52w_low: number;
		near_52w_pct: number;
	};
	ihsg: OverviewIhsg;
	average_change_pct: number | null;
	up: number;
	flat: number;
	down: number;
	up5: number;
	down5: number;
	breadth_pct: number;
	above_ma50_pct: number;
	down5_pct: number;
	near_52w_high: number;
	near_52w_low: number;
}

export interface GaugeComponent {
	key: string;
	label: string;
	raw: number | [number, number] | null;
	score: number;
	unit: string;
	greed_direction: "up" | "down";
	weight: number;
}

export interface OverviewGauge {
	value: number;
	band: string;
	band_label: string;
	components: GaugeComponent[];
	weights: Record<string, number>;
	note: string;
}

export interface RotationPoint {
	group: string;
	x: number;
	y: number;
	quadrant: Quadrant;
	members: number;
	tail: [number, number][];
}

export interface RotationGroup {
	group: string;
	quadrant: Quadrant;
	change_pct: number | null;
	members: number;
	x: number;
	y: number;
}

export interface RotationBlock {
	available: boolean;
	points: RotationPoint[];
	groups: RotationGroup[];
	count?: number;
	reason?: string;
}

export interface OverviewCacheMeta {
	hit: boolean;
	fresh: boolean;
	age_seconds: number;
	saved_at: string | null;
	ttl_seconds: number;
	cache_key: string;
	warning: string | null;
}

export interface OverviewCoverage {
	universe: number;
	joined: number;
	missing_history: number;
	missing_print: number;
	history_floor: number;
	history_as_of: string | null;
	print_as_of: string;
	use_current_print: boolean;
	appended_current_to_history?: boolean;
	history_gap_days: number | null;
}

export interface OverviewStatus {
	state: "idle" | "running" | "done" | "failed";
	phase: string | null;
	message: string | null;
	started_at: string | null;
	finished_at: string | null;
	seconds: number | null;
	error: string | null;
	session: string | null;
	formula_version?: number;
}

export interface OverviewSnapshot {
	as_of: string;
	history_as_of: string | null;
	print_as_of: string | null;
	source: string;
	coverage: OverviewCoverage;
	market: OverviewMarket;
	gauge: OverviewGauge;
	sectors: RotationBlock;
	conglomerates: RotationBlock;
	industries: RotationBlock;
	warnings: string[];
	built_at: string;
	formula_version: number;
	stale?: boolean;
	building?: boolean;
	cache?: OverviewCacheMeta;
	status?: OverviewStatus;
}

export interface OverviewBuilding {
	state: "building";
	session: string;
	status: OverviewStatus;
	snapshot: null;
}

export type OverviewResponse = OverviewSnapshot | OverviewBuilding;

export const overviewApi = {
	latest: () => api.get<OverviewResponse>("/api/overview"),
	status: () => api.get<OverviewStatus>("/api/overview/status"),
	refresh: () => api.post<OverviewStatus>("/api/overview/refresh", {}),
	cache: () => api.get<Record<string, unknown>>("/api/overview/cache"),
};
