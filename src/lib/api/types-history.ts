/** Market data: Quote, history, indicators, momentum. */

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
