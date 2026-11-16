/**
 * Alert Book — the nightly feed as a glance: verdict, ranked entries, NO_TRADE.
 *
 * Every number comes from /api/alerts/feed (the plan's own payload, re-shaped
 * server-side). The panel can render only designed states: loading, error,
 * stale, NO_TRADE, entries, and overflow into the watchlist.
 */

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { feedApi, type AlertFeed, type FeedEntry } from "@/lib/api/feed";
import { usePlanRefreshSignal } from "@/lib/refresh";
import { idr } from "@/components/plan";

const STATE_WORD: Record<string, string> = {
	ENTER: "Entry",
	WAIT: "Tunggu",
	NO_TRADE: "Tidak trade",
	DATA_UNSAFE: "Data tidak aman",
};

const STATE_TONE: Record<string, string> = {
	ENTER: "var(--up)",
	WAIT: "var(--gold)",
	NO_TRADE: "var(--gold)",
	DATA_UNSAFE: "var(--down)",
};

function EntryCard({ entry }: { entry: FeedEntry }) {
	return (
		<li className="border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="flex items-baseline justify-between gap-3">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="font-mono text-[11px] text-[var(--text-ghost)]">
						#{entry.rank}
					</span>
					<Link
						to="/deep/$ticker"
						params={{ ticker: entry.ticker }}
						className="font-display text-[17px] tracking-tight text-[var(--text)] underline-offset-4 hover:underline"
					>
						{entry.ticker}
					</Link>
					<span className="truncate text-[12px] text-[var(--text-dim)]">
						{entry.name}
					</span>
				</div>
				<span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
					{entry.position_idr != null ? `size ${idr(entry.position_idr)}` : null}
				</span>
			</div>
			<p className="mt-1 text-[13px] leading-relaxed text-[var(--text-dim)]">{entry.why}</p>
			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
				<div>
					<p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
						Entry
					</p>
					<p className="font-mono text-[13px] text-[var(--text)]">
						{entry.entry_ref != null ? idr(entry.entry_ref) : "—"}
					</p>
				</div>
				<div>
					<p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
						Target
					</p>
					<p className="font-mono text-[13px]" style={{ color: "var(--up)" }}>
						{entry.target_price != null ? idr(entry.target_price) : "—"}
						{entry.target_pct != null ? ` (${entry.target_pct > 0 ? "+" : ""}${entry.target_pct}%)` : ""}
					</p>
				</div>
				<div>
					<p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
						Stop
					</p>
					<p className="font-mono text-[13px]" style={{ color: "var(--down)" }}>
						{entry.stop_price != null ? idr(entry.stop_price) : "—"}
						{entry.stop_pct != null ? ` (${entry.stop_pct}%)` : ""}
					</p>
				</div>
				<div>
					<p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
						Risiko Rp
					</p>
					<p className="font-mono text-[13px] text-[var(--text)]">
						{entry.max_loss_idr != null ? idr(entry.max_loss_idr) : "—"}
					</p>
				</div>
			</div>
		</li>
	);
}

export function AlertBook() {
	const nonce = usePlanRefreshSignal();
	const [feed, setFeed] = useState<AlertFeed | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		setFailed(null);
		feedApi
			.get()
			.then((data) => {
				if (!alive) return;
				setFeed(data);
				setLoading(false);
			})
			.catch((error: Error) => {
				if (!alive) return;
				setFailed(error.message);
				setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [nonce]);

	if (loading && !feed) {
		return (
			<section className="border border-[var(--border)] bg-[var(--panel)] p-5">
				<p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
					Alert · memuat…
				</p>
			</section>
		);
	}

	if (failed) {
		return (
			<section
				className="border border-[var(--border)] bg-[var(--panel)] p-5"
				style={{ borderLeftWidth: 3, borderLeftColor: "var(--down)" }}
			>
				<p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
					Alert · gagal memuat
				</p>
				<p className="mt-1 text-[13px] text-[var(--text-dim)]">{failed}</p>
				<button
					type="button"
					onClick={() => {
						setLoading(true);
						feedApi
							.get()
							.then((data) => {
								setFeed(data);
								setLoading(false);
							})
							.catch((error: Error) => {
								setFailed(error.message);
								setLoading(false);
							});
					}}
					className="mt-3 border border-[var(--border)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text)] hover:bg-[var(--panel-raise)]"
				>
					Coba lagi
				</button>
			</section>
		);
	}

	if (!feed) return null;

	const tone = STATE_TONE[feed.state] ?? "var(--gold)";
	const hasEntries = feed.entries.length > 0;

	return (
		<section
			className="relative border border-[var(--border)] bg-[var(--panel)]"
			style={{ borderLeftWidth: 3, borderLeftColor: tone }}
			aria-live="polite"
		>
			<div className="p-5 sm:p-6">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
						Alert · {feed.session_label} · entry di open {feed.next_session ?? "—"}
					</p>
					{feed.stale ? (
						<span
							className="border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
							style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
						>
							data {feed.data_age_days ?? "?"} hari — periksa dulu
						</span>
					) : null}
				</div>
				<div className="mt-2 flex items-baseline gap-3">
					<span
						className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
						style={{ background: tone }}
						aria-hidden
					/>
					<span
						className="font-display text-[26px] leading-none tracking-[-0.01em]"
						style={{ color: tone }}
					>
						{STATE_WORD[feed.state] ?? feed.state}
					</span>
					<span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
						breadth {feed.regime.breadth != null ? Math.round(feed.regime.breadth * 100) : "—"}%
					</span>
				</div>

				{hasEntries ? (
					<>
						<ul className="mt-4 flex flex-col gap-3">
							{feed.entries.map((entry) => (
								<EntryCard key={entry.ticker} entry={entry} />
							))}
						</ul>
						{feed.book_overflow.length > 0 || feed.watchlist_count > 0 ? (
							<p className="mt-3 text-[12px] text-[var(--text-faint)]">
								+{feed.book_overflow.length + feed.watchlist_count} kandidat lain
								masuk watchlist — maksimal 5 posisi terbuka sesuai aturan risiko.
							</p>
						) : null}
					</>
				) : (
					<div className="mt-3">
						<p className="text-[14px] leading-relaxed text-[var(--text)]">
							{feed.headline ??
								"Kondisi tidak terpenuhi — tidak ada yang layak entry malam ini."}
						</p>
						{feed.no_trade_reasons.length > 0 ? (
							<ul className="mt-2 flex flex-col gap-1">
								{feed.no_trade_reasons.map((reason) => (
									<li
										key={reason}
										className="border-l-2 pl-3 text-[13px] text-[var(--text-dim)]"
										style={{ borderColor: "var(--gold)" }}
									>
										{reason}
									</li>
								))}
							</ul>
						) : null}
					</div>
				)}

				{feed.study.win_rate != null ? (
					<p className="mt-4 font-mono text-[11px] leading-relaxed text-[var(--text-ghost)]">
						Ekspektasi studi (bukan malam ini): {Math.round(feed.study.win_rate)}% win ·{" "}
						{feed.study.avg_ret_pct != null
							? `${feed.study.avg_ret_pct > 0 ? "+" : ""}${feed.study.avg_ret_pct}%/trade`
							: "—"}{" "}
						· {feed.study.oos_trades ?? "?"} trade out-of-sample
					</p>
				) : null}
			</div>
		</section>
	);
}
