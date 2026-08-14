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
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				// Inline SVG favicon — dark rounded square, accent tile, mono "TS".
				href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230a0e14'/%3E%3Crect x='6' y='8' width='20' height='16' rx='3' fill='%2356b6e7'/%3E%3Ctext x='16' y='21' font-family='monospace' font-size='12' font-weight='700' fill='%230a0e14' text-anchor='middle'%3ETS%3C/text%3E%3C/svg%3E",
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
				<button
					type="button"
					className="skip-link"
					onClick={() => {
						const main = document.getElementById("main");
						main?.focus();
						main?.scrollIntoView();
					}}
				>
					Skip to content
				</button>
				<Shell>{children}</Shell>
				<Scripts />
			</body>
		</html>
	);
}
