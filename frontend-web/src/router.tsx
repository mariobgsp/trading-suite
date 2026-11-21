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
import Scanner from "@/routes/Scanner";
import Flow from "@/routes/Flow";
import Deep from "@/routes/Deep";
import Backtest from "@/routes/Backtest";
import Paper from "@/routes/Paper";

/**
 * Navigasi dibuat dari tugas pembacanya, bukan dari mesinnya:
 *
 *   /          Hari ini       — kondisi pasar dan langkah berikutnya
 *   /scanner   Cari saham     — saring seluruh daftar saham
 *   /deep      Periksa saham  — satu saham, dari bisnis sampai risiko
 *   /backtest  Uji strategi   — adukan aturan pada satu target
 *
 * Cara kerja (/method), Akun latihan (/paper) dan Riset teknikal (/flow)
 * tetap terjangkau dari footer dan tautan kontekstual: halaman lanjutan
 * tidak boleh berebut perhatian dengan empat tugas utama.
 */

const TITLE = "Trading Suite — pasar dan saham IDX dalam bahasa sederhana";
const DESCRIPTION =
	"Kondisi pasar hari ini, saham yang lolos aturan beserta alasan dan risikonya, " +
	"lalu uji strategi terukur. Riset dengan biaya di dalam setiap transaksi, bukan saran investasi.";

const PRIMARY_TABS = [
	{ to: "/", label: "Hari ini" },
	{ to: "/scanner", label: "Cari saham" },
	{ to: "/deep", label: "Periksa saham" },
	{ to: "/backtest", label: "Uji strategi" },
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
						aria-label="Navigasi utama"
						className="flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-2"
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
										"border-transparent text-[var(--text-faint)] hover:text-[var(--text)]",
								}}
								className={
									"whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] font-medium transition-colors"
								}
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
				<div className="mx-auto max-w-[1180px] px-4 py-8 text-[12px] leading-relaxed text-[var(--text-ghost)] sm:px-6 lg:px-8">
					<nav aria-label="Halaman lanjutan" className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
						<Link to="/method" className="text-[var(--text-faint)] underline underline-offset-2 hover:text-[var(--text-dim)]">
							Cara kerja &amp; bukti
						</Link>
						<Link to="/paper" className="text-[var(--text-faint)] underline underline-offset-2 hover:text-[var(--text-dim)]">
							Akun latihan
						</Link>
						<Link to="/flow" className="text-[var(--text-faint)] underline underline-offset-2 hover:text-[var(--text-dim)]">
							Riset teknikal
						</Link>
					</nav>
					<p className="max-w-[80ch]">
						Setiap angka dibaca dari riset historis dengan biaya di dalam setiap
						transaksi, atau dari pita pasar seperti yang diberi label. Ini hasil riset,
						bukan saran investasi — baca{" "}
						<Link
							to="/method"
							className="underline underline-offset-2 hover:text-[var(--text-faint)]"
						>
							halaman Cara kerja
						</Link>{" "}
						sebelum transaksi pertama.
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
<p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text-ghost)]">404</p>
<h1 className="mt-3 font-display text-[32px] text-[var(--text)]">Halaman tidak ditemukan</h1>
<p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
Alamat ini bukan salah satu dari empat tugas aplikasi. Mulai lagi dari Hari ini.
</p>
<Link
to="/"
className="mt-4 inline-block border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-1.5 font-mono text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]"
>
Kembali ke Hari ini
</Link>
</div>
),
});

function to(where: string | { to: string }) {
	return () => {
		throw redirect({ to: where as string });
	};
}

const homeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: Tonight,
});

const scannerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/scanner",
	component: Scanner,
});

/* Alamat lama tetap mendarat di tugas barunya. */
const marketAliasRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/market",
	beforeLoad: to("/scanner"),
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

/* Halaman rencana lama kini menjadi halaman utama; alamatnya dialihkan. */
const planRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/plan",
	beforeLoad: to("/"),
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
	beforeLoad: to("/scanner"),
});

/* The book the app plays by itself: the plan's signals, filled by the sync. */
const paperRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/paper",
	component: Paper,
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
		homeRoute,
		scannerRoute,
		marketAliasRoute,
		deepIndexRoute,
		deepTickerRoute,
		backtestRoute,
		planRoute,
		paperRoute,
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
