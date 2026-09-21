"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import type { AppMeta } from "@/lib/apps";

/**
 * Decorative 196px data preview rendered in each card header.
 * CSS-only looping animation; `prefers-reduced-motion` is handled globally.
 */
function AppViz({ viz }: { viz: AppMeta["viz"] }) {
	switch (viz.kind) {
		case "eq":
			return (
				<div className="viz-eq" aria-hidden="true">
					{[34, 62, 46, 78, 52, 90, 58, 72, 40, 66, 48].map((h, i) => (
						<span
							key={i}
							className="viz-eq-bar"
							style={{
								height: `${h}%`,
								background: i % 2 === 0 ? "var(--accent)" : "var(--border)",
								animationDelay: `${-i * 0.18}s`,
								opacity: i % 2 === 0 ? 0.95 : 0.9,
							}}
						/>
					))}
				</div>
			);
		case "bars":
			return (
				<div className="viz-bars" aria-hidden="true">
					{[28, 46, 38, 62, 52, 84].map((h, i) => (
						<span
							key={i}
							className="viz-bar"
							style={{
								height: `${h}%`,
								background: i === 4 ? "var(--accent)" : "var(--border)",
							}}
						/>
					))}
				</div>
			);
		case "meters":
			return (
				<div className="viz-meters" aria-hidden="true">
					{viz.rows.map((row) => (
						<div key={row.label} className="meter-row">
							<span className="meter-label">{row.label}</span>
							<span className="meter-track">
								<span
									className={`meter-fill ${row.dim ? "dim" : ""}`}
									style={{ "--w": `${row.pct}%` } as React.CSSProperties}
								/>
							</span>
							<span className="meter-val">{row.pct}%</span>
						</div>
					))}
				</div>
			);
		case "stat":
			return (
				<div aria-hidden="true">
					<div className="flex items-baseline gap-2">
						<span className="viz-stat">{viz.value}</span>
						<span className="viz-stat-unit">{viz.unit}</span>
					</div>
					<div className="mt-5">
						<div className="viz-seg">
							{viz.segments.map((seg, i) => (
								<span
									key={i}
									className={seg.locked ? "viz-seg-locked" : "viz-seg-fill"}
									style={{ width: `${seg.pct}%` }}
								/>
							))}
						</div>
						<div className="viz-head mt-2.5 flex justify-between opacity-70">
							<span>Tradable</span>
							<span>Locked</span>
						</div>
					</div>
				</div>
			);
	}
}

/** One launchpad tile — the whole card is a link. */
export function AppCard({ app, index = 0 }: { app: AppMeta; index?: number }) {
	const doPrefetch = () => {
		// warm the first endpoint for each tool so navigation feels instant
		if (app.endpoints[0])
			api.prefetch(app.endpoints[0].replace("{ticker}", "BBCA"));
	};
	return (
		<Link
			href={app.href}
			onMouseEnter={doPrefetch}
			onFocus={doPrefetch}
			prefetch
			className="tool-card group flex flex-col rise-in"
			aria-label={`Open ${app.name} — ${app.tagline}`}
			style={{ animationDelay: `${index * 0.06}s` } as React.CSSProperties}
		>
			{/* Viz header — flat canvas */}
			<div
				className="relative h-[204px] shrink-0 overflow-hidden bg-[var(--bg-subtle)] p-6"
				style={{ borderBottom: "1px solid var(--border)" }}
			>
				<div className="viz-head flex items-center justify-between">
					<span className="tracking-[0.16em]">{app.badge ?? app.name}</span>
					<span className="flex items-center gap-2">
						{app.badge === "LIVE" && <span className="viz-live" aria-hidden="true" />}
						<span className="viz-badge">{app.num}</span>
					</span>
				</div>
				<div className="mt-5 h-[128px]">
					<AppViz viz={app.viz} />
				</div>
			</div>

			{/* Text body */}
			<div className="flex flex-1 flex-col gap-3 p-6 sm:p-[26px]">
				<div className="flex items-baseline gap-3">
					<span className="font-mono text-xs font-bold tracking-widest text-[var(--accent)]">
						{app.num}
					</span>
					<h3 className="text-balance text-[22px] font-semibold leading-none tracking-[-0.022em] text-[var(--text)] sm:text-[24px]">
						{app.name}
					</h3>
				</div>
				<p className="max-w-[32ch] text-pretty text-[14px] font-light leading-[1.6] text-[var(--text-dim)]">
					{app.tagline}
				</p>

				{/* Footer — pinned to bottom */}
				<div
					className="mt-auto flex items-center justify-between pt-4 font-mono text-[11px]"
					style={{ borderTop: "1px solid var(--line)" }}
				>
					<span className="truncate pr-4 font-medium tracking-wide text-[var(--text-ghost)]">
						{app.href}
					</span>
					<span className="inline-flex shrink-0 items-center gap-1.5 font-bold tracking-[0.14em] text-[var(--accent)] transition-all duration-300 group-hover:gap-2.5">
						OPEN
						<span
							aria-hidden="true"
							className="translate-x-0 transition-transform duration-300 group-hover:translate-x-0.5"
						>
							→
						</span>
					</span>
				</div>
			</div>
		</Link>
	);
}

/** "TOOLS & DATA" section — eyebrow, display heading, dim intro, 2-col grid. */
export function AppsGrid({ apps }: { apps: AppMeta[] }) {
	return (
		<section className="mt-2">
			<div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-4 sm:mb-10">
				<div className="min-w-0">
					<span className="eyebrow">Tools &amp; Data</span>
					<h2
						className="mt-3 max-w-[12ch] text-balance font-semibold tracking-[-0.03em] text-[var(--text)] rise-in"
						style={{ fontSize: "clamp(34px, 4vw, 52px)", lineHeight: 0.96 }}
					>
						Built for the desk.
					</h2>
				</div>
				<p className="max-w-[32em] text-pretty text-[15px] font-light leading-relaxed text-[var(--text-dim)] rise-in-2">
					Eight tools across markets, portfolio, screening, and sentiment — one dark
					desk for the IDX. Every view streams live and respects the regime filter.
				</p>
			</div>

			<div className="h-px bg-[var(--line)] mb-8 rise-in-2" />

			<div className="grid grid-cols-1 gap-5 sm:gap-[22px] lg:grid-cols-2">
				{apps.map((app, i) => (
					<AppCard key={app.href} app={app} index={i} />
				))}
			</div>

			<p className="mx-auto mt-8 max-w-2xl text-center font-mono text-[11px] leading-relaxed tracking-wide text-[var(--text-ghost)]">
				Data via yfinance · cached on disk · SSE streaming. Quotes are delayed and
				for research only — not a recommendation.
			</p>
		</section>
	);
}
