#!/usr/bin/env node
/**
 * Feature-wiring guard — fails if the suite's features get dismantled:
 *
 *   1. Every section in src/lib/sections.ts must have a module at
 *      src/components/sections/<id>.tsx.   (frontend-web/src/...)
 *   2. Every section must reference at least one endpoint declared for it.
 *   3. Every declared /api/... endpoint must exist in some backend router file.
 *   4. Core feature strings must survive in the sections that own them
 *      (D-Signal groups, Konglo groups, ownership register, rotation accum).
 *
 * No dependencies: plain node + regex. Run: npm test
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The frontend moved to frontend-web/ (Vite) when Next.js was dropped. The
// guard checks the same section-to-module wiring, so only the frontend paths
// need repointing - backend/ paths stay relative to root.
const fe = join(root, "frontend-web");

let failures = 0;
const fail = (msg) => {
	failures++;
	console.error(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`ok   ${msg}`);

// ── Parse sections.ts ───────────────────────────────────────────────────
const registrySrc = readFileSync(join(fe, "src/lib/sections.ts"), "utf8");
const apps = [...registrySrc.matchAll(/id:\s*"([^"]+)"([\s\S]*?)endpoints:\s*\[([^\]]*)\]/g)].map(
	([, id, , eps]) => ({
		id,
		endpoints: [...eps.matchAll(/"(\/api\/[^"]*)"/g)].map((m) => m[1]),
	}),
);
if (apps.length < 5) {
	fail(`sections.ts declares only ${apps.length} sections — entries were removed`);
}

// ── 1+2: module exists per section, references its endpoints ────────────
for (const { id, endpoints } of apps) {
	const file = join(fe, "src/components/sections", `${id}.tsx`);
	if (!existsSync(file)) {
		fail(`${id}: src/components/sections/${id}.tsx deleted`);
		continue;
	}
	const sectionSrc = readFileSync(file, "utf8");
	const concrete = endpoints.map((e) => e.replace(/\{ticker\}.*/, ""));
	if (concrete.length === 0) {
		ok(`${id}: section exists (no API)`);
		continue;
	}
	const referenced = concrete.some((e) => sectionSrc.includes(e));
	if (!referenced) {
		fail(
			`${id}.tsx no longer calls any of its declared endpoints (${endpoints.join(", ")})`,
		);
	} else ok(`${id}: section exists, calls its API`);
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
for (const { id, endpoints } of apps) {
	for (const ep of endpoints) {
		const base = ep.replace(/\{[^}]*\}/g, "{}");
		if (!allRoutes.includes(base)) {
			fail(`endpoint ${ep} (section ${id}) missing from backend routers`);
		}
	}
}
ok("backend routes cover all declared section endpoints");

// ── 4: feature markers that must not disappear ────────────────────────
const MARKERS = [
	[
		"src/components/sections/markets.tsx",
		["ForeignBarsPanel", "showLpm", "showIntensity"],
		"Markets foreign bars + LPM toggles",
	],
	[
		"src/components/sections/profiler.tsx",
		["ValidatorDetail", "StockbitBrokerPanel", "Bandarmology"],
		"Profiler merged validator",
	],
	[
		"src/components/sections/screener.tsx",
		["SSE", "behavior", "vault"],
		"Screener backend filter",
	],
];
for (const [file, needles, label] of MARKERS) {
	if (!existsSync(join(fe, file))) {
		fail(`${label}: ${file} deleted`);
		continue;
	}
	const src = readFileSync(join(fe, file), "utf8");
	const missing = needles.filter((n) => !src.includes(n));
	if (missing.length) fail(`${label}: lost markers ${missing.join(", ")}`);
	else ok(`${label}: intact`);
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nall feature-wiring checks passed");
