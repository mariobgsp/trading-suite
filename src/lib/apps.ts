/**
 * The 8 tools of the suite — single source of truth for the launcher
 * grid, the sidebar, and (future) search indexing.
 *
 * `viz` drives the decorative data preview rendered in each card header.
 * `endpoints` lists the live API surface behind each tool.
 */

export type AppViz =
	| { kind: "eq" }
	| { kind: "bars" }
	| { kind: "meters"; rows: { label: string; pct: number; dim?: boolean }[] }
	| {
			kind: "stat";
			value: string;
			unit: string;
			segments: { pct: number; locked?: boolean }[];
	  };

export interface AppMeta {
	/** Monospace index shown before the title. */
	num: string;
	/** Sidebar label. */
	name: string;
	/** One-line description (card body + search). */
	tagline: string;
	/** Unicode glyph used in the sidebar (launcher cards draw a real viz). */
	glyph: string;
	href: string;
	/** Badge in the viz header row. */
	badge?: string;
	/** Decorative data preview. */
	viz: AppViz;
	endpoints: string[];
}

export const APPS: AppMeta[] = [
	{
		num: "01",
		name: "Overview",
		tagline:
			"IHSG market dashboard — indices, watchlist, and the regime filter in one live view.",
		glyph: "◈",
		href: "/overview",
		badge: "LIVE",
		viz: { kind: "eq" },
		endpoints: [
			"/api/market/indices",
			"/api/market/quotes",
			"/api/regime/snapshot",
		],
	},
	{
		num: "02",
		name: "Markets",
		tagline:
			"Candlestick charts with SMA/EMA overlays, volume, and per-ticker history across 4 periods.",
		glyph: "▤",
		href: "/markets",
		badge: "OHLCV",
		viz: { kind: "bars" },
		endpoints: ["/api/market/history/{ticker}", "/api/market/quote/{ticker}"],
	},
	{
		num: "03",
		name: "Portfolio",
		tagline:
			"FIFO cost-basis ledger — positions, lots, cash, and realized P&L in IDR. Journal your trades.",
		glyph: "▤",
		href: "/portfolio",
		badge: "FIFO",
		viz: {
			kind: "meters",
			rows: [
				{ label: "BBCA", pct: 82 },
				{ label: "BBRI", pct: 54 },
				{ label: "TLKM", pct: 31, dim: true },
			],
		},
		endpoints: ["/api/portfolio/state", "/api/portfolio/journal"],
	},
	{
		num: "04",
		name: "Backtest",
		tagline:
			"Momentum, mean-reversion, and buy-and-hold strategies with equity curves and trade logs.",
		glyph: "↻",
		href: "/backtest",
		badge: "3 STRATEGIES",
		viz: {
			kind: "stat",
			value: "+38.2%",
			unit: "MOMENTUM · 1Y",
			segments: [{ pct: 78 }, { pct: 22, locked: true }],
		},
		endpoints: ["/api/backtest/{ticker}", "/api/backtest/strategies"],
	},
	{
		num: "05",
		name: "Screener",
		tagline:
			"Behavior, squeeze, and vault scans streamed live — ticker analysis with forced refresh.",
		glyph: "◫",
		href: "/screener",
		badge: "SSE STREAM",
		viz: {
			kind: "meters",
			rows: [
				{ label: "BEHAVIOR", pct: 100 },
				{ label: "SQUEEZE", pct: 64 },
				{ label: "VAULT", pct: 38, dim: true },
			],
		},
		endpoints: ["/api/screener/scan/stream", "/api/screener/analyze/{ticker}"],
	},
	{
		num: "06",
		name: "Validator",
		tagline:
			"Bandarmology validator — institutional flow, intent radar, and liquidity signals per ticker.",
		glyph: "◉",
		href: "/validator",
		badge: "BANDARMOLOGY",
		viz: {
			kind: "meters",
			rows: [
				{ label: "INST FLOW", pct: 72 },
				{ label: "INTENT", pct: 45, dim: true },
			],
		},
		endpoints: ["/api/validator/{ticker}"],
	},
	{
		num: "07",
		name: "Sentiment Radar",
		tagline:
			"News-driven sentiment scoring with category and tag filters — watch the tape, not the noise.",
		glyph: "◈",
		href: "/sentiment",
		badge: "▲ 12 ACTIVE",
		viz: { kind: "eq" },
		endpoints: ["/api/sentiment/news"],
	},
	{
		num: "08",
		name: "Regime & Bot",
		tagline:
			"Market regime via SMA/ATR/Hurst classification, IHSG history, and bot pipeline permissions.",
		glyph: "◮",
		href: "/regime",
		badge: "REGIME",
		viz: {
			kind: "stat",
			value: "BULL",
			unit: "SMA 20/50 · ATR",
			segments: [{ pct: 84 }, { pct: 16, locked: true }],
		},
		endpoints: ["/api/regime/snapshot", "/api/regime/history"],
	},
];
