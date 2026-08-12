import { fmtNum, fmtPct } from "@/lib/api";

/** Green/red price change chip. */
export function ChangeBadge({
	value,
	suffix = "",
	className = "",
}: {
	value: number | null | undefined;
	suffix?: string;
	className?: string;
}) {
	if (value == null || Number.isNaN(value)) {
		return <span className={`text-[var(--text-faint)] ${className}`}>—</span>;
	}
	const up = value >= 0;
	return (
		<span
			className={`font-mono text-xs font-semibold ${className} ${
				up ? "text-[var(--up)]" : "text-[var(--down)]"
			}`}
		>
			{up ? "▲" : "▼"} {fmtPct(value)}
			{suffix}
		</span>
	);
}

/** KPI stat card. */
export function StatCard({
	label,
	value,
	sub,
	tone = "default",
}: {
	label: string;
	value: React.ReactNode;
	sub?: React.ReactNode;
	tone?: "default" | "up" | "down" | "accent";
}) {
	const tones: Record<string, string> = {
		default: "text-[var(--text)]",
		up: "text-[var(--up)]",
		down: "text-[var(--down)]",
		accent: "text-[var(--accent)]",
	};
	return (
		<div className="panel p-4">
			<div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div className={`mt-1 font-mono text-xl font-bold ${tones[tone]}`}>
				{value}
			</div>
			{sub && (
				<div className="mt-0.5 text-xs text-[var(--text-dim)]">{sub}</div>
			)}
		</div>
	);
}

/** Section header with optional action slot. */
export function SectionHeader({
	title,
	subtitle,
	right,
}: {
	title: string;
	subtitle?: string;
	right?: React.ReactNode;
}) {
	return (
		<div className="mb-4 flex items-end justify-between">
			<div>
				<h1 className="text-xl font-bold tracking-tight text-[var(--text)]">
					{title}
				</h1>
				{subtitle && (
					<p className="mt-0.5 text-sm text-[var(--text-dim)]">{subtitle}</p>
				)}
			</div>
			{right}
		</div>
	);
}

/** Loading skeleton block. */
export function Skeleton({ className = "h-24" }: { className?: string }) {
	return <div className={`skeleton ${className}`} />;
}

/** Inline spinner. */
export function Spinner({ label }: { label?: string }) {
	return (
		<div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
			<span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
			{label}
		</div>
	);
}

/** Number cell for tables (mono, right-aligned). */
export function NumCell({
	value,
	digits = 0,
}: {
	value: number | null | undefined;
	digits?: number;
}) {
	return <span className="tabular font-mono">{fmtNum(value, digits)}</span>;
}
