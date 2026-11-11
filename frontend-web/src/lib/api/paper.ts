/**
 * The paper book: what the method would have done, with nobody at the wheel.
 *
 * The backend fills these orders itself at each session's open, through the
 * fee model the tickets quote. Nothing here is edited by hand, which is the
 * point — a track record a person curates is not a track record.
 */

import { api } from "./transport";

export interface PaperFill {
	order_id: string;
	ticker: string;
	side: "BUY" | "SELL";
	date: string;
	price: number;
	shares: number;
	cash_delta: number;
	note: string;
}

export interface PaperPosition {
	ticker: string;
	shares: number;
	lots: number;
	entry_date: string;
	entry_price: number;
	last_price: number | null;
	priced_as_of: string | null;
	value_idr: number;
	unrealized_idr: number;
	unrealized_pct: number | null;
	stop: number | null;
	target: number | null;
	hold_bars: number | null;
	order_id: string;
}

export interface PaperTrade {
	ticker: string;
	entry_date: string;
	entry_price: number;
	exit_date: string;
	exit_price: number;
	shares: number;
	pnl_idr: number;
	return_pct: number | null;
	reason: string;
}

export interface PaperOrder {
	id: string;
	ticker: string;
	signal_session: string;
	fill_after: string;
	shares: number;
	stop: number | null;
	target: number | null;
	hold_bars: number | null;
	status: string;
	note: string;
}

export interface PaperSnapshot {
	hasBook: boolean;
	capital_idr?: number;
	cash_idr?: number;
	invested_idr?: number;
	equity_idr?: number;
	pnl_idr?: number;
	return_pct?: number | null;
	started?: string;
	settledThrough?: string | null;
	open_positions?: PaperPosition[];
	closed_trades?: PaperTrade[];
	fills?: PaperFill[];
	pending_orders?: PaperOrder[];
	stats?: {
		closed_count: number;
		open_count: number;
		win_rate_pct: number | null;
		avg_win_idr: number | null;
		avg_loss_idr: number | null;
		profit_factor: number | null;
		costs: { buy_fee_pct: number; sell_fee_pct: number; slippage_pct: number };
	};
}

export const getPaper = () =>
	api.getCached<PaperSnapshot>("/api/paper/state", { ttl: 60_000 });

export const settlePaper = () =>
	api.post<Record<string, unknown>>("/api/paper/settle", {});
