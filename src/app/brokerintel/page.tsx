"use client";

import { useState } from "react";
import { api, fmtIdr, fmtNum } from "@/lib/api";
import Shell from "@/components/Shell";
import { SectionHeader, Skeleton } from "@/components/ui";
import { usePolling } from "@/lib/usePolling";

interface BrokerAnalysis {
	ticker: string;
	available: boolean;
	error?: string;
	as_of?: string;
	note?: string;
	price?: number;
	total_volume?: number;
	net_foreign_lots?: number;
	net_foreign_idr?: number;
	foreign_buy_lots?: number;
	foreign_sell_lots?: number;
	foreign_buy_idr?: number;
	foreign_sell_idr?: number;
}

interface BrokerRadarRow {
	broker: string;
	code?: string;
	net_lots: number;
	net_idr: number;
	type: string;
	ticker_count: number;
	tickers: string[];
	volume?: number;
	value_idr?: number;
	frequency?: number;
}

interface BrokerRadar {
	available: boolean;
	error?: string;
	covered_tickers?: number;
	count?: number;
	as_of?: string;
	rows?: BrokerRadarRow[];
}

const POPULAR = [
	"BBCA",
	"BBRI",
	"BMRI",
	"TLKM",
	"ASII",
	"ADRO",
	"ANTM",
	"MDKA",
	"AMMN",
	"GOTO",
];

export default function BrokerIntelPage() {
	const [ticker, setTicker] = useState("BBCA");

	const radar = usePolling<BrokerRadar>(
		() => api.get("/api/intel/broker/radar"),
		90000,
		"radar",
	);
	const detail = usePolling<BrokerAnalysis | null>(
		() => api.get(`/api/intel/broker/${ticker}`),
		60000,
		ticker,
	);

	const unavailable = radar.data && radar.data.available === false;
	const radarRows = (radar.data?.rows ?? [])
		.filter((r) => typeof r.value_idr === "number")
		.sort((a, b) => (b.value_idr ?? 0) - (a.value_idr ?? 0));

	return (
		<Shell>
			<SectionHeader
				title="Broker Intel"
				subtitle="Broker activity from IDX — exchange-level volume ranking, plus per-stock foreign flow"
			/>

			{unavailable ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						IDX unavailable
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						{radar.data?.error ?? "The IDX endpoint did not respond."} The backend
						retries with browser impersonation; try again shortly.
					</p>
				</div>
			) : radar.loading && !radar.data ? (
				<Skeleton className="h-72" />
			) : (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{radar.data?.count ?? radarRows.length} brokers · whole IDX market, one
							exchange summary
						</span>
						{radar.data?.as_of ? (
							<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
								IDX · as of {String(radar.data.as_of).slice(0, 10)}
							</span>
						) : null}
					</div>
					<div className="panel overflow-x-auto p-2">
						<table className="w-full">
							<thead>
								<tr className="border-b border-[var(--line)] text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
									<th className="px-2 py-1">Broker</th>
									<th className="px-2 py-1">Code</th>
									<th className="px-2 py-1 text-right">Volume</th>
									<th className="px-2 py-1 text-right">Value</th>
									<th className="px-2 py-1 text-right">Frequency</th>
								</tr>
							</thead>
							<tbody>
								{radarRows.length === 0 ? (
									<tr>
										<td
											colSpan={5}
											className="px-2 py-4 font-mono text-xs text-[var(--text-faint)]"
										>
											No broker data yet
										</td>
									</tr>
								) : (
									radarRows.map((r, i) => (
										<tr
											key={`${r.broker}-${i}`}
											className="border-b border-[var(--line)]/50 last:border-b-0 hover:bg-[var(--panel-2)]"
										>
											<td className="px-2 py-1.5 text-[12px] font-semibold text-[var(--text)]">
												{r.broker}
											</td>
											<td className="tabular px-2 py-1.5 font-mono text-[11px] text-[var(--text-faint)]">
												{r.code}
											</td>
											<td className="tabular px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text)]">
												{fmtNum(r.volume ?? null, 0)}
											</td>
											<td className="tabular px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text)]">
												{fmtNum((r.value_idr ?? 0) / 1e9, 1)}
											</td>
											<td className="tabular px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text)]">
												{fmtNum(r.frequency ?? null, 0)}
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</>
			)}

			{/* Per-ticker foreign flow (the IDX proxy for "who's accumulating") */}
			<div className="panel mt-6 p-4">
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
						Per-ticker foreign flow · {ticker}
					</h2>
					<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
						FLOW
						{detail.data?.as_of
							? ` · as of ${String(detail.data.as_of).slice(0, 10)}`
							: ""}
					</span>
				</div>
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<input
						value={ticker}
						onChange={(e) => setTicker(e.target.value.toUpperCase())}
						onKeyDown={(e) => {
							if (e.key === "Enter" && ticker) void detail.refresh();
						}}
						placeholder="Ticker (e.g. BBCA)"
						className="panel-2 w-36 px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
					/>
					<button
						onClick={() => void detail.refresh()}
						className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
					>
						Load
					</button>
					<div className="ml-2 flex flex-wrap gap-1">
						{POPULAR.map((t) => (
							<button
								key={t}
								onClick={() => setTicker(t)}
								className={`panel-2 rounded-pill px-2.5 py-1 font-mono text-[11px] ${
									ticker === t
										? "text-[var(--accent)] ring-1 ring-[var(--accent)]"
										: "text-[var(--text-dim)] hover:text-[var(--accent)]"
								}`}
							>
								{t}
							</button>
						))}
					</div>
				</div>

				{detail.loading && !detail.data ? (
					<Skeleton className="h-40" />
				) : detail.data?.error ? (
					<p className="text-xs text-[var(--down)]">{detail.data.error}</p>
				) : detail.data ? (
					<>
						<div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
							<DrillStat
								label="Net Foreign"
								value={
									<span
										className={
											(detail.data.net_foreign_lots ?? 0) >= 0
												? "text-[var(--up)]"
												: "text-[var(--down)]"
										}
									>
										{(detail.data.net_foreign_lots ?? 0) >= 0 ? "+" : ""}
										{fmtNum(detail.data.net_foreign_lots ?? 0, 0)} lots
									</span>
								}
							/>
							<DrillStat
								label="Net Foreign IDR"
								value={
									<span
										className={
											(detail.data.net_foreign_idr ?? 0) >= 0
												? "text-[var(--up)]"
												: "text-[var(--down)]"
										}
									>
										{fmtIdr(detail.data.net_foreign_idr ?? 0, true)}
									</span>
								}
							/>
							<DrillStat
								label="Foreign Buy"
								value={
									<span className="text-[var(--up)]">
										{fmtNum(detail.data.foreign_buy_lots ?? 0, 0)} lots ·{" "}
										{fmtIdr(detail.data.foreign_buy_idr ?? 0, true)}
									</span>
								}
							/>
							<DrillStat
								label="Foreign Sell"
								value={
									<span className="text-[var(--down)]">
										{fmtNum(detail.data.foreign_sell_lots ?? 0, 0)} lots ·{" "}
										{fmtIdr(detail.data.foreign_sell_idr ?? 0, true)}
									</span>
								}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
							<DrillStat
								label="Price"
								value={detail.data.price != null ? fmtNum(detail.data.price) : "—"}
							/>
							<DrillStat
								label="Volume"
								value={fmtNum(detail.data.total_volume ?? 0, 0)}
							/>
							<DrillStat
								label="Source"
								value={<span className="text-[var(--accent)]">IDX</span>}
							/>
						</div>
						<p className="mt-4 text-[11px] leading-relaxed text-[var(--text-faint)]">
							{detail.data.note ??
								"IDX publishes broker activity exchange-level only."}{" "}
							Per-broker buy/sell per stock is not public exchange data; foreign flow
							is the official per-stock institutional signal.
						</p>
					</>
				) : null}
			</div>
		</Shell>
	);
}

function DrillStat({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div className="panel-2 p-3">
			<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div className="tabular mt-0.5 font-mono text-sm font-bold text-[var(--text)]">
				{value}
			</div>
		</div>
	);
}
