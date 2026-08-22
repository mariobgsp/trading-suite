import { Link } from "@tanstack/react-router";

/**
 * Simplified sidebar — 6 grouped sections instead of 19 flat links.
 *
 * Market Pulse is the daily screen (Overview/Heatmap/Movers live there);
 * Analysis, Ledger, and Intel group the deep tools; Learn holds the wiki.
 * The full 19-tool launcher grid remains on the home page.
 */
const GROUPS: {
	label: string;
	links: { href: string; glyph: string; name: string }[];
}[] = [
	{
		label: "Market Pulse",
		links: [{ href: "/overview", glyph: "◈", name: "Overview" }],
	},
	{
		label: "Analysis",
		links: [
			{ href: "/markets", glyph: "▤", name: "Markets" },
			{ href: "/screener", glyph: "◫", name: "Screener" },
			{ href: "/validator", glyph: "◉", name: "Validator" },
			{ href: "/profiler", glyph: "◉", name: "Stock Profiler" },
			{ href: "/alerts", glyph: "◔", name: "D-Signal" },
		],
	},
	{
		label: "Ledger",
		links: [
			{ href: "/portfolio", glyph: "▤", name: "Portfolio" },
			{ href: "/journal", glyph: "▤", name: "Trade Journal" },
			{ href: "/backtest", glyph: "↻", name: "Backtest" },
			{ href: "/calculators", glyph: "⚖", name: "Calculators" },
		],
	},
	{
		label: "Intel",
		links: [
			{ href: "/foreignflow", glyph: "◭", name: "Foreign Flow" },
			{ href: "/brokerintel", glyph: "◍", name: "Broker Intel" },
			{ href: "/announcements", glyph: "▣", name: "Announcements" },
			{ href: "/ownership", glyph: "◍", name: "Ownership" },
			{ href: "/msci", glyph: "◈", name: "MSCI Watch" },
			{ href: "/watchlist", glyph: "◫", name: "Watchlist" },
			{ href: "/sector-rotation", glyph: "◫", name: "Sector Rotation" },
			{ href: "/konglo", glyph: "⊕", name: "Konglo" },
			{ href: "/sentiment", glyph: "◈", name: "Sentiment" },
		],
	},
	{
		label: "Learn",
		links: [{ href: "/wiki", glyph: "▣", name: "Wiki" }],
	},
];

const itemClass = (active: boolean) =>
	`flex items-center gap-3 rounded-md px-3 py-1.5 text-[12.5px] transition-colors ${
		active
			? "bg-[var(--panel-2)] font-semibold text-[var(--accent)]"
			: "text-[var(--text-dim)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
	}`;

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

			<nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
				<Link to="/" className={`${itemClass(active === "/")} mb-1`}>
					<span className="w-4 text-center text-sm">⌂</span>
					Apps
				</Link>

				{GROUPS.map((g) => (
					<div key={g.label}>
						<div className="mb-1 px-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
							{g.label}
						</div>
						<div className="space-y-0.5">
							{g.links.map((l) => (
								<Link key={l.href} to={l.href} className={itemClass(active === l.href)}>
									<span className="w-4 text-center text-sm">{l.glyph}</span>
									{l.name}
								</Link>
							))}
						</div>
					</div>
				))}

				<div className="mt-4 rounded-md bg-[var(--panel-2)]/60 px-3 py-2 font-mono text-[10px] text-[var(--text-faint)]">
					21 tools · full grid on Apps
				</div>
			</nav>

			<div className="border-t border-[var(--border)] px-5 py-4">
				<div className="font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
					IDX market intelligence
					<br />
					all features free
				</div>
			</div>
		</aside>
	);
}
