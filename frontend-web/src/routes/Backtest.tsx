/**
 * Backtest - every method we have, versus the index.
 *
 * Two honest layers on one screen. The engine layer simulates all ten
 * strategies through the same fee + slippage model and prices them against
 * buy-and-hold of the target and of IHSG. The evidence layer shows the
 * walk-forward study's own published numbers for the shipped method, because
 * a method deserves its own record, not a euphemism.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
	createChart,
	LineSeries,
	LineStyle,
	ColorType,
	type IChartApi,
	type ISeriesApi,
	type Time,
} from "lightweight-charts";
import { fmtNum, fmtPct, fmtIdr } from "@/lib/api";
import { pctRaw } from "@/components/plan";
import { useChartPalette, withAlpha } from "@/lib/theme";
import {
	compareApi,
	erroredRows,
	rankedRows,
	type CompareResult,
	type Period,
	type StrategyRow,
} from "@/lib/api/backtest";
import { planApi, type MethodCard } from "@/lib/api/plan";
import { Page } from "./Tonight";

const PERIODS: { value: Period; label: string }[] = [
	{ value: "6mo", label: "6 bln" },
	{ value: "1y", label: "1 thn" },
	{ value: "2y", label: "2 thn" },
	{ value: "5y", label: "5 thn" },
];

const PRESETS = ["^JKSE", "BBCA", "BBRI", "ASII", "TLKM"];

export default function Backtest() {
	const [ticker, setTicker] = useState("^JKSE");
	const [typed, setTyped] = useState("^JKSE");
	const [period, setPeriod] = useState<Period>("2y");
	const [result, setResult] = useState<CompareResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [methodCard, setMethodCard] = useState<MethodCard | null>(null);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		setError(null);
		compareApi
			.compare(ticker, period)
			.then((data) => alive && setResult(data))
			.catch((err: Error) => alive && setError(err.message))
			.finally(() => alive && setLoading(false));
		return () => {
			alive = false;
		};
	}, [ticker, period]);

	useEffect(() => {
		let alive = true;
		planApi
			.method()
			.then((card) => alive && setMethodCard(card))
			.catch(() => alive && setMethodCard(null));
		return () => {
			alive = false;
		};
	}, []);

	function run(nextTicker: string, nextPeriod: Period = period, force = false) {
		const code = nextTicker.trim().toUpperCase() || "^JKSE";
		setTicker(code);
		setTyped(code);
		setPeriod(nextPeriod);
		setLoading(true);
		setError(null);
		compareApi
			.compare(code, nextPeriod, 10_000_000, force)
			.then((data) => setResult(data))
			.catch((err: Error) => setError(err.message))
			.finally(() => setLoading(false));
	}

	return (
		<Page>
			<header className="mb-7">
				<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
					Methods, measured
				</p>
				<h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[40px]">
					Backtest
				</h1>
				<p className="mt-3 max-w-[78ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Semua metode yang dimiliki domain ini berjalan pada satu target dengan
					model biaya yang sama (fee + slippage di dalam setiap order), lalu
					diadu dengan kinerja indeks. Di bawahnya, studi walk-forward menaruh
					catatan metodologisnya yang sudah diterbitkan.
				</p>
			</header>

			<section className="mb-6 border border-[var(--border)] bg-[var(--panel-2)] p-4">
				<div className="flex flex-wrap items-end gap-3">
					<label className="flex flex-col gap-1">
						<span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
							Target
						</span>
						<input
							value={typed}
							onChange={(event) => setTyped(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") run(typed, period);
							}}
							className="w-[220px] border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[13px] text-[var(--text)]"
							aria-label="Kode target"
						/>
					</label>
					<div className="flex flex-col gap-1">
						<span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
							Periode
						</span>
						<div className="flex gap-1">
							{PERIODS.map((option) => (
								<button
									key={option.value}
									type="button"
									onClick={() => run(typed || ticker, option.value)}
									className={
										"border px-2 py-1.5 font-mono text-[11px] " +
										(period === option.value
											? "border-[var(--text)] text-[var(--text)]"
											: "border-[var(--border)] text-[var(--text-ghost)] hover:text-[var(--text)]")
									}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
					<button
						type="button"
						onClick={() => run(typed || ticker, period, true)}
						disabled={loading}
						className="border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
					>
						{loading ? "menjalankan…" : "Bandingkan ulang"}
					</button>
					<div className="ml-auto flex flex-wrap gap-1.5">
						{PRESETS.map((preset) => (
							<button
								key={preset}
								type="button"
								onClick={() => run(preset, period)}
								className={
									"border px-2 py-1 font-mono text-[10px] " +
									(ticker === preset
										? "border-[var(--text)] text-[var(--text)]"
										: "border-[var(--border)] text-[var(--text-ghost)] hover:text-[var(--text)]")
								}
							>
								{preset === "^JKSE" ? "IHSG" : preset}
							</button>
						))}
					</div>
				</div>
				{result && (
					<p className="mt-3 font-mono text-[10px] text-[var(--text-ghost)]">
						{result.bars} bar · modal {fmtIdr(result.capital)} · {result.fees.note}
						{result.cache?.hit ? " · cache " + result.cache.age_seconds + "s" : ""}
					</p>
				)}
			</section>

			{error && (
				<p className="mb-5 border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-dim)]">
					Perbandingan gagal: {error}
				</p>
			)}

			{result && (
				<>
					<WinnerCard result={result} />

					<section className="mt-6">
						<h2 className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
							Kurva ekuitas
							<span className="font-mono text-[10px] text-[var(--text-ghost)]">
								normalisasi ke 100 · putus-putus tebal = beli-tahan IHSG
							</span>
						</h2>
						<EquityCompareChart result={result} />
					</section>

					<section className="mt-6">
						<h2 className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
							Statistik per metode
						</h2>
						<StrategyTable result={result} />
						<ErrorRows result={result} />
					</section>

					<section className="mt-6 border border-[var(--border)] bg-[var(--panel-2)] p-4 font-mono text-[11px] leading-relaxed text-[var(--text-faint)]">
						<p>
							<strong className="text-[var(--text)]">Cara membaca.</strong> Win
							rate = pangsa order yang ditutup berkeuntungan. Max drawdown diukur
							 pada ekuitas berjalan; posisi terbuka dihitung mark-to-market.
							Kolom α = pengembalian metode − pengembalian beli-tahan IHSG:
							angka yang menunjukkan siapa yang benar-benar unggul dan siapa yang
							hanya menyalin pasar. Waktu di pasar menunjukkan berapa lama
							strategi berdiri di dalam posisi. Simulasi bukan pembuktian:
							aturan tetap yang tidak dilatih pada data ini keluar dengan angka,
							bukan dengan janji.
						</p>
					</section>
				</>
			)}

			{methodCard && <MethodEvidence card={methodCard} />}
		</Page>
	);
}

/* ── winner card ────────────────────────────────────────────────────── */

function WinnerCard({ result }: { result: CompareResult }) {
	const rows = rankedRows(result).filter((row) => row.strategy !== "buyhold");
	if (rows.length === 0) return null;
	const best = rows[0]!;
	const indexTotal = result.hold_index.total_pct ?? result.hold_target.total_pct;
	const baselineLabel =
		result.hold_index.total_pct != null
			? "Beli-tahan IHSG identik memberi"
			: "Beli-tahan target identik memberi";
	const stats = best.stats!;
	const total = stats.total_return_pct;
	const beat = indexTotal != null && total > indexTotal;
	const alpha =
		best.alpha_vs_index_pct == null
			? "—"
			: (best.alpha_vs_index_pct >= 0 ? "+" : "") +
				fmtNum(best.alpha_vs_index_pct, 2) +
				"pp";
	return (
		<div
			className="border border-[var(--border)] border-l-[3px] bg-[var(--panel)] p-5"
			style={{ borderLeftColor: beat ? "var(--up)" : "var(--down)" }}
		>
			<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
				Jawaban pendek periode ini
			</p>
			<p className="mt-2 max-w-[86ch] text-[15px] leading-relaxed text-[var(--text)]">
				<strong>{best.label}</strong> mencatat {fmtPct(total)} selama{" "}
				{fmtNum(result.bars, 0)} sesi ({stats.total_trades} order,{" "}
				{fmtPct(stats.win_rate)} menang, drawdown paling dalam{" "}
				{stats.max_drawdown_pct.toFixed(1)}%, berada di pasar{" "}
				{stats.time_in_market_pct.toFixed(0)}% dari waktu).{" "}
				{indexTotal != null
					? baselineLabel +
						" " +
						fmtPct(indexTotal) +
						" — selisih " +
						alpha +
						"."
					: "Baseline indeks tidak tersedia untuk periodenya ini."}
			</p>
			<p className="mt-2 font-mono text-[10px] text-[var(--text-ghost)]">
				Pemenang satu periode tidak otomatis memenangkan periode lain — lihat
				kolom walk-forward per metode di bawah.
			</p>
		</div>
	);
}

/* ── equity compare chart ───────────────────────────────────────────── */

const LINE_ORDER = [
	"golden_cross",
	"breakout",
	"tsmom",
	"momentum",
	"pullback",
	"cross_9_21",
	"meanreversion",
	"mildmover",
	"cross_3_5",
	"buyhold",
];

const LINE_COLORS = (theme: { up: string; down: string; gold: string; violet: string; blue: string; ink: string }) => ({
	tsmom: theme.violet,
	momentum: theme.blue,
	meanreversion: theme.gold,
	pullback: theme.up,
	breakout: withAlpha(theme.up, 0.85),
	mildmover: withAlpha(theme.violet, 0.55),
	golden_cross: theme.ink,
	cross_3_5: withAlpha(theme.blue, 0.5),
	cross_9_21: withAlpha(theme.gold, 0.55),
	buyhold: withAlpha(theme.ink, 0.75),
});

function EquityCompareChart({ result }: { result: CompareResult }) {
	const theme = useChartPalette();
	const containerRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const seriesRef = useRef<Record<string, ISeriesApi<"Line">>>({});
	const [visible, setVisible] = useState<Set<string>>(() => new Set());

	useEffect(() => {
		if (!containerRef.current) return;
		const chart = createChart(containerRef.current, {
			height: 420,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: theme.ink,
				fontFamily: "ui-monospace, Menlo, Consolas, monospace",
				fontSize: 11,
			},
			grid: {
				vertLines: { color: theme.grid },
				horzLines: { color: theme.grid },
			},
			crosshair: { mode: 0 },
			rightPriceScale: { borderColor: theme.grid },
			timeScale: { borderColor: theme.grid },
		});
		chartRef.current = chart;
		seriesRef.current = {};

		const colors: Record<string, string> = LINE_COLORS(theme);
		if (result.hold_index.curve && result.hold_index.curve.length > 1) {
			chart
				.addSeries(LineSeries, {
					color: theme.ink,
					lineWidth: 2,
					lineStyle: LineStyle.Dashed,
					priceLineVisible: false,
					lastValueVisible: false,
				})
				.setData(
					result.hold_index.curve.map((point) => ({
						time: point.date as Time,
						value: point.value,
					})),
				);
		}
		const on: string[] = [];
		for (const row of result.strategies) {
			if (!row.curve || row.curve.length < 2) continue;
			const series = chart.addSeries(LineSeries, {
				color: colors[row.strategy] ?? theme.ink,
				lineWidth: 1,
				priceLineVisible: false,
				lastValueVisible: false,
			});
			series.setData(
				row.curve.map((point) => ({ time: point.date as Time, value: point.value })),
			);
			seriesRef.current[row.strategy] = series;
			on.push(row.strategy);
		}
		setVisible(new Set(on));
		chart.timeScale().fitContent();
		return () => {
			chartRef.current = null;
			chart.remove();
			seriesRef.current = {};
		};
	}, [result, theme]);

	useEffect(() => {
		for (const [strategy, series] of Object.entries(seriesRef.current)) {
			series.applyOptions({ visible: visible.has(strategy) });
		}
	}, [visible, result]);

	const legend = [...result.strategies]
		.filter((row) => row.curve && row.curve.length > 1)
		.sort(
			(a, b) => LINE_ORDER.indexOf(a.strategy) - LINE_ORDER.indexOf(b.strategy),
		);

	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-2">
			<div ref={containerRef} />
			<div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border)] px-2 pt-2 font-mono text-[10px]">
				{legend.map((row) => (
					<ToggleChip
						key={row.strategy}
						visible={visible.has(row.strategy)}
						onToggle={() => {
							const next = new Set(visible);
							if (next.has(row.strategy)) next.delete(row.strategy);
							else next.add(row.strategy);
							setVisible(next);
						}}
						label={row.label}
					/>
				))}
				<span className="ml-auto text-[var(--text-ghost)]">
					klik legend untuk menarik/menyembunyikan garis
				</span>
			</div>
		</div>
	);
}

function ToggleChip({
	visible,
	onToggle,
	label,
}: {
	visible: boolean;
	onToggle: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className={
				"flex items-baseline gap-1.5 " +
				(visible ? "text-[var(--text-dim)] hover:text-[var(--text)]" : "text-[var(--text-ghost)] opacity-50 hover:opacity-80")
			}
		>
			<span aria-hidden>—</span>
			{label}
		</button>
	);
}

/* ── the stats table ────────────────────────────────────────────────── */

function StrategyTable({ result }: { result: CompareResult }) {
	const rows = rankedRows(result);
	if (rows.length === 0) {
		return (
			<p className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[12px] text-[var(--text-faint)]">
				Tidak ada metode yang berhasil disimulasikan pada data ini.
			</p>
		);
	}
	return (
		<div className="overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
			<table className="w-full border-collapse text-left">
				<thead className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
					<tr className="border-b border-[var(--border)] bg-[var(--panel-2)]">
						<th className="px-3 py-2">Metode</th>
						<th className="px-2 py-2 text-right">Order</th>
						<th className="px-2 py-2 text-right">Win rate</th>
						<th className="px-2 py-2 text-right">Rata win / loss</th>
						<th className="px-2 py-2 text-right">Total</th>
						<th className="px-2 py-2 text-right">CAGR</th>
						<th className="px-2 py-2 text-right">Max DD</th>
						<th className="px-2 py-2 text-right">α vs IHSG</th>
						<th className="px-2 py-2 text-right">Waktu di pasar</th>
						<th className="px-2 py-2 text-center">Walk-forward</th>
					</tr>
				</thead>
				<tbody className="font-mono text-[11px]">
					{rows.map((row) => (
						<StrategyRowView key={row.strategy} row={row} />
					))}
				</tbody>
			</table>
		</div>
	);
}

function StrategyRowView({ row }: { row: StrategyRow }) {
	const stats = row.stats!;
	return (
		<tr className="border-b border-[var(--border)] last:border-b-0">
			<td className="px-3 py-1.5">
				<span className="text-[var(--text)]">{row.label}</span>
				<span className="ml-2 text-[9px] uppercase tracking-[0.08em] text-[var(--text-ghost)]">
					{row.kin}
				</span>
			</td>
			<td className="tabular px-2 py-1.5 text-right">{stats.total_trades}</td>
			<td className="tabular px-2 py-1.5 text-right">{pctRaw(stats.win_rate, 0)}</td>
			<td className="tabular px-2 py-1.5 text-right">
				<span style={{ color: stats.avg_win_pct >= 0 ? "var(--up)" : "var(--down)" }}>
					{fmtPct(stats.avg_win_pct)}
				</span>
				<span className="px-1 text-[var(--text-ghost)]">/</span>
				<span style={{ color: stats.avg_loss_pct >= 0 ? "var(--up)" : "var(--down)" }}>
					{fmtPct(stats.avg_loss_pct)}
				</span>
			</td>
			<td className="tabular px-2 py-1.5 text-right">
				<span style={{ color: stats.total_return_pct >= 0 ? "var(--up)" : "var(--down)" }}>
					{fmtPct(stats.total_return_pct)}
				</span>
			</td>
			<td className="tabular px-2 py-1.5 text-right text-[var(--text-dim)]">
				{fmtPct(stats.annualized_return_pct)}
			</td>
			<td className="tabular px-2 py-1.5 text-right" style={{ color: "var(--down)" }}>
				{stats.max_drawdown_pct.toFixed(1)}%
			</td>
			<td className="tabular px-2 py-1.5 text-right">
				{row.alpha_vs_index_pct == null ? (
					<span className="text-[var(--text-ghost)]">—</span>
				) : (
					<span
						style={{
							color: row.alpha_vs_index_pct >= 0 ? "var(--up)" : "var(--down)",
						}}
					>
						{(row.alpha_vs_index_pct >= 0 ? "+" : "") +
							fmtNum(row.alpha_vs_index_pct, 2) +
							"pp"}
					</span>
				)}
			</td>
			<td className="tabular px-2 py-1.5 text-right text-[var(--text-dim)]">
				{stats.time_in_market_pct.toFixed(0)}%
			</td>
			<td className="px-2 py-1.5 text-center">
				{row.walk_forward ? (
					<span
						title={
							"IS " +
							fmtPct(row.walk_forward.is_return_pct) +
							" / OOS " +
							fmtPct(row.walk_forward.oos_return_pct)
						}
						style={{
							color: row.walk_forward.consistent ? "var(--up)" : "var(--gold)",
						}}
					>
						{row.walk_forward.consistent ? "konsisten" : "IS turun di OOS"}
					</span>
				) : (
					<span className="text-[var(--text-ghost)]">—</span>
				)}
			</td>
		</tr>
	);
}

function ErrorRows({ result }: { result: CompareResult }) {
	const errors = erroredRows(result);
	if (errors.length === 0) return null;
	return (
		<ul className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
			{errors.map((row) => (
				<li key={"err-" + row.strategy}>
					· {row.label} gagal dijalankan: {row.error ?? "tanpa keterangan"}
				</li>
			))}
		</ul>
	);
}

/* ── the method's own record ────────────────────────────────────────── */

function MethodEvidence({ card }: { card: MethodCard }) {
	const e = card.corrected ?? card.evidence;
	const holdout = card.holdout;
	const replay = card.five_year as
		| {
				window?: string;
				tiers?: {
					tier: string;
					book_total_pct?: number | null;
					win_rate?: number | null;
					book_max_drawdown_pct?: number | null;
					trades?: number | null;
				}[];
		  }
		| undefined;
	return (
		<section className="mt-10 border-t border-[var(--border)] pt-8">
			<header className="mb-4">
				<h2 className="font-display text-[24px] text-[var(--text)]">
					Catatan metode yang dikirim malam ini
				</h2>
				<p className="mt-1 max-w-[74ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
					Angka di bawah bukan simulasi layar ini. Mereka keluar dari studi
					walk-forward dengan biaya di dalam tiap order;{" "}
					<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text)]">
						halaman metode lengkap
					</Link>{" "}
					menyimpan sitasi file-per-barisnya.
				</p>
			</header>
			<div className="grid gap-4 sm:grid-cols-4">
				<Stat label="Menang (dikoreksi)" value={pctRaw(e.win_rate, 1)} />
				<Stat label="Per order" value={e.avg_ret_pct != null ? "+" + fmtNum(e.avg_ret_pct, 2) + "%" : "—"} />
				<Stat label="Order OOS" value={e.oos_trades != null ? fmtNum(e.oos_trades, 0) : "—"} />
				<Stat
					label="Holdout"
					value={
						holdout
							? (holdout.winners_surviving ?? 0) + "/" + (holdout.winners_tested ?? 0)
							: "—"
					}
				/>
			</div>
			{replay?.tiers && replay.tiers.length > 0 && (
				<div className="mt-4 overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
					<table className="w-full border-collapse text-left">
						<thead className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
							<tr className="border-b border-[var(--border)] bg-[var(--panel-2)]">
								<th className="px-3 py-2">Tier</th>
								<th className="px-2 py-2 text-right">Buku ({replay.window ?? "replay"})</th>
								<th className="px-2 py-2 text-right">Menang</th>
								<th className="px-2 py-2 text-right">Max DD buku</th>
								<th className="px-2 py-2 text-right">Order</th>
							</tr>
						</thead>
						<tbody className="font-mono text-[11px]">
							{replay.tiers.map((tier) => (
								<tr key={tier.tier} className="border-b border-[var(--border)] last:border-b-0">
									<td className="px-3 py-1.5">{tier.tier}</td>
									<td className="tabular px-2 py-1.5 text-right">
										<span
											style={{
												color: (tier.book_total_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)",
											}}
										>
											{fmtPct(tier.book_total_pct ?? null)}
										</span>
									</td>
									<td className="tabular px-2 py-1.5 text-right">
										{pctRaw(tier.win_rate ?? null, 1)}
									</td>
									<td className="tabular px-2 py-1.5 text-right" style={{ color: "var(--down)" }}>
										{(tier.book_max_drawdown_pct ?? 0).toFixed(1)}%
									</td>
									<td className="tabular px-2 py-1.5 text-right text-[var(--text-dim)]">
										{tier.trades != null ? fmtNum(tier.trades, 0) : "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<p className="mt-3 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
				Perlu dibaca sebelum order pertama: replay lima tahun adalah satu jendela
				dengan universe terkunci di akhir periode (survivorship utuh), jadi tidak
				sebanding dengan walk-forward. Yang paling menggoda di atas kertas justru
				pemegang catatan terburuk di buku —{" "}
				<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text)]">
					baca tafsirannya
				</Link>
				.
			</p>
		</section>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				{label}
			</div>
			<div className="tabular mt-1 font-display text-[22px] text-[var(--text)]">
				{value}
			</div>
		</div>
	);
}
