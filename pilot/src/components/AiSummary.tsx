import { useAiSummary } from "@/lib/useAiSummary";
import { Spinner } from "@/components/ui";

const LABELS: Record<string, string> = {
	launcher: "Desk AI Summary",
	overview: "Market AI Summary",
	markets: "Markets AI Summary",
	portfolio: "Portfolio AI Summary",
	backtest: "Backtest AI Summary",
	screener: "Screener AI Summary",
	validator: "Validator AI Summary",
	sentiment: "Sentiment AI Summary",
	regime: "Regime AI Summary",
};

/**
 * AI summary panel for one page. Generates on mount (when the user opens the
 * page) via the connected opencode-go / deepseek-v4-flash model; refreshes
 * on demand. Degrades gracefully while loading or on model failure.
 */
export default function AiSummary({
	page,
	ticker,
	className = "",
}: {
	page: keyof typeof LABELS;
	ticker?: string;
	className?: string;
}) {
	const { data, loading, error, refresh } = useAiSummary(page, ticker);

	return (
		<div className={`panel grid-texture p-4 ${className}`}>
			<div className="mb-2 flex items-center justify-between gap-3">
				<h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
					{LABELS[page] ?? "AI Summary"}
					{data?.model ? (
						<span className="ml-2 font-mono text-[10px] font-normal normal-case tracking-normal text-[var(--text-faint)]">
							{data.model}
						</span>
					) : null}
				</h2>
				<button
					onClick={() => void refresh()}
					disabled={loading}
					className="rounded-md bg-[var(--panel-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-dim)] transition-colors hover:text-[var(--accent)] disabled:opacity-50"
					title="Regenerate summary"
				>
					{loading ? "…" : "↻ Regenerate"}
				</button>
			</div>

			{loading && !data ? (
				<div className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
					<Spinner label="Analyzing live data…" />
				</div>
			) : error && !data ? (
				<p className="text-xs text-[var(--down)]">
					⚠ Summary unavailable ({error}) — press Regenerate to retry.
				</p>
			) : (
				<p className="text-sm leading-relaxed text-[var(--text-dim)]">
					{data?.summary}
				</p>
			)}
		</div>
	);
}
