/**
 * Cari saham — alat penyaring, bukan halaman keputusan.
 *
 * Keputusan malam ini ada di halaman Hari ini. Halaman ini menyaring seluruh
 * daftar riset dengan bahasa yang sama: kolom utama cukup untuk memilih nama,
 * kolom teknis bisa dimatikan, dan setiap filter menyimpan jumlah hasil beserta
 * satu kalimat artinya. Keanggotaan filter tetap dihitung backend.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { scanApi, type ScanPayload, type ScanRow, type ScanScreenKey } from "@/lib/api/scanner";
import { usePlanRefreshSignal } from "@/lib/refresh";
import { Section, idr, pct, pctRaw } from "@/components/plan";
import { Page } from "./Tonight";
import { bandCopy, screenCopy, TERMS } from "@/lib/present";

type Sort = "closest" | "momentum" | "breakout" | "quiet" | "turnover" | "ticker";
type Filter = ScanScreenKey | "all";

/** Kolom tampilan ala TradingView: ringkas = harga+level, performa = +nilai transaksi,
 * teknikal = semua kolom. Satu state menggantikan toggle boolean lama. */
type ColumnPreset = "ringkas" | "performa" | "teknikal";

const COLUMN_PRESETS: readonly (readonly [ColumnPreset, string])[] = [
	["ringkas", "Ringkas"],
	["performa", "Performa"],
	["teknikal", "Teknikal"],
];

/** Filter simpanan: kombinasi filter+urutan yang paling sering dipakai. */
const SAVED_PRESETS: readonly { key: string; label: string; filter: Filter; sort: Sort }[] = [
	{ key: "likuid-momentum", label: "Likuid + momentum", filter: "relative_strength", sort: "momentum" },
	{ key: "tenang-hampir", label: "Tenang + hampir lolos", filter: "tier1_setup", sort: "quiet" },
	{ key: "breakout", label: "Penembus 40 hari", filter: "breakout", sort: "breakout" },
];

const SORTS: readonly (readonly [Sort, string])[] = [
	["closest", "Terkait aturan"],
	["momentum", "Momentum terkuat"],
	["breakout", "Paling menembus 40 hari"],
	["quiet", "Paling tenang"],
	["turnover", "Nilai transaksi terbesar"],
	["ticker", "A–Z"],
];

export default function Scanner() {
	const nonce = usePlanRefreshSignal();
	const [payload, setPayload] = useState<ScanPayload | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<Sort>("closest");
	const [preset, setPreset] = useState<ColumnPreset>("ringkas");
	const showTech = preset === "teknikal";
	const showPerf = preset !== "ringkas";

	useEffect(() => {
		let alive = true;
		setFailed(null);
		scanApi
			.get()
			.then((data) => alive && setPayload(data))
			.catch((error: Error) => alive && setFailed(error.message));
		return () => {
			alive = false;
		};
	}, [nonce]);

	const selectedScreen = payload?.screens.find((screen) => screen.key === filter) ?? null;
	const band = payload ? bandCopy(payload.regime.band) : null;

	const rows = useMemo(() => {
		if (!payload) return [];
		const needle = query.trim().toUpperCase();
		const list = payload.rows.filter(
			(row) =>
				(filter === "all" || row.screens.includes(filter)) &&
				(needle === "" || row.ticker.includes(needle)),
		);
		const sorted = [...list];
		switch (sort) {
			case "momentum":
				return sorted.sort((a, b) => b.rs_rating - a.rs_rating);
			case "breakout":
				return sorted.sort((a, b) => b.breakout_pct - a.breakout_pct);
			case "quiet":
				return sorted.sort(
					(a, b) =>
						a.vol20 / Math.max(a.vol20_threshold, 0.01) -
						b.vol20 / Math.max(b.vol20_threshold, 0.01),
				);
			case "turnover":
				return sorted.sort((a, b) => (b.turnover_idr ?? 0) - (a.turnover_idr ?? 0));
			case "ticker":
				return sorted.sort((a, b) => a.ticker.localeCompare(b.ticker));
			default:
				return sorted.sort(
					(a, b) =>
						b.conditions_passed - a.conditions_passed || b.rs_rating - a.rs_rating,
				);
		}
	}, [payload, filter, query, sort]);

	if (failed) {
		return (
			<Page>
				<h1 data-state="failed" className="font-display text-[30px] text-[var(--text)]">
					Backend tidak menjawab
				</h1>
				<p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Jalankan <code className="font-mono text-[13px]">./trading-suite run</code> lalu muat
					ulang. Halaman ini membaca seluruh daftar riset, jadi pemuatan pertama tidak instan.
				</p>
				<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">{failed}</p>
			</Page>
		);
	}

	if (!payload) {
		return (
			<Page>
				<p data-state="loading" className="font-mono text-[13px] text-[var(--text-faint)]">
					Menyaring seluruh daftar — pertama kali butuh waktu, setelah itu tersimpan.
				</p>
			</Page>
		);
	}

	const columns = showTech ? 10 : showPerf ? 7 : 6;

	return (
		<Page>
			<header className="mb-6">
				<h1 className="font-display text-[32px] leading-tight tracking-[-0.02em] text-[var(--text)] sm:text-[38px]">
					Cari saham
				</h1>
				<p className="mt-3 max-w-[76ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Satu baris untuk setiap saham yang lolos syarat dasar riset. Filter di bawah memakai
					aturan yang sama dengan halaman Hari ini — setiap filter menunjukkan jumlah hasil dan
					artinya. Kolom tampilan bisa diganti: Ringkas, Performa, Teknikal.
				</p>
			</header>

			{band && (
				<div
					data-tape={payload.freshness?.stale ? "stale" : "current"}
					className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border px-4 py-2.5"
					style={{
						borderColor: payload.freshness?.stale ? "var(--gold)" : "var(--border)",
						borderLeftWidth: 3,
						borderLeftColor: payload.freshness?.stale ? "var(--gold)" : "var(--border)",
					}}
				>
					<span className="text-[13px] text-[var(--text-dim)]">
						Kondisi pasar:{" "}
						<b className="text-[var(--text)]" style={{ color: band.tone }}>
							{band.label}
						</b>{" "}
						→ {band.advice}
					</span>
					<Link
						to="/"
						className="text-[12px] text-[var(--text-faint)] underline underline-offset-2 hover:text-[var(--text)]"
					>
						lihat Hari ini →
					</Link>
					{payload.freshness ? (
						<span
							className="ml-auto font-mono text-[10px] text-[var(--text-ghost)]"
							title={
								payload.freshness.stale
									? `Data bar berakhir ${payload.freshness.bars_session}; sesi terakhir bursa ${payload.freshness.expected_session}. Muat ulang data sebelum bertindak.`
									: `Data bar berakhir ${payload.freshness.bars_session}; sesuai jam bursa.`
							}
						>
							data per {payload.freshness.bars_session}
							{payload.freshness.stale ? " · perbarui dulu" : ""}
						</span>
					) : null}
				</div>
			)}

			<Section
				title={`${idr(rows.length)} dari ${idr(payload.rows.length)} saham`}
				subtitle={`Per ${payload.session_label}. ${idr(payload.universe.tradable)} dari ${idr(
					payload.universe.codes,
				)} kode lolos syarat dasar riset; sisanya tidak dihitung.`}
			>
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<Chip active={filter === "all"} count={payload.rows.length} onClick={() => setFilter("all")}>
						Semua saham
					</Chip>
					{payload.screens.map((screen) => {
						const plain = screenCopy(screen.key, screen);
						return (
							<Chip
								key={screen.key}
								active={filter === screen.key}
								count={screen.count}
								disabled={!screen.active}
								title={
									screen.active
										? screen.definition
										: `${plain.label} tidak aktif di pita pasar ini. ${screen.note}`
								}
								onClick={() => setFilter(screen.key)}
							>
								{plain.label}
							</Chip>
						);
					})}
				</div>

				<div className="mb-4 flex flex-wrap items-center gap-2">
					<input
						type="search"
						aria-label="Cari kode saham"
						placeholder="Cari kode — BBCA"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						className="w-[210px] border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-ghost)] focus:border-[var(--border-strong)]"
					/>
					<label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
						Urutkan
						<select
							value={sort}
							onChange={(event) => setSort(event.target.value as Sort)}
							className="border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-[var(--text-dim)] outline-none focus:border-[var(--border-strong)]"
						>
							{SORTS.map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<div className="flex items-center gap-1" role="group" aria-label="Kolom tampilan">
						{COLUMN_PRESETS.map(([value, label]) => (
							<button
								key={value}
								type="button"
								aria-pressed={preset === value}
								onClick={() => setPreset(value)}
								className="border px-2.5 py-1.5 font-mono text-[11px] normal-case"
								style={{
									borderColor: preset === value ? "var(--accent)" : "var(--border)",
									color: preset === value ? "var(--text)" : "var(--text-faint)",
								}}
							>
								{label}
							</button>
						))}
					</div>
					<span className="ml-auto font-mono text-[10px] text-[var(--text-ghost)]">
						Klik saham untuk periksa lengkap
					</span>
				</div>

				<div className="mb-4 flex flex-wrap items-center gap-2">
					<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
						Cepat:
					</span>
					{SAVED_PRESETS.map((item) => (
						<button
							key={item.key}
							type="button"
							onClick={() => {
								setFilter(item.filter);
								setSort(item.sort);
							}}
							className="border border-[var(--border)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
						>
							{item.label}
						</button>
					))}
				</div>

				<ScreenNote screens={payload.screens} screen={selectedScreen} />

				<div className="max-h-[72vh] overflow-auto border border-[var(--border)] bg-[var(--panel)]">
					<table
						className={
							"w-full border-collapse text-left " + (showTech ? "min-w-[960px]" : showPerf ? "min-w-[800px]" : "min-w-[640px]")
						}
					>
						<thead className="sticky top-0 z-10 bg-[var(--panel-2)] font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
							<tr>
								<th className="px-3 py-2">Saham</th>
								<th className="px-2 py-2 text-right">Harga</th>
								<th className="px-2 py-2 text-right">Hari ini</th>
								{showTech && <th className="px-2 py-2 text-right">40 hari</th>}
								{showTech && <th className="px-2 py-2 text-right">Momentum</th>}
								{showTech && <th className="px-2 py-2 text-right">Volatilitas</th>}
								{showPerf && <th className="px-2 py-2 text-right">Nilai transaksi</th>}
								<th className="px-2 py-2 text-center">Support / Resistance</th>
								<th className="px-2 py-2">Status</th>
								<th className="px-3 py-2">Periksa</th>
							</tr>
						</thead>
							<tbody className="font-mono text-[11px]">
							{rows.map((row) => (
								<Row key={row.ticker} row={row} showTech={showTech} showPerf={showPerf} />
							))}
							{rows.length === 0 && (
								<tr data-state="empty">
									<td colSpan={columns} className="px-4 py-8 text-center text-[13px] text-[var(--text-faint)]">
										Tidak ada saham yang lolos filter ini malam ini.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
				<p className="mt-2 max-w-[90ch] text-[11px] leading-relaxed text-[var(--text-ghost)]">
					Support = {TERMS.support}. Resistance = {TERMS.resistance}. Angka ×N setelah harga
					level = sudah N kali harga berbalik arah di area itu dalam satu tahun terakhir.
				</p>
			</Section>
		</Page>
	);
}

function Chip({
	active,
	count,
	disabled = false,
	title,
	onClick,
	children,
}: {
	active: boolean;
	count: number;
	disabled?: boolean;
	title?: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			disabled={disabled}
			data-state={count === 0 ? "zero" : active ? "selected" : disabled ? "disabled" : "filled"}
			title={title}
			onClick={onClick}
			className="flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
			style={{
				borderColor: active ? "var(--accent)" : "var(--border)",
				background: active ? "var(--accent)" : "transparent",
				color: active ? "var(--accent-fg)" : "var(--text-faint)",
			}}
		>
			{children}
			<span
				className="tabular-nums"
				style={{ color: active ? "var(--accent-fg)" : "var(--text-ghost)" }}
			>
				{idr(count)}
			</span>
		</button>
	);
}

function ScreenNote({
	screens,
	screen,
}: {
	screens: ScanPayload["screens"];
	screen: ScanPayload["screens"][number] | null;
}) {
	if (!screen) {
		return (
			<div className="mb-4 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
				<p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
					Setiap filter dan artinya. Hanya <b className="text-[var(--text)]">Lolos semua aturan</b>{" "}
					yang punya hasil terukur sendiri; sisanya adalah syarat yang menjelaskan posisi sebuah
					saham.
				</p>
				<dl className="mt-3 space-y-1.5">
					{screens.map((s) => {
						const plain = screenCopy(s.key, s);
						return (
							<div key={s.key} className="flex flex-wrap gap-x-3 text-[11px] leading-relaxed">
								<dt className="w-[158px] shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text)]">
									{plain.label}{" "}
									<span className="text-[var(--text-ghost)]">({idr(s.count)})</span>
								</dt>
								<dd className="max-w-[82ch] text-[var(--text-faint)]">
									{plain.meaning}{" "}
									{!s.active && <i className="text-[var(--gold)]">Tidak aktif di pita ini.</i>}
								</dd>
							</div>
						);
					})}
				</dl>
			</div>
		);
	}
	const plain = screenCopy(screen.key, screen);
	return (
		<div className="mb-4 border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
			<p className="text-[12px] leading-relaxed text-[var(--text-dim)]">
				<b className="text-[var(--text)]">{plain.label}.</b> {plain.meaning}
			</p>
			<details className="mt-1">
				<summary className="cursor-pointer text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)]">
					Definisi teknis dan hasil terukur
				</summary>
				<p className="mt-1 text-[11px] leading-relaxed text-[var(--text-faint)]">{screen.definition}</p>
				<p className="mt-1 text-[11px] leading-relaxed text-[var(--text-faint)]">{screen.note}</p>
				{screen.measured && (
					<p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
						{screen.kind === "strategy" ? "Terukur" : "Sapuan"}:{" "}
						<b className="text-[var(--text-dim)]">
							{pct(screen.measured.win_rate ?? screen.measured.sweep_win_rate, 1)} menang /{" "}
							{(screen.measured.avg_ret_pct ?? screen.measured.sweep_avg_ret_pct ?? 0) >= 0 ? "+" : ""}
							{(screen.measured.avg_ret_pct ?? screen.measured.sweep_avg_ret_pct ?? 0).toFixed(2)}%
						</b>{" "}
						({idr(screen.measured.trades ?? screen.measured.sweep_trades ?? 0)} transaksi)
						{screen.measured.holdout_win_rate != null && (
							<> · holdout {pct(screen.measured.holdout_win_rate, 1)} menang</>
						)}
						.{" "}
						<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text)]">
							Metode dan batasnya →
						</Link>
					</p>
				)}
			</details>
		</div>
	);
}

function Row({ row, showTech, showPerf }: { row: ScanRow; showTech: boolean; showPerf: boolean }) {
	const badges = row.screens.filter(
		(key) => key === "tier1" || key === "tier1_setup" || key === "capitulation",
	);
	return (
		<tr className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
			<td className="px-3 py-1.5">
				<Link
					to="/deep/$ticker"
					params={{ ticker: row.ticker }}
					className="font-display text-[15px] text-[var(--text)] hover:underline hover:underline-offset-4"
				>
					{row.ticker}
				</Link>
			</td>
			<td className="tabular px-2 py-1.5 text-right text-[var(--text-dim)]">{idr(row.close)}</td>
			<td className="tabular px-2 py-1.5 text-right">
				<span style={{ color: (row.change_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
					{pctRaw(row.change_pct, 1)}
				</span>
			</td>
			{showTech && (
				<td className="tabular px-2 py-1.5 text-right">
					<span style={{ color: row.conditions.breakout ? "var(--up)" : "var(--text-faint)" }}>
						{(row.breakout_pct >= 0 ? "+" : "") + row.breakout_pct.toFixed(2) + "%"}
					</span>
				</td>
			)}
			{showTech && (
				<td className="tabular px-2 py-1.5 text-right">
					<span
						style={{
							color: row.conditions.relative_strength ? "var(--text)" : "var(--text-faint)",
						}}
					>
						{row.rs_rating.toFixed(0)}
					</span>
				</td>
			)}
			{showTech && (
				<td className="tabular px-2 py-1.5 text-right">
					<span style={{ color: row.conditions.quiet_vol ? "var(--up)" : "var(--text-faint)" }}>
						{row.vol20.toFixed(1)}
					</span>
					<span className="ml-1 text-[9px] text-[var(--text-ghost)]">
						maks {row.vol20_threshold.toFixed(1)}
					</span>
				</td>
			)}
			{showPerf && (
				<td className="tabular px-2 py-1.5 text-right text-[var(--text-faint)]">
					{compactIdr(row.turnover_idr)}
				</td>
			)}
			<td className="px-2 py-1.5 text-center">
				<Levels row={row} />
			</td>
			<td className="px-2 py-1.5">
				{badges.length === 0 ? (
					<span className="text-[var(--text-ghost)]">—</span>
				) : (
					<span className="flex flex-wrap gap-1">
						{badges.map((key) => (
							<span
								key={key}
								className="rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em]"
								style={{
									color: key === "tier1" ? "var(--up)" : "var(--gold)",
									background:
										key === "tier1"
											? "color-mix(in srgb, var(--up) 10%, transparent)"
											: "color-mix(in srgb, var(--gold) 10%, transparent)",
								}}
							>
								{key === "tier1" ? "lolos" : key === "capitulation" ? "pantau" : "hampir"}
							</span>
						))}
					</span>
				)}
			</td>
			<td className="px-3 py-1.5">
				<Link
					to="/deep/$ticker"
					params={{ ticker: row.ticker }}
					className="text-[9px] uppercase tracking-[0.08em] text-[var(--text-faint)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)]"
				>
					Periksa →
				</Link>
			</td>
		</tr>
	);
}

function Levels({ row }: { row: ScanRow }) {
	const sides: [string, number | null, number | null, string][] = [
		["S", row.support, row.support_touches, "var(--up)"],
		["R", row.resistance, row.resistance_touches, "var(--down)"],
	];
	if (row.support == null && row.resistance == null)
		return (
			<span className="text-[var(--text-ghost)]" title="Belum ada level terkonfirmasi dalam setahun terakhir">
				—
			</span>
		);
	return (
		<span
			className="flex items-center justify-center gap-3 whitespace-nowrap"
			title="Level terdekat tempat harga pernah berbalik; ×N = sudah N kali berbalik arah di sana dalam setahun terakhir"
		>
			{sides.map(([label, level, touches, color]) => (
				<span key={label} style={{ color: level == null ? "var(--text-ghost)" : color }}>
					{label} {level == null ? "—" : idr(level)}
					{touches != null && touches > 0 && <b className="ml-0.5 font-semibold">×{touches}</b>}
				</span>
			))}
		</span>
	);
}

function compactIdr(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return "—";
	if (value >= 1e12) return `Rp ${(value / 1e12).toFixed(1)} T`;
	if (value >= 1e9) return `Rp ${(value / 1e9).toFixed(1)} B`;
	if (value >= 1e6) return `Rp ${(value / 1e6).toFixed(0)} M`;
	return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}
