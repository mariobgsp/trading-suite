/**
 * One name: what the method thinks of it, priced as a trade.
 *
 * Reads the same gate chain the buy list reads, so a name that is not in the
 * plan still gets a full, honest answer — "why not" is the commonest question
 * a screen raises, and answering it is the point of this page.
 */

import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { api, type HistoryResponse } from "@/lib/api";
import { planApi, type GateKey, type PlanDetail } from "@/lib/api/plan";
import { usePlanRefreshSignal } from "@/lib/refresh";
import { GateList, OrderTicket, ReasonBlock, idr, pct, pctRaw } from "@/components/plan";
import MarketChart, { type PriceLine } from "@/components/MarketChart";
import { Page } from "./Tonight";

export default function Name() {
	const { ticker } = useParams({ from: "/name/$ticker" });
	const nonce = usePlanRefreshSignal();
	const [detail, setDetail] = useState<PlanDetail | null>(null);
	const [requiredGates, setRequiredGates] = useState<GateKey[] | undefined>();
	const code = (ticker ?? "").toUpperCase();

	useEffect(() => {
		let alive = true;
		setDetail(null);
		planApi.detail(code).then((d) => alive && setDetail(d)).catch(() => {});
		return () => {
			alive = false;
		};
	}, [code, nonce]);

	/* Which gates the running family applies, so the ones it ignores can be
	 * dimmed rather than shown as failures. Read off the plan rather than the
	 * method page: same request the plan already made, and one source of truth. */
	useEffect(() => {
		let alive = true;
		planApi
			.plan()
			.then((p) => alive && setRequiredGates(p.required_gates))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [nonce]);

	if (!detail) {
		return (
			<Page>
				<p className="font-mono text-[13px] text-[var(--text-faint)]">Checking {code}…</p>
			</Page>
		);
	}

	const applies = requiredGates ? new Set(requiredGates) : null;
	const failed = detail.gates.filter(
		(g) => !g.passed && (!applies || applies.has(g.key)),
	);

	return (
		<Page>
			<nav className="mb-6 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				<a href="/" className="hover:text-[var(--text)]">
					← back to tonight
				</a>
			</nav>

			<header className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-[var(--border)] pb-6">
				<h1 className="font-display text-[44px] leading-none tracking-[-0.02em] text-[var(--text)]">
					{code}
				</h1>
				{detail.close != null && (
					<span className="tabular font-mono text-[20px] text-[var(--text-dim)]">
						{idr(detail.close)}
					</span>
				)}
				<span
					className="rounded-sm px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]"
					style={{
						color: detail.in_plan ? "var(--up)" : "var(--gold)",
						background: detail.in_plan
							? "color-mix(in srgb, var(--up) 12%, transparent)"
							: "color-mix(in srgb, var(--gold) 14%, transparent)",
					}}
				>
					{detail.in_plan ? "in tonight's plan" : "not buyable"}
				</span>
				<span className="ml-auto font-mono text-[11px] text-[var(--text-ghost)]">
					as of {detail.as_of}
				</span>
			</header>

			{!detail.in_plan && failed.length > 0 && (
				<p className="mt-6 max-w-[68ch] border-l-2 border-[var(--gold)] pl-4 text-[14px] leading-relaxed text-[var(--text-dim)]">
					{detail.distance_text ?? "Not close to firing yet."} {failed.length} of{" "}
					{detail.gates.length} conditions are not met.
				</p>
			)}

			<div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-10">
				<section>
					<h2 className="mb-4 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
						Every condition
					</h2>
					{detail.gates.length > 0 ? (
						<GateList gates={detail.gates} required={requiredGates} />
					) : (
						<p className="border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-faint)]">
							Not enough history for {code} to be measured against this method.
						</p>
					)}
				</section>

				{detail.in_plan && detail.geometry && (
					<section>
						<h2 className="mb-4 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
							How to trade it
						</h2>
						<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
							<div className="grid grid-cols-3 gap-4">
								<Price label="Reference" value={idr(detail.geometry.entry_ref)} note="last close" />
								<Price label="Target" value={idr(detail.geometry.target_price)} note={`+${detail.geometry.target_pct}%`} color="var(--up)" />
								<Price label="Stop" value={idr(detail.geometry.stop_price)} note={`−${detail.geometry.stop_pct}%`} color="var(--down)" />
							</div>
							<p className="mt-4 border-t border-[var(--border)] pt-3 font-mono text-[11px] leading-relaxed text-[var(--text-faint)]">
								On Rp1,000,000 that is roughly{" "}
								<span className="text-[var(--up)]">+{idr(detail.geometry.target_gain_idr_1m)}</span> at
								target against{" "}
								<span className="text-[var(--down)]">
									−{idr(detail.geometry.max_loss_idr_1m)}
								</span>{" "}
				at the stop, including {pctRaw(detail.geometry.gross_risk_pct, 1)} of costs on the loss.
							</p>
						</div>
						<div className="mt-6">
							<OrderTicket
								ticker={code}
								geometry={detail.geometry}
								turnoverIdr={detail.turnover_idr}
							/>
						</div>
					</section>
				)}
			</div>

			{detail.reason ? (
				<div className="mt-6">
					<ReasonBlock reason={detail.reason} />
				</div>
			) : null}

			<PriceHistory
				code={code}
				breakoutLevel={detail.breakout_level}
				geometry={detail.geometry}
				reason={detail.reason}
			/>

			<section className="mt-10 border border-[var(--border)] bg-[var(--panel-2)] p-5">
				<h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
					Why this name clears {pct(detail.evidence.win_rate, 1)} of the time
				</h2>
				<p className="mt-2 max-w-[72ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
					Not because of {code} specifically. The same six conditions were applied to every name in
					the universe on every session of the study's walk-forward folds, and the{" "}
					{pct(detail.evidence.win_rate, 1)} figure comes from all{" "}
					{idr(detail.evidence.oos_trades)} trades that were taken under them.
				</p>
			</section>
		</Page>
	);
}

/**
 * The candles, with the levels the method trades against drawn on them.
 *
 * The point is checkability: the 40-session high is the line that had to break,
 * and the target and stop are where the trade is managed to. Seeing them on the
 * same chart as the price is what separates "the app says so" from "you can
 * look at it".
 */
function PriceHistory({
	code,
	breakoutLevel,
	geometry,
	reason,
}: {
	code: string;
	breakoutLevel: number | null;
	geometry: PlanDetail["geometry"];
	reason: PlanDetail["reason"];
}) {
	const [data, setData] = useState<HistoryResponse | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let alive = true;
		setData(null);
		setFailed(false);
		api
			.getCached<HistoryResponse>(`/api/market/history/${code}?period=1y`)
			.then((d) => alive && setData(d))
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
		};
	}, [code]);

	// One marker: the session the close first cleared the 40-session high. The
	// entry itself is the *next* session, which has no bar yet to point at.
	const annotations = reason?.breakout_date
		? [{ date: reason.breakout_date, label: "broke out", kind: "breakout" as const }]
		: undefined;

	const lines: PriceLine[] = [];
	if (breakoutLevel != null) {
		lines.push({ price: breakoutLevel, title: "40-day high", style: "dashed" });
	}
	if (geometry) {
		lines.push({ price: geometry.target_price, title: "Target" });
		lines.push({ price: geometry.stop_price, title: "Stop" });
	}

	return (
		<section className="mt-10">
			<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
					Price history
				</h2>
				<span className="font-mono text-[11px] text-[var(--text-ghost)]">
					{lines.length ? lines.map((l) => l.title).join(" · ") : "one year, daily"}
				</span>
			</div>
			<div className="border border-[var(--border)] bg-[var(--panel)] p-2">
				{failed ? (
					<p className="p-6 text-[13px] text-[var(--text-faint)]">
						No price history available for {code}.
					</p>
				) : data?.history?.length ? (
					<MarketChart
						history={data.history}
						indicators={data.indicators}
						height={380}
						priceLines={lines}
						annotations={annotations}
						options={{ showVolume: true, overlayIndicators: ["sma50"] }}
					/>
				) : (
					<p className="p-10 text-center font-mono text-[12px] text-[var(--text-faint)]">
						Loading candles…
					</p>
				)}
			</div>
			<p className="mt-2 max-w-[76ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
				The dashed line is the {breakoutLevel != null ? idr(breakoutLevel) : "40-session"} high
				the close had to beat for this method to fire. Solid lines are where the trade is
				managed to.
			</p>
		</section>
	);
}

function Price({
	label,
	value,
	note,
	color = "var(--text)",
}: {
	label: string;
	value: string;
	note: string;
	color?: string;
}) {
	return (
		<div>
			<div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
				{label}
			</div>
			<div className="tabular mt-1 font-mono text-[18px] font-bold leading-none" style={{ color }}>
				{value}
			</div>
			<div className="mt-1 font-mono text-[10px] text-[var(--text-ghost)]">{note}</div>
		</div>
	);
}