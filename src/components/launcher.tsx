import Link from "next/link";
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
								background: i % 2 === 0 ? "var(--accent)" : "var(--line-2)",
								animationDelay: `${-i * 0.18}s`,
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
								background: i === 4 ? "var(--accent)" : "var(--line-2)",
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
					<div>
						<span className="viz-stat">{viz.value}</span>
						<span className="viz-stat-unit"> {viz.unit}</span>
					</div>
					<div className="mt-4">
						<div className="viz-seg">
							{viz.segments.map((seg, i) => (
								<span
									key={i}
									className={seg.locked ? "viz-seg-locked" : "viz-seg-fill"}
									style={{ width: `${seg.pct}%` }}
								/>
							))}
						</div>
						<div className="viz-head mt-2 flex justify-between">
							<span>Tradable</span>
							<span>Locked</span>
						</div>
					</div>
				</div>
			);
	}
}

/** One launchpad tile — the whole card is a link. */
export function AppCard({ app }: { app: AppMeta }) {
	return (
		<Link
			href={app.href}
			className="tool-card flex flex-col rounded-card"
			aria-label={`Open ${app.name} — ${app.tagline}`}
		>
			{/* Viz header */}
			<div
				className="h-[196px] shrink-0 bg-canvas p-6"
				style={{ borderBottom: "1px solid var(--line)" }}
			>
				<div className="viz-head flex items-center justify-between">
					<span>{app.badge ?? app.name}</span>
					<span className="flex items-center gap-2">
						{app.badge === "LIVE" && (
							<span className="viz-live" aria-hidden="true" />
						)}
						<span className="viz-badge">{app.num}</span>
					</span>
				</div>
				<div className="mt-4 h-[128px]">
					<AppViz viz={app.viz} />
				</div>
			</div>

			{/* Text body */}
			<div className="flex flex-1 flex-col gap-3 p-[26px]">
				<div className="flex items-baseline gap-3">
					<span className="font-mono text-xs text-accent">{app.num}</span>
					<h3 className="text-2xl font-medium tracking-[-0.01em] text-ink">
						{app.name}
					</h3>
				</div>
				<p className="text-[15px] font-light leading-[1.56] text-ink-2">
					{app.tagline}
				</p>

				{/* Footer */}
				<div
					className="mt-auto flex items-center justify-between pt-3.5 font-mono text-[11px]"
					style={{ borderTop: "1px solid var(--line)" }}
				>
					<span className="text-ink-3">{app.href}</span>
					<span className="font-semibold text-accent">
						OPEN <span aria-hidden="true">→</span>
					</span>
				</div>
			</div>
		</Link>
	);
}

/** "TOOLS & DATA" section — eyebrow, display heading, dim intro, 2-col grid. */
export function AppsGrid({ apps }: { apps: AppMeta[] }) {
	return (
		<section className="mt-4">
			<div
				className="mb-13 flex flex-wrap items-end justify-between gap-x-10 gap-y-4"
				style={{ marginBottom: 52 }}
			>
				<div>
					<span className="eyebrow">Tools &amp; Data</span>
					<h2
						className="mt-3 font-medium tracking-[-0.02em] text-ink"
						style={{ fontSize: "clamp(34px, 3.8vw, 50px)", lineHeight: 1.05 }}
					>
						Built for the desk.
					</h2>
				</div>
				<p className="max-w-[30em] text-base font-light text-ink-3">
					Eight tools across markets, portfolio, screening, and sentiment — one
					dark desk for the IDX.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-[22px] lg:grid-cols-2">
				{apps.map((app) => (
					<AppCard key={app.href} app={app} />
				))}
			</div>
		</section>
	);
}
