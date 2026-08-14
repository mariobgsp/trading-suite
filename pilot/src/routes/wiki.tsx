import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SectionHeader } from "@/components/ui";

/**
 * Educational wiki — how the IDX works and what the signals mean.
 * Static, no data source: this is the "learn the tape" layer of the suite.
 */

export const Route = createFileRoute("/wiki")({
	component: WikiPage,
});

const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
	{
		id: "idx-basics",
		title: "IDX Basics — lots, boards, and limits",
		body: (
			<>
				<p>
					One <strong>lot</strong> on the IDX is 100 shares, and orders round to
					whole lots. The exchange runs three main <strong>boards</strong>: the
					Main Board (blue-chip, established), the Development Board (smaller
					and younger), and the New Economy Board for tech listings. Each board
					has its own daily <strong>price limit</strong> — the Main Board allows
					roughly ±35% (ARA/ARB), while higher-volatility boards get wider
					bands. Trading hours are 09:00-15:30 WIB with a lunch break.
				</p>
				<p>
					The broad market index is the <strong>IHSG</strong> (^JKSE), with the
					LQ45 and IDX30 tracking the most liquid names. Fees matter: broker
					commissions run about 0.15-0.3% per side plus VAT, and there is a 0.1%
					transaction levy.
				</p>
			</>
		),
	},
	{
		id: "foreign-flow",
		title: "Foreign Flow — what the Asing rows mean",
		body: (
			<>
				<p>
					IDX publishes daily net <strong>foreign buying/selling</strong> per
					stock (the Asing rows in Foreign Flow). Net foreign inflow is a
					sentiment signal: institutions move in blocks, so sustained net
					foreign buying often precedes liquidity that retail sees later. Watch
					the <em>trend</em>, not one day — a single session of +Rp 500M means
					little; five sessions in a row means something.
				</p>
				<p>
					Pair foreign flow with <strong>broker flow</strong>: the broker codes
					(e.g. ZP, CC, YP) are the accounts at each securities firm. When the
					same broker code accumulates across several tickers in its sector,
					that is the accumulation footprint bandarmologi analysis looks for.
				</p>
			</>
		),
	},
	{
		id: "bandarmology",
		title: "Bandarmology — reading accumulation and distribution",
		body: (
			<>
				<p>
					<strong>Bandarmology</strong> (the local term for smart-money flow
					analysis) reads who is building or exiting positions before the price
					says so. The Validator tool scores each ticker on institutional flow,
					a confidence index, and an intent phase:
					<strong> accumulation</strong> (buyers absorbing supply),{" "}
					<strong>distribution</strong>
					(sellers unloading into strength), or a transition phase.
				</p>
				<p>
					Classic tells: a stock that refuses to fall on bad news while a known
					broker code keeps buying; volume drying up during a shakeout; a
					distribution phase showing up as strong-volume sells into price
					spikes. None of these are guarantees — they are context that raises or
					lowers the quality of your trade idea.
				</p>
			</>
		),
	},
	{
		id: "market-regime",
		title: "Market Regime — when to press, when to defend",
		body: (
			<>
				<p>
					The Regime tool classifies IHSG as{" "}
					<strong>BULL, CAUTION, or BEAR</strong> using SMA trend, ATR
					volatility, and a Hurst exponent (trend persistence) over a one-year
					window. Regime is a filter, not a forecast: in a BULL regime the suite
					permits the aggressive engines; in a BEAR it restricts them.
				</p>
				<p>
					This matters because most retail losses come from fighting the tape —
					shorting strength in a bull regime, buying dips in a bear. The regime
					readout sits at the top of Overview and feeds the entry-plan scoring
					in Stock Profiler.
				</p>
			</>
		),
	},
	{
		id: "sector-rotation",
		title: "Sector Rotation — money moves in waves",
		body: (
			<>
				<p>
					Institutional capital rotates through sectors in waves: early cycle
					into cyclicals and commodities, later into financials and consumer,
					defensives in the late/risk-off phase. The Sector Rotation tool
					archives each day's sector strength and shows the{" "}
					<strong>rank change</strong> over 5 and 20 days — a sector climbing
					the ranking (negative rank delta here) is where money is rotating{" "}
					<em>into</em>.
				</p>
				<p>
					Rotation works best as a relative play: buy strength within a
					strengthening sector, and be careful holding laggards inside a sector
					that is fading down the ranking.
				</p>
			</>
		),
	},
	{
		id: "msci",
		title: "MSCI and index membership — why it moves price",
		body: (
			<>
				<p>
					<strong>MSCI Indonesia</strong> membership matters because global
					passive funds must hold the index constituents. When MSCI adds a stock
					(or a country increases its weight), passive buyers are forced into
					the name over the rebalance window; deletions get forced selling.
				</p>
				<p>
					There is no free MSCI membership API — the MSCI Watch tool keeps a
					curated constituent table refreshed at each quarterly review
					(Feb/May/Aug/Nov) and enriches it with live price and market-cap data.
					Watch the free-float rule too: IDX raised the free-float floor to 15%,
					which reshuffles who qualifies.
				</p>
			</>
		),
	},
	{
		id: "risk",
		title: "Risk, position sizing, and the R framework",
		body: (
			<>
				<p>
					Before any entry, define your risk in IDR, not in feelings: position
					size = (capital × risk %) ÷ (entry − stop). The Calculators tool does
					this math for you, including the blended average price when you add to
					a position and the R ratio (reward ÷ risk) of the trade idea.
				</p>
				<p>
					The discipline: risk no more than 1-2% of capital per idea, size so
					that your stop loss is a real price (not a mental one), and treat the
					journal's win rate and profit factor as the only scoreboard that
					matters.
				</p>
			</>
		),
	},
];

function WikiPage() {
	const [open, setOpen] = useState<string | null>("idx-basics");

	return (
		<div>
			<SectionHeader
				title="Wiki"
				subtitle="How the IDX works and what the signals mean — the desk manual for this suite"
			/>
			<div className="space-y-3">
				{SECTIONS.map((s) => (
					<details
						key={s.id}
						open={open === s.id}
						onToggle={(e) => {
							if ((e.target as HTMLDetailsElement).open) setOpen(s.id);
						}}
						className="panel overflow-hidden"
					>
						<summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)]">
							<span>{s.title}</span>
							<span className="font-mono text-[10px] text-[var(--text-faint)]">
								{open === s.id ? "−" : "+"}
							</span>
						</summary>
						<div className="space-y-3 border-t border-[var(--border)] px-4 py-4 text-sm leading-relaxed text-[var(--text-dim)]">
							{s.body}
						</div>
					</details>
				))}
			</div>
			<p className="mt-4 text-[11px] leading-relaxed text-[var(--text-faint)]">
				Educational material only — nothing here is investment advice. All
				decisions are yours.
			</p>
		</div>
	);
}
