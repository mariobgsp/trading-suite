/**
 * The compare-all engine types.
 *
 * The backend runs every strategy in STRATEGIES on one target over one period,
 * each through the same fee/slippage model, and reports its own walk-forward
 * flag. A strategy that fails returns a row with "error", never a failed
 * request.
 */

import { api } from "./transport";

export type Period = "6mo" | "1y" | "2y" | "5y";

export interface StrategyStats {
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
	time_in_market_pct: number;
	buyhold_return_pct: number;
	profit_factor: number | null;
	fees_pct: string;
}

export interface CurvePoint {
	date: string;
	value: number;
}

export interface WalkForward {
	is_return_pct: number;
	oos_return_pct: number;
	consistent: boolean;
}

export interface StrategyRow {
	strategy: string;
	label: string;
	kin: string;
	stats?: StrategyStats;
	walk_forward?: WalkForward | null;
	curve?: CurvePoint[] | null;
	time_in_market_pct?: number | null;
	error?: string;
	alpha_vs_index_pct: number | null;
}

export interface CompareResult {
	ticker: string;
	period: string;
	bars: number;
	index: string | null;
	strategies: StrategyRow[];
	hold_target: { curve: CurvePoint[] | null; total_pct: number | null };
	hold_index: { curve: CurvePoint[] | null; total_pct: number | null };
	fees: { fee_rate: number; slippage_rate: number; note: string };
	capital: number;
	cache?: {
		hit?: boolean;
		fresh?: boolean;
		age_seconds?: number;
		saved_at?: string | null;
	};
}

const COMPARE_TTL = 10 * 60_000;

export const compareApi = {
	/**
	 * Every strategy on one target. The dominant input is the ticker; the
	 * period defaults to 2y and capital to Rp10,000,000, matching the
	 * backend's order-ticket default.
	 */
	compare: (
		ticker: string,
		period: Period = "2y",
		capital = 10_000_000,
		force = false,
	) => {
		const code = encodeURIComponent(ticker.trim().toUpperCase());
		const extra = force ? "&force=1" : "";
		return api.getCached<CompareResult>(
			`/api/backtest/compare?ticker=${code}&period=${period}&capital=${capital}${extra}`,
			{ ttl: COMPARE_TTL },
		);
	},
};

/** Strategy rows with a valid stats block, sorted by total return. */
export function rankedRows(result: CompareResult | null): StrategyRow[] {
	if (!result) return [];
	return result.strategies
		.filter((row) => row.stats != null)
		.sort(
			(a, b) => (b.stats!.total_return_pct ?? 0) - (a.stats!.total_return_pct ?? 0),
		);
}

export function erroredRows(result: CompareResult | null): StrategyRow[] {
	if (!result) return [];
	return result.strategies.filter((row) => row.error);
}
