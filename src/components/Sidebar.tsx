import Link from "next/link";
import { APPS } from "@/lib/apps";

export default function Sidebar({ active }: { active: string }) {
	return (
		<aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]">
			<div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
				<div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-sm font-black text-black">
					TS
				</div>
				<div>
					<div className="text-sm font-bold tracking-tight text-[var(--text)]">
						Trading Suite
					</div>
					<div className="font-mono text-[10px] text-[var(--text-faint)]">
						IDX · IHSG · LQ45
					</div>
				</div>
			</div>

			<nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
				<Link
					href="/"
					className={`mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${
						active === "/"
							? "bg-[var(--panel-2)] font-semibold text-[var(--accent)]"
							: "text-[var(--text-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
					}`}
				>
					<span className="w-4 text-center text-sm">⌂</span>
					Apps
				</Link>

				{APPS.map((item) => (
					<Link
						key={item.href}
						href={item.href}
						className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${
							active === item.href
								? "bg-[var(--panel-2)] font-semibold text-[var(--accent)]"
								: "text-[var(--text-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
						}`}
					>
						<span className="w-4 text-center text-sm">{item.glyph}</span>
						{item.name}
					</Link>
				))}
			</nav>

			<div className="border-t border-[var(--border)] px-5 py-4">
				<div className="font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
					Merged from 6 repos
					<br />
					trading-simulator · backtester
					<br />
					bot · validator · screener
					<br />
					sentiment-analysis
				</div>
			</div>
		</aside>
	);
}
