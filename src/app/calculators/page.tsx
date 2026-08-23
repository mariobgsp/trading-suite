"use client";

import { useMemo, useState } from "react";
import { fmtIdr, fmtNum } from "@/lib/api";
import Shell from "@/components/Shell";
import { SectionHeader } from "@/components/ui";

/**
 * Trading calculators — pure arithmetic, no data source required.
 * Mirrors the tradersaham calculator set: average price, position sizing,
 * risk/reward, profit & ARA/ARB.
 */
export default function CalculatorsPage() {
	return (
		<Shell>
			<SectionHeader
				title="Calculators"
				subtitle="Position math for the IDX desk — average price, sizing, risk, and corporate-action math"
			/>
			<div className="grid gap-4 lg:grid-cols-2">
				<AveragePriceCalc />
				<PositionSizingCalc />
				<RiskRewardCalc />
				<ProfitCalc />
			</div>
		</Shell>
	);
}

/* ── Shared input + output primitives ────────────────────────────────────── */

function NumInput({
	label,
	value,
	onChange,
	step = "any",
	prefix,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	step?: string;
	prefix?: string;
}) {
	return (
		<label className="block">
			<span className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</span>
			<span className="relative block">
				{prefix ? (
					<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-faint)]">
						{prefix}
					</span>
				) : null}
				<input
					type="number"
					step={step}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className={`panel-2 w-full px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none ${prefix ? "pl-8" : ""}`}
				/>
			</span>
		</label>
	);
}

function Result({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "up" | "down" | "accent";
}) {
	const tones: Record<string, string> = {
		up: "text-[var(--up)]",
		down: "text-[var(--down)]",
		accent: "text-[var(--accent)]",
	};
	return (
		<div className="panel-2 p-3">
			<div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{label}
			</div>
			<div
				className={`tabular mt-0.5 font-mono text-base font-bold ${tone ? tones[tone] : "text-[var(--text)]"}`}
			>
				{value}
			</div>
		</div>
	);
}

const num = (s: string): number => {
	const f = parseFloat(s);
	return Number.isFinite(f) ? f : 0;
};

/* ── 1. Weighted average price ───────────────────────────────────────────── */

function AveragePriceCalc() {
	// Two-entry blend: first buy + add-on, weighted by lots.
	const [lots1, setLots1] = useState("10");
	const [price1, setPrice1] = useState("9250");
	const [lots2, setLots2] = useState("5");
	const [price2, setPrice2] = useState("9600");

	const blend = useMemo(() => {
		const l1 = num(lots1);
		const p1 = num(price1);
		const l2 = num(lots2);
		const p2 = num(price2);
		const shares1 = l1 * 100;
		const shares2 = l2 * 100;
		const value1 = shares1 * p1;
		const value2 = shares2 * p2;
		const shares = shares1 + shares2;
		const avg = shares > 0 ? (value1 + value2) / shares : 0;
		return {
			value1,
			value2,
			shares,
			avg,
			totalValue: value1 + value2,
			lots: l1 + l2,
		};
	}, [lots1, price1, lots2, price2]);

	return (
		<div className="panel p-4">
			<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
				Weighted Average Price
			</h2>
			<div className="grid grid-cols-2 gap-3">
				<NumInput label="Entry 1 Lots" value={lots1} onChange={setLots1} />
				<NumInput
					label="Entry 1 Price"
					value={price1}
					onChange={setPrice1}
					prefix="Rp"
				/>
				<NumInput label="Entry 2 Lots" value={lots2} onChange={setLots2} />
				<NumInput
					label="Entry 2 Price"
					value={price2}
					onChange={setPrice2}
					prefix="Rp"
				/>
			</div>
			<div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Result
					label="Blended Avg / Share"
					value={fmtNum(blend.avg)}
					tone="accent"
				/>
				<Result label="Total Shares" value={fmtNum(blend.shares, 0)} />
				<Result label="Total Lots" value={fmtNum(blend.lots, 0)} />
				<Result label="Total Value" value={fmtIdr(blend.totalValue, true)} />
			</div>
			<p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
				IDX lot = 100 shares. Weighted by lots, so a bigger add-on pulls the average
				harder.
			</p>
		</div>
	);
}

/* ── 2. Position sizing ──────────────────────────────────────────────────── */

function PositionSizingCalc() {
	const [capital, setCapital] = useState("100000000");
	const [riskPct, setRiskPct] = useState("1");
	const [entry, setEntry] = useState("9250");
	const [stop, setStop] = useState("8800");

	const sizing = useMemo(() => {
		const cap = num(capital);
		const rp = num(riskPct);
		const e = num(entry);
		const s = num(stop);
		const riskPerShare = Math.max(0, e - s);
		const riskIdr = cap * (rp / 100);
		const shares =
			riskPerShare > 0 ? Math.floor(riskIdr / riskPerShare / 100) * 100 : 0;
		const lots = shares / 100;
		const notional = shares * e;
		return { riskIdr, shares, lots, notional, riskPerShare };
	}, [capital, riskPct, entry, stop]);

	return (
		<div className="panel p-4">
			<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
				Position Sizing
			</h2>
			<div className="grid grid-cols-2 gap-3">
				<NumInput
					label="Capital (IDR)"
					value={capital}
					onChange={setCapital}
					prefix="Rp"
				/>
				<NumInput label="Risk %" value={riskPct} onChange={setRiskPct} />
				<NumInput label="Entry" value={entry} onChange={setEntry} prefix="Rp" />
				<NumInput label="Stop" value={stop} onChange={setStop} prefix="Rp" />
			</div>
			<div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Result
					label="Risk Amount"
					value={fmtIdr(sizing.riskIdr, true)}
					tone="down"
				/>
				<Result label="Shares" value={fmtNum(sizing.shares, 0)} />
				<Result label="Lots" value={fmtNum(sizing.lots, 0)} />
				<Result label="Notional" value={fmtIdr(sizing.notional, true)} />
			</div>
		</div>
	);
}

/* ── 3. Risk / reward ───────────────────────────────────────────────────── */

function RiskRewardCalc() {
	const [entry, setEntry] = useState("9250");
	const [stop, setStop] = useState("8800");
	const [target, setTarget] = useState("10100");

	const rr = useMemo(() => {
		const e = num(entry);
		const s = num(stop);
		const t = num(target);
		const risk = Math.abs(e - s);
		const reward = Math.abs(t - e);
		const ratio = risk > 0 ? reward / risk : 0;
		return {
			ratio,
			riskPct: e > 0 ? (risk / e) * 100 : 0,
			rewardPct: e > 0 ? (reward / e) * 100 : 0,
		};
	}, [entry, stop, target]);

	return (
		<div className="panel p-4">
			<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
				Risk / Reward (R)
			</h2>
			<div className="grid grid-cols-3 gap-3">
				<NumInput label="Entry" value={entry} onChange={setEntry} prefix="Rp" />
				<NumInput label="Stop" value={stop} onChange={setStop} prefix="Rp" />
				<NumInput label="Target" value={target} onChange={setTarget} prefix="Rp" />
			</div>
			<div className="mt-3 grid grid-cols-3 gap-3">
				<Result
					label="R Ratio"
					value={`${rr.ratio.toFixed(2)}R`}
					tone={rr.ratio >= 2 ? "up" : rr.ratio >= 1 ? "accent" : "down"}
				/>
				<Result label="Risk" value={`${rr.riskPct.toFixed(2)}%`} tone="down" />
				<Result label="Reward" value={`${rr.rewardPct.toFixed(2)}%`} tone="up" />
			</div>
		</div>
	);
}

/* ── 4. Profit & ARA/ARB ─────────────────────────────────────────────────── */

function ProfitCalc() {
	const [lots, setLots] = useState("10");
	const [buy, setBuy] = useState("9250");
	const [sell, setSell] = useState("10100");
	const [feePct, setFeePct] = useState("0.25");

	const profit = useMemo(() => {
		const l = num(lots);
		const b = num(buy);
		const s = num(sell);
		const shares = l * 100;
		const gross = (s - b) * shares;
		const fee = Math.abs(gross) * (num(feePct) / 100);
		const net = gross - fee;
		const costBasis = b * shares;
		return {
			gross,
			fee,
			net,
			returnPct: costBasis > 0 ? (net / costBasis) * 100 : 0,
			shares,
		};
	}, [lots, buy, sell, feePct]);

	return (
		<div className="panel p-4">
			<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
				Profit &amp; Fees
			</h2>
			<div className="grid grid-cols-2 gap-3">
				<NumInput label="Lots" value={lots} onChange={setLots} />
				<NumInput label="Buy" value={buy} onChange={setBuy} prefix="Rp" />
				<NumInput label="Sell" value={sell} onChange={setSell} prefix="Rp" />
				<NumInput label="Fee %" value={feePct} onChange={setFeePct} />
			</div>
			<div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Result
					label="Gross P&L"
					value={fmtIdr(profit.gross, true)}
					tone={profit.gross >= 0 ? "up" : "down"}
				/>
				<Result label="Fee" value={fmtIdr(profit.fee, true)} />
				<Result
					label="Net P&L"
					value={fmtIdr(profit.net, true)}
					tone={profit.net >= 0 ? "up" : "down"}
				/>
				<Result
					label="Return"
					value={`${profit.returnPct.toFixed(2)}%`}
					tone={profit.net >= 0 ? "up" : "down"}
				/>
			</div>
			<p className="mt-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
				IDX daily price limits: ARA = +35% from previous close, ARB = -35%
				(board-dependent). Typical broker commission ~0.15-0.3% + VAT.
			</p>
		</div>
	);
}
