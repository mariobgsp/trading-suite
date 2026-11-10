/**
 * Deep Dive - one stock, asked twice.
 *
 * "Layak trade secara fundamental?" and "Layak trade secara teknikal?" are two
 * different questions about one name. The page answers each with its own
 * measured count, then supports them with the chart and a research rail, and
 * merges nothing.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "@tanstack/react-router";
import {
	api,
	type HistoryResponse,
} from "@/lib/api";
import { planApi, type PlanDetail, type Plan } from "@/lib/api/plan";
import { caseApi, type CaseReport } from "@/lib/api/case";
import { marketApi, type TickerProfile } from "@/lib/api/market";
import { Page } from "./Tonight";
import {
	DeepHeader,
	FundamentalVerdict,
	FeedSection,
	RangeBar,
	TechnicalVerdict,
	TickerSearch,
} from "@/components/deep";
import MarketChart from "@/components/MarketChart";
import FlowChart from "@/components/FlowChart";
import { flowApi, type FlowSeries } from "@/lib/api/flow";

const PERIODS = ["3mo", "6mo", "1y", "2y"] as const;
type Period = (typeof PERIODS)[number];

export default function Deep() {
	const params = useParams({ strict: false }) as { ticker?: string };
	const code = (params.ticker ?? "").toUpperCase();

	const [plan, setPlan] = useState<Plan | null>(null);
	const [detail, setDetail] = useState<PlanDetail | null>(null);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [profile, setProfile] = useState<TickerProfile | null>(null);
	const [caseReport, setCaseReport] = useState<CaseReport | null>(null);
	const [period, setPeriod] = useState<Period>("1y");
	const [history, setHistory] = useState<HistoryResponse | null>(null);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [flow, setFlow] = useState<FlowSeries | null>(null);

	useEffect(() => {
		let alive = true;
		planApi
			.plan()
			.then((p) => alive && setPlan(p))
			.catch(() => alive && setPlan(null));
		return () => {
			alive = false;
		};
	}, []);

	useEffect(() => {
		if (!code) return;
		let alive = true;
		setDetail(null);
		setDetailError(null);
		setProfile(null);
		setCaseReport(null);
		setHistory(null);
		setHistoryError(null);
		setFlow(null);

		planApi
			.detail(code)
			.then((d) => alive && setDetail(d))
			.catch((error: Error) => alive && setDetailError(error.message));
		marketApi
			.profile(code)
			.then((p) => alive && setProfile(p))
			.catch(() => alive && setProfile(null));
		caseApi
			.assess(code)
			.then((c) => alive && setCaseReport(c))
			.catch(() => alive && setCaseReport(null));
		flowApi
			.series(code, 120)
			.then((s) => alive && setFlow(s))
			.catch(() => alive && setFlow(null));

		return () => {
			alive = false;
		};
	}, [code]);

	useEffect(() => {
		if (!code) return;
		let alive = true;
		setHistory(null);
		setHistoryError(null);
		api
			.getCached<HistoryResponse>("/api/market/history/" + code + "?period=" + period)
			.then((h) => alive && setHistory(h))
			.catch((error: Error) => alive && setHistoryError(error.message));
		return () => {
			alive = false;
		};
	}, [code, period]);

	if (!code) return <DeepIndex plan={plan} />;

	const unknown =
		profile?.found === false &&
		detail?.gates.length === 0 &&
		detailError != null;

	const lines = [];
	if (detail?.breakout_level != null) lines.push({ price: detail.breakout_level, title: "Level breakout", style: "dashed" as const });
	if (detail?.in_plan && detail.geometry) {
		lines.push({ price: detail.geometry.target_price, title: "Target" });
		lines.push({ price: detail.geometry.stop_price, title: "Stop" });
	}

	const lastChange =
		history?.history && history.history.length >= 2
			? ((history.history[history.history.length - 1]!.close /
					history.history[history.history.length - 2]!.close -
					1) *
					100)
			: null;
	const bars = history?.history ?? [];
	const high52 = bars.length ? Math.max(...bars.map((b) => b.high)) : null;
	const low52 = bars.length ? Math.min(...bars.map((b) => b.low)) : null;

	return (
		<Page>
			<nav className="mb-6 flex flex-wrap items-baseline justify-between gap-3 font-mono text-[11px] text-[var(--text-ghost)]">
				<div className="flex items-baseline gap-3">
					<Link to="/" className="hover:text-[var(--text)]">
						← pasar
					</Link>
					<span className="max-w-[280px]">
						<TickerSearch ranked={plan?.ranked ?? []} onPick={() => {}} />
					</span>
				</div>
				<span>Deep Dive · data riset, bukan saran</span>
			</nav>

			{unknown ? (
				<div className="border border-[var(--border)] bg-[var(--panel)] p-10">
					<h1 className="font-display text-[30px] text-[var(--text)]">
						{code} tidak dikenali
					</h1>
					<p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
						Tidak ada profil, riwayat, atau chain metode untuk kode ini. Cari kode saham lain di kotak di atas — halaman tidak mengarang data untuk kode
						yang tak dikenal.
					</p>
				</div>
			) : (
				<>
					<DeepHeader
						code={code}
						profile={profile}
						changeFromHistory={lastChange}
					/>

					<section className="mt-8 grid gap-4 lg:grid-cols-2">
						<FundamentalVerdict caseReport={caseReport} />
						<TechnicalVerdict
							detail={detail}
							requiredGates={plan?.required_gates}
							technicalCriteria={caseReport?.technical?.criteria ?? []}
						/>
					</section>
					<p className="mt-3 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-faint)]">
						Dua pertanyaan, dua jawaban. Panel kiri bertanya apakah bisnis dan
						struktur sahamnya sehat; panel kanan bertanya apakah tape satu tujuan
						dengan metode malam ini. Tidak ada skor gabungan — merdu tapi bohong.
					</p>

					<section className="mt-8">
						<div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
							<h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
								Perjalanan harga
							</h2>
							<div className="flex gap-1">
								{PERIODS.map((option) => (
									<button
										key={option}
										type="button"
										onClick={() => setPeriod(option)}
										className={
											"border px-2 py-1 font-mono text-[11px] " +
											(period === option
												? "border-[var(--text)] text-[var(--text)]"
												: "border-[var(--border)] text-[var(--text-ghost)] hover:text-[var(--text)]")
										}
									>
										{option}
									</button>
								))}
							</div>
						</div>
						<div className="border border-[var(--border)] bg-[var(--panel)] p-2">
							{historyError ? (
								<p className="p-6 font-mono text-[12px] text-[var(--text-faint)]">
									Riwayat harga tidak tersedia untuk {code} ({historyError}).
								</p>
							) : bars.length ? (
								<MarketChart
									history={bars}
									indicators={history ? history.indicators : undefined}
									height={380}
									priceLines={lines}
									annotations={detail?.reason?.breakout_date
										? [{ date: detail.reason.breakout_date, label: "breakout", kind: "breakout" as const }]
										: undefined}
									options={{ showVolume: true, overlayIndicators: ["sma20", "sma50"] }}
								/>
							) : (
								<p className="p-10 text-center font-mono text-[12px] text-[var(--text-faint)]">
									Memuat lilin…
								</p>
							)}
						</div>
						<p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
							Garis putus-putus: level breakout yang harus dilampaui metode. Garis
							tebal: target dan stop yang meminta trade melipir ke sana.
						</p>
					</section>

					<section className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
						<div className="min-w-0">
							<h2 className="mb-3 text-[15px] font-semibold text-[var(--text)]">
								<abbr
									title="Proksi transparan atas tekanan dana masuk-keluar; bukan rumah produksi vendor, bukan bagian dari plan"
									className="no-underline"
								>
									Proksi arus dana (riset)
								</abbr>
							</h2>
							{flow ? (
								<div className="border border-[var(--border)] bg-[var(--panel)] p-3">
									<FlowChart series={flow} history={bars} />
									{flow.warnings.length > 0 && (
										<ul className="mt-2 space-y-1 font-mono text-[10px] text-[var(--text-ghost)]">
											{flow.warnings.map((warning) => (
												<li key={warning}>· {warning}</li>
											))}
										</ul>
									)}
								</div>
							) : (
								<p className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[12px] text-[var(--text-faint)]">
									Seri proksi tidak tersedia untuk {code} — rail mundur dengan rapi;
									halaman tetap berdiri.
								</p>
							)}
						</div>
						<div className="grid gap-4">
							<RangeBar high={high52} low={low52} price={profile?.price ?? null} />
							<FeedSection
								title="Pengungkapan KI (IDX)"
								items={(caseReport?.disclosures.items ?? []).map((item) => ({
									title: item.title,
									date: item.date,
									note: item.category,
									link: item.link,
								}))}
								warnWhenEmpty={caseReport?.disclosures.available ? null : caseReport?.disclosures.warnings[0] ?? "sumber KI tidak menjawab"}
							/>
							<FeedSection
								title="Berita saham ini"
								items={(caseReport?.news.items ?? []).map((item) => ({
									title: item.title,
									date: item.date_str,
									note: item.source,
									link: item.link,
								}))}
								warnWhenEmpty={caseReport?.news.available ? null : caseReport?.news.warnings[0] ?? "sumber berita tidak menjawab"}
							/>
						</div>
					</section>
				</>
			)}
		</Page>
	);
}

/**
 * The no-ticker state: search plus where the market says people are looking.
 */
function DeepIndex({ plan }: { plan: Plan | null }) {
	const ranked = plan?.ranked ?? [];
	const near = ranked
		.filter((row) => !row.waiting_on_market && row.gates_passed >= row.gates_total - 1)
		.slice(0, 12);
	return (
		<Page>
			<header className="mb-8 max-w-[80ch]">
				<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
					One stock, two questions
				</p>
				<h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[40px]">
					Deep Dive
				</h1>
				<p className="mt-3 text-[14px] leading-relaxed text-[var(--text-dim)]">
					Pilih satu saham. Halaman ini mengukurnya dua kali: kasus fundamental
					terhadap pita yang tertulis, dan chain teknikal metode terhadap tape.
					Chart, struktur kepemilikan, pengungkapan KI, berita, dan proksi arus
					dana melengkapinya.
				</p>
			</header>
			<div className="max-w-[520px]">
				<TickerSearch ranked={ranked} onPick={() => {}} />
			</div>
			{near.length > 0 && (
				<section className="mt-8">
					<h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
						Menarik hari ini — satu kondisi dari lolos
					</h2>
					<div className="flex flex-wrap gap-2">
						{near.map((row) => (
							<Link
								key={row.ticker}
								to={"/deep/" + row.ticker}
								className="border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-mono text-[12px] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--panel-3)]"
							>
								{row.ticker}
								<span className="ml-2 text-[10px] text-[var(--text-ghost)]">
									{row.gates_passed}/{row.gates_total} · RS {row.rs_rating}
								</span>
							</Link>
						))}
					</div>
				</section>
			)}
		</Page>
	);
}
