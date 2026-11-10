/**
 * Markets - the front door.
 *
 * One snapshot answers one question: apa yang terjadi di pasar hari ini. The
 * build is a background job; this screen shows the last snapshot while the new
 * one is prepared, and never blocks on a universe scan.
 */

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { fmtNum, fmtPct } from "@/lib/api";
import {
	overviewApi,
	type OverviewBuilding,
	type OverviewResponse,
	type OverviewSnapshot,
	type OverviewStatus,
} from "@/lib/api/overview";
import { planApi, type Plan } from "@/lib/api/plan";
import {
	BreadthBar,
	ContributionPanel,
	IhsgHero,
	MoversPanel,
	RotationMap,
	RotationTable,
	SectorDayPanel,
	SectorMembersView,
	StressGauge,
	TopBottomList,
} from "@/components/market";
import { Section } from "@/components/plan";

const BAND: Record<string, { label: string; action: string; color: string }> = {
	trending: { label: "trending", action: "boleh trading", color: "var(--up)" },
	sideways: { label: "sideways", action: "tetap flat", color: "var(--gold)" },
	capitulation: { label: "capitulation", action: "watchlist saja", color: "var(--down)" },
};

export default function MarketsHome() {
	const [data, setData] = useState<OverviewResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reload, setReload] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	const [plan, setPlan] = useState<Plan | null>(null);
	const [sectorPick, setSectorPick] = useState<{ name: string; field: "sector" | "industry" } | null>(null);

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

	useEffect(() => {
		let alive = true;
		planApi
			.plan()
			.then((p) => alive && setPlan(p))
			.catch(() => alive && setPlan(null));
		return () => {
			alive = false;
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
		<div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
			<header className="mb-7">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
							The market, today
						</p>
						<h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[40px]">
							Markets
						</h1>
						<p className="mt-3 max-w-[78ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
							Satu snapshot untuk satu pertanyaan: apa yang terjadi di pasar hari
							ini — IHSG, saham yang menggerakkannya, sektor yang berputar, dan
							tekanan pasar yang terukur. Angka saham individual menautkan ke Deep
							Dive.
						</p>
					</div>
					<div className="flex flex-col items-start gap-2 sm:items-end">
						<button
							type="button"
							onClick={refresh}
							disabled={refreshing}
							className="border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
						>
							{refreshing ? "memulai…" : "Refresh snapshot"}
						</button>
						<span className="font-mono text-[10px] text-[var(--text-ghost)]">
							{snapshot?.as_of ? "sesi " + snapshot.as_of : "belum ada snapshot"}
						</span>
					</div>
				</div>
			</header>

			{error && (
				<p className="mb-5 border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-dim)]">
					Backend tidak menjawab: {error}. Layar akan mencoba lagi; jalankan{" "}
					<code className="font-mono">./trading-suite run</code> bila backend mati.
				</p>
			)}

			{building && !snapshot && (
				<div className="border border-[var(--border)] bg-[var(--panel)] p-8">
					<p className="font-mono text-[12px] text-[var(--text-dim)]">
						Membangun snapshot pertama. Layar ini memperbarui diri otomatis.
					</p>
					<Progress status={building.status} />
				</div>
			)}

			{snapshot && (
				<>
					<MetaRow snapshot={snapshot} />
					{snapshot.warnings.length > 0 && (
						<ul className="mb-5 space-y-1 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-3 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
							{snapshot.warnings.map((warning) => (
								<li key={warning}>· {warning}</li>
							))}
						</ul>
					)}
					{snapshot.status?.state === "failed" && (
						<p className="mb-5 border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel)] p-3 font-mono text-[10px] leading-relaxed text-[var(--text-dim)]">
							Build terakhir gagal: {snapshot.status.error ?? "unknown"}.
							Snapshot sebelumnya tetap ditampilkan.
						</p>
					)}

					{plan && <VerdictStrip plan={plan} />}

					<Section
						title="IHSG & simetri"
						subtitle="Level indeks, pergerakan harian, dan berapa banyak saham yang benar-benar ikut."
					>
						<div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
							<IhsgHero
								market={snapshot.market}
								tail={snapshot.benchmark_tail}
								indices={snapshot.indices}
							/>
							<BreadthBar market={snapshot.market} />
						</div>
					</Section>

					<Section
						title="Saham yang bergerak"
						subtitle="Naik paling dalam, jatuh paling dalam, dan yang paling ramai diperdagangkan hari ini."
					>
						<MoversPanel movers={snapshot.movers} />
					</Section>

					<Section
						title="Siapa yang menggerakkan IHSG"
						subtitle="Kontribusi poin-persen terhadap perubahan indeks; klik satu sektor (tabel atau titik peta) untuk melihat saham di dalamnya."
					>
						<div className="grid gap-4 lg:grid-cols-2">
							<ContributionPanel
								contribution={snapshot.index_contribution}
								asOf={snapshot.print_as_of ?? snapshot.as_of}
							/>
							<div className="min-w-0">
								<SectorDayPanel
									sectorDay={snapshot.sector_day}
									active={sectorPick}
									onPick={(name) =>
										setSectorPick((prev) =>
											prev && prev.name === name && prev.field === "sector"
												? null
												: { name, field: "sector" },
										)
									}
								/>
							</div>
						</div>
						{sectorPick && (
							<div className="mt-4">
								<div className="mb-2 flex items-baseline justify-between gap-3">
									<h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
										Isi sektor: {sectorPick.name}
									</h3>
									<button
										type="button"
										onClick={() => setSectorPick(null)}
										className="border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-ghost)] hover:text-[var(--text)]"
									>
										tutup ×
									</button>
								</div>
								<SectorMembersView sector={sectorPick.name} field={sectorPick.field} />
							</div>
						)}
					</Section>

					<Section
						title="Rotasi mingguan"
						subtitle="Kekuatan relatif terhadap IHSG selama seminggu; kanan kuat, kiri lemah."
						right={
							snapshot.sectors.count ? snapshot.sectors.count + " grup" : undefined
						}
					>
						<div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
							<RotationMap
								block={snapshot.sectors}
								title="Sektor"
								activeGroup={sectorPick?.field === "sector" ? sectorPick.name : null}
								onPickGroup={(name) =>
									setSectorPick((prev) =>
										prev && prev.name === name && prev.field === "sector"
											? null
											: { name, field: "sector" },
									)
								}
							/>
							<RotationTable rows={snapshot.sectors.groups} />
						</div>
						<details className="mt-4 border border-[var(--border)] bg-[var(--panel-2)]">
							<summary className="cursor-pointer px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
								Pembagian yang lebih halus — konglomerasion & industri
							</summary>
							<div className="border-t border-[var(--border)] p-4">
								<div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
									<RotationMap block={snapshot.conglomerates} title="Konglomerasion" />
									<RotationTable rows={snapshot.conglomerates.groups} />
								</div>
								<div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
									<RotationMap
										block={snapshot.industries}
										title="Industri"
										showLabels={false}
										activeGroup={sectorPick?.field === "industry" ? sectorPick.name : null}
										onPickGroup={(name) =>
											setSectorPick((prev) =>
												prev && prev.name === name && prev.field === "industry"
													? null
													: { name, field: "industry" },
											)
										}
									/>
									<div>
										<RotationTable rows={snapshot.industries.groups} limit={12} />
										<div className="mt-3">
											<TopBottomList rows={snapshot.industries.groups} title="Industri" limit={6} />
										</div>
									</div>
								</div>
							</div>
						</details>
					</Section>

					<Section
						title="Tekanan pasar"
						subtitle="Tingkat stres 0 (panik) sampai 100 (serakah), komposit enam komponen terukur."
					>
						<StressGauge gauge={snapshot.gauge} />
					</Section>

					<footer className="mt-10 border-t border-[var(--border)] pt-5 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
						<p>
							Data: riwayat studi sampai {snapshot.history_as_of ?? "—"}; universe
							hari ini dari TradingView (print sesuai tanda waktu). Gauge tekanan
							bukan indeks resmi. Bukan saran investasi ·{" "}
							{fmtNum(snapshot.market.universe.total, 0)} saham ·{" "}
							{fmtPct(snapshot.market.above_ma50_pct)} di atas MA50.
						</p>
					</footer>
				</>
			)}

			{snapshot?.building && job && (
				<div className="mt-4 border border-[var(--border)] bg-[var(--panel)] p-3">
					<Progress status={job} compact />
				</div>
			)}
		</div>
	);
}

function MetaRow({ snapshot }: { snapshot: OverviewSnapshot }) {
	const cache = snapshot.cache;
	return (
		<div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-2.5 font-mono text-[10px] text-[var(--text-ghost)]">
			<span>sesi {snapshot.as_of}</span>
			<span>riwayat {snapshot.history_as_of ?? "—"}</span>
			<span>print {snapshot.print_as_of ?? "—"}</span>
			<span>
				{snapshot.coverage.joined}/{snapshot.coverage.universe} bergabung
			</span>
			{cache && (
				<span>
					{cache.hit ? "cache " + cache.age_seconds + "s" : "computed"}
				</span>
			)}
			{snapshot.stale && <span style={{ color: "var(--gold)" }}>snapshot kemarin</span>}
			{snapshot.building && <span style={{ color: "var(--gold)" }}>memperbarui…</span>}
		</div>
	);
}

function VerdictStrip({ plan }: { plan: Plan }) {
	const bandKey = plan.regime.band in BAND ? plan.regime.band : "sideways";
	const band = BAND[bandKey];
	const unsafe = plan.verdict.state === "DATA_UNSAFE";
	const buys = plan.candidates.length;
	const copy = unsafe
		? "Integritas data turun — setiap tiket disedot: lihat layar Plan sebelum menyimpulkan apapun."
		: plan.verdict.buys
			? "Metode siap membeli: " + buys + " saham lolos rantai kondisi malam ini."
			: "Tape tidak melegakan beli — posisi malam ini: tidak ada yang dibeli. Itu keputusan, bukan kegagalan.";
	return (
		<Link
			to="/plan"
			className="mb-5 block border border-[var(--border)] border-l-[3px] bg-[var(--panel-2)] px-4 py-3 transition-colors hover:bg-[var(--panel-3)]"
			style={{ borderLeftColor: unsafe ? "var(--down)" : band.color }}
		>
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
					Keputusan metode malam ini
				</span>
				<span className="font-display text-[15px] font-semibold" style={{ color: unsafe ? "var(--down)" : band.color }}>
					{unsafe ? plan.verdict.state : band.label}
				</span>
				<span className="font-mono text-[12px] text-[var(--text-dim)]">
					→ {unsafe ? "tiket ditahan" : band.action}
				</span>
				<span className="ml-auto font-mono text-[11px] text-[var(--text-faint)]">{copy}</span>
			</div>
		</Link>
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
	const order = ["queued", "universe", "summary", "gauge", "rotation", "moves", "persist", "done"];
	const index = order.indexOf(phase);
	if (index < 0) return 10;
	return Math.max(8, Math.round(((index + 1) / order.length) * 100));
}
