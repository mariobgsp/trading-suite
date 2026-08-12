import { createFileRoute } from "@tanstack/react-router";
import { APPS } from "@/lib/apps";
import { AppsGrid } from "@/components/launcher";

/** Routes actually ported to the pilot — everything else renders disabled. */
const PORTED = new Set([
	"/overview",
	"/markets",
	"/portfolio",
	"/backtest",
	"/screener",
	"/validator",
	"/sentiment",
	"/regime",
]);

export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	return (
		<div>
			<AppsGrid apps={APPS} available={PORTED} />
		</div>
	);
}
