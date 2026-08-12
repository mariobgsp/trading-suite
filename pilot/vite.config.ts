import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 3001,
		proxy: {
			// Same-origin API surface: Vite (dev) / Hono (prod) forwards /api/*
			// to the FastAPI backend on :8000. Kills the CORS/SSE cross-origin
			// problem entirely and matches the "Hono as thin gateway" migration path.
			"/api": {
				target: "http://localhost:8000",
				changeOrigin: true,
				ws: true,
			},
		},
	},
	plugins: [
		tanstackStart(), // MUST come before react()
		viteReact(),
		// Fonts: self-hosted via @fontsource-variable imports in globals.css
		// (no runtime CDN dependency, matches next/font's local bundling).
	],
});
