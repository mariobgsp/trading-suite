/**
 * Lean desk — 5 tools + launcher root.
 * Suspended is backend-only (no nav), foreign bars live inside Markets.
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
	num: string;
	name: string;
	tagline: string;
	glyph: string;
	href: string;
	badge?: string;
	group: "market" | "signals" | "desk";
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
			"Candlestick charts with SMA/EMA overlays, foreign flow bars, volume and LPM/Intensity.",
		glyph: "▤",
		href: "/markets",
		badge: "OHLCV",
		viz: { kind: "bars" },
		endpoints: [
			"/api/market/history/{ticker}",
			"/api/market/quote/{ticker}",
			"/api/intel/foreign/universe",
		],
	},
	{
		num: "03",
		group: "signals",
		name: "Screener",
		tagline:
			"Behavior, squeeze, and vault scans streamed live — suspended names excluded backend-only.",
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
		num: "04",
		group: "desk",
		name: "Profiler",
		tagline:
			"Per-ticker workup — quote, chart, entry, backtest, validator, broker and foreign flow in one view.",
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
			"/api/validator/{ticker}",
		],
	},
	{
		num: "05",
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
];
