"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { APPS } from "@/lib/apps";

export default function Sidebar({ active }: { active: string }) {
	return (
		<aside className="hidden w-[268px] shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_92%,transparent)] backdrop-blur-[14px] lg:flex sticky top-0 h-dvh">
			{/* Brand */}
			<div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-[var(--border)] px-5">
				<div className="flex h-[36px] w-[36px] items-center justify-center rounded-control bg-[var(--accent-strong)] text-[13px] font-black tracking-tight text-black shadow-[0_6px_18px_-8px_rgba(56,189,248,0.6)]">
					TS
				</div>
				<div className="min-w-0">
					<div className="text-[14px] font-semibold tracking-[-0.02em] text-[var(--text)] leading-none">
						Trading Suite
					</div>
					<div className="mt-1 font-mono text-[10px] font-semibold tracking-[0.14em] text-[var(--text-faint)]">
						IDX · IHSG · LQ45
					</div>
				</div>
				<span className="ml-auto hidden xl:inline-flex items-center rounded-pill border border-[var(--accent-dim)] bg-[var(--accent-dim)] px-2 py-1 font-mono text-[10px] font-bold tracking-widest text-[var(--accent)]">
					LIVE
				</span>
			</div>

			{/* Nav */}
			<nav className="flex-1 overflow-y-auto px-3 py-5">
				<div className="mb-3 px-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--text-ghost)]">
					NAVIGATE
				</div>
				<Link
					href="/"
					prefetch
					className={`group flex items-center gap-3 rounded-control px-3 py-2.5 text-[13.5px] transition-all duration-200 ${
						active === "/"
							? "bg-[var(--panel-2)] text-[var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-[var(--border)]"
							: "text-[var(--text-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--text)] hover:translate-x-[1px]"
					}`}
				>
					<span
						className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[13px] transition-colors ${
							active === "/"
								? "bg-[var(--accent-dim)] text-[var(--accent)]"
								: "bg-[var(--panel-3)] text-[var(--text-faint)] group-hover:bg-[var(--panel-2)] group-hover:text-[var(--text-dim)]"
						}`}
					>
						⌂
					</span>
					<span className={active === "/" ? "font-semibold" : "font-medium"}>Apps</span>
					{active === "/" && (
						<span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent-glow)]" />
					)}
				</Link>

				<div className="my-4 h-px bg-[var(--line)]" />

				<div className="mb-2 px-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--text-ghost)]">
					TOOLS — 08
				</div>

				<div className="space-y-1">
					{APPS.map((item) => {
						const isActive = active === item.href;
						return (
							<Link
								key={item.href}
								href={item.href}
								prefetch
								onMouseEnter={() => {
									if (item.endpoints[0]) api.prefetch(item.endpoints[0].replace("{ticker}", "BBCA"));
								}}
								className={`group flex items-center gap-3 rounded-control px-3 py-2.5 text-[13.5px] transition-all duration-200 ${
									isActive
										? "bg-[var(--panel-2)] font-semibold text-[var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-[var(--border-strong)]"
										: "font-medium text-[var(--text-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--text)] hover:translate-x-[1px]"
								}`}
							>
								<span
									className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[12px] transition-colors ${
										isActive
											? "bg-[var(--accent-dim)] text-[var(--accent)]"
											: "bg-[var(--panel-3)]/80 text-[var(--text-faint)] group-hover:bg-[var(--panel-3)] group-hover:text-[var(--text-dim)]"
									}`}
								>
									{item.glyph}
								</span>
								<span className="truncate">{item.name}</span>
								<span className="ml-auto font-mono text-[10px] font-medium tracking-widest opacity-60 group-hover:opacity-100">
									{item.num}
								</span>
							</Link>
						);
					})}
				</div>
			</nav>

			{/* Footer meta */}
			<div className="border-t border-[var(--border)] p-3">
				<div className="rounded-control border border-[var(--border)] bg-[var(--panel-2)] p-3.5">
					<div className="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--text-faint)]">
						SYSTEM
					</div>
					<div className="mt-1.5 font-mono text-[11px] leading-relaxed text-[var(--text-dim)]">
						Merged from 6 repos
						<br />
						<span className="text-[var(--text-faint)]">trading-simulator · backtester</span>
						<br />
						<span className="text-[var(--text-faint)]">bot · validator · screener</span>
						<br />
						<span className="text-[var(--text-faint)]">sentiment-analysis</span>
					</div>
					<div className="mt-3 flex items-center gap-2 font-mono text-[10px] text-[var(--text-ghost)]">
						<span className="h-1.5 w-1.5 rounded-full bg-[var(--up)] shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
						All systems operational
					</div>
				</div>
				<div className="mt-3 flex items-center justify-between px-1 font-mono text-[10px] text-[var(--text-ghost)]">
					<span>© 2026 Trading Suite</span>
					<span className="text-[var(--text-faint)]">v0.1</span>
				</div>
			</div>
		</aside>
	);
}
