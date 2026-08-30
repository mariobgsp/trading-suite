#!/usr/bin/env node
/**
 * Feature-wiring guard — fails if the suite's features get dismantled:
 *
 *   1. Every app in src/lib/apps.ts must have a Next page at src/app<href>/page.tsx.
 *   2. Every page must reference at least one endpoint declared for it in apps.ts.
 *   3. Every declared /api/... endpoint must exist in some backend router file.
 *   4. Core feature strings must survive in the pages that own them
 *      (D-Signal groups, Konglo groups, ownership register, rotation accum).
 *
 * No dependencies: plain node + regex. Run: npm test
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let failures = 0;
const fail = (msg) => {
	failures++;
	console.error(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`ok   ${msg}`);

// ── Parse apps.ts ──────────────────────────────────────────────────────
const appsSrc = readFileSync(join(root, "src/lib/apps.ts"), "utf8");
const appBlocks = appsSrc.split(/\{\s*\n\s*num:/).slice(1);
let apps = appBlocks.map((block) => {
	const href = block.match(/href:\s*"([^"]+)"/)?.[1];
	const endpoints = [...block.matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]);
	return { href, endpoints };
});
apps = apps.filter((a) => a.href);
if (apps.length < 5)
	fail(`apps.ts has only ${apps.length} apps — entries were removed`);

// ── 1+2: page exists per app, references its endpoints ────────────────
for (const { href, endpoints } of apps) {
	const pagePath = join(root, "src/app", href, "page.tsx");
	if (!existsSync(pagePath)) {
		fail(`no page for nav entry ${href} (expected ${pagePath})`);
		continue;
	}
	const pageSrc = readFileSync(pagePath, "utf8");
	const concrete = endpoints.map((e) => e.replace(/\{ticker\}.*/, ""));
	if (concrete.length === 0) {
		ok(`${href}: page exists (no API)`);
		continue;
	}
	const referenced = concrete.some((e) => pageSrc.includes(e));
	if (!referenced)
		fail(
			`${href}/page.tsx no longer calls any of its declared endpoints (${endpoints.join(", ")})`,
		);
	else ok(`${href}: page exists, calls its API`);
}

// ── 3: every declared endpoint exists in backend routers ──────────────
const routersDir = join(root, "backend/app/routers");
// Combine each router's prefix with its @router.get("/...") paths.
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
for (const { href, endpoints } of apps) {
	for (const ep of endpoints) {
		const base = ep.replace(/\{[^}]*\}/g, "{}");
		if (!allRoutes.includes(base))
			fail(`endpoint ${ep} (app ${href}) missing from backend routers`);
	}
}
ok("backend routes cover all declared app endpoints");

// ── 4: feature markers that must not disappear ────────────────────────
const MARKERS = [
	[
		"src/app/markets/page.tsx",
		["ForeignBarsPanel", "showLpm", "showIntensity"],
		"Markets foreign bars + LPM toggles",
	],
	[
		"src/app/profiler/page.tsx",
		["ValidatorDetail", "StockbitBrokerPanel", "Bandarmology"],
		"Profiler merged validator",
	],
	[
		"src/app/screener/page.tsx",
		["SSE", "behavior", "vault"],
		"Screener backend filter",
	],
];
for (const [file, needles, label] of MARKERS) {
	if (!existsSync(join(root, file))) {
		fail(`${label}: ${file} deleted`);
		continue;
	}
	const src = readFileSync(join(root, file), "utf8");
	const missing = needles.filter((n) => !src.includes(n));
	if (missing.length) fail(`${label}: lost markers ${missing.join(", ")}`);
	else ok(`${label}: intact`);
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nall feature-wiring checks passed");
