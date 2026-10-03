import { SectionBodies } from "@/components/sections";

export default function Page() {
	return (
		<main id="main" className="mx-auto max-w-[1380px] px-4 sm:px-6 lg:px-8">
			<div className="border-b border-[var(--border)] py-14 sm:py-20 lg:py-28">
				<p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-ghost)]">
					$ idx desk
				</p>
				<h1 className="mt-4 max-w-[24ch] font-display text-[34px] leading-[1.05] tracking-[-0.02em] text-[var(--text)] sm:text-[44px] lg:text-[54px]">
					The IDX desk, end to end.
				</h1>
				<p className="mt-6 max-w-[58ch] text-[14px] leading-relaxed text-[var(--text-dim)] sm:text-[15px]">
					Indices and the regime read, candlestick charts with foreign flow and
					ownership, the screener, a FIFO portfolio profiler, and the position
					math. Stacked in reading order — no menus between them.
				</p>
			</div>

			<SectionBodies />

			<footer className="border-t border-[var(--border)] py-10">
				<p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
					Trading Suite · Indonesia Stock Exchange
				</p>
			</footer>
		</main>
	);
}
