import { useLocation, useRouterState } from "@tanstack/react-router";
import Sidebar from "@/components/Sidebar";
import { usePendingViews } from "@/lib/usePolling";

export default function Shell({ children }: { children: React.ReactNode }) {
	const location = useLocation();
	const pathname = location.pathname;
	const active = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;

	// Global pending indicator: show the top progress bar while the router is
	// transitioning OR any data-driven view on screen is still awaiting data.
	const routePending = useRouterState({
		select: (s) => s.status === "pending" || s.isLoading,
	});
	const pendingViews = usePendingViews();
	const isPending = routePending || pendingViews > 0;

	return (
		<div className="flex h-dvh overflow-hidden bg-[var(--bg)]">
			<Sidebar active={active} />
			<main
				id="main"
				tabIndex={-1}
				className="relative flex-1 overflow-y-auto outline-none"
			>
				{isPending && (
					<div className="sticky top-0 z-50 h-0.5 w-full overflow-hidden">
						<div className="route-progress-bar h-full" />
					</div>
				)}
				<div className="mx-auto max-w-[1400px] px-6 py-6">{children}</div>
			</main>
		</div>
	);
}
