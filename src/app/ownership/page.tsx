"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
	api,
	fmtNum,
	type OwnerHoldings,
	type OwnershipHistory,
	type OwnershipStructure,
} from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import Shell from "@/components/Shell";
import { SectionHeader, Skeleton } from "@/components/ui";

type ShareholderRow = NonNullable<OwnershipStructure["shareholders"]>[number];

const POPULAR = ["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "ADRO"];

export default function OwnershipPage() {
	const [ticker, setTicker] = useState("BBCA");
	const data = usePolling<OwnershipStructure | null>(
		() => api.get(`/api/intel/ownership/${ticker}`),
		60000,
		ticker,
	);
	const history = usePolling<OwnershipHistory | null>(
		() => api.get(`/api/intel/ownership/${ticker}/history`),
		60000,
		ticker,
	);

	const unavailable = data.data && data.data.available === false;

	return (
		<Shell>
			<SectionHeader
				eyebrow="IDX disclosures"
				title="Ownership & Disclosures"
				subtitle="Shareholder structure straight from IDX — who controls the float, at what percentage"
			/>

			{/* Ticker selector */}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<input
					value={ticker}
					onChange={(e) => setTicker(e.target.value.toUpperCase())}
					onKeyDown={(e) => {
						if (e.key === "Enter" && ticker) void data.refresh();
					}}
					placeholder="Ticker (e.g. BBCA)"
					className="panel-2 w-36 px-3 py-2 font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
				/>
				<button
					onClick={() => void data.refresh()}
					className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:brightness-[1.05]"
				>
					Load
				</button>
				<div className="ml-2 flex flex-wrap gap-1">
					{POPULAR.map((t) => (
						<button
							key={t}
							onClick={() => setTicker(t)}
							className={`panel-2 px-2.5 py-1 font-mono text-[11px] ${
								ticker === t
									? "text-[var(--accent)] ring-1 ring-[var(--accent)]"
									: "text-[var(--text-dim)] hover:text-[var(--accent)]"
							}`}
						>
							{t}
						</button>
					))}
				</div>
			</div>

			{unavailable ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						IDX unavailable
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						{data.data?.error}. The IDX endpoints are behind Cloudflare
						fingerprinting; the backend retries with browser impersonation. Try again
						shortly.
					</p>
				</div>
			) : data.loading && !data.data ? (
				<Skeleton className="h-48" />
			) : data.data?.error ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--down)]">
						Lookup failed
					</div>
					<p className="mt-2 text-sm text-[var(--text-dim)]">{data.data.error}</p>
				</div>
			) : data.data ? (
				<>
					{/* Company header */}
					<div className="panel mb-4 p-4">
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
								{data.data.name ?? ticker}
							</h2>
							{data.data.as_of && (
								<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
									IDX · as of {String(data.data.as_of).slice(0, 10)}
								</span>
							)}
						</div>
						{(data.data.sector || data.data.sub_sector || data.data.listing_date) && (
							<div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-[var(--text-faint)]">
								{data.data.sector ? <span>SECTOR {data.data.sector}</span> : null}
								{data.data.sub_sector ? <span>SUB {data.data.sub_sector}</span> : null}
								{data.data.listing_date ? (
									<span>LISTED {String(data.data.listing_date).slice(0, 10)}</span>
								) : null}
							</div>
						)}
					</div>

					{/* Shareholders — interactive register */}
					<ShareholdersPanel
						rows={data.data.shareholders ?? []}
						ticker={ticker}
						onSelectTicker={setTicker}
					/>

					{/* Ownership changes — snapshot diff archive */}
					{history.data && history.data.snapshots.length > 0 && (
						<div className="panel mb-4 p-4">
							<div className="mb-3 flex items-baseline justify-between">
								<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
									Ownership changes
								</h2>
								<span className="font-mono text-[10px] text-[var(--text-faint)]">
									{history.data.snapshots.length} snapshot
									{history.data.snapshots.length === 1 ? "" : "s"} archived
								</span>
							</div>
							{history.data.changes ? (
								<div className="space-y-4">
									<ChangeGroup
										title={`Entered · ${history.data.changes.from_date} → ${history.data.changes.to_date}`}
										items={history.data.changes.entered.map((e) => ({
											label: e.name,
											value: e.percent != null ? `${fmtNum(e.percent, 2)}%` : "",
											tone: "up" as const,
										}))}
									/>
									<ChangeGroup
										title={`Exited · ${history.data.changes.from_date} → ${history.data.changes.to_date}`}
										items={history.data.changes.exited.map((e) => ({
											label: e.name,
											value: e.percent != null ? `${fmtNum(e.percent, 2)}%` : "",
											tone: "down" as const,
										}))}
									/>
									{history.data.changes.changed.length > 0 && (
										<ChangeGroup
											title="Holding % moved"
											items={history.data.changes.changed.map((c) => ({
												label: c.name,
												value: `${fmtNum(c.from, 2)}% → ${fmtNum(c.to, 2)}%`,
												tone: (c.delta ?? 0) >= 0 ? ("up" as const) : ("down" as const),
											}))}
										/>
									)}
									{history.data.changes.crossed.length > 0 && (
										<div>
											<div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--gold)]">
												Threshold crossed
											</div>
											<ul className="space-y-1">
												{history.data.changes.crossed.map((c, i) => (
													<li
														key={i}
														className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-1 last:border-b-0"
													>
														<span className="text-xs text-[var(--text)]">
															{c.name}
															<span className="ml-2 text-[var(--text-faint)]">
																came {c.dir} the {fmtNum(c.threshold, 0)}% line
															</span>
														</span>
														<span className="tabular text-[10px] text-[var(--text-faint)]">
															{fmtNum(c.from, 2)}% → {fmtNum(c.to, 2)}%
														</span>
													</li>
												))}
											</ul>
										</div>
									)}
								</div>
							) : (
								<p className="text-xs text-[var(--text-faint)]">
									Archive started — a second distinct snapshot is needed to show changes.
									It accumulates automatically as fresh ownership data loads.
								</p>
							)}
						</div>
					)}

					{/* Board */}
					{data.data.board &&
						(data.data.board.direktur.length > 0 ||
							data.data.board.komisaris.length > 0) && (
							<div className="grid gap-4 lg:grid-cols-2">
								{data.data.board.direktur.length > 0 && (
									<div className="panel p-4">
										<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
											Direktur
										</h2>
										<BoardList rows={data.data.board.direktur} />
									</div>
								)}
								{data.data.board.komisaris.length > 0 && (
									<div className="panel p-4">
										<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
											Komisaris
										</h2>
										<BoardList rows={data.data.board.komisaris} />
									</div>
								)}
							</div>
						)}
				</>
			) : null}

			<div className="panel mt-6 p-4">
				<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Source and limits
				</h2>
				<ul className="space-y-2 text-xs leading-relaxed text-[var(--text-dim)]">
					<li>
						<span className="mr-2 text-[var(--accent)]">•</span>
						Data comes from IDX&apos;s{" "}
						<span className="font-mono">GetCompanyProfilesDetail</span> — the
						issuer-disclosed shareholder snapshot, no auth, refreshed daily by IDX.
					</li>
					<li>
						<span className="mr-2 text-[var(--accent)]">•</span>
						Ownership changes come from a per-ticker snapshot archive that accumulates
						automatically as fresh data loads — a second distinct snapshot enables
						entered/exited/changed diffs and threshold watch (5 / 25 / 50% lines).
					</li>
					<li>
						<span className="mr-2 text-[var(--accent)]">•</span>
						IDX publishes what issuers disclose; treasury, warkat, and institutional
						buckets appear as reported.
					</li>
				</ul>
			</div>
		</Shell>
	);
}

function BoardList({ rows }: { rows: { name: string; position: string }[] }) {
	return (
		<ul className="space-y-2">
			{rows.map((r, i) => (
				<li
					key={i}
					className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2 last:border-b-0"
				>
					<span className="text-xs text-[var(--text)]">{r.name}</span>
					<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
						{r.position}
					</span>
				</li>
			))}
		</ul>
	);
}

function ChangeGroup({
	title,
	items,
}: {
	title: string;
	items: { label: string; value: string; tone: "up" | "down" }[];
}) {
	if (items.length === 0) return null;
	return (
		<div>
			<div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				{title}
			</div>
			<ul className="space-y-1">
				{items.map((it, i) => (
					<li
						key={i}
						className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-1 last:border-b-0"
					>
						<span className="text-xs text-[var(--text)]">{it.label}</span>
						<span
							className={`tabular text-[10px] font-semibold ${
								it.tone === "up" ? "text-[var(--up)]" : "text-[var(--down)]"
							}`}
						>
							{it.value}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/* ── Shareholders · interactive register ─────────────────────────── */

type SortKey = "name" | "shares" | "percent";

type RankedRow = ShareholderRow & { rank: number; cum: number };

function ShareholdersPanel({
	rows,
	ticker,
	onSelectTicker,
}: {
	rows: ShareholderRow[];
	ticker: string;
	onSelectTicker: (t: string) => void;
}) {
	const [q, setQ] = useState("");
	const [cat, setCat] = useState<string | null>(null);
	const [sortKey, setSortKey] = useState<SortKey>("percent");
	const [sortDesc, setSortDesc] = useState(true);
	const [openId, setOpenId] = useState<number | null>(null);

	const cats = useMemo(
		() => [...new Set(rows.map((r) => r.category || "—"))].sort(),
		[rows],
	);

	// Rank order is always stake-desc; sorting/searching only reorders/filters
	// the view, so ranks and cumulative stakes stay meaningful.
	const ranked = useMemo<RankedRow[]>(() => {
		// ponytail: O(n²) cumulative over tiny holder list; fine at this scale.
		const sorted = [...rows].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
		return sorted.map((r, i) => ({
			...r,
			rank: i + 1,
			cum: sorted.slice(0, i + 1).reduce((s, x) => s + (x.percent ?? 0), 0),
		}));
	}, [rows]);

	const totalPct = useMemo(
		() => rows.reduce((s, r) => s + (r.percent ?? 0), 0),
		[rows],
	);
	const top3 = ranked.slice(0, 3).reduce((s, r) => s + (r.percent ?? 0), 0);
	const maxPct = Math.max(...ranked.map((r) => r.percent ?? 0), 0.0001);

	const view = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return ranked
			.filter((r) => !cat || (r.category || "—") === cat)
			.filter((r) => !needle || r.name.toLowerCase().includes(needle))
			.sort((a, b) => {
				const dir = sortDesc ? -1 : 1;
				if (sortKey === "name") return a.name.localeCompare(b.name) * dir * -1;
				return ((a[sortKey] as number) - (b[sortKey] as number)) * dir;
			});
	}, [ranked, q, cat, sortKey, sortDesc]);

	if (rows.length === 0) {
		return (
			<div className="panel mb-4 p-4">
				<p className="text-xs text-[var(--text-faint)]">
					No shareholder data for {ticker}.
				</p>
			</div>
		);
	}

	const toggleSort = (key: SortKey) => {
		if (key === sortKey) setSortDesc((d) => !d);
		else {
			setSortKey(key);
			setSortDesc(key !== "name");
		}
	};
	const arrow = (key: SortKey) =>
		sortKey === key ? (sortDesc ? " ↓" : " ↑") : "";

	const th =
		"cursor-pointer select-none py-1 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)] hover:text-[var(--accent)]";
	const td = "border-b border-[var(--line)] py-1.5 text-xs";

	return (
		<div className="panel mb-4 overflow-x-auto p-4">
			<div className="mb-2 flex items-baseline justify-between gap-3">
				<h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
					Shareholders · {ticker}
				</h2>
				<span className="font-mono text-[10px] text-[var(--text-faint)]">
					click row for detail · click header to sort
				</span>
			</div>

			{/* Concentration stats */}
			<div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-[var(--text-faint)]">
				<span className="text-[var(--text-dim)]">{rows.length} holders</span>
				<span>
					top-1{" "}
					<b className="text-[var(--gold)]">{fmtNum(ranked[0]?.percent ?? 0, 2)}%</b>
				</span>
				<span>
					top-3 <b className="text-[var(--text)]">{fmtNum(top3, 2)}%</b>
				</span>
				<span>Σ disclosed {fmtNum(totalPct, 2)}%</span>
				{totalPct < 100 && (
					<span>
						public float ≈{" "}
						<b className="text-[var(--accent)]">{fmtNum(100 - totalPct, 2)}%</b>
					</span>
				)}
			</div>

			{/* Search + category chips */}
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<input
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Filter holders…"
					className="panel-2 w-44 px-2 py-1 font-mono text-[11px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
				/>
				{cats.length > 1 &&
					cats.map((c) => (
						<button
							key={c}
							onClick={() => setCat(cat === c ? null : c)}
							className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
								cat === c
									? "bg-[var(--accent)] text-black"
									: "panel-2 text-[var(--text-dim)] hover:text-[var(--accent)]"
							}`}
						>
							{c}
						</button>
					))}
				{(cat || q) && (
					<button
						onClick={() => {
							setCat(null);
							setQ("");
						}}
						className="font-mono text-[10px] text-[var(--down)] hover:underline"
					>
						clear ×
					</button>
				)}
			</div>

			<table className="w-full min-w-[720px]">
				<thead>
					<tr>
						<th className={th}>#</th>
						<th
							className={`${th} ${arrow("name")}`}
							onClick={() => toggleSort("name")}
						>
							Holder{arrow("name")}
						</th>
						<th className={th}>Category</th>
						<th
							className={`${th} text-right ${arrow("shares")}`}
							onClick={() => toggleSort("shares")}
						>
							Shares{arrow("shares")}
						</th>
						<th
							className={`${th} text-right ${arrow("percent")}`}
							onClick={() => toggleSort("percent")}
						>
							Stake %{arrow("percent")}
						</th>
						<th className={`${th} text-right`}>Σ cum%</th>
					</tr>
				</thead>
				<tbody>
					{view.map((r) => {
						const open = openId === r.rank;
						const pct = r.percent ?? 0;
						return (
							<Fragment key={r.rank}>
								<tr
									className={`cursor-pointer hover:bg-[var(--panel-2)] ${
										open ? "bg-[var(--panel-2)]" : ""
									}`}
									onClick={() => setOpenId(open ? null : r.rank)}
								>
									<td className={`${td} font-mono text-[10px] text-[var(--text-faint)]`}>
										{open ? "▾" : "▸"} {r.rank}
									</td>
									<td className={`${td} font-semibold text-[var(--text)]`}>
										{r.name}
										{r.controlling && (
											<span className="ml-2 rounded-sm bg-[var(--gold)] px-1 font-mono text-[8px] font-bold uppercase text-black">
												controlling
											</span>
										)}
									</td>
									<td className={`${td} text-[var(--text-dim)]`}>{r.category || "—"}</td>
									<td className={`${td} tabular text-right text-[var(--text)]`}>
										{fmtNum(r.shares, 0)}
									</td>
									<td className={td}>
										<div className="flex items-center justify-end gap-2">
											<div className="h-1.5 w-20 overflow-hidden rounded-sm bg-[var(--line)]">
												<div
													className="h-full bg-[var(--gold)]"
													style={{ width: `${Math.min(100, (pct / maxPct) * 100)}%` }}
												/>
											</div>
											<span className="tabular w-14 text-right font-semibold text-[var(--text)]">
												{pct != null ? `${fmtNum(pct, 2)}%` : "—"}
											</span>
										</div>
									</td>
									<td className={`${td} tabular text-right text-[var(--text-dim)]`}>
										{fmtNum(r.cum, 2)}%
									</td>
								</tr>
								{open && (
									<tr className="bg-[var(--panel)]">
										<td
											colSpan={6}
											className="border-b border-[var(--line)] pb-3 pl-8 pr-4 pt-1"
										>
											<div className="flex flex-wrap gap-x-8 gap-y-1 font-mono text-[10px] text-[var(--text-dim)]">
												<span>
													exact shares{" "}
													<b className="text-[var(--text)]">
														{r.shares != null ? r.shares.toLocaleString("id-ID") : "—"}
													</b>
												</span>
												<span>
													share of disclosed{" "}
													<b className="text-[var(--text)]">
														{totalPct > 0 ? `${fmtNum((pct / totalPct) * 100, 1)}%` : "—"}
													</b>
												</span>
												<span>
													cumulative through rank {r.rank}{" "}
													<b className="text-[var(--text)]">{fmtNum(r.cum, 2)}%</b>
												</span>
												<span>
													category <b className="text-[var(--text)]">{r.category || "—"}</b>
												</span>
												<span>
													control{" "}
													<b
														className={
															r.controlling ? "text-[var(--gold)]" : "text-[var(--text)]"
														}
													>
														{r.controlling ? "CONTROLLING" : "non-controlling"}
													</b>
												</span>
											</div>
											<OwnerElsewhere
												key={r.name}
												name={r.name}
												current={ticker}
												onSelectTicker={onSelectTicker}
											/>
										</td>
									</tr>
								)}
							</Fragment>
						);
					})}
				</tbody>
			</table>
			{view.length === 0 && (
				<p className="py-3 text-center font-mono text-[10px] text-[var(--text-faint)]">
					no holders match the current filter
				</p>
			)}
		</div>
	);
}

/* Lazy cross-issuer lookup: which other listed companies does this holder
   own? Fetched only when a row is expanded; matches are clickable to jump
   the whole page to that ticker. */
function OwnerElsewhere({
	name,
	current,
	onSelectTicker,
}: {
	name: string;
	current: string;
	onSelectTicker: (t: string) => void;
}) {
	const [res, setRes] = useState<OwnerHoldings | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let alive = true;
		api
			.get<OwnerHoldings>(
				`/api/intel/owner/holdings?name=${encodeURIComponent(name)}`,
			)
			.then((d) => alive && setRes(d))
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
		};
	}, [name]);

	if (failed) return null;
	const matches = (res?.matches ?? []).filter((m) => m.ticker !== current);
	const matchTickers = new Set(matches.map((m) => m.ticker));
	const restIssuers = (res?.issuers ?? []).filter(
		(i) => i.ticker !== current && !matchTickers.has(i.ticker),
	);
	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
			<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
				Also holds
				{res ? ` · ${res.issuers_scanned} issuers scanned` : ""}
			</span>
			{!res && (
				<span className="font-mono text-[10px] text-[var(--text-faint)]">
					searching…
				</span>
			)}
			{matches.map((m) => (
				<button
					key={m.ticker}
					onClick={() => onSelectTicker(m.ticker)}
					title={`${m.category || "holder"}${m.controlling ? " · controlling" : ""}${
						m.as_of ? ` · as of ${m.as_of}` : ""
					}`}
					className={`max-w-[22rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold ${
						m.controlling
							? "bg-[var(--gold)] text-black"
							: "panel-2 text-[var(--accent)] hover:text-black"
					}`}
				>
					{m.name || m.ticker}
					<span className="opacity-60"> {m.ticker}</span>
					{m.percent != null ? ` ${fmtNum(m.percent, 2)}%` : ""}
				</button>
			))}
			{/* Every other archived stock — visible and clickable even when
			    this holder isn't in it. */}
			{restIssuers.map((i) => (
				<button
					key={i.ticker}
					onClick={() => onSelectTicker(i.ticker)}
					title={i.name || i.ticker}
					className="max-w-[22rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px] panel-2 text-[var(--text-faint)] hover:text-[var(--accent)]"
				>
					{i.name || i.ticker}
					<span className="opacity-60"> {i.ticker}</span>
				</button>
			))}
			{res && matches.length === 0 && res.issuers_scanned === 0 && (
				<span className="font-mono text-[10px] text-[var(--text-faint)]">
					archive is empty — load some companies first
				</span>
			)}
		</div>
	);
}
