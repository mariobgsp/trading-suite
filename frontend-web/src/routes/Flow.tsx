/**
 * Flow — a bandarmology-style research panel.
 *
 * The page is intentionally separate from Tonight: the proxy here is not part
 * of the measured plan, and saying so is part of the UI. The cards show
 * technical readouts and a flow direction; the detail pane shows a separate
 * pressure score, never a vendor LPM level.
 */

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
	api,
	fmtIdr,
	fmtNum,
	fmtPct,
	type HistoryRecord,
	type HistoryResponse,
} from "@/lib/api";
import {
	flowApi,
	type FlowCard,
	type FlowCardsResponse,
	type FlowSeries,
	type FlowUniverse,
	type FlowValidation,
} from "@/lib/api/flow";
import { usePlanRefreshSignal } from "@/lib/refresh";
import { ChangeBadge } from "@/components/ui";
import FlowChart from "@/components/FlowChart";
import { Page } from "./Tonight";

const FLOW_TTL = 120_000;

export default function Flow() {
	const nonce = usePlanRefreshSignal();
	const [universe, setUniverse] = useState<FlowUniverse>("watchlist");
	const [cards, setCards] = useState<FlowCardsResponse | null>(null);
	const [cardsError, setCardsError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [series, setSeries] = useState<FlowSeries | null>(null);
	const [history, setHistory] = useState<HistoryRecord[]>([]);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [report, setReport] = useState<FlowValidation | null>(null);
	const [reportBusy, setReportBusy] = useState(false);
	const [reportError, setReportError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		setCardsError(null);
		flowApi
			.cards({ universe, limit: 30, days: 120 })
			.then((data) => alive && setCards(data))
			.catch((error: Error) => alive && setCardsError(error.message));
		return () => {
			alive = false;
		};
	}, [universe, nonce]);

	useEffect(() => {
		if (!cards?.cards.length) return;
		if (selected && cards.cards.some((card) => card.ticker === selected)) return;
		setSelected(cards.cards[0]!.ticker);
	}, [cards, selected]);

	useEffect(() => {
		if (!selected) return;
		let alive = true;
		setSeries(null);
		setHistory([]);
		setDetailError(null);
		setReport(null);
		setReportError(null);

		flowApi
			.series(selected, 120)
			.then((flowSeries) => alive && setSeries(flowSeries))
			.catch((error: Error) => alive && setDetailError(error.message));

		api
			.getCached<HistoryResponse>("/api/market/history/" + selected + "?period=1y", {
				ttl: FLOW_TTL,
			})
			.then((priceHistory) => alive && setHistory(priceHistory.history ?? []))
			.catch(() => alive && setHistory([]));

		return () => {
			alive = false;
		};
	}, [selected, nonce]);

	const selectedCard = cards?.cards.find((card) => card.ticker === selected) ?? null;

	async function reloadCards() {
		setCardsError(null);
		try {
			const data = await flowApi.cards({
				universe,
				limit: 30,
				days: 120,
				refresh: true,
			});
			setCards(data);
		} catch (error) {
			setCardsError(error instanceof Error ? error.message : String(error));
		}
	}

	async function measure() {
		if (!selected) return;
		setReportBusy(true);
		setReportError(null);
		setReport(null);
		try {
			const next = await flowApi.validate({
				tickers: [selected],
				horizon: 5,
				days: 250,
			});
			setReport(next);
		} catch (error) {
			setReportError(error instanceof Error ? error.message : String(error));
		} finally {
			setReportBusy(false);
		}
	}

	return (
		<Page>
			<header className="mb-8">
				<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
					Research panel
				</p>
				<h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[40px]">
					Flow pressure
				</h1>
				<p className="mt-3 max-w-[78ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					A bandarmology-style readout: technicals, a 5-day value, and a
					flow-pressure direction for a bounded universe. The flow line is a{" "}
					<strong className="text-[var(--text)]">transparent proxy</strong>, not
					Bandarmetrics LPM, and it is not used in tonight&rsquo;s plan or verdict.
				</p>
				<div className="mt-4 border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel)] p-4 text-[12px] leading-relaxed text-[var(--text-dim)]">
					<p>
						<strong className="text-[var(--text)]">What this is not.</strong> The
						vendor LPM formula and its broker data are proprietary. The score here
						uses Chaikin Money Flow plus the current IDX foreign-flow print (and
						Stockbit broker rows only on explicit detail requests). Its levels are
						not comparable to the vendor&rsquo;s line. Read the{" "}
						<Link
							to="/method"
							className="underline underline-offset-2 hover:text-[var(--text)]"
						>
							method page
						</Link>{" "}
						for why the plan does not trade a flow proxy.
					</p>
				</div>
			</header>

			<div className="mb-5 flex flex-wrap items-center gap-3">
				<select
					value={universe}
					onChange={(event) => setUniverse(event.target.value as FlowUniverse)}
					className="border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1 font-mono text-[11px] text-[var(--text)]"
					aria-label="Universe"
				>
					<option value="watchlist">Watchlist</option>
					<option value="movers">Most active</option>
					<option value="plan">Tonight&rsquo;s plan</option>
				</select>
				<button
					type="button"
					onClick={reloadCards}
					className="border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1 font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
				>
					Reload cards
				</button>
				<span className="ml-auto font-mono text-[11px] text-[var(--text-ghost)]">
					{cards
						? cards.count +
							" names · " +
							cards.as_of +
							(cards.cache
								? cards.cache.hit
									? " · cache " + cards.cache.age_seconds + "s"
									: " · computed"
								: "")
						: "reading sources…"}
				</span>
			</div>

			{cardsError && (
				<p className="mb-5 border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-dim)]">
					The Flow backend is not answering: {cardsError}
				</p>
			)}

			{cards && !cards.available && (
				<p className="mb-5 border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-dim)]">
					No cards were available. {cards.warnings.join(" ")}
				</p>
			)}

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
				<section>
					<div className="mb-3 flex items-baseline justify-between gap-3">
						<h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
							Cards
						</h2>
						<span className="font-mono text-[10px] text-[var(--text-ghost)]">
							proxy quality
						</span>
					</div>
					<ul className="border border-[var(--border)] bg-[var(--panel)]">
						{(cards?.cards ?? []).map((card) => (
							<li
								key={card.ticker}
								className="border-b border-[var(--border)] last:border-b-0"
							>
								<button
									type="button"
									onClick={() => setSelected(card.ticker)}
									className={
										"w-full text-left transition-colors hover:bg-[var(--panel-3)] " +
										(selected === card.ticker ? "bg-[var(--panel-3)]" : "")
									}
									aria-pressed={selected === card.ticker}
								>
									<CardView card={card} />
								</button>
							</li>
						))}
						{cards && cards.cards.length === 0 && (
							<li className="px-5 py-6 text-[13px] text-[var(--text-faint)]">
								Nothing in this universe has enough history for a card.
							</li>
						)}
						{!cards && !cardsError && (
							<li className="px-5 py-6 font-mono text-[12px] text-[var(--text-faint)]">
								Reading the universe — the first pass pulls one year per name.
							</li>
						)}
					</ul>
					{cards?.warnings.length ? (
						<ul className="mt-3 space-y-1 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
							{cards.warnings.map((warning) => (
								<li key={warning}>· {warning}</li>
							))}
						</ul>
					) : null}
				</section>

				<section className="min-w-0">
					<div className="mb-3 flex items-baseline justify-between gap-3">
						<h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
							{selected ?? "Detail"}
						</h2>
						{selectedCard && <FlowBadge flow={selectedCard.flow} />}
					</div>
					{detailError && (
						<p className="border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--text-dim)]">
							{detailError}
						</p>
					)}
					{!detailError && !series && (
						<p className="border border-[var(--border)] bg-[var(--panel)] p-4 font-mono text-[12px] text-[var(--text-faint)]">
							Loading the proxy series…
						</p>
					)}
					{series && (
						<>
							<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
								<DetailHead card={selectedCard} series={series} />
								<FlowChart series={series} history={history} />
								{series.warnings.length > 0 && (
									<ul className="mt-3 space-y-1 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
										{series.warnings.map((warning) => (
											<li key={warning}>· {warning}</li>
										))}
									</ul>
								)}
							</div>
							<ValidationPanel
								report={report}
								busy={reportBusy}
								error={reportError}
								onMeasure={measure}
							/>
						</>
					)}
				</section>
			</div>
		</Page>
	);
}

function DetailHead({ card, series }: { card: FlowCard | null; series: FlowSeries }) {
	return (
		<div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<span className="font-display text-[24px] font-semibold text-[var(--text)]">
				{series.ticker}
			</span>
			<span className="font-mono text-[11px] text-[var(--text-ghost)]">
				{card?.name ?? "—"}
			</span>
			{card && (
				<>
					<span className="ml-auto tabular font-mono text-[16px] text-[var(--text-dim)]">
						{fmtIdr(card.price)}
					</span>
					<ChangeBadge value={card.change_pct} />
				</>
			)}
			<div className="w-full font-mono text-[10px] text-[var(--text-ghost)]">
				as of {series.source.as_of} · {series.source.flow} · quality{" "}
				{series.source.quality}
				{series.cache
					? series.cache.hit
						? " · cache " + series.cache.age_seconds + "s"
						: " · computed"
					: ""}
			</div>
		</div>
	);
}

function CardView({ card }: { card: FlowCard }) {
	const t = card.technicals;
	return (
		<div className="px-4 py-3">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span className="font-display text-[18px] font-semibold text-[var(--text)]">
					{card.ticker}
				</span>
				<span className="min-w-0 truncate font-mono text-[10px] text-[var(--text-ghost)]">
					{card.name}
				</span>
				<span className="ml-auto tabular font-mono text-[15px] font-semibold text-[var(--text)]">
					{fmtIdr(card.price)}
				</span>
				<ChangeBadge value={card.change_pct} />
			</div>

			<div className="mt-2 flex flex-wrap items-center gap-2">
				<FlowBadge flow={card.flow} />
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					5D value {fmtIdr(card.value_5d_idr, true)}
				</span>
				<span className="ml-auto font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-ghost)]">
					proxy
				</span>
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] sm:grid-cols-3">
				<Metric label="RSI" value={fmtNum(t.rsi14, 1)} />
				<Metric label="Stoch" value={fmtNum(t.stoch_k, 1)} />
				<Metric
					label="ST"
					value={
						t.supertrend === "bull"
							? "Bull"
							: t.supertrend === "bear"
								? "Bear"
								: "—"
					}
					tone={t.supertrend === "bull" ? "up" : t.supertrend === "bear" ? "down" : "neutral"}
				/>
				<Metric
					label="Kumo"
					value={
						t.kumo === "above"
							? "Above"
							: t.kumo === "below"
								? "Below"
								: t.kumo === "inside"
									? "Inside"
									: "—"
					}
					tone={t.kumo === "above" ? "up" : t.kumo === "below" ? "down" : "neutral"}
				/>
				<Metric label="VWAP" value={fmtPct(t.vwap_pct)} tone={tone(t.vwap_pct)} />
				<Metric
					label="MA20"
					value={yesNo(t.above_ma20)}
					tone={
						t.above_ma20 == null ? "neutral" : t.above_ma20 ? "up" : "down"
					}
				/>
				<Metric
					label="MA50"
					value={yesNo(t.above_ma50)}
					tone={
						t.above_ma50 == null ? "neutral" : t.above_ma50 ? "up" : "down"
					}
				/>
				<Metric label="52W" value={fmtPct(t.from_52w_high_pct)} />
				<Metric
					label="5D chg"
					value={fmtPct(t.change_5d_pct)}
					tone={tone(t.change_5d_pct)}
				/>
			</div>
		</div>
	);
}

function Metric({
	label,
	value,
	tone = "neutral",
}: {
	label: string;
	value: string;
	tone?: "up" | "down" | "neutral";
}) {
	const color =
		tone === "up"
			? "var(--up)"
			: tone === "down"
				? "var(--down)"
				: "var(--text-dim)";
	return (
		<div className="flex min-w-0 items-baseline justify-between gap-2 border-b border-[var(--border-soft)] pb-0.5">
			<span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				{label}
			</span>
			<span className="tabular truncate" style={{ color }}>
				{value}
			</span>
		</div>
	);
}

function FlowBadge({ flow }: { flow: FlowCard["flow"] }) {
	const direction = flow.direction;
	const tone =
		direction === "rising"
			? "var(--up)"
			: direction === "falling"
				? "var(--down)"
				: "var(--gold)";
	const glyph =
		direction === "rising" ? "↑" : direction === "falling" ? "↓" : "→";
	const label =
		direction === "rising"
			? "rising"
			: direction === "falling"
				? "falling"
				: direction === "flat"
					? "flat"
					: "unavailable";
	return (
		<span
			className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]"
			style={{
				color: tone,
				borderColor: tone,
				background: "color-mix(in srgb, currentColor 8%, transparent)",
			}}
			title={
				"Proxy score slope: " +
				(flow.slope_5d ?? "—") +
				"; not Bandarmetrics LPM"
			}
		>
			<span aria-hidden="true">{glyph}</span>
			LPM proxy {label}
		</span>
	);
}

function ValidationPanel({
	report,
	busy,
	error,
	onMeasure,
}: {
	report: FlowValidation | null;
	busy: boolean;
	error: string | null;
	onMeasure: () => void;
}) {
	return (
		<div className="mt-4 border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<div>
					<h3 className="text-[14px] font-semibold text-[var(--text)]">
						What the proxy is worth
					</h3>
					<p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
						Measure the 5-session direction against the next 5 sessions. This is
						the proxy&rsquo;s own record, not the vendor&rsquo;s accuracy and not a
						promise.
					</p>
				</div>
				<button
					type="button"
					onClick={onMeasure}
					disabled={busy}
					className="border border-[var(--border-strong)] px-2 py-1 font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-50"
				>
					{busy ? "measuring…" : "measure this proxy"}
				</button>
			</div>

			{error && (
				<p className="mt-3 font-mono text-[11px] text-[var(--down)]">{error}</p>
			)}

			{report && (
				<div className="mt-4 grid grid-cols-2 gap-3 font-mono text-[11px] sm:grid-cols-4">
					<Readout label="hit rate" value={fmtPct(report.hit_rate_pct)} />
					<Readout
						label="baseline"
						value={fmtPct(report.baseline_hit_rate_pct)}
					/>
					<Readout label="AUC" value={fmtNum(report.auc, 3)} />
					<Readout label="n" value={fmtNum(report.n, 0)} />
					<Readout
						label="rank IC"
						value={
							report.cross_section.available
								? fmtNum(report.cross_section.mean_rank_ic, 3)
								: "—"
						}
					/>
					<Readout
						label="top-bottom"
						value={
							report.cross_section.available
								? fmtPct(report.cross_section.mean_top_bottom_pct)
								: "—"
						}
					/>
					<Readout
						label="vendor"
						value={report.vendor_parity.available ? "sample" : "none"}
					/>
					<Readout label="source" value={report.source} />
					<Readout
						label="cache"
						value={
							report.cache
								? report.cache.hit
									? report.cache.age_seconds + "s"
									: "new"
								: "—"
						}
					/>
					<div className="col-span-2 mt-1 border-t border-[var(--border)] pt-2 text-[10px] leading-relaxed text-[var(--text-ghost)] sm:col-span-4">
						{report.warnings.join(" ")}
					</div>
				</div>
			)}
		</div>
	);
}

function Readout({ label, value }: { label: string; value: string }) {
	return (
		<div className="border border-[var(--border-soft)] p-2">
			<div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-ghost)]">
				{label}
			</div>
			<div className="tabular mt-1 text-[15px] font-semibold text-[var(--text)]">
				{value}
			</div>
		</div>
	);
}

function yesNo(value: boolean | null): string {
	if (value == null) return "—";
	return value ? "✓" : "✗";
}

function tone(value: number | null): "up" | "down" | "neutral" {
	if (value == null) return "neutral";
	return value >= 0 ? "up" : "down";
}
