/**
 * The single page is the whole app. This registry is the one source of truth
 * for section order, anchor ids, the index nav, and the API surface each
 * section is wired to. It deliberately imports no components so the layout can
 * render the nav without pulling the section modules into its graph.
 */
export const SECTIONS = [
	{
		id: "overview",
		num: "01",
		label: "Overview",
		endpoints: [
			"/api/market/indices",
			"/api/market/quotes",
			"/api/regime/snapshot",
		],
	},
	{
		id: "markets",
		num: "02",
		label: "Markets",
		endpoints: [
			"/api/market/history/{ticker}",
			"/api/market/quote/{ticker}",
			"/api/intel/foreign/universe",
		],
	},
	{
		id: "screener",
		num: "03",
		label: "Screener",
		endpoints: ["/api/screener/scan/stream", "/api/screener/analyze/{ticker}"],
	},
	{
		id: "profiler",
		num: "04",
		label: "Profiler",
		endpoints: [
			"/api/market/quote/{ticker}",
			"/api/market/history/{ticker}",
			"/api/analysis/entry/{ticker}",
			"/api/validator/{ticker}",
		],
	},
	{ id: "calculators", num: "05", label: "Calculators", endpoints: [] },
] as const;
