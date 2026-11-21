/**
 * Paper — the book the app plays by itself.
 *
 * Nobody places these orders. Each weekly sync turns the plan's candidates into
 * orders and fills them at the next session's open, so the equity here is the
 * answer to one question: what would have happened to IDR 5,000,000 if every
 * signal had been taken exactly as written. A number a person curates is not
 * that number.
 */

import { useEffect, useMemo, useState } from "react";
import { Page } from "./Tonight";
import { Section, idr, pctRaw } from "@/components/plan";
import { getPaper, type PaperSnapshot } from "@/lib/api/paper";
import { planApi, type Plan } from "@/lib/api/plan";
import { usePlanRefreshSignal } from "@/lib/refresh";

type Phase = "loading" | "empty" | "unsettled" | "ready" | "error";

export default function Paper() {
	const nonce = usePlanRefreshSignal();
	const [snap, setSnap] = useState<PaperSnapshot | null>(null);
	const [plan, setPlan] = useState<Plan | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		getPaper()
			.then((s) => alive && setSnap(s))
			.catch((e: Error) => alive && setError(e.message));
		planApi
			.plan()
			.then((p) => alive && setPlan(p))
			.catch(() => undefined); // the book is readable without tonight's plan
		return () => {
			alive = false;
		};
	}, [nonce]);

	const hasBook = snap?.hasBook ?? false;
	const settledThrough = snap?.settledThrough ?? null;
	const planOpen = plan?.open ?? false;

	const phase = useMemo<Phase>(() => {
		if (error) return "error";
		if (!snap) return "loading";
		if (!hasBook) return "empty";
		// The book is behind the bars: a missed sync, or a backfill not run.
		if (settledThrough && plan?.as_of && settledThrough < plan.as_of) return "unsettled";
		return "ready";
	}, [error, snap, hasBook, settledThrough, plan?.as_of]);

	if (phase === "error") {
		return (
			<Page>
				<Header />
				<Panel title="Buku latihan tidak bisa dibaca">
					<p className="text-[13px] text-[var(--text-faint)]">{error}</p>
				</Panel>
			</Page>
		);
	}

	if (phase === "loading") {
		return (
			<Page>
				<Header />
				<Panel title="Membaca buku latihan…">
					<p className="text-[13px] text-[var(--text-faint)]">
						Mengambil catatan transaksi…
					</p>
				</Panel>
			</Page>
		);
	}

	if (phase === "empty" || !snap) {
		return (
			<Page>
				<Header />
				<Panel title="Buku latihan belum dibuka">
					<p className="max-w-[70ch] text-[13px] leading-relaxed text-[var(--text-faint)]">
						Buku ini terbuka pada sinkronisasi pertama setelah aplikasi dipasang:
						kandidat halaman Hari ini menjadi order, dan pembukaan sesi
						berikutnya mengisinya. Tidak ada yang dipesan dengan tangan, jadi
						tidak ada yang perlu dilakukan selain menunggu jadwal sinkronisasi.
					</p>
				</Panel>
			</Page>
		);
	}

	const stats = snap.stats;
	const positions = snap.open_positions ?? [];
	const trades = snap.closed_trades ?? [];
	const pending = snap.pending_orders ?? [];

	return (
		<Page>
			<Header />

			{phase === "unsettled" && (
				<Panel title="Buku latihan tertinggal dari data terbaru">
					<p className="max-w-[76ch] text-[13px] leading-relaxed text-[var(--text-faint)]">
						Sudah dihitung sampai {settledThrough ?? "—"} padahal sesi terbaru adalah{" "}
						{plan?.as_of ?? "tidak diketahui"}. Batas rugi yang tertembus di tengah
						celah itu belum dibukukan, jadi saldo di bawah belum angka hari ini.
					</p>
				</Panel>
			)}

			<div className="grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
				<Stat label="Saldo" value={`Rp${idr(snap.equity_idr)}`} />
				<Stat label="Tunai" value={`Rp${idr(snap.cash_idr)}`} />
				<Stat
					label="Untung/rugi"
					value={`${(snap.pnl_idr ?? 0) >= 0 ? "+" : ""}Rp${idr(snap.pnl_idr)}`}
					tone={(snap.pnl_idr ?? 0) >= 0 ? "up" : "down"}
				/>
				<Stat label="Hasil" value={pctRaw(snap.return_pct)} />
			</div>

			<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">
				Dimulai {snap.started ?? "—"} · dihitung sampai {settledThrough ?? "—"} ·{" "}
				{planOpen ? "aturan sedang berdagang" : "aturan sedang menahan"} ·{" "}
				{stats ? `${stats.closed_count} selesai / ${stats.open_count} terbuka` : ""}
			</p>

			<Section
				title="Menunggu pembukaan pasar"
				subtitle="Order yang ditempatkan aturan malam ini. Order terisi pada harga pembukaan sesi berikutnya, berapapun pembukaannya — bukan pada level pemicunya."
				right={`${pending.length} order`}
			>
				{pending.length === 0 ? (
					<Empty>Tidak ada order yang menunggu. Aturannya sedang menahan, atau posisinya sudah penuh.</Empty>
				) : (
					<Table
						head={["Ticker", "Shares", "Stop", "Target", "Hold", "Fills"]}
						rows={pending.map((o) => [
							o.ticker,
							idr(o.shares),
							o.stop == null ? "—" : idr(o.stop),
							o.target == null ? "—" : idr(o.target),
							o.hold_bars == null ? "—" : `${o.hold_bars} bars`,
							o.fill_after,
						])}
					/>
				)}
			</Section>

			<Section
				title="Posisi terbuka"
				subtitle="Dihargai dengan penutupan terakhir yang benar-benar tercetak tiap saham. Saham tanpa bar baru menampilkan harga masuknya dan tanggal datanya sendiri, bukan angka karangan."
				right={`${positions.length} positions`}
			>
				{positions.length === 0 ? (
					<Empty>Tanpa posisi. Buku latihan menunggu sinyal berikutnya.</Empty>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[720px] border border-[var(--border)] bg-[var(--panel)] text-[12px]">
							<thead>
								<tr className="border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
									{["Ticker", "Lots", "Entry", "Last", "Unrealised", "Stop", "Target", "Value"].map(
										(h) => (
											<th key={h} className="px-3 py-2 text-left font-normal">
												{h}
											</th>
										),
									)}
								</tr>
							</thead>
							<tbody>
								{positions.map((p) => (
									<tr key={p.order_id} className="border-b border-[var(--border)] last:border-0">
										<td className="px-3 py-2 font-mono font-semibold text-[var(--text)]">{p.ticker}</td>
										<td className="px-3 py-2 font-mono">{idr(p.lots)}</td>
										<td className="px-3 py-2 font-mono">{idr(p.entry_price)}</td>
										<td className="px-3 py-2 font-mono">
											{p.last_price == null ? "—" : idr(p.last_price)}
										</td>
										<td
											className={`px-3 py-2 font-mono ${p.unrealized_idr >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}
										>
											{idr(p.unrealized_idr)} ({pctRaw(p.unrealized_pct)})
										</td>
										<td className="px-3 py-2 font-mono text-[var(--text-faint)]">
											{p.stop == null ? "—" : idr(p.stop)}
										</td>
										<td className="px-3 py-2 font-mono text-[var(--text-faint)]">
											{p.target == null ? "—" : idr(p.target)}
										</td>
										<td className="px-3 py-2 font-mono">{idr(p.value_idr)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Section>

			<Section
				title="Transaksi selesai"
				subtitle="Alasan tiap posisi keluar: batas rugi, target, atau jangka waktu habis. Batas rugi yang tertembus saat gap dicatat pada harga pembukaan, bukan pada level batasnya."
				right={stats?.profit_factor == null ? "" : `PF ${stats.profit_factor}`}
			>
				{trades.length === 0 ? (
					<Empty>No round trip yet. The first one is the first honest number.</Empty>
				) : (
					<Table
						head={["Ticker", "In", "Out", "Entry", "Exit", "P&L", "Return", "Why"]}
						rows={trades.map((t) => [
							t.ticker,
							t.entry_date,
							t.exit_date,
							idr(t.entry_price),
							idr(t.exit_price),
							`${t.pnl_idr >= 0 ? "+" : ""}${idr(t.pnl_idr)}`,
							pctRaw(t.return_pct),
							t.reason,
						])}
					/>
				)}
			</Section>

			<p className="mt-10 max-w-[80ch] font-mono text-[11px] leading-relaxed text-[var(--text-ghost)]">
				Charged on every fill: {stats?.costs.buy_fee_pct ?? 0.15}% buy fee,{" "}
				{stats?.costs.sell_fee_pct ?? 0.25}% sell fee (brokerage plus the final
				sales tax) and {stats?.costs.slippage_pct ?? 0.15}% slippage per side.
				The same model the tickets quote. A paper result read without those costs
				is a different result.
			</p>
		</Page>
	);
}

function Header() {
	return (
		<header className="mb-8">
			<h1 className="font-display text-[26px] tracking-[-0.01em] text-[var(--text)]">
				Akun latihan
			</h1>
			<p className="mt-2 max-w-[76ch] text-[13px] leading-relaxed text-[var(--text-faint)]">
				Uang latihan Rp5 juta — bukan akun nyata, tidak ada order yang dikirim
				ke broker. Aturan dari halaman Hari ini dijalankan otomatis setiap
				sinkronisasi, supaya kelihatan apakah metodenya bertahan dari biayanya
				sendiri pada hari-hari ketika ia berbicara.
			</p>
		</header>
	);
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mt-6 border border-[var(--border)] bg-[var(--panel)] px-5 py-6">
			<h2 className="mb-2 text-[15px] font-semibold text-[var(--text)]">{title}</h2>
			{children}
		</div>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "up" | "down";
}) {
	return (
		<div className="bg-[var(--panel)] px-4 py-3">
			<p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				{label}
			</p>
			<p
				className={`mt-1 font-mono text-[16px] ${
					tone === "up"
						? "text-[var(--up)]"
						: tone === "down"
							? "text-[var(--down)]"
							: "text-[var(--text)]"
				}`}
			>
				{value}
			</p>
		</div>
	);
}

function Empty({ children }: { children: React.ReactNode }) {
	return (
		<p className="border border-[var(--border)] bg-[var(--panel)] px-5 py-6 text-[13px] text-[var(--text-faint)]">
			{children}
		</p>
	);
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[640px] border border-[var(--border)] bg-[var(--panel)] text-[12px]">
				<thead>
					<tr className="border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
						{head.map((h) => (
							<th key={h} className="px-3 py-2 text-left font-normal">
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className="border-b border-[var(--border)] last:border-0">
							{row.map((cell, j) => (
								<td
									key={j}
									className={`px-3 py-2 font-mono ${j === 0 ? "font-semibold text-[var(--text)]" : "text-[var(--text-faint)]"}`}
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
