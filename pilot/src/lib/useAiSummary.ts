import { useCallback, useEffect, useRef, useState } from "react";

export interface AiSummaryData {
	page: string;
	ticker?: string;
	summary: string;
	model: string;
	generated_at: string;
}

/**
 * Fetches the per-page AI summary from /api/summary/{page} (proxied to
 * FastAPI, which calls the connected opencode-go / deepseek-v4-flash model).
 * Refetches on mount + on manual refresh.
 */
export function useAiSummary(page: string, ticker?: string, enabled = true) {
	const [data, setData] = useState<AiSummaryData | null>(null);
	const [loading, setLoading] = useState(enabled);
	const [error, setError] = useState<string | null>(null);
	const seqRef = useRef(0);

	const load = useCallback(async () => {
		const seq = ++seqRef.current;
		setLoading(true);
		setError(null);
		try {
			const qs = new URLSearchParams();
			if (ticker) qs.set("ticker", ticker);
			const url = `/api/summary/${page}${qs.size ? `?${qs}` : ""}`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`summary ${res.status}`);
			const json = (await res.json()) as AiSummaryData;
			if (seq === seqRef.current) {
				setData(json);
				setLoading(false);
			}
		} catch (e) {
			if (seq === seqRef.current) {
				setError(e instanceof Error ? e.message : String(e));
				setLoading(false);
			}
		}
	}, [page, ticker]);

	useEffect(() => {
		if (!enabled) return;
		// Defer so the initial load isn't a synchronous setState inside the
		// effect body (react-hooks/set-state-in-effect); timer is cleared on
		// unmount so a late fetch never fires.
		const t = setTimeout(() => void load(), 0);
		return () => clearTimeout(t);
	}, [load, enabled]);

	return { data, loading, error, refresh: load };
}
