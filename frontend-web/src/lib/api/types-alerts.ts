/** D-Signal alerts — scan output and per-ticker items. */

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
