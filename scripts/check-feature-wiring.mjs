#!/usr/bin/env node
/**
 * Feature-wiring guard — fails if the suite's pages get dismantled:
 *
 *   1. Every page in PAGES must exist as <page>.html with its js/<page>.js.
 *   2. Every page module must reference at least one /api/... endpoint.
 *   3. Every referenced endpoint must exist in some backend router file.
 *   4. Shell markers (nav tabs, theme toggle, refresh button) must survive in
 *      every page; the redirect map must survive in 404.html + deploy/Caddyfile.
 *   5. The vendored chart lib must exist (pages render charts offline).
 *
 * No dependencies: plain node + regex. Run: node scripts/check-feature-wiring.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fe = join(root, "frontend-native");

let failures = 0;
const fail = (msg) => {
	failures++;
	console.error(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`ok   ${msg}`);

// ── 1+2: page shell + module exist, module calls its API ─────────────
// [page, module]: the home page's module keeps its Tonight name.
const PAGES = [["index", "tonight"], ["scanner", "scanner"], ["deep", "deep"], ["backtest", "backtest"], ["paper", "paper"], ["flow", "flow"], ["method", "method"]];
const pageEndpoints = {};
for (const [id, mod] of PAGES) {
	const html = join(fe, `${id}.html`);
	const js = join(fe, "js", `${mod}.js`);
	if (!existsSync(html)) {
		fail(`${id}.html deleted`);
		continue;
	}
	if (!existsSync(js)) {
		fail(`js/${id}.js deleted`);
		continue;
	}
	const src = readFileSync(js, "utf8");
	const eps = [...src.matchAll(/"(\/api\/[^"?]*)"/g)].map((m) => m[1]);
	pageEndpoints[id] = eps;
	if (eps.length === 0) fail(`${id}.js no longer calls any /api endpoint`);
	else ok(`${id}: shell + module exist, calls its API`);
}

// ── 3: every referenced endpoint exists in backend routers ────────────
const routersDir = join(root, "backend/app/routers");
const allRoutes = readdirSync(routersDir)
	.filter((f) => f.endsWith(".py"))
	.map((f) => {
		const src = readFileSync(join(routersDir, f), "utf8");
		const prefix = src.match(/prefix\s*=\s*"([^"]*)"/)?.[1] ?? "";
		return [...src.matchAll(/@router\.\w+\(\s*"([^"]*)"/g)].map((m) =>
			(prefix + m[1]).replace(/\{[^}]*\}/g, "{}"),
		);
	})
	.flat();
for (const [id, endpoints] of Object.entries(pageEndpoints)) {
	for (const ep of endpoints) {
		const base = ep.split("?")[0];
		const hit = allRoutes.some(
			(r) =>
				r === base ||
				base === r.replace(/\/\{\}$/, "") ||
				base.startsWith(r.replace(/\/\{\}$/, "") + "/"),
		);
		if (!hit) fail(`endpoint ${ep} (page ${id}) missing from backend routers`);
	}
}
ok("backend routes cover all page endpoints");

// ── 4: shell + redirect markers ───────────────────────────────────────
const TABS = ["index.html", "scanner.html", "deep.html", "backtest.html"];
for (const [id] of PAGES) {
	const src = readFileSync(join(fe, `${id}.html`), "utf8");
	const missing = TABS.filter((t) => !src.includes(`href="${t}"`));
	if (missing.length) fail(`${id}.html lost nav tabs ${missing.join(", ")}`);
	if (!src.includes("data-theme-toggle")) fail(`${id}.html lost theme toggle`);
	if (!src.includes("data-refresh")) fail(`${id}.html lost refresh button`);
}
ok("shell: nav tabs, theme toggle, refresh button on all pages");

const notFound = readFileSync(join(fe, "404.html"), "utf8");
for (const needle of ["/deep.html?ticker=", "/plan", "retired"]) {
	if (!notFound.includes(needle)) fail(`404.html lost redirect marker ${needle}`);
}
const caddy = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
for (const needle of ["frontend-native", "redir /plan", "path_regexp", "404.html"]) {
	if (!caddy.includes(needle)) fail(`deploy/Caddyfile lost marker ${needle}`);
}
ok("redirects: 404 fallback + Caddy 301 map intact");

// ── 5: vendored chart lib ─────────────────────────────────────────────
if (!existsSync(join(fe, "vendor/lightweight-charts.js"))) {
	fail("vendor/lightweight-charts.js deleted — charts break offline");
} else ok("vendored chart lib present");

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nall feature-wiring checks passed");
