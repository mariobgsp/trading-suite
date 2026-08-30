/**
 * Profiler orchestration — 7 polling feeds keyed on (ticker, analyzeNonce).
 *
 * The page only needs to manage `ticker` and call `analyze()` to refresh
 * every feed with `?force=true`. All 7 usePolling calls + their cacheKey
 * wiring live here; the page is left to render.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import type { Quote, HistoryResponse, RegimeSnapshot } from "@/lib/api";
import type {
	BetaResult,
	EntryPlan,
	PatternBacktest,
	ProfilerValidatorResult as ValidatorResult,
} from "@/lib/api/types-profiler";
import { usePolling } from "@/lib/usePolling";

export function useProfiler(initialTicker: string) {
	const [ticker, setTicker] = useState(initialTicker);
	const [analyzeNonce, setAnalyzeNonce] = useState(0);

	// Endpoints without a query string take "?force=true"; the history
	// endpoint already has ?period=6mo, so it takes "&force=true".
	const forceQ = analyzeNonce > 0 ? "?force=true" : "";
	const forceAmp = analyzeNonce > 0 ? "&force=true" : "";

	const quote = usePolling<Quote>(
		() => api.getCached<Quote>(`/api/market/quote/${ticker}${forceQ}`),
		30000,
		`${ticker}:${analyzeNonce}`,
		{ cacheKey: `/api/market/quote/${ticker}${forceQ}` },
	);
	const history = usePolling<HistoryResponse | null>(
		() =>
			api.getCached<HistoryResponse | null>(
				`/api/market/history/${ticker}?period=6mo${forceAmp}`,
			),
		null,
		`${ticker}:${analyzeNonce}`,
		{ cacheKey: `/api/market/history/${ticker}?period=6mo${forceAmp}` },
	);
	const beta = usePolling<BetaResult>(
		() => api.getCached<BetaResult>(`/api/market/beta/${ticker}${forceQ}`),
		60000,
		`${ticker}:${analyzeNonce}`,
		{ cacheKey: `/api/market/beta/${ticker}${forceQ}` },
	);
	const validator = usePolling<ValidatorResult | null>(
		() =>
			api.getCached<ValidatorResult | null>(`/api/validator/${ticker}${forceQ}`),
		60000,
		`${ticker}:${analyzeNonce}`,
		{ cacheKey: `/api/validator/${ticker}${forceQ}` },
	);
	const regime = usePolling<RegimeSnapshot>(
		() => api.getCached<RegimeSnapshot>("/api/regime/snapshot"),
		120000,
		"regime",
		{ cacheKey: "/api/regime/snapshot" },
	);
	const entry = usePolling<EntryPlan | null>(
		() =>
			api.getCached<EntryPlan | null>(`/api/analysis/entry/${ticker}${forceQ}`),
		120000,
		`${ticker}:${analyzeNonce}`,
		{ cacheKey: `/api/analysis/entry/${ticker}${forceQ}` },
	);
	const patterns = usePolling<PatternBacktest | null>(
		() =>
			api.getCached<PatternBacktest | null>(
				`/api/analysis/backtest/${ticker}${forceQ}`,
			),
		null,
		`${ticker}:${analyzeNonce}`,
		{ cacheKey: `/api/analysis/backtest/${ticker}${forceQ}` },
	);

	const analyze = () => setAnalyzeNonce((n) => n + 1);

	return {
		ticker,
		setTicker,
		analyze,
		feeds: { quote, history, beta, validator, regime, entry, patterns },
	};
}
