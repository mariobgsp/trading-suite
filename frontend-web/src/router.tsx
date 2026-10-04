import { useEffect } from "react";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { SectionBodies } from "@/components/sections";
import ThemeToggle from "@/components/ThemeToggle";
import { SECTIONS } from "@/lib/sections";

/* Next exported these from app/layout.tsx as `metadata`. Vite has no
 * metadata API, so the same two values are written onto the document shell
 * that index.html ships. */
const TITLE = "Trading Suite — IDX Desk";
const DESCRIPTION =
	"The IDX desk on one page: live IHSG indices and regime, candlestick charts with foreign flow and ownership, the screener, a FIFO portfolio profiler, and position calculators.";

/**
 * Port of src/app/layout.tsx. <html>/<body> live in index.html, so this keeps
 * only the in-body markup and renders the child route through <Outlet />.
 */
function RootComponent() {
	useEffect(() => {
		document.title = TITLE;
		document
			.querySelector('meta[name="description"]')
			?.setAttribute("content", DESCRIPTION);
	}, []);

	return (
		<>
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[4px] focus:bg-[var(--text)] focus:px-3 focus:py-2 focus:font-mono focus:text-[11px] focus:text-[var(--bg)]"
			>
				Skip to content
			</a>
			<header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]">
				<div className="mx-auto flex max-w-[1380px] items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
					<div className="flex shrink-0 items-center gap-4">
						<span className="font-display text-[15px] tracking-[-0.01em] text-[var(--text)]">
							Trading Suite
						</span>
						<ThemeToggle />
					</div>
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
			<Outlet />
		</>
	);
}

/** Port of src/app/page.tsx. */
function IndexComponent() {
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

const rootRoute = createRootRoute({ component: RootComponent });

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	// The only query param the single page reads is ?ticker=, consumed by the
	// markets and profiler sections via useSearch({ from: "/" }). Declaring it
	// here gives those reads a type and normalises the URL on navigation.
	validateSearch: (search: Record<string, unknown>): { ticker?: string } => ({
		ticker: typeof search.ticker === "string" ? search.ticker : undefined,
	}),
	component: IndexComponent,
});

/* Every entry of the redirect table in the old next.config.ts. Each one is a
 * path plus its `:path*` deep-link variant; all of them are sunset pages, so
 * the surviving single page at "/" is the destination. `/$` is TanStack's
 * splat, the equivalent of Next's `:path*`. */
const RETIRED_PATHS = [
	"suspended",
	"foreignflow",
	"brokerintel",
	"validator",
	"alerts",
	"konglo",
	"rotation",
	"ownership",
	"msci",
	"announcements",
	"regime",
	"backtest",
	"sentiment",
	"watchlist",
	"journal",
	"stealth",
	"wiki",
	"portfolio",
] as const;

function redirectHome() {
	// `search: {}` clears the query, matching Next's redirect: a redirect
	// never forwards ?… to its destination. Omitting it would keep the
	// current search instead.
	throw redirect({ to: "/", search: {} });
}

const redirectRoutes = RETIRED_PATHS.flatMap((path) => [
	createRoute({
		getParentRoute: () => rootRoute,
		path,
		beforeLoad: redirectHome,
	}),
	createRoute({
		getParentRoute: () => rootRoute,
		path: `${path}/$`,
		beforeLoad: redirectHome,
	}),
]);

export const router = createRouter({
	routeTree: rootRoute.addChildren([indexRoute, ...redirectRoutes]),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}