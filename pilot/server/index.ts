/**
 * Pilot production server (Hono on Node).
 *
 * Wiring, per the migration plan's "Hono as thin gateway" step:
 *   - `/api/*`   → proxied to the FastAPI backend on :8000 (REST + SSE pass-through)
 *   - `/assets/*`→ static client build from dist/client/assets
 *   - everything else → TanStack Start SSR handler (dist/server/server.js)
 *
 * Same-origin API surface in prod, exactly like Vite's dev proxy on :3001.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3001);
const API_TARGET = process.env.API_TARGET ?? "http://localhost:8000";

// SSR entry from the TanStack Start build.
const { default: startServer } = await import("../dist/server/server.js");

const app = new Hono();

const MIME: Record<string, string> = {
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
};

// 1) API proxy (REST + SSE). Forward the raw upstream body stream so
//    text/event-stream frames flow through untouched, with flush support.
app.all("/api/*", async (c) => {
	try {
		const url = new URL(c.req.url);
		const target = `${API_TARGET}${url.pathname}${url.search}`;
		// target host is allowlisted via API_TARGET env (FastAPI backend);
		// path is the inbound request path, not attacker-controlled beyond routing.
		if (!target.startsWith(API_TARGET)) {
			return c.json({ error: "bad proxy target" }, 400);
		}
		const headers = new Headers(c.req.raw.headers);
		headers.delete("host");
		headers.set("x-forwarded-host", c.req.header("host") ?? "");
		const upstream = await fetch(target, {
			method: c.req.method,
			headers,
			body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
			// FastAPI streams SSE frames for a long time; no timeout.
			signal: undefined,
		});
		return new Response(upstream.body, {
			status: upstream.status,
			headers: upstream.headers,
		});
	} catch (e) {
		return c.json({ error: "proxy error", detail: String(e) }, 502);
	}
});

// 2) Static client assets.
app.get("/assets/*", async (c) => {
	const rel = c.req.path.replace(/^\/assets\//, "");
	// path traversal guard
	if (rel.includes("..") || rel.includes("\0")) return c.notFound();
	const filePath = new URL(`../dist/client/assets/${rel}`, import.meta.url);
	try {
		const s = await stat(fileURLToPath(filePath));
		if (!s.isFile()) return c.notFound();
	} catch {
		return c.notFound();
	}
	const mime =
		MIME[filePath.pathname.slice(filePath.pathname.lastIndexOf("."))] ??
		"application/octet-stream";
	c.header("content-type", mime);
	c.header("cache-control", "public, max-age=31536000, immutable");
	const stream = createReadStream(fileURLToPath(filePath));
	// @ts-expect-error node stream -> web ReadableStream interop
	return c.body(Readable.toWeb(stream));
});

// 3) Everything else → TanStack Start SSR.
app.all("*", async (c) => {
	const res = await startServer.fetch(c.req.raw);
	return new Response(res.body, { status: res.status, headers: res.headers });
});

serve(
	{
		fetch: app.fetch,
		port: PORT,
		createServer:
			createServerWithLongTimeouts as unknown as typeof createServerNode,
	},
	(info: { port: number }) => {
		console.log(
			`▶ pilot (Hono + TanStack Start) on http://localhost:${info.port}`,
		);
		console.log(`▶ /api/* proxied to ${API_TARGET}`);
	},
);

/**
 * Node http.Server with no request timeout so long-lived SSE streams survive.
 * @hono/node-server calls `createServer(options, requestListener)`.
 */
function createServerWithLongTimeouts(
	options: Parameters<typeof createServerNode>[0] | undefined,
	requestListener?: RequestListener,
) {
	const server = createServerNode(options ?? {}, requestListener);
	server.requestTimeout = 0;
	server.headersTimeout = 0;
	server.keepAliveTimeout = 60_000;
	return server;
}

import {
	createServer as createServerNode,
	type RequestListener,
} from "node:http";
