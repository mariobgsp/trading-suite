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
	/** Sidebar section this tool belongs to. */
	group: "market" | "signals" | "flow" | "desk";
	/** Decorative data preview. */
	viz: AppViz;
	endpoints: string[];
}

export const APPS: AppMeta[] = [
	{
		num: "01",
		group: "market",
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
		group: "market",
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
		group: "desk",
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
		group: "desk",
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
		group: "signals",
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
		group: "desk",
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
		group: "market",
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
		group: "desk",
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
		group: "signals",
		name: "D-Signal",
		tagline:
			"BidBot-style market scan — premium oversold accumulation, breakouts, morning spikes, full MA ladders, grouped per signal.",
		glyph: "⚡",
		href: "/alerts",
		badge: "SCAN",
		viz: { kind: "bars" },
		endpoints: ["/api/alerts"],
	},
	{
		num: "10",
		group: "flow",
		name: "Konglo Map",
		tagline:
			"IDX tickers rolled up per conglomerate family — average move and aggregate net foreign flow per konglo group.",
		glyph: "⌘",
		href: "/konglo",
		badge: "FLOW",
		viz: { kind: "eq" },
		endpoints: ["/api/intel/konglo"],
	},
	{
		num: "11",
		group: "signals",
		name: "Sector Rotation",
		tagline:
			"Relative-strength ranks with movers per sector and valid-accumulation watch — silent volume before the run.",
		glyph: "⟳",
		href: "/rotation",
		badge: "ROTATE",
		viz: {
			kind: "meters",
			rows: [
				{ label: "BANK", pct: 72 },
				{ label: "ENERGI", pct: 48, dim: true },
			],
		},
		endpoints: ["/api/intel/rotation"],
	},
	{
		num: "12",
		group: "flow",
		name: "Ownership",
		tagline:
			"Shareholder register from IDX disclosures — stakes, concentration stats, and cross-issuer holder lookup.",
		glyph: "◉",
		href: "/ownership",
		badge: "IDX",
		viz: {
			kind: "stat",
			value: "54.8%",
			unit: "TOP HOLDER · Σ DISCLOSED",
			segments: [{ pct: 55 }, { pct: 45, locked: true }],
		},
		endpoints: ["/api/intel/ownership/{ticker}", "/api/intel/owner/holdings"],
	},
	{
		num: "13",
		group: "market",
		name: "Watchlist",
		tagline:
			"Live quotes for your saved tickers — scores, signals, and one-tap edits.",
		glyph: "★",
		href: "/watchlist",
		badge: "LIVE",
		viz: { kind: "eq" },
		endpoints: ["/api/portfolio/watchlist"],
	},
	{
		num: "14",
		group: "market",
		name: "Profiler",
		tagline:
			"Full per-ticker workup — quote, entry plan, backtest, beta, validator, broker and regime context in one view.",
		glyph: "◎",
		href: "/profiler",
		badge: "DEEP",
		viz: {
			kind: "meters",
			rows: [
				{ label: "ENTRY", pct: 66 },
				{ label: "RISK", pct: 24, dim: true },
			],
		},
		endpoints: [
			"/api/market/quote/{ticker}",
			"/api/market/history/{ticker}",
			"/api/analysis/entry/{ticker}",
		],
	},
	{
		num: "15",
		group: "flow",
		name: "Foreign Flow",
		tagline:
			"Universe-wide net foreign flow split buy/sell, with per-ticker drill-down.",
		glyph: "⇄",
		href: "/foreignflow",
		badge: "FLOW",
		viz: { kind: "bars" },
		endpoints: ["/api/intel/foreign/universe"],
	},
	{
		num: "16",
		group: "flow",
		name: "Broker Intel",
		tagline:
			"Broker radar ranked by value plus per-ticker broker breakdown — honest foreign labeling.",
		glyph: "▦",
		href: "/brokerintel",
		badge: "RADAR",
		viz: { kind: "eq" },
		endpoints: ["/api/intel/broker/radar"],
	},
	{
		num: "17",
		group: "flow",
		name: "Announcements",
		tagline: "Latest IDX issuer disclosures as they land.",
		glyph: "≡",
		href: "/announcements",
		badge: "IDX",
		viz: { kind: "eq" },
		endpoints: ["/api/intel/announcements"],
	},
	{
		num: "18",
		group: "flow",
		name: "MSCI Watch",
		tagline: "MSCI index membership tracker — who is in, who is missing.",
		glyph: "◇",
		href: "/msci",
		badge: "INDEX",
		viz: {
			kind: "stat",
			value: "IN",
			unit: "MEMBERS TRACKED",
			segments: [{ pct: 80 }, { pct: 20, locked: true }],
		},
		endpoints: ["/api/intel/msci"],
	},
	{
		num: "19",
		group: "desk",
		name: "Journal",
		tagline:
			"Trade journal stats — win rate, profit factor, monthly P&L scoreboard.",
		glyph: "✎",
		href: "/journal",
		badge: "LOG",
		viz: {
			kind: "stat",
			value: "58%",
			unit: "WIN RATE · ALL TRADES",
			segments: [{ pct: 58 }, { pct: 42, locked: true }],
		},
		endpoints: ["/api/portfolio/journal/stats"],
	},
	{
		num: "20",
		group: "desk",
		name: "Calculators",
		tagline:
			"Position sizing, risk-per-trade, fee and break-even math — pure client-side.",
		glyph: "∑",
		href: "/calculators",
		badge: "MATH",
		viz: {
			kind: "meters",
			rows: [
				{ label: "SIZE", pct: 50 },
				{ label: "RISK", pct: 20, dim: true },
			],
		},
		endpoints: [],
	},
	{
		num: "21",
		group: "desk",
		name: "Playbook",
		tagline:
			"The desk manual — strategy notes, discipline rules, and how the tools fit together.",
		glyph: "❑",
		href: "/wiki",
		badge: "DOC",
		viz: { kind: "eq" },
		endpoints: [],
	},
];
