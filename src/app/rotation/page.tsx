"use client";

import { Fragment, useState } from "react";
import {
	api,
	fmtNum,
	type RotationHistory,
	type RotationMover,
	type RotationSector,
	type ValidAccum,
} from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import Shell from "@/components/Shell";
import { SectionHeader, Skeleton } from "@/components/ui";

export default function SectorRotationPage() {
	const data = usePolling<RotationHistory>(
		() => api.get("/api/intel/rotation?days=20"),
		300000,
		"rotation",
	);
	const [openSector, setOpenSector] = useState<string | null>(null);

	return (
		<Shell>
			<SectionHeader
				eyebrow="Rotation & valid accumulation"
				title="Sector Rotation"
				subtitle="Hover a sector to preview its movers — click a row to expand them, click a stock to analyze it fully"
			/>
			{data.loading && !data.data ? (
				<Skeleton className="h-72" />
			) : data.data?.error ? (
				<p className="text-xs text-[var(--down)]">{data.data.error}</p>
			) : data.data ? (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{daysLabel(data.data.days_archived)} · negative rank Δ = gaining relative
							strength
						</span>
						{data.data.as_of && (
							<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
								SNAP · as of {String(data.data.as_of).slice(0, 10)}
							</span>
						)}
					</div>
					<div className="panel overflow-x-auto p-4">
						<table className="w-full min-w-[680px]">
							<thead>
								<tr className="border-b border-[var(--line)]">
									<th className="py-1 pr-2 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										Rank
									</th>
									<th className="py-1 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										Sector
									</th>
									<th className="py-1 px-2 text-right font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										A / D
									</th>
									<th className="py-1 px-2 text-right font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										Today
									</th>
									<th className="py-1 px-2 text-right font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										5d
									</th>
									<th className="py-1 px-2 text-right font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										20d
									</th>
									<th className="py-1 pl-2 text-right font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
										Rank Δ
									</th>
								</tr>
							</thead>
							<tbody>
								{data.data.sectors.map((s) => (
									<Fragment key={s.sector}>
										<SectorRow
											s={s}
											open={openSector === s.sector}
											onToggle={() =>
												setOpenSector(openSector === s.sector ? null : s.sector)
											}
										/>
										{openSector === s.sector && (
											<tr>
												<td colSpan={7} className="border-b border-[var(--line)] pb-4 pt-1">
													<MoversStrip sector={s} />
												</td>
											</tr>
										)}
									</Fragment>
								))}
							</tbody>
						</table>
						{data.data.sectors.length === 0 && (
							<p className="py-6 text-center font-mono text-[10px] text-[var(--text-faint)]">
								No sector snapshots yet
							</p>
						)}
					</div>
				</>
			) : null}
		</Shell>
	);
}

/* Stock chips deep-link into the markets profiler (?ticker=). */
function MoversStrip({ sector }: { sector: RotationSector }) {
	const onPick = (t: string) => {
		window.location.href = `/markets?ticker=${encodeURIComponent(t)}`;
	};
	const movers = sector.movers;
	const acc = sector.valid_accumulation;
	if (!movers && (!acc || acc.length === 0)) {
		return (
			<p className="pt-2 font-mono text-[10px] text-[var(--text-faint)]">
				mover detail starts with tomorrow&apos;s snapshot (today&apos;s archive
				predates it)
			</p>
		);
	}
	return (
		<div className="space-y-3 pt-2">
			{movers && (
				<div className="grid gap-3 lg:grid-cols-2">
					<MoverGroup
						label="▲ Moving up"
						tone="up"
						list={movers.gainers}
						onPick={onPick}
					/>
					<MoverGroup
						label="▼ Moving down"
						tone="down"
						list={movers.losers}
						onPick={onPick}
					/>
				</div>
			)}
			{acc && acc.length > 0 ? (
				<div className="space-y-3">
					<AccumGroup
						label="◆ Watch · akumulasi senyap"
						hint="volume beli masuk, harga belum bergerak (≤3%)"
						list={acc.filter((v) => v.stage === "watch")}
						onPick={onPick}
					/>
					<AccumGroup
						label="▲ Akumulasi valid · mulai jalan"
						hint="harga belum lari (puncak ≤8%) · volume beli dominan"
						list={acc.filter((v) => v.stage !== "watch")}
						onPick={onPick}
					/>
				</div>
			) : (
				<p className="font-mono text-[9px] text-[var(--text-faint)]">
					belum ada kandidat — arsip harian mengumpulkan data dulu (butuh ≥3 hari)
				</p>
			)}
		</div>
	);
}

function SectorRow({
	s,
	open,
	onToggle,
}: {
	s: RotationSector;
	open: boolean;
	onToggle: () => void;
}) {
	const ad = `${s.gainers}/${s.losers}`;
	const gaining = (s.rank_delta ?? 0) < 0;
	return (
		<tr
			onClick={onToggle}
			className={`cursor-pointer transition-colors hover:bg-[var(--panel-2)] ${
				open ? "bg-[var(--panel-2)]" : ""
			}`}
		>
			<td className="tabular py-2 pr-2 text-[11px] text-[var(--text-faint)]">
				<span className={open ? "text-[var(--accent)]" : ""}>
					{open ? "▾" : "▸"} {s.rank ?? "—"}
				</span>
			</td>
			<td className="py-2 text-sm font-semibold text-[var(--text)]">
				{s.sector}
				<span className="ml-2 font-mono text-[10px] font-normal text-[var(--text-faint)]">
					{s.count} stocks
				</span>
			</td>
			<td className="tabular py-2 px-2 text-right text-[11px] text-[var(--text-dim)]">
				{ad}
			</td>
			<td
				className={`tabular py-2 px-2 text-right text-[12px] font-semibold ${
					s.avg_change_percent >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
				}`}
			>
				{fmtNum(s.avg_change_percent, 2)}%
			</td>
			<td
				className={`tabular py-2 px-2 text-right text-[11px] ${
					(s.avg5 ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
				}`}
			>
				{s.avg5 != null ? `${fmtNum(s.avg5, 2)}%` : "—"}
			</td>
			<td
				className={`tabular py-2 px-2 text-right text-[11px] ${
					(s.avg20 ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"
				}`}
			>
				{s.avg20 != null ? `${fmtNum(s.avg20, 2)}%` : "—"}
			</td>
			<td className="tabular py-2 pl-2 text-right text-[11px] font-semibold">
				{s.rank_delta == null ? (
					<span className="text-[var(--text-faint)]">—</span>
				) : (
					<span className={gaining ? "text-[var(--up)]" : "text-[var(--down)]"}>
						{gaining ? "▲" : "▼"} {Math.abs(s.rank_delta)}
					</span>
				)}
			</td>
		</tr>
	);
}

function MoverGroup({
	label,
	tone,
	list,
	onPick,
}: {
	label: string;
	tone: "up" | "down";
	list: RotationMover[];
	onPick: (ticker: string) => void;
}) {
	if (list.length === 0) return null;
	const color = tone === "up" ? "text-[var(--up)]" : "text-[var(--down)]";
	return (
		<div>
			<div
				className={`mb-1 font-mono text-[10px] uppercase tracking-wider ${color}`}
			>
				{label}
			</div>
			<div className="flex flex-wrap gap-1.5">
				{list.map((m) => (
					<button
						key={m.ticker}
						onClick={() => onPick(m.ticker)}
						title={`${m.name ?? m.ticker} · ${fmtNum(m.price ?? 0, 0)} · analyze`}
						className={`group flex items-baseline gap-2 rounded-md border px-2 py-1 text-left transition-all hover:-translate-y-px hover:border-[var(--accent)] hover:bg-[var(--panel-2)] ${
							m.change_percent >= 0
								? "border-[var(--up)]/30 bg-[var(--up)]/5"
								: "border-[var(--down)]/30 bg-[var(--down)]/5"
						}`}
					>
						<span className="font-mono text-[11px] font-bold text-[var(--text)]">
							{m.ticker}
						</span>
						<span className="hidden max-w-40 truncate font-mono text-[9px] text-[var(--text-faint)] group-hover:inline lg:inline">
							{m.name}
						</span>
						<span className={`tabular text-[11px] font-semibold ${color}`}>
							{m.change_percent >= 0 ? "+" : ""}
							{fmtNum(m.change_percent, 2)}%
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

function daysLabel(n: number) {
	if (n === 1)
		return "1 day archived — history grows as the daily snapshot accumulates";
	if (n === 0)
		return "snapshot archive warming up — check back after the next fetch";
	return `${n} days archived`;
}

function AccumGroup({
	label,
	hint,
	list,
	onPick,
}: {
	label: string;
	hint: string;
	list: ValidAccum[];
	onPick: (ticker: string) => void;
}) {
	if (list.length === 0) return null;
	return (
		<div>
			<div className="mb-1 flex flex-wrap items-baseline gap-2">
				<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--gold)]">
					{label}
				</span>
				<span className="font-mono text-[9px] text-[var(--text-faint)]">
					{hint}
				</span>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{list.map((v) => (
					<button
						key={v.ticker}
						onClick={() => onPick(v.ticker)}
						title={`${v.name ?? v.ticker} · ${v.days} hari · harga ${fmtNum(v.price_move, 1)}% (puncak ${fmtNum(v.peak_move ?? v.price_move, 1)}%) · ${fmtNum(v.buy_share, 0)}% volume beli${v.flow_agrees ? " · asing ikut beli" : ""}`}
						className="flex items-baseline gap-1.5 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-2 py-1 transition-all hover:-translate-y-px hover:border-[var(--accent)] hover:bg-[var(--panel-2)]"
					>
						<span className="font-mono text-[11px] font-bold text-[var(--text)]">
							{v.ticker}
						</span>
						<span className="font-mono text-[9px] text-[var(--text-faint)]">
							{v.days}d
						</span>
						<span className="tabular text-[11px] font-semibold text-[var(--up)]">
							{fmtNum(v.buy_share, 0)}% beli
						</span>
						{v.flow_agrees && (
							<span
								className="h-1.5 w-1.5 self-center rounded-full bg-[var(--gold)]"
								title="asing ikut akumulasi"
							/>
						)}
					</button>
				))}
			</div>
		</div>
	);
}
