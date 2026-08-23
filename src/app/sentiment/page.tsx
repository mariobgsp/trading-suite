"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type SentimentFeed } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import Shell from "@/components/Shell";
import { SectionHeader, StatCard } from "@/components/ui";

const CATEGORY_ORDER = ["WHALE", "KINERJA", "ACTION", "KOMODITAS", "GLOBAL"];

export default function SentimentPage() {
	const [category, setCategory] = useState<string>("ALL");
	const [tag, setTag] = useState<string>("ALL");
	const feed = usePolling<SentimentFeed>(
		() => api.getCached<SentimentFeed>("/api/sentiment/news"),
		300000,
		"",
		{ cacheKey: "/api/sentiment/news" },
	);

	// Backend serves stale instantly + refreshes in background; this second
	// poll picks up the freshly-fetched feed ~2s after mount without blocking.
	useEffect(() => {
		const t = setTimeout(() => void feed.refresh(), 2500);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const items = useMemo(() => {
		if (!feed.data) return [];
		let out = feed.data.items;
		if (category !== "ALL") out = out.filter((i) => i.category === category);
		if (tag !== "ALL") out = out.filter((i) => i.tags.includes(tag));
		return out;
	}, [feed.data, category, tag]);

	const allTags = useMemo(() => {
		const set = new Set<string>();
		feed.data?.items.forEach((i) => i.tags.forEach((t) => set.add(t)));
		return [...set].sort();
	}, [feed.data]);

	const counts = useMemo(() => {
		const c: Record<string, number> = {};
		feed.data?.items.forEach((i) => {
			c[i.category] = (c[i.category] ?? 0) + 1;
		});
		return c;
	}, [feed.data]);

	return (
		<Shell>
			<SectionHeader
				eyebrow="Kontan · Bisnis · CNBC Indonesia · Investor.id"
				title="Sentiment Radar"
				subtitle="Weekly market intelligence — whale & insider, financials, corporate action, commodities. Watch the tape, not the noise."
				right={
					<button
						onClick={() => void feed.refresh()}
						className="rounded-control bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-black transition-all hover:brightness-[1.05] active:scale-[0.985]"
					>
						Rescan News
					</button>
				}
			/>

			<div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
				<StatCard
					label="Total Headlines"
					value={feed.data?.count ?? "…"}
					tone="accent"
				/>
				<StatCard label="Whale / Insider" value={counts.WHALE ?? 0} tone="up" />
				<StatCard
					label="Financials"
					value={counts.KINERJA ?? 0}
					tone="accent"
				/>
				<StatCard
					label="Corporate Action"
					value={counts.ACTION ?? 0}
					tone="accent"
				/>
			</div>

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<button
					onClick={() => setCategory("ALL")}
					className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
						category === "ALL"
							? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent)]"
							: "text-[var(--text-dim)] hover:bg-[var(--panel-2)]"
					}`}
				>
					All
				</button>
				{CATEGORY_ORDER.map((c) => (
					<button
						key={c}
						onClick={() => setCategory(c)}
						className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
							category === c
								? "bg-[var(--panel-2)] text-[var(--accent)] ring-1 ring-[var(--accent)]"
								: "text-[var(--text-dim)] hover:bg-[var(--panel-2)]"
						}`}
					>
						{c}
					</button>
				))}
				<select
					value={tag}
					onChange={(e) => setTag(e.target.value)}
					className="panel-2 ml-auto px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none"
				>
					<option value="ALL">All topics</option>
					{allTags.map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
			</div>

			{items.length === 0 ? (
				<div className="panel p-8 font-mono text-xs text-[var(--text-faint)]">
					{feed.loading ? "$ news --fetching…" : "No headlines for this filter — $ news --rescan"}
				</div>
			) : (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{items.map((item, i) => (
						<a
							key={`${item.link}-${i}`}
							href={item.link}
							target="_blank"
							rel="noreferrer"
							className="panel block p-4 transition-colors hover:border-[var(--border-strong)]"
							style={{ borderLeft: `3px solid ${item.color}` }}
						>
							<div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--text-faint)]">
								<span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 font-semibold uppercase">
									{item.source}
								</span>
								<span>{item.date_str}</span>
								<span className="ml-auto flex items-center gap-1">
									<SentimentDot score={item.score} />
									<span className="capitalize">{item.sentiment}</span>
								</span>
							</div>
							<div className="text-sm font-semibold leading-snug text-[var(--text)] hover:text-[var(--accent)]">
								{item.title}
							</div>
							<div className="mt-2 flex flex-wrap items-center gap-1">
								<span
									className="rounded px-1.5 py-0.5 text-[10px] font-bold"
									style={{
										color: item.color,
										backgroundColor: `${item.color}18`,
									}}
								>
									{item.label}
								</span>
								{item.tags.slice(0, 5).map((t) => (
									<span
										key={t}
										className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-dim)]"
									>
										{t}
									</span>
								))}
							</div>
						</a>
					))}
				</div>
			)}
		</Shell>
	);
}

function SentimentDot({ score }: { score: number }) {
	const tone =
		score > 0 ? "var(--up)" : score < 0 ? "var(--down)" : "var(--text-faint)";
	return (
		<span
			className="inline-block h-2 w-2 rounded-full"
			style={{ backgroundColor: tone }}
			title={`sentiment ${score}`}
		/>
	);
}
