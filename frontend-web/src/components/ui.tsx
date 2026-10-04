import { fmtNum, fmtPct } from "@/lib/api";

/** Green/red price change chip — pill with tinted bg. */
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
		return <span className={`font-mono text-xs text-[var(--text-ghost)] ${className}`}>—</span>;
	}
	const up = value >= 0;
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${className} ${
				up
					? "border-[var(--up)]/25 bg-[var(--up-dim)] text-[var(--up)]"
					: "border-[var(--down)]/25 bg-[var(--down-dim)] text-[var(--down)]"
			}`}
		>
			<span className="text-[9px] leading-none">{up ? "▲" : "▼"}</span>
			{fmtPct(value)}
			{suffix}
		</span>
	);
}

/** KPI stat card — terminal panel, no shimmer. */
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
	const toneDot: Record<string, string> = {
		default: "bg-[var(--line)]",
		up: "bg-[var(--up)]",
		down: "bg-[var(--down)]",
		accent: "bg-[var(--accent)]",
	};
	return (
		<div className="panel group relative flex flex-col gap-1 p-[14px] font-mono">
			<div className="flex items-center gap-1.5">
				<span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]} opacity-70`} />
				<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">{label}</span>
			</div>
			<div className="tabular text-[20px] font-bold leading-none tracking-tight text-[var(--text)]" style={{ fontVariantNumeric: "tabular-nums" }}>
				{value}
			</div>
			{sub && <div className="line-clamp-2 text-[11px] leading-snug text-[var(--text-dim)]">{sub}</div>}
		</div>
	);
}

/** Section header — prompt style, instant. */
export function SectionHeader({
	title,
	subtitle,
	right,
	eyebrow,
}: {
	title: string;
	subtitle?: string;
	eyebrow?: string;
	right?: React.ReactNode;
}) {
	return (
		<div className="mb-5 flex flex-wrap items-end justify-between gap-4">
			<div className="min-w-0 font-mono">
				{eyebrow && <div className="mb-1 text-[11px] tracking-[0.16em] text-[var(--text-ghost)]">$ {eyebrow}</div>}
				<h1 className="text-balance text-[22px] font-bold leading-none tracking-tight text-[var(--text)] sm:text-[26px]">
					<span className="text-[var(--accent)]">&gt; </span>{title}
				</h1>
				{subtitle && <p className="mt-1.5 max-w-[60ch] text-pretty text-[12px] leading-relaxed text-[var(--text-dim)]"># {subtitle}</p>}
			</div>
			{right && <div className="shrink-0 font-mono">{right}</div>}
		</div>
	);
}

/** Terminal line — replaces Skeleton. Never blocks, just text. */
export function Skeleton({ className = "h-24" }: { className?: string }) {
	return (
		<div className={`flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 font-mono text-xs text-[var(--text-faint)] ${className}`}>
			<span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
			<span>loading…</span>
			<span className="ml-auto text-[10px] text-[var(--text-ghost)]">— terminal stream</span>
		</div>
	);
}

/** Inline terminal prompt — replaces spinner overlay. */
export function Spinner({ label }: { label?: string }) {
	return (
		<span className="inline-flex items-center gap-2 font-mono text-xs text-[var(--text-faint)]">
			<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
			{label ? <span className="text-[11px]">{label}</span> : <span>...</span>}
			<span className="inline-block h-3 w-1.5 animate-pulse bg-[var(--text-faint)]" />
		</span>
	);
}

/** Terminal line variant for table rows — instant placeholder. */
export function TermLine({ children }: { children: React.ReactNode }) {
	return <div className="font-mono text-xs leading-relaxed text-[var(--text-dim)]">{children}</div>;
}

export function NumCell({ value, digits = 0 }: { value: number | null | undefined; digits?: number }) {
	return <span className="tabular font-mono font-medium">{fmtNum(value, digits)}</span>;
}

export function MonoLabel({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">{children}</span>;
}
