/**
 * Daily market dashboard.
 *
 * Reads a persisted snapshot. The first build is a background job; this page
 * shows the last snapshot while the new one is prepared, and never blocks on a
 * universe scan.
 */

import { useEffect, useState } from "react";
import { fmtNum, fmtPct } from "@/lib/api";
import {
	overviewApi,
	type OverviewBuilding,
	type OverviewResponse,
	type OverviewSnapshot,
	type OverviewStatus,
} from "@/lib/api/overview";
import { Section } from "@/components/plan";
import {
	MarketSummary,
	RotationMap,
	RotationTable,
	StressGauge,
	TopBottomList,
} from "@/components/market";
import { Page } from "./Tonight";

export default function Market() {
	const [data, setData] = useState<OverviewResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reload, setReload] = useState(0);
	const [refreshing, setRefreshing] = useState(false);

	useEffect(() => {
		let alive = true;
		let timer: number | undefined;

		async function tick() {
			try {
				const next = await overviewApi.latest();
				if (!alive) return;
				setData(next);
				setError(null);
				const busy =
					"state" in next ? next.state === "building" : Boolean(next.building);
				if (busy) {
					timer = window.setTimeout(tick, 3000);
				}
			} catch (err) {
				if (!alive) return;
				setError(err instanceof Error ? err.message : String(err));
				timer = window.setTimeout(tick, 5000);
			}
		}

		void tick();
		return () => {
			alive = false;
			if (timer) window.clearTimeout(timer);
		};
	}, [reload]);

	async function refresh() {
		setRefreshing(true);
		try {
			await overviewApi.refresh();
			setReload((value) => value + 1);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRefreshing(false);
		}
	}

	const snapshot: OverviewSnapshot | null =
		data && "market" in data ? data : null;
	const building: OverviewBuilding | null =
		data && "state" in data && data.state === "building" ? data : null;
	const job: OverviewStatus | null = snapshot?.status ?? building?.status ?? null;

	return (
		<Page>
			<header className="mb-7">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
							Market dashboard
						</p>
						<h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[40px]">
							Daily update
						</h1>
						<p className="mt-3 max-w-[78ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
							Breadth, stress, and relative rotation across sectors, conglomerates and
							industries. The page reads a cached snapshot; the build runs in the
							background.
						</p>
					</div>
					<div className="flex flex-col items-start gap-2 sm:items-end">
						<button
							type="button"
							onClick={refresh}
							disabled={refreshing}
							className="border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
						>
							{refreshing ? "starting…" : "Refresh snapshot"}
						</button>
						<span className="font-mono text-[10px] text-[var(--text-ghost)]">
							{snapshot?.as_of ? "session " + snapshot.as_of : "no snapshot yet"}
						</span>
					</div>
				</div>
			</header>

			{error && (
				<p className="mb-5 border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-dim)]">
					The dashboard backend is not answering: {error}
				</p>
			)}

			{building && !snapshot && (
				<div className="border border-[var(--border)] bg-[var(--panel)] p-8">
					<p className="font-mono text-[12px] text-[var(--text-dim)]">
						Building the first snapshot. This page will update automatically.
					</p>
					<Progress status={building.status} />
				</div>
			)}

			{snapshot && (
				<>
					<div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-2.5 font-mono text-[10px] text-[var(--text-ghost)]">
						<span>session {snapshot.as_of}</span>
						<span>history {snapshot.history_as_of ?? "—"}</span>
						<span>print {snapshot.print_as_of ?? "—"}</span>
						<span>{snapshot.coverage.joined}/{snapshot.coverage.universe} joined</span>
						{snapshot.cache && (
							<span>
								{snapshot.cache.hit ? "cache " + snapshot.cache.age_seconds + "s" : "computed"}
							</span>
						)}
						{snapshot.building && <span style={{ color: "var(--gold)" }}>updating…</span>}
					</div>

					{snapshot.warnings.length > 0 && (
						<ul className="mb-5 space-y-1 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-3 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
							{snapshot.warnings.map((warning) => (
								<li key={warning}>· {warning}</li>
							))}
						</ul>
					)}

					{snapshot.status?.state === "failed" && (
						<p className="mb-5 border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel)] p-3 font-mono text-[10px] leading-relaxed text-[var(--text-dim)]">
							The last snapshot build failed: {snapshot.status.error ?? "unknown error"}.
							Showing the previous snapshot.
						</p>
					)}

					<Section title="Market summary" subtitle="IHSG, the all-stock average, and the breadth behind them.">
						<div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
							<MarketSummary market={snapshot.market} />
							<StressGauge gauge={snapshot.gauge} />
						</div>
					</Section>

					<Section
						title="Sector rotation"
						subtitle="Weekly relative strength versus IHSG. Above 100 is stronger than the market."
						right={snapshot.sectors.count ? snapshot.sectors.count + " groups" : undefined}
					>
						<div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
							<RotationMap block={snapshot.sectors} title="Sectors" />
							<RotationTable rows={snapshot.sectors.groups} />
						</div>
					</Section>

					<Section
						title="Conglomerate rotation"
						subtitle="The same weekly rotation over the curated group map."
						right={
							snapshot.conglomerates.count
								? snapshot.conglomerates.count + " groups"
								: undefined
						}
					>
						<div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
							<RotationMap block={snapshot.conglomerates} title="Conglomerates" />
							<RotationTable rows={snapshot.conglomerates.groups} />
						</div>
					</Section>

					<Section
						title="Industry rotation"
						subtitle="TradingView industries with at least five members."
						right={
							snapshot.industries.count
								? snapshot.industries.count + " groups"
								: undefined
						}
					>
						<div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
							<RotationMap block={snapshot.industries} title="Industries" showLabels={false} />
							<RotationTable rows={snapshot.industries.groups} limit={24} />
						</div>
						<div className="mt-4">
							<TopBottomList rows={snapshot.industries.groups} title="Industries" />
						</div>
					</Section>

					<footer className="mt-10 border-t border-[var(--border)] pt-5 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
						<p>
							Data: study history through {snapshot.history_as_of ?? "—"}; current
							universe from TradingView. The stress gauge is our transparent composite
							of six market components, not an official index. Not investment advice.
						</p>
						<p className="mt-1">
							Build covers {snapshot.market.universe.total} names ·{" "}
							{fmtNum(snapshot.coverage.missing_history, 0)} without study history ·{" "}
							{fmtPct(snapshot.market.above_ma50_pct)} above MA50.
						</p>
					</footer>
				</>
			)}

			{snapshot?.building && job && (
				<div className="mt-4 border border-[var(--border)] bg-[var(--panel)] p-3">
					<Progress status={job} compact />
				</div>
			)}
		</Page>
	);
}

function Progress({ status, compact = false }: { status: OverviewStatus; compact?: boolean }) {
	const phase = status.phase ?? status.state;
	const message = status.message ?? "working";
	return (
		<div className={compact ? "" : "mt-4"}>
			<div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[10px]">
				<span className="text-[var(--text-dim)]">{message}</span>
				<span className="text-[var(--text-ghost)]">
					{phase}
					{status.seconds != null ? " · " + status.seconds.toFixed(1) + "s" : ""}
				</span>
			</div>
			<div className="mt-1.5 h-1.5 overflow-hidden bg-[var(--panel-3)]">
				<div
					className="h-full bg-[var(--accent)] transition-all"
					style={{ width: phaseWidth(phase) + "%" }}
				/>
			</div>
			{status.error && (
				<p className="mt-2 font-mono text-[10px]" style={{ color: "var(--down)" }}>
					{status.error}
				</p>
			)}
		</div>
	);
}

function phaseWidth(phase: string): number {
	const order = ["queued", "universe", "summary", "gauge", "rotation", "persist", "done"];
	const index = order.indexOf(phase);
	if (index < 0) return 10;
	return Math.max(8, Math.round(((index + 1) / order.length) * 100));
}
