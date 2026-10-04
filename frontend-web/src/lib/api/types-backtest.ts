/** Backtest result shape: trades, equity curve, stats, IS/OOS validation. */

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
