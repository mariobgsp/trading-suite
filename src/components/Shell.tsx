"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { APPS } from "@/lib/apps";
import { api } from "@/lib/api";

export default function Shell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const active = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;
	const [cmdOpen, setCmdOpen] = useState(false);
	const [cmdQuery, setCmdQuery] = useState("");
	const [clock, setClock] = useState<string | null>(null); // null = SSR, set on mount

	// ⌘K / Ctrl+K — instant palette, no load
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setCmdOpen((v) => !v);
			}
			if (e.key === "Escape") setCmdOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Lean warm — only BBCA (markets/overview share it). No fan-out to 5 tickers × 4 periods.
	useEffect(() => {
		api.prefetch("/api/market/quote/BBCA");
		api.prefetch("/api/market/history/BBCA?period=1y");
		api.prefetch("/api/market/indices");
		api.prefetch("/api/regime/snapshot");
	}, []);

	// Title-bar clock — ticks every 30s. Initial render stays null to avoid hydration mismatch.
	useEffect(() => {
		const fmt = () =>
			new Date().toLocaleTimeString("id-ID", {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
				timeZone: "Asia/Jakarta",
			});
		const id = setInterval(() => setClock(fmt()), 30_000);
		return () => clearInterval(id);
	}, []);

	const filtered = APPS.filter(
		(a) =>
			!cmdQuery ||
			a.name.toLowerCase().includes(cmdQuery.toLowerCase()) ||
			a.tagline.toLowerCase().includes(cmdQuery.toLowerCase()) ||
			a.href.includes(cmdQuery.toLowerCase()),
	);

	return (
		<div className="flex min-h-dvh overflow-hidden bg-[var(--bg)] font-mono">
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
			>
				skip
			</a>

			<Sidebar active={active} />

			<div className="flex flex-1 flex-col min-w-0">
				{/* Terminal window chrome — renders instantly, zero data fetch */}
				<div className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--panel)]">
					{/* title bar like macOS terminal */}
					<div className="flex h-7 items-center gap-1.5 px-3">
						<span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
						<span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
						<span className="h-3 w-3 rounded-full bg-[#27c93f]" />
						<span className="ml-3 font-mono text-[11px] tracking-wide text-[var(--text-faint)]">
							trading-suite — zsh — 80×24
						</span>
						<span className="ml-auto hidden items-center gap-3 font-mono text-[10px] text-[var(--text-ghost)] sm:flex">
							<span className="status-pill">
								<span className="status-dot live" />
								<span>online</span>
							</span>
							{clock && (
								<span
									className="hidden md:inline text-[var(--text-faint)]"
									suppressHydrationWarning
								>
									{clock} WIB
								</span>
							)}
						</span>
					</div>
					{/* prompt bar — instant, no API */}
					<div className="flex items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1.5">
						<span className="font-mono text-[11px] font-bold text-[var(--up)]">
							mario@desk
						</span>
						<span className="text-[var(--text-ghost)]">:</span>
						<span className="font-mono text-[11px] font-semibold text-[var(--accent)]">
							~{pathname}
						</span>
						<span className="font-mono text-[11px] text-[var(--text-faint)]">$</span>
						<span className="ml-1 hidden sm:inline font-mono text-[11px] text-[var(--text-dim)]">
							{active === "/" ? "ls --apps" : `run ${active.replace("/", "")}`}
						</span>
						<span
							className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--accent)]"
							aria-hidden
						/>
						<button
							onClick={() => setCmdOpen(true)}
							className="ml-auto hidden sm:inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 font-mono text-[10px] leading-none text-[var(--text-faint)] hover:text-[var(--text-dim)]"
						>
							<span className="rounded bg-[var(--panel-3)] px-1 py-0.5 text-[10px]">
								⌘
							</span>
							K
						</button>
					</div>
				</div>

				{/* Mobile nav — instant, no fetch */}
				<div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					<Link
						href="/"
						className={`shrink-0 rounded border px-3 py-1 font-mono text-xs ${active === "/" ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]" : "border-transparent bg-[var(--panel-2)] text-[var(--text-dim)]"}`}
					>
						$ ls
					</Link>
					{APPS.map((a) => (
						<Link
							key={a.href}
							href={a.href}
							className={`shrink-0 rounded border px-3 py-1 font-mono text-xs ${active === a.href ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]" : "border-transparent bg-[var(--panel-2)] text-[var(--text-dim)]"}`}
						>
							{a.name}
						</Link>
					))}
				</div>

				<main
					id="main"
					className="flex-1 overflow-y-auto"
					style={{ scrollbarGutter: "stable" }}
				>
					<div className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 lg:px-8 lg:py-6">
						{children}
					</div>
					<footer className="mx-auto max-w-[1380px] px-4 pb-6 sm:px-6 lg:px-8">
						<div className="border-t border-[var(--line)] pt-4 font-mono text-[11px] leading-relaxed text-[var(--text-ghost)]">
							<span className="text-[var(--up)]">●</span> live ·{" "}
							<span className="text-[var(--text-faint)]">IDX delayed</span> · no advice
							·{" "}
							<span className="underline decoration-[var(--line-2)] underline-offset-4">
								privacy
							</span>{" "}
							·{" "}
							<span className="underline decoration-[var(--line-2)] underline-offset-4">
								terms
							</span>
						</div>
					</footer>
				</main>
			</div>

			{/* Command palette — instant, client-only, no data fetch */}
			{cmdOpen && (
				<div
					className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[14vh]"
					onClick={() => setCmdOpen(false)}
				>
					<div
						className="panel w-full max-w-[560px] overflow-hidden rounded-[14px] border-[var(--border-strong)] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
							<span className="font-mono text-sm text-[var(--text-faint)]">$</span>
							<input
								autoFocus
								value={cmdQuery}
								onChange={(e) => setCmdQuery(e.target.value)}
								placeholder="type app, ticker, or command…"
								className="w-full bg-transparent font-mono text-sm text-[var(--text)] placeholder:text-[var(--text-ghost)] focus:outline-none"
							/>
							<span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
								ESC
							</span>
						</div>
						<div className="max-h-[50vh] overflow-y-auto p-2">
							{filtered.length === 0 ? (
								<p className="px-3 py-6 text-center font-mono text-xs text-[var(--text-faint)]">
									no match
								</p>
							) : (
								filtered.map((a) => (
									<button
										key={a.href}
										onClick={() => {
											setCmdOpen(false);
											router.push(a.href);
										}}
										className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-[var(--panel-2)]"
									>
										<span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--panel-3)] font-mono text-xs text-[var(--text-faint)]">
											{a.glyph}
										</span>
										<span className="min-w-0">
											<span className="block font-mono text-sm font-semibold text-[var(--text)]">
												{a.name}
											</span>
											<span className="block truncate font-mono text-xs text-[var(--text-faint)]">
												{a.href} — {a.tagline.slice(0, 48)}
											</span>
										</span>
										<span className="ml-auto font-mono text-xs text-[var(--text-ghost)]">
											{a.num}
										</span>
									</button>
								))
							)}
							<div className="mt-2 border-t border-[var(--line)] pt-2">
								<p className="px-3 py-1 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
									tip:{" "}
									<span className="text-[var(--text-faint)]">markets? ticker=BBCA</span>{" "}
									jumps straight to a chart · palette is instant, no network
								</p>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
