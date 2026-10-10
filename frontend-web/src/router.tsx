import { useEffect } from "react";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import RefreshButton from "@/components/RefreshButton";
import ThemeToggle from "@/components/ThemeToggle";
import Tonight from "@/routes/Tonight";
import Name from "@/routes/Name";
import Method from "@/routes/Method";
import Screener from "@/routes/Screener";

/**
 * Four screens, and that is the whole navigation.
 *
 *   Tonight  - what to buy, or why not to
 *   Screener - every name, ranked by how near it is to being buyable
 *   Method   - the rules and the measured proof
 *   Name     - one name, priced as a trade, with its chart
 *
 * The earlier 22-tool desk is gone. Its chart survives on the Name page, where
 * the levels the method trades against are drawn on the candles. Everything
 * else — the portfolio profiler, the ownership panel, the broker feed, the
 * calculators, the old behaviour screener — was machinery around a different
 * question and has no place in a tool you open once a night to decide what to
 * buy.
 */

const TITLE = "Tonight — IDX swing plan";
const DESCRIPTION =
	"Which IDX stocks to buy next session and why, from a walk-forward measured swing-trading method: 80%+ win rate and +5% average per trade, with fees inside every trade.";

/** The nav. Order is reading order, not importance. */
const NAV = [
	{ to: "/", label: "Tonight" },
	{ to: "/screener", label: "Screener" },
	{ to: "/method", label: "Method" },
] as const;

function RootComponent() {
	// Vite has no metadata API, so the two values the page needs are written
	// onto the shell index.html ships.
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
				<div className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
					<Link to="/" className="shrink-0 font-display text-[15px] tracking-[-0.01em] text-[var(--text)]">
						Tonight
					</Link>
					<nav aria-label="Sections" className="flex items-center gap-5 sm:gap-7">
						{NAV.map(({ to, label }) => (
							<Link
								key={to}
								to={to}
								activeOptions={{ exact: to === "/" }}
								activeProps={{ className: "text-[var(--text)]" }}
								inactiveProps={{ className: "text-[var(--text-ghost)]" }}
								className="font-mono text-[11px] uppercase tracking-[0.12em] transition-colors hover:text-[var(--text)]"
							>
								{label}
							</Link>
						))}
					</nav>
					<div className="flex items-center gap-3">
						<RefreshButton />
						<ThemeToggle />
					</div>
				</div>
			</header>
			<main id="main">
				<Outlet />
			</main>
			<footer className="border-t border-[var(--border)]">
				<div className="mx-auto max-w-[1180px] px-4 py-8 text-[11px] leading-relaxed text-[var(--text-ghost)] sm:px-6 lg:px-8">
					<p className="max-w-[80ch]">
						Every number here is read from a walk-forward backtest of the IDX universe, with fees
						and slippage inside each trade. It is a research result, not financial advice, and it
						is not a promise — read{" "}
						<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text-faint)]">
							the method page
						</Link>{" "}
						before the first trade.
					</p>
				</div>
			</footer>
		</>
	);
}

const rootRoute = createRootRoute({
	component: RootComponent,
	notFoundComponent: () => (
		<div className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8">
			<p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-ghost)]">404</p>
			<h1 className="mt-3 font-display text-[32px] text-[var(--text)]">No such screen</h1>
			<Link to="/" className="mt-4 inline-block font-mono text-[12px] text-[var(--text-faint)] underline underline-offset-4">
				Back to tonight
			</Link>
		</div>
	),
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	/* The only query the plan reads is `?ticker=`, used by a retired bookmark to
	 * land on a specific name. Declaring it here gives the read a type and
	 * normalises the URL. */
	validateSearch: (s: Record<string, unknown>): { ticker?: string } => ({
		ticker: typeof s.ticker === "string" ? s.ticker : undefined,
	}),
	component: Tonight,
});

const nameRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/name/$ticker",
	component: Name,
});

const methodRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/method",
	component: Method,
});

const screenerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/screener",
	component: Screener,
});

/* A retired tool path. The 22-tool desk is gone, so these land on the plan. A
 * `?ticker=` carried in from a bookmark is preserved rather than dropped, so an
 * old "screener?ticker=BBCA" link still opens that name. */


/* The retired tool routes. Each had its own page before; they all land on the
 * plan now, so an old bookmark lands somewhere real instead of a 404. */
const RETIRED = [
	"desk",
	"overview",
	"markets",
	"profiler",
	"calculators",
	"watchlist",
	"backtest",
	"regime",
	"alerts",
	"portfolio",
	"journal",
	"rotation",
	"ownership",
	"sentiment",
	"announcements",
	"foreignflow",
	"brokerintel",
	"validator",
	"suspended",
	"konglo",
	"msci",
	"stealth",
	"wiki",
] as const;

function toPlan() {
	throw redirect({ to: "/" });
}

const retiredRoutes = RETIRED.flatMap((path) => [
	createRoute({ getParentRoute: () => rootRoute, path, beforeLoad: toPlan }),
	createRoute({ getParentRoute: () => rootRoute, path: `${path}/$`, beforeLoad: toPlan }),
]);

export const router = createRouter({
	routeTree: rootRoute.addChildren([
		indexRoute,
		screenerRoute,
		methodRoute,
		nameRoute,
		...retiredRoutes,
	]),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}