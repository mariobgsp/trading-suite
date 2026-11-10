/**
 * The Deep Dive tab's visual vocabulary.
 *
 * The two verdict panels are the core: the fundamental question and the
 * technical question are asked separately and answered separately, because a
 * good business at a bad moment and a bad business on a good tape are both
 * real. Nothing in this file merges the two counts into one score.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { fmtNum } from "@/lib/api";
import type { PlanDetail, Gate, GateKey } from "@/lib/api/plan";
import type { TickerProfile } from "@/lib/api/market";
import type {
	CaseReport,
	Criterion,
	ShareStructure,
} from "@/lib/api/case";
import type { RankedRow } from "@/lib/api/plan";
import { ChangeBadge } from "@/components/ui";
import { GATE_LABEL, idr } from "@/components/plan";

const TONE: Record<string, string> = {
	supportive: "var(--up)",
	calibrated: "var(--up)",
	caution: "var(--gold)",
	mixed: "var(--gold)",
	against: "var(--down)",
	weak: "var(--down)",
	unknown: "var(--text-ghost)",
};

export function fmtIdrShort(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value) || value <= 0) return "—";
	if (value >= 1e15) return "Rp " + (value / 1e15).toFixed(1) + " Kuad";
	if (value >= 1e12) return "Rp " + (value / 1e12).toFixed(2) + " T";
	if (value >= 1e9) return "Rp " + (value / 1e9).toFixed(1) + " M";
	return "Rp " + Math.round(value).toLocaleString("id-ID");
}

// ── ticker search ────────────────────────────────────────────────────────

export function TickerSearch({
	ranked,
	onPick,
}: {
	ranked: RankedRow[];
	onPick: (ticker: string) => void;
}) {
	const [query, setQuery] = useState("");
	const navigate = useNavigate();

	const matches = useMemo(() => {
		const q = query.trim().toUpperCase();
		if (!q) return [];
		return ranked
			.filter((row) => row.ticker.includes(q))
			.sort((a, b) => a.ticker.length - b.ticker.length || b.rs_rating - a.rs_rating)
			.slice(0, 8);
	}, [query, ranked]);

	const exact = query.trim().toUpperCase().replace(/[^A-Z]/g, "");
	function submit() {
		const candidate = matches.length > 0 ? matches[0]!.ticker : exact;
		if (candidate.length >= 3) {
			navigate({ to: "/deep/" + candidate });
			onPick(candidate);
			setQuery("");
		}
	}

	return (
		<div className="relative">
			<input
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") submit();
				}}
				placeholder="Cari kode saham — BBCA, TLKM, …"
				aria-label="Cari saham"
				className="w-full border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-2 font-mono text-[13px] text-[var(--text)] placeholder:text-[var(--text-ghost)] focus:outline-none"
			/>
			{matches.length > 0 && (
				<ul className="absolute left-0 right-0 top-full z-30 mt-1 border border-[var(--border)] bg-[var(--panel)] shadow-[0_1px_0_var(--border)]">
					{matches.map((row) => (
						<li
							key={row.ticker}
							className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] px-3 py-1.5 font-mono text-[11px] last:border-b-0 hover:bg-[var(--panel-3)]"
						>
							<button
								type="button"
								onClick={() => {
									navigate({ to: "/deep/" + row.ticker });
									onPick(row.ticker);
									setQuery("");
								}}
								className="flex min-w-0 flex-1 items-baseline justify-between gap-3 text-left"
							>
								<span className="font-semibold text-[var(--text)]">{row.ticker}</span>
								<span className="flex items-baseline gap-3 text-[var(--text-faint)]">
									<span className="tabular">{idr(row.close)}</span>
									<span>RS {row.rs_rating}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

// ── header ───────────────────────────────────────────────────────────────

export function DeepHeader({
	code,
	profile,
	changeFromHistory,
}: {
	code: string;
	profile: TickerProfile | null;
	changeFromHistory?: number | null;
}) {
	const price =
		profile?.price != null ? (profile.price as number) : null;
	const change = profile?.change_percent ?? changeFromHistory ?? null;
	const chips = [
		profile?.sector ? "Sektor: " + profile.sector : null,
		profile?.industry ? "Industri: " + profile.industry : null,
		profile?.market_cap != null
			? "Kap. pasar " + fmtIdrShort(profile.market_cap)
			: null,
		profile?.quote_live ? null : "pondasi dari scan harian",
	].filter(Boolean) as string[];
	return (
		<header className="border-b border-[var(--border)] pb-6">
			<div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
				<h1 className="font-display text-[44px] leading-none tracking-[-0.02em] text-[var(--text)]">
					{code}
				</h1>
				{profile?.name && (
					<span className="max-w-[34ch] truncate font-mono text-[12px] text-[var(--text-faint)]">
						{profile.name}
					</span>
				)}
				<span className="tabular ml-auto font-display text-[24px] text-[var(--text)]">
					{price != null ? idr(price) : "—"}
				</span>
				<ChangeBadge value={change} />
			</div>
			<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--text-ghost)]">
				{chips.map((chip) => (
					<span key={chip} className="border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5">
						{chip}
					</span>
				))}
				{!profile && (
					<span>membaca identitas…</span>
				)}
			</div>
		</header>
	);
}

// ── the two verdicts ─────────────────────────────────────────────────────

export function FundamentalVerdict({
	caseReport,
}: {
	caseReport: CaseReport | null;
}) {
	const pillar = caseReport?.fundamental ?? null;
	if (!caseReport || !pillar) {
		return (
			<VerdictFrame
				title="Layak secara fundamental?"
				verdictText="mengukur…"
				tone="unknown"
			>
				<p className="p-3 font-mono text-[12px] text-[var(--text-faint)]">
					Kas investasi sedang dirakit (profil, kepemilikan, pengungkapan).
				</p>
			</VerdictFrame>
		);
	}
	const counts = pillar.verdict;
	const sentence = verdictSentence(counts.state, counts.supportive, counts.against, counts.measured);
	return (
		<VerdictFrame
			title="Layak trade secara fundamental?"
			verdictText={counts.state}
			tone={TONE[counts.state] ?? "unknown"}
		>
			<p className="px-4 pb-1 font-mono text-[11px] text-[var(--text-faint)]">
				{sentence} · {counts.measured}/{counts.total} kriteria terukur
			</p>
			<CriteriaList criteria={pillar.criteria} />
			{pillar.warnings.length > 0 && (
				<ul className="mx-3 mb-3 space-y-1 border-t border-[var(--border)] pt-2 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
					{pillar.warnings.map((warning) => (
						<li key={warning}>· {warning}</li>
					))}
				</ul>
			)}
			{caseReport.ownership.available && caseReport.ownership && (
				<OwnershipStrip structure={caseReport.ownership} />
			)}
		</VerdictFrame>
	);
}

export function TechnicalVerdict({
	detail,
	requiredGates,
	technicalCriteria,
}: {
	detail: PlanDetail | null;
	requiredGates: GateKey[] | undefined;
	technicalCriteria: Criterion[];
}) {
	if (!detail) {
		return (
			<VerdictFrame
				title="Layak trade secara teknikal?"
				verdictText="mengukur…"
				tone="unknown"
			>
				<p className="p-3 font-mono text-[12px] text-[var(--text-faint)]">
					Chain kondisi diukur pada bar terakhir yang utuh.
				</p>
			</VerdictFrame>
		);
	}
	const passed = detail.gates.filter((gate) => gate.passed).length;
	const applies = requiredGates ? new Set(requiredGates) : null;
	const failingRequired = detail.gates.filter(
		(gate) => !gate.passed && (!applies || applies.has(gate.key)),
	).length;
	const state:
		| "supportive"
		| "caution"
		| "against"
		| "unknown" = detail.in_plan
		? "supportive"
		: failingRequired > 0
			? passingMost(detail.gates)
				? "caution"
				: "against"
			: "caution";
	return (
		<VerdictFrame
			title="Layak trade secara teknikal?"
			verdictText={detail.in_plan ? "buyable" : "belum"}
			tone={state === "supportive" ? "var(--up)" : state === "caution" ? "var(--gold)" : "var(--down)"}
		>
			<p className="px-4 pb-1 font-mono text-[11px] text-[var(--text-faint)]">
				{passed}/{detail.gates.length} kondisi metode terpenuhi
				{detail.in_plan
					? " — rantai penuh terbuka malam ini"
					: " — " + (detail.distance_text ?? failingRequired + " kondisi belum lolos")}
			</p>
			{technicalCriteria.length > 0 && (
				<div className="mx-3 mb-2 flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-2">
					{technicalCriteria.map((criterion) => (
						<span
							key={criterion.key}
							title={criterion.detail}
							className="border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-0.5 font-mono text-[10px]"
							style={{ color: TONE[criterion.state] ?? "var(--text-dim)" }}
						>
							{criterion.label} {criterion.display}
						</span>
					))}
				</div>
			)}
			{detail.gates.length > 0 ? (
				<GateMiniList gates={detail.gates} required={requiredGates} />
			) : (
				<p className="mx-3 mb-3 font-mono text-[12px] text-[var(--text-faint)]">
					Riwayat terlalu pendek untuk mengukur rantai metode terhadap saham ini.
				</p>
			)}
			{detail.in_plan && detail.geometry && (
				<div className="mx-3 mb-3 border border-[var(--border)] bg-[var(--panel-2)] p-3">
					<p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
						Geometri perdagangan (tetap milik metode, bukan panel ini)
					</p>
					<div className="mt-2 grid grid-cols-3 gap-3 font-mono text-[12px]">
						<span>
							<span className="block text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
								Entry
							</span>
							{idr(detail.geometry.entry_ref)}
						</span>
						<span style={{ color: "var(--up)" }}>
							<span className="block text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
								Target
							</span>
							{idr(detail.geometry.target_price)}
						</span>
						<span style={{ color: "var(--down)" }}>
							<span className="block text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
								Stop
							</span>
							{idr(detail.geometry.stop_price)}
						</span>
					</div>
					<p className="mt-2 border-t border-[var(--border)] pt-2 font-mono text-[10px] text-[var(--text-ghost)]">
						Tiket penuh (ukuran, biaya) ada di layar Plan untuk nama yang termasuk
						dalam rencana malam ini.
					</p>
				</div>
			)}
		</VerdictFrame>
	);
}

function passingMost(gates: Gate[]): boolean {
	if (gates.length === 0) return false;
	return gates.filter((gate) => !gate.passed).length <= Math.floor(gates.length / 2);
}

function verdictSentence(state: string, supportive: number, against: number, measured: number): string {
	if (measured < 3) return "Terlalu sedikit yang terukur untuk bilang apa-apa";
	if (state === "supportive") return supportive + " kriteria mendukung, tidak ada yang melawan";
	if (state === "weak") return against + " kriteria melawan — kasus lemah menurut pita yang tertulis";
	if (state === "mixed") return "bauran: " + supportive + " mendukung, " + against + " melawan";
	return "kaum terukur";
}

export function VerdictFrame({
	title,
	verdictText,
	tone,
	children,
}: {
	title: string;
	verdictText: string;
	tone: string;
	children: React.ReactNode;
}) {
	return (
		<article className="flex min-w-0 flex-col border border-[var(--border)] bg-[var(--panel)]">
			<header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
				<h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
					{title}
				</h3>
				<span
					className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
					style={{ color: tone, borderColor: tone }}
				>
					{verdictText}
				</span>
			</header>
			{children}
		</article>
	);
}

function CriteriaList({ criteria }: { criteria: Criterion[] }) {
	if (criteria.length === 0) {
		return (
			<p className="mx-3 mb-3 border border-[var(--border)] bg-[var(--panel-2)] p-3 font-mono text-[11px] text-[var(--text-faint)]">
				Tidak ada pengukuran yang kembali dari sumber data.
			</p>
		);
	}
	return (
		<ul className="m-3 space-y-1">
			{criteria.map((criterion) => (
				<li
					key={criterion.key}
					title={criterion.detail}
					className="flex items-baseline justify-between gap-3 border-l-2 bg-[var(--panel-2)] px-2 py-1.5"
					style={{ borderLeftColor: TONE[criterion.state] ?? "var(--text-ghost)" }}
				>
					<span className="min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-ghost)]">
						{criterion.label}
					</span>
					<span
						className="tabular shrink-0 font-mono text-[11px]"
						style={{ color: TONE[criterion.state] ?? "var(--text-dim)" }}
					>
						{criterion.display}
					</span>
				</li>
			))}
		</ul>
	);
}

function OwnershipStrip({ structure }: { structure: ShareStructure }) {
	return (
		<div className="mx-3 mb-3 border-t border-[var(--border)] pt-2 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
			<span className="text-[var(--text-ghost)]">Struktur saham: </span>
			{fmtIdrShort(structure.shares_outstanding)} lembar
			{structure.public_pct != null
				? " · float publik " + fmtNum(structure.public_pct, 1) + "%"
				: ""}
			{structure.owner_pct != null
				? " · pengendali " + fmtNum(structure.owner_pct, 1) + "%"
				: ""}
			{structure.trend !== "unknown" && structure.delta_pp != null
				? " · tren kepemilikan " +
					structure.trend +
					" (" +
					(structure.delta_pp >= 0 ? "+" : "") +
					fmtNum(structure.delta_pp, 2) +
					"pp antara " +
					(structure.from_date ?? "—") +
					" → " +
					(structure.to_date ?? "—") +
					")"
				: ""}
		</div>
	);
}

function GateMiniList({
	gates,
	required,
}: {
	gates: Gate[];
	required?: GateKey[];
}) {
	const applies = required ? new Set(required) : null;
	return (
		<ul className="m-3 space-y-1">
			{gates.map((gate) => {
				const isRequired = applies ? applies.has(gate.key) : true;
				return (
					<li
						key={gate.key}
						className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] pb-1 last:border-b-0"
						style={isRequired ? undefined : { opacity: 0.55 }}
					>
						<span className="flex min-w-0 items-baseline gap-2">
							<span
								className="font-mono text-[11px]"
								style={{ color: gate.passed ? "var(--up)" : "var(--text-ghost)" }}
							>
								{gate.passed ? "✓" : isRequired ? "✗" : "–"}
							</span>
							<span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-dim)]">
								{gate.label || GATE_LABEL[gate.key] || gate.key}
							</span>
						</span>
						<span className="shrink-0 truncate font-mono text-[10px] text-[var(--text-ghost)]">
							{gate.text}
						</span>
					</li>
				);
			})}
		</ul>
	);
}

// ── research rail ────────────────────────────────────────────────────────

export function RangeBar({
	high,
	low,
	price,
}: {
	high: number | null;
	low: number | null;
	price: number | null;
}) {
	if (high == null || low == null || price == null || high <= low) return null;
	const pctPos = ((price - low) / (high - low)) * 100;
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				<span>rentang 52 minggu</span>
				<span className="tabular">
					{idr(low)} — {idr(high)}
				</span>
			</div>
			<div className="relative mt-2 h-2 rounded-full bg-[var(--panel-3)]">
				<div
					className="absolute inset-y-0 left-0 rounded-full"
					style={{ width: pctPos + "%", background: "var(--accent-dim)" }}
				/>
				<div
					className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-full"
					style={{ left: "calc(" + pctPos + "% - 1px)", background: "var(--text)" }}
				/>
			</div>
			<div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-ghost)]">
				<span className="tabular">{idr(price)}</span>
				<span>sisa ruang {fmtNum(((high - price) / price) * 100, 1)}% ke high</span>
			</div>
		</div>
	);
}

export function FeedSection({
	title,
	items,
	warnWhenEmpty,
}: {
	title: string;
	items: { title: string; date: string; link?: string | null; note?: string | null }[];
	warnWhenEmpty?: string | null;
}) {
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)]">
			<div className="border-b border-[var(--border)] px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				{title}
			</div>
			{warnWhenEmpty && items.length === 0 ? (
				<p className="px-3 py-3 font-mono text-[10px] text-[var(--text-faint)]">
					{warnWhenEmpty} — tidak ada item hari ini; panel tidak mengarang.
				</p>
			) : (
				<ul>
					{items.slice(0, 5).map((item) => {
						const content = (
							<div className="px-3 py-1.5">
								<p className="line-clamp-2 text-[12px] leading-snug text-[var(--text-dim)]">
									{item.title}
								</p>
								<p className="mt-0.5 font-mono text-[9px] text-[var(--text-ghost)]">
									{[item.note, item.date].filter(Boolean).join(" · ")}
								</p>
							</div>
						);
						return (
							<li key={item.title} className="border-b border-[var(--border)] last:border-b-0">
								{item.link ? (
									<a href={item.link} target="_blank" rel="noreferrer" className="block hover:bg-[var(--panel-3)]">
										{content}
									</a>
								) : (
									content
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
