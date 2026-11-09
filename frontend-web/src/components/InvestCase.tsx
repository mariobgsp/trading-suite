/**
 * Invest case — the selected name, asked twice.
 *
 * Fundamental and technical are separate sections because they fail
 * separately: a good business at a bad entry is still a bad entry, and the
 * app's evidence tiers are never blended. Each section is a small flow graph:
 * every criterion feeds one rail, the rail feeds the verdict. A criterion
 * with no measurement keeps its node and draws a dashed arm — the verdict's
 * coverage line says how many of the seven actually spoke.
 *
 * Below the two sections sit the two disclosure feeds the case carries: the
 * official IDX KI filings and the headlines that name the ticker.
 *
 * Codes: loading, error, fundamental_unavailable, technical_unavailable,
 * ownership_unavailable, trend_unknown, partial, empty.
 * N: ticker_selected — the sections mount only once Flow has a name.
 * N: case_api_reachable — every fetch is same-origin through the suite proxy.
 */

import { useEffect, useState } from "react";
import {
	caseApi,
	type CaseReport,
	type Criterion,
	type CriterionState,
	type Pillar,
	type PillarVerdict,
	type ShareStructure,
	type StakeTrend,
} from "@/lib/api/case";
import { usePlanRefreshSignal } from "@/lib/refresh";

const TONE: Record<CriterionState | PillarVerdict["state"], string> = {
	supportive: "var(--up)",
	caution: "var(--gold)",
	against: "var(--down)",
	unknown: "var(--text-ghost)",
	mixed: "var(--gold)",
	weak: "var(--down)",
};

const TREND_TONE: Record<StakeTrend, string> = {
	rising: "var(--up)",
	falling: "var(--down)",
	flat: "var(--gold)",
	unknown: "var(--text-ghost)",
};

const TREND_GLYPH: Record<StakeTrend, string> = {
	rising: "↑",
	falling: "↓",
	flat: "→",
	unknown: "—",
};

export default function InvestCase({ ticker }: { ticker: string }) {
	const nonce = usePlanRefreshSignal();
	const [report, setReport] = useState<CaseReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		setError(null);
		caseApi
			.assess(ticker)
			.then((data) => alive && setReport(data))
			.catch((err: Error) => alive && setError(err.message))
			.finally(() => alive && setLoading(false));
		return () => {
			alive = false;
		};
	}, [ticker, nonce]);

	return (
		<section className="mt-10 border-t border-[var(--border)] pt-7">
			<div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<div>
					<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
						Invest case
					</p>
					<h2 className="mt-2 font-display text-[24px] leading-none tracking-[-0.01em] text-[var(--text)]">
						{ticker} — how valid is an investment?
					</h2>
				</div>
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					{report
						? `bars ${report.as_of}${report.name ? ` · ${report.name}` : ""}`
						: loading
							? "reading the company, the register and the tape…"
							: ""}
				</span>
			</div>
			<p className="mb-5 max-w-[80ch] text-[13px] leading-relaxed text-[var(--text-faint)]">
				Two questions, answered separately: is the business worth owning, and is
				the tape willing to pay for it? Each criterion is a measurement against a
				written band. The verdict counts those measurements; it predicts nothing.
			</p>

			{error && (
				<p className="border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-dim)]">
					The case backend is not answering: {error}
				</p>
			)}

			{!error && loading && !report && (
				<p className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[12px] text-[var(--text-faint)]">
					Reading the company and the tape…
				</p>
			)}

			{report && (
				<>
					<div className="grid items-start gap-5 lg:grid-cols-2">
						<PillarCard pillar={report.fundamental} structure={report.ownership} />
						<PillarCard pillar={report.technical} />
					</div>

					<div className="mt-6 grid items-start gap-5 lg:grid-cols-2">
						<FeedCard
							eyebrow="IDX KI"
							title="Keterbukaan informasi"
							available={report.disclosures.available}
							count={report.disclosures.items.length}
							warnings={report.disclosures.warnings}
						>
							{report.disclosures.items.map((item) => (
								<li key={(item.link ?? "") + item.title} className="py-2 first:pt-0 last:pb-0">
									<div className="flex items-baseline gap-2">
										<span className="shrink-0 font-mono text-[9px] text-[var(--text-ghost)]">
											{item.date.slice(0, 10)}
										</span>
										<ItemTitle title={item.title} link={item.link} />
									</div>
									{item.category && (
										<div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
											{item.category}
										</div>
									)}
								</li>
							))}
						</FeedCard>

						<FeedCard
							eyebrow="Headlines"
							title="News"
							available={report.news.available}
							count={report.news.items.length}
							warnings={report.news.warnings}
						>
							{report.news.items.map((item) => (
								<li key={(item.link ?? "") + item.title} className="py-2 first:pt-0 last:pb-0">
									<div className="flex items-baseline gap-2">
										<span className="shrink-0 font-mono text-[9px] text-[var(--text-ghost)]">
											{item.date_str || item.date.slice(0, 10)}
										</span>
										<ItemTitle title={item.title} link={item.link} />
									</div>
									{item.source && (
										<div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
											{item.source}
										</div>
									)}
								</li>
							))}
						</FeedCard>
					</div>
				</>
			)}
		</section>
	);
}

function PillarCard({
	pillar,
	structure,
}: {
	pillar: Pillar;
	structure?: ShareStructure;
}) {
	return (
		<article className="min-w-0 border border-[var(--border)] bg-[var(--panel)] p-4">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-ghost)]">
						{pillar.name}
					</p>
					<h3 className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
						{pillar.label} validity
					</h3>
				</div>
				<VerdictBadge verdict={pillar.verdict} />
			</header>

			<p className="mt-1.5 font-mono text-[10px] text-[var(--text-ghost)]">
				{pillar.verdict.measured} of {pillar.verdict.total} criteria measured
			</p>

			{structure && <ShareStrip structure={structure} />}

			{!pillar.available && (
				<p className="mt-3 border-l-2 border-[var(--gold)] pl-2 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
					No {pillar.name} measurement came back —{" "}
					{pillar.warnings[0] ?? "the source did not answer."}
				</p>
			)}

			{pillar.criteria.length > 0 ? (
				<CriteriaGraph criteria={pillar.criteria} verdict={pillar.verdict} />
			) : (
				!pillar.available || (
					<p className="mt-4 border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
						No measurements for this name.
					</p>
				)
			)}

			{pillar.available && pillar.warnings.length > 0 && (
				<ul className="mt-3 space-y-1 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
					{pillar.warnings.map((warning) => (
						<li key={warning}>· {warning}</li>
					))}
				</ul>
			)}
		</article>
	);
}

function VerdictBadge({ verdict }: { verdict: PillarVerdict }) {
	const color = TONE[verdict.state];
	return (
		<span
			className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
			style={{
				color,
				borderColor: color,
				background: "color-mix(in srgb, currentColor 8%, transparent)",
			}}
		>
			{verdict.state}
		</span>
	);
}

function CriteriaGraph({
	criteria,
	verdict,
}: {
	criteria: Criterion[];
	verdict: PillarVerdict;
}) {
	return (
		<div className="case-graph mt-4">
			{criteria.map((criterion, index) => (
				<div
					key={criterion.key}
					title={criterion.detail}
					className="min-w-0 border border-[var(--border)] border-l-2 bg-[var(--panel-2)] px-2 py-1.5"
					style={{
						gridColumn: 1,
						gridRow: index + 1,
						borderLeftColor: TONE[criterion.state],
					}}
				>
					<div className="flex items-baseline justify-between gap-2">
						<span className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-ghost)]">
							{criterion.label}
						</span>
						<span
							className="tabular shrink-0 font-mono text-[11px]"
							style={{ color: TONE[criterion.state] }}
						>
							{criterion.display}
						</span>
					</div>
				</div>
			))}

			{criteria.map((criterion, index) => (
				<span
					key={criterion.key + "-arm"}
					aria-hidden="true"
					style={{
						gridColumn: 2,
						gridRow: index + 1,
						alignSelf: "center",
						borderTop: `1px ${
							criterion.state === "unknown" ? "dashed" : "solid"
						} var(--border-strong)`,
					}}
				/>
			))}

			<div
				style={{ gridColumn: 3, gridRow: `1 / span ${criteria.length}` }}
				className="flex items-center border-l border-[var(--border-strong)] pl-2"
			>
				<VerdictNode verdict={verdict} />
			</div>
		</div>
	);
}

function VerdictNode({ verdict }: { verdict: PillarVerdict }) {
	const color = TONE[verdict.state];
	return (
		<div
			className="w-full border bg-[var(--panel-2)] p-2 text-center"
			style={{ borderColor: color }}
		>
			<div
				className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
				style={{ color }}
			>
				{verdict.state}
			</div>
			<div className="mt-1 font-mono text-[9px] leading-snug text-[var(--text-ghost)]">
				{verdict.supportive} for · {verdict.caution} caution
				<br />
				{verdict.against} against · {verdict.unknown} unknown
			</div>
		</div>
	);
}

function ShareStrip({ structure }: { structure: ShareStructure }) {
	if (!structure.available) {
		return (
			<div className="mt-3">
				<p className="border-l-2 border-[var(--gold)] pl-2 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
					Share structure unavailable —{" "}
					{structure.warnings[0] ?? "the IDX register did not answer."}
				</p>
				{structure.shares_outstanding != null && (
					<p className="mt-1 font-mono text-[10px] text-[var(--text-ghost)]">
						shares outstanding {fmtShares(structure.shares_outstanding)}
						{structure.total_source ? ` (${structure.total_source})` : ""}
					</p>
				)}
			</div>
		);
	}

	const cells: { label: string; value: string; sub: string; title?: string }[] = [
		{
			label: "Shares out",
			value: fmtShares(structure.shares_outstanding),
			sub: structure.total_source ?? "—",
		},
		{
			label: "Controlling",
			value: fmtShares(structure.owner_shares),
			sub: fmtLevel(structure.owner_pct),
		},
		{
			label: "Public float",
			value: fmtShares(structure.public_shares),
			sub: fmtLevel(structure.public_pct),
			title: "outstanding minus the holders IDX flags as controlling",
		},
	];

	return (
		<div className="mt-3">
			<div className="grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
				{cells.map((cell) => (
					<div
						key={cell.label}
						className="min-w-0 bg-[var(--panel)] px-2.5 py-2"
						title={cell.title}
					>
						<div className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-ghost)]">
							{cell.label}
						</div>
						<div className="tabular mt-0.5 font-mono text-[13px] text-[var(--text)]">
							{cell.value}
						</div>
						<div className="tabular truncate font-mono text-[10px] text-[var(--text-ghost)]">
							{cell.sub}
						</div>
					</div>
				))}
				<div
					className="min-w-0 bg-[var(--panel)] px-2.5 py-2"
					title={structure.trend_detail || undefined}
				>
					<div className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-ghost)]">
						Stake trend
					</div>
					<div
						className="tabular mt-0.5 font-mono text-[13px]"
						style={{ color: TREND_TONE[structure.trend] }}
					>
						{TREND_GLYPH[structure.trend]} {structure.trend}
					</div>
					<div className="tabular truncate font-mono text-[10px] text-[var(--text-ghost)]">
						{trendSub(structure)}
					</div>
				</div>
			</div>
			{structure.trend_detail && (
				<p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
					{structure.trend_detail}
				</p>
			)}
		</div>
	);
}

function FeedCard({
	eyebrow,
	title,
	available,
	count,
	warnings,
	children,
}: {
	eyebrow: string;
	title: string;
	available: boolean;
	count: number;
	warnings: string[];
	children: React.ReactNode;
}) {
	const empty = !available || count === 0;
	return (
		<section className="min-w-0 border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="flex items-baseline justify-between gap-2">
				<div>
					<p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-ghost)]">
						{eyebrow}
					</p>
					<h3 className="mt-1 text-[14px] font-semibold text-[var(--text)]">{title}</h3>
				</div>
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					{available ? `${count} item${count === 1 ? "" : "s"}` : "unavailable"}
				</span>
			</div>
			{empty ? (
				<p className="mt-3 border border-[var(--border)] bg-[var(--panel-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-faint)]">
					{available ? "Nothing in the window." : (warnings[0] ?? "The feed did not answer.")}
				</p>
			) : (
				<ul className="mt-3 max-h-[300px] divide-y divide-[var(--border)] overflow-auto">
					{children}
				</ul>
			)}
		</section>
	);
}

function ItemTitle({ title, link }: { title: string; link: string | null }) {
	if (!link) {
		return (
			<span className="min-w-0 text-[12px] leading-snug text-[var(--text-dim)]">{title}</span>
		);
	}
	return (
		<a
			href={link}
			target="_blank"
			rel="noreferrer"
			className="min-w-0 text-[12px] leading-snug text-[var(--text-dim)] underline-offset-2 hover:text-[var(--text)] hover:underline"
		>
			{title}
		</a>
	);
}

function trendSub(structure: ShareStructure): string {
	if (structure.snapshots < 2) return "needs 2 snapshots";
	if (structure.delta_pp != null) {
		const sign = structure.delta_pp > 0 ? "+" : "";
		return `${sign}${structure.delta_pp.toFixed(2)} pp`;
	}
	return `${structure.snapshots} snapshots`;
}

function fmtLevel(value: number | null): string {
	if (value == null || Number.isNaN(value)) return "—";
	return `${value.toFixed(2)}%`;
}

function fmtShares(value: number | null): string {
	if (value == null || Number.isNaN(value)) return "—";
	if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(2)} T`;
	if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)} M`;
	if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)} Jt`;
	return Math.round(value).toLocaleString("id-ID");
}
