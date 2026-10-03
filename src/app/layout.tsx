import type { Metadata } from "next";
import { SECTIONS } from "@/lib/sections";
import "./globals.css";

export const metadata: Metadata = {
	title: "Trading Suite — IDX Desk",
	description:
		"The IDX desk on one page: live IHSG indices and regime, candlestick charts with foreign flow and ownership, the screener, a FIFO portfolio profiler, and position calculators.",
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>
				<a
					href="#main"
					className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[4px] focus:bg-[var(--text)] focus:px-3 focus:py-2 focus:font-mono focus:text-[11px] focus:text-[var(--bg)]"
				>
					Skip to content
				</a>
				<header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]">
					<div className="mx-auto flex max-w-[1380px] items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
						<span className="font-display text-[15px] tracking-[-0.01em] text-[var(--text)]">
							Trading Suite
						</span>
						<nav
							aria-label="Sections"
							className="flex items-center gap-4 overflow-x-auto sm:gap-6"
						>
							{SECTIONS.map(({ id, num, label }) => (
								<a
									key={id}
									href={`#${id}`}
									className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
								>
									<span className="text-[var(--text-ghost)]">{num}</span> {label}
								</a>
							))}
						</nav>
					</div>
				</header>
				{children}
			</body>
		</html>
	);
}
