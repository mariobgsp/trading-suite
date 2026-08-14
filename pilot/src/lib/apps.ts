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
		// meters viz — distinct from Overview's eq bars; sentiment is a
		// distribution (positive / neutral / negative), not a waveform.
		viz: {
			kind: "meters",
			rows: [
				{ label: "POSITIVE", pct: 62 },
				{ label: "NEUTRAL", pct: 24, dim: true },
				{ label: "NEGATIVE", pct: 14 },
			],
		},
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
	{
		num: "09",
		name: "Foreign Flow",
		tagline:
			"Net foreign per stock and sector across the IDX universe — where institutional money moves.",
		glyph: "◭",
		href: "/foreignflow",
		badge: "IDX",
		viz: {
			kind: "meters",
			rows: [
				{ label: "NET INFLOW", pct: 72 },
				{ label: "NET OUTFLOW", pct: 28, dim: true },
			],
		},
		endpoints: ["/api/intel/foreign/universe", "/api/intel/foreign/{ticker}"],
	},
	{
		num: "10",
		name: "Broker Intel",
		tagline:
			"Market-wide broker accumulation radar plus per-ticker buyer/seller breakdown.",
		glyph: "◍",
		href: "/brokerintel",
		badge: "BROKSUM",
		viz: {
			kind: "bars",
		},
		endpoints: ["/api/intel/broker/radar", "/api/intel/broker/{ticker}"],
	},
	{
		num: "11",
		name: "Announcements",
		tagline:
			"Official IDX corporate disclosures, curated and readable — the pengumuman feed.",
		glyph: "▣",
		href: "/announcements",
		badge: "IDX FEED",
		viz: {
			kind: "stat",
			value: "IDX",
			unit: "DISCLOSURES",
			segments: [{ pct: 40 }, { pct: 60, locked: true }],
		},
		endpoints: ["/api/intel/announcements"],
	},
	{
		num: "12",
		name: "Calculators",
		tagline:
			"Position math for the desk — average price, sizing, risk/reward, and profit with fees.",
		glyph: "⚖",
		href: "/calculators",
		badge: "LOCAL",
		viz: {
			kind: "stat",
			value: "R",
			unit: "RISK MATH",
			segments: [{ pct: 50 }, { pct: 50, locked: true }],
		},
		endpoints: [],
	},
	{
		num: "13",
		name: "Sector Rotation",
		tagline:
			"Daily sector snapshots archived on the server — strength and rank shifts over 5 and 20 days.",
		glyph: "◫",
		href: "/sector-rotation",
		badge: "ROTATION",
		viz: {
			kind: "meters",
			rows: [
				{ label: "GAINING", pct: 70 },
				{ label: "FADING", pct: 34, dim: true },
			],
		},
		endpoints: ["/api/intel/rotation"],
	},
	{
		num: "14",
		name: "Stock Profiler",
		tagline:
			"One screen, the full picture — quote, beta, bandarmology, regime, and entry plan per ticker.",
		glyph: "◉",
		href: "/profiler",
		badge: "CONSOLIDATED",
		viz: {
			kind: "stat",
			value: "BBCA",
			unit: "PROFILE",
			segments: [{ pct: 62 }, { pct: 38, locked: true }],
		},
		endpoints: [
			"/api/market/quote/{ticker}",
			"/api/validator/{ticker}",
			"/api/analysis/entry/{ticker}",
		],
	},
	{
		num: "15",
		name: "Trade Journal",
		tagline:
			"Performance analytics over your FIFO ledger — win rate, profit factor, and monthly P&L.",
		glyph: "▤",
		href: "/journal",
		badge: "ANALYTICS",
		viz: {
			kind: "stat",
			value: "R",
			unit: "LEDGER STATS",
			segments: [{ pct: 55 }, { pct: 45, locked: true }],
		},
		endpoints: ["/api/portfolio/journal/stats"],
	},
	{
		num: "16",
		name: "MSCI Watch",
		tagline:
			"MSCI Indonesia constituents with live price and cap data — refreshed at each index review.",
		glyph: "◈",
		href: "/msci",
		badge: "INDEX",
		viz: {
			kind: "bars",
		},
		endpoints: ["/api/intel/msci"],
	},
	{
		num: "17",
		name: "Watchlist Intel",
		tagline:
			"Your watchlist with live quotes and a momentum + liquidity ranking.",
		glyph: "◫",
		href: "/watchlist",
		badge: "RANKED",
		viz: {
			kind: "meters",
			rows: [
				{ label: "MOMENTUM", pct: 74 },
				{ label: "LIQUIDITY", pct: 46, dim: true },
			],
		},
		endpoints: ["/api/portfolio/watchlist"],
	},
	{
		num: "18",
		name: "Ownership",
		tagline:
			"Shareholder structure straight from IDX — who controls the float and at what percentage.",
		glyph: "◍",
		href: "/ownership",
		badge: "IDX",
		viz: {
			kind: "stat",
			value: "IDX",
			unit: "OWNERSHIP",
			segments: [{ pct: 40 }, { pct: 60, locked: true }],
		},
		endpoints: ["/api/intel/ownership/{ticker}"],
	},
	{
		num: "19",
		name: "Wiki",
		tagline:
			"How the IDX works and what the signals mean — the desk manual for this suite.",
		glyph: "▣",
		href: "/wiki",
		badge: "EDU",
		viz: {
			kind: "eq",
		},
		endpoints: [],
	},
];
