/**
 * Hari ini — halaman pertama.
 *
 * Dibaca dari atas ke bawah seperti satu keputusan: status pasar, tanggal
 * datanya, kandidat beserta risikonya, lalu daftar pantau. Angka teknis dan
 * bukti tetap ada di balik satu bagian "Lihat angka" — dekat, tetapi tidak
 * menghalangi pembaca baru.
 */

import { useEffect, useState } from "react";
import { planApi, type Plan } from "@/lib/api/plan";
import { usePlanRefreshSignal } from "@/lib/refresh";
import { AlertBook } from "@/components/AlertBook";
import { CapitulationWatch, RegimeDriftStrip } from "@/components/regimes";
import { bandCopy } from "@/lib/present";
import {
	EvidenceBadge,
	LimitsPanel,
	Section,
	VerdictHero,
	WatchRow,
	idr,
	pct,
} from "@/components/plan";

function usePlan() {
	// Bump by the header's refresh button once new bars have been screened.
	const nonce = usePlanRefreshSignal();
	const [plan, setPlan] = useState<Plan | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let alive = true;
		setError(null);
		planApi
			.plan()
			.then((p) => alive && setPlan(p))
			.catch((e: Error) => alive && setError(e.message));
		return () => {
			alive = false;
		};
	}, [nonce]);
	return { plan, error };
}

export default function Tonight() {
	const { plan, error } = usePlan();

	if (error) {
		return (
			<Page>
				<h1 className="font-display text-[30px] text-[var(--text)]">Backend tidak menjawab</h1>
				<p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Jalankan <code className="font-mono text-[13px]">./trading-suite run</code> lalu muat
					ulang halaman. Analisis pertama membaca seluruh daftar riset, jadi butuh beberapa
					detik.
				</p>
				<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">{error}</p>
			</Page>
		);
	}

	if (!plan) {
		return (
			<Page>
				<p className="font-mono text-[13px] text-[var(--text-faint)]">
					Membaca data riset — beberapa detik.
				</p>
			</Page>
		);
	}

	const { regime, watchlist, evidence } = plan;
	const band = bandCopy(regime.band);

	return (
		<Page>
			<VerdictHero plan={plan} />

			{plan.holdout && !plan.holdout.winners_surviving && (
				<div className="mb-6 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-4">
					<p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
						<span className="font-semibold text-[var(--text)]">Sebelum menindaklanjuti kandidat:</span>{" "}
						dari {plan.holdout.search_cells} kombinasi aturan yang dicoba riset, hanya{" "}
						{plan.holdout.search_cells_clearing} yang lolos batas 80% menang dan +5% per transaksi
						sekaligus — dan {plan.holdout.winners_surviving} dari {plan.holdout.winners_tested} yang
						di bawa ke depan tetap bertahan di data uji. Hasil terbaik yang pernah dicapai:{" "}
						<span className="text-[var(--text)]">
							{pct(plan.holdout.best_holdout_win_rate, 1)} menang dan +
							{(plan.holdout.best_holdout_avg_ret_pct ?? 0).toFixed(2)}% per transaksi
						</span>
						.{" "}
						<a
							href="/method#holdout"
							className="underline decoration-[var(--border-strong)] underline-offset-2 hover:text-[var(--text)]"
						>
							Baca catatan holdout
						</a>
					</p>
				</div>
			)}

			{/* Kandidat malam ini: kartu berbahasa sederhana dari sisi server,
			    sudah membawa harga masuk, target, stop, dan risiko rupiah. */}
			<AlertBook />

			{watchlist.length > 0 && (
				<Section
					title="Hampir lolos: daftar pantau"
					subtitle="Belum bisa dibeli. Setiap saham di sini unggul di momentum dan sedang berada tepat di bawah batas harganya — ini daftar yang menunggu sesi berikutnya."
					right={`${watchlist.length} saham`}
				>
					<ul className="border border-[var(--border)] bg-[var(--panel)]">
						{watchlist.map((w) => (
							<WatchRow key={w.ticker} item={w} />
						))}
					</ul>
				</Section>
			)}

			{plan.capitulation_watch?.length > 0 && <CapitulationWatch plan={plan} />}

			<Section
				title="Seberapa andal metodenya"
				subtitle="Angka di atas nyata, dan batasnya juga. Baca ini sebelum transaksi pertama, bukan setelahnya."
			>
				<div className="grid gap-5 lg:grid-cols-[1fr_320px]">
					<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
						<p className="max-w-[78ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
							Diukur pada data yang tidak dilihat saat aturannya dicari:{" "}
							{idr(evidence.oos_trades)} transaksi selesai, dengan biaya dan slippage di dalam
							setiap transaksinya. Gabungannya {pct(evidence.win_rate, 1)} transaksi untung,
							rata-rata{" "}
							{evidence.avg_ret_pct != null ? `+${evidence.avg_ret_pct.toFixed(2)}%` : "—"} tiap
							transaksi. Hasilnya tidak rata — fold demi fold:{" "}
							<span className="font-mono text-[12px] text-[var(--text)]">
								{evidence.fold_detail || "—"}
							</span>
						</p>
						<p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
							{evidence.caveat}
						</p>
					</div>
					<EvidenceBadge evidence={evidence} roundTripPct={plan.costs.round_trip} />
				</div>
			</Section>

			<details className="mt-8">
				<summary className="cursor-pointer text-[13px] text-[var(--text-faint)] hover:text-[var(--text-dim)]">
					Lihat angka dan cara perhitungannya
				</summary>
				<div className="mt-5">
					<Section
						title="Kondisi pasar (syarat semua saham)"
						subtitle="Saat syarat ini tertutup, tidak ada saham di daftar riset yang memenuhi aturan — itu metode yang melindungi, bukan aplikasi yang rusak."
					>
						<div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
							<span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
								Pita malam ini
							</span>
							<span className="font-display text-[18px] font-semibold" style={{ color: band.tone }}>
								{band.label}
							</span>
							<span className="text-[12px] text-[var(--text-dim)]">→ {band.advice}</span>
						</div>
						<RegimeDriftStrip regime={regime} />
						<div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
							<Gate
								label="Kondisi pasar (breadth)"
								ok={regime.breadth_open}
								value={pct(regime.breadth, 1)}
								need={`butuh ${pct(regime.breadth_threshold, 0)}`}
								note={`Berapa banyak dari ${idr(regime.universe_size)} saham yang berada di atas rata-rata 200 hari miliknya sendiri. Median lima tahun: ${pct(regime.breadth_median, 0)}.`}
							/>
							<Gate
								label="IHSG di atas rata-rata 200 hari"
								ok={regime.index_above_200 ?? false}
								required={plan.required_gates.includes("index_above_200")}
								value={regime.index_above_200 ? "Ya" : "Tidak"}
								need={idr(regime.index_close)}
								note="Konteks saja — metode ini berdagang pada kondisi seluruh daftar, bukan pada indeks."
							/>
						</div>
					</Section>
					<LimitsPanel plan={plan} />
				</div>
			</details>
		</Page>
	);
}

function Gate({
	label,
	ok,
	value,
	need,
	note,
	required = true,
}: {
	label: string;
	ok: boolean;
	value: string;
	need: string;
	note: string;
	required?: boolean;
}) {
	return (
		<div className="bg-[var(--panel)] p-5">
			<div className="flex items-baseline justify-between gap-3">
				<span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
					{label}
				</span>
				<span
					className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
					style={{
						color: !required ? "var(--text-ghost)" : ok ? "var(--up)" : "var(--gold)",
						background: !required
							? "var(--panel-3)"
							: ok
								? "color-mix(in srgb, var(--up) 12%, transparent)"
								: "color-mix(in srgb, var(--gold) 14%, transparent)",
					}}
				>
					{required ? (ok ? "terbuka" : "tertutup") : "konteks"}
				</span>
			</div>
			<div className="tabular mt-2 font-mono text-[30px] font-bold leading-none text-[var(--text)]">
				{value}
			</div>
			<div className="mt-1 font-mono text-[11px] text-[var(--text-ghost)]">{need}</div>
			<p className="mt-3 max-w-[56ch] text-[12px] leading-relaxed text-[var(--text-faint)]">{note}</p>
		</div>
	);
}

export function Page({ children }: { children: React.ReactNode }) {
	return <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">{children}</div>;
}
