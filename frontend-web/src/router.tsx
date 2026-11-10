import { useEffect } from "react";
import {
	Link,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import RefreshButton from "@/components/RefreshButton";
import ThemeToggle from "@/components/ThemeToggle";
import Tonight from "@/routes/Tonight";
import Method from "@/routes/Method";
import Screener from "@/routes/Screener";
import Flow from "@/routes/Flow";
import MarketsHome from "@/routes/MarketsHome";
import Deep from "@/routes/Deep";
import Backtest from "@/routes/Backtest";

/**
 * Three tabs are the product; the measured screens stay one secondary link
 * away, because they still answer questions the tabs do not.
 *
 *   Markets    - what the market did today: IHSG, breadth, movers, index
 *                contribution, sectors, stress - one snapshot, one screen
 *   Deep Dive  - one stock: the fundamental verdict and the technical verdict,
 *                side by side, never merged; chart, levels, research rail
 *   Backtest   - every strategy we have on one target, priced against the
 *                index, beside the walk-forward study's own measured numbers
 *
 *   Plan       - tonight's verdict and tickets (the former front page)
 *   Screener   - every name, ranked by how near it is to being buyable
 *   Method     - the rule chain and every citation
 *   Flow       - the multi-name research cards (the per-name work moved into
 *                the Deep Dive's research rail)
 */

const TITLE = "Markets - IDX daily desk";
const DESCRIPTION =
	"The IDX market at a glance: IHSG, breadth, who moved the index, sector " +
	"rotation - then one-stock fundamentals and technicals, and every strategy " +
	"backtested against the index. Research, not investment advice.";

const PRIMARY_TABS = [
	{ to: "/", label: "Markets" },
	{ to: "/deep", label: "Deep Dive" },
	{ to: "/backtest", label: "Backtest" },
] as const;

const SECONDARY_TABS = [
	{ to: "/plan", label: "Plan" },
	{ to: "/screener", label: "Screener" },
	{ to: "/method", label: "Method" },
	{ to: "/flow", label: "Flow" },
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
				<div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
					<div className="flex items-baseline gap-2">
						<Link
							to="/"
							className="shrink-0 font-display text-[15px] tracking-[-0.01em] text-[var(--text)]"
						>
							Trading<span className="text-[var(--text-faint)]">Suite</span>
						</Link>
						<span className="hidden font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-ghost)] sm:inline">
							IDX
						</span>
					</div>
					<div className="flex items-center gap-3">
						<RefreshButton />
						<ThemeToggle />
					</div>
				</div>
				<div className="mx-auto flex max-w-[1180px] items-end justify-between gap-3 px-4 sm:px-6 lg:px-8">
					<nav
						aria-label="Tabs"
						className="flex items-center gap-1 sm:gap-2"
					>
						{PRIMARY_TABS.map(({ to, label }) => (
							<Link
								key={to}
								to={to}
								activeOptions={{ exact: to === "/" }}
								activeProps={{
									className:
										"border-[var(--text)] text-[var(--text)]",
								}}
								inactiveProps={{
									className:
										"border-transparent text-[var(--text-ghost)] hover:text-[var(--text)]",
								}}
								className={
									"border-b-2 px-2.5 py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors"
								}
							>
								{label}
							</Link>
						))}
					</nav>
					<nav
						aria-label="Secondary screens"
						className="hidden items-center gap-4 sm:flex"
					>
						{SECONDARY_TABS.map(({ to, label }) => (
							<Link
								key={to}
								to={to}
								inactiveProps={{
									className: "text-[var(--text-ghost)]",
								}}
								activeProps={{ className: "text-[var(--text)]" }}
								className="font-mono text-[11px] transition-colors hover:text-[var(--text)]"
							>
								{label}
							</Link>
						))}
					</nav>
				</div>
			</header>
			<main id="main">
				<Outlet />
			</main>
			<footer className="border-t border-[var(--border)]">
				<div className="mx-auto max-w-[1180px] px-4 py-8 font-[11px] text-[11px] leading-relaxed text-[var(--text-ghost)] sm:px-6 lg:px-8">
					<p className="max-w-[80ch]">
						Every number is read from a walk-forward backtest of the IDX universe
						with fees inside each trade, or from the live tape as labelled. It is
						a research result, not financial advice - read{" "}
						<Link
							to="/method"
							className="underline underline-offset-2 hover:text-[var(--text-faint)]"
						>
							the method page
						</Link>{" "}
						before the first trade.
					</p>
				</div>
			</footer>
		</>
	);
}

// Codes: not_found - the root notFoundComponent is the designed 404; retired
// routes redirect instead of landing here.
const rootRoute = createRootRoute({
	component: RootComponent,
	notFoundComponent: () => (
		<div className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8">
			<p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-ghost)]">
				404
			</p>
			<h1 className="mt-3 font-display text-[32px] text-[var(--text)]">
				No such screen
			</h1>
			<Link
				to="/"
				className="mt-4 inline-block font-mono text-[12px] text-[var(--text-faint)] underline underline-offset-4"
			>
				Back to the market
			</Link>
		</div>
	),
});

function to(where: string | { to: string }) {
	return () => {
		throw redirect({ to: where as string });
	};
}

const marketsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: MarketsHome,
});

const marketAliasRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/market",
	component: MarketsHome,
});

const deepIndexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/deep",
	component: Deep,
});

const deepTickerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/deep/$ticker",
	component: Deep,
});

const backtestRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/backtest",
	component: Backtest,
});

const planRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/plan",
	component: Tonight,
});

/* The per-name screen folded into the Deep Dive tab; old links land there. */
const nameRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/name/$ticker",
	beforeLoad: ({ params }) => {
		throw redirect({ to: "/deep/" + params.ticker });
	},
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

const flowRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/flow",
	component: Flow,
});

/* Retired tool paths from the 22-tool desk still land somewhere real. The
 * two that describe this app's actual contents were promoted: their names
 * route to the tabs instead of the plan. */
const RETIRED = [
	"desk",
	"overview",
	"markets",
	"profiler",
	"calculators",
	"watchlist",
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
	"stockbit",
	"validator",
	"suspended",
	"konglo",
	"msci",
	"stealth",
	"wiki",
] as const;

const retiredRoutes = RETIRED.flatMap((path) => [
	createRoute({ getParentRoute: () => rootRoute, path, beforeLoad: to("/") }),
	createRoute({
		getParentRoute: () => rootRoute,
		path: path + "/$",
		beforeLoad: to("/"),
	}),
]);

export const router = createRouter({
	routeTree: rootRoute.addChildren([
		marketsRoute,
		marketAliasRoute,
		deepIndexRoute,
		deepTickerRoute,
		backtestRoute,
		planRoute,
		screenerRoute,
		flowRoute,
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
