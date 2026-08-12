import type { ReactNode } from "react";
import {
	Outlet,
	createRootRoute,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import Shell from "@/components/Shell";
import "@/styles/globals.css";
// Self-hosted variable fonts — imported from JS (not CSS @import) so Vite
// resolves the ./files/*.woff2 url()s at build time and emits them locally.
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Trading Suite — IDX Platform" },
			{
				name: "description",
				content:
					"Merged Indonesian stock trading platform: portfolio, backtesting, screener, bandarmology validator, sentiment radar, market regime.",
			},
		],
		// Fonts are self-hosted at build time by unplugin-fonts (vite.config.ts);
		// no runtime Google Fonts CDN dependency.
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<Shell>{children}</Shell>
				<Scripts />
			</body>
		</html>
	);
}
