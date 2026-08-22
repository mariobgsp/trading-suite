// DISMANTLED — AI summaries disabled. Stub hook returns idle state instantly.
export interface AiSummaryData {
	page: string;
	ticker?: string;
	summary: string;
	model: string;
	generated_at: string;
}

export function useAiSummary(_page: string, _ticker?: string, _enabled = true) {
	return { data: null as AiSummaryData | null, loading: false, error: null, refresh: async () => {} };
}
