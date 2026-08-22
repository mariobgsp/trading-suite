/**
 * Tiny SWR cache for the trading desk.
 * - Memory first (Map), sessionStorage second (survives soft reload).
 * - TTL per entry, stale-while-revalidate, request dedup.
 * - No external deps, ~2kB.
 */
"use client";

type Entry<T = unknown> = {
	data: T;
	fetchedAt: number;
	ttl: number; // ms
};

const mem = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();

// TTL defaults tuned to IDX volatility — see getDefaultTTL
function getDefaultTTL(path: string): number {
	if (path.includes("/api/market/indices")) return 20_000;
	if (path.includes("/api/market/quotes")) return 12_000;
	if (path.includes("/api/market/quote/")) return 12_000;
	if (path.includes("/api/market/history/")) return 60_000;
	if (path.includes("/api/regime/snapshot")) return 45_000;
	if (path.includes("/api/regime/history")) return 120_000;
	if (path.includes("/api/portfolio/state")) return 15_000;
	if (path.includes("/api/sentiment/news")) return 180_000;
	if (path.includes("/api/validator/")) return 60_000;
	if (path.includes("/api/screener/")) return 30_000;
	if (path.includes("/api/backtest/")) return 120_000;
	return 30_000;
}

const SS_PREFIX = "ts:cache:";

function ssGet<T>(key: string): Entry<T> | null {
	try {
		if (typeof sessionStorage === "undefined") return null;
		const raw = sessionStorage.getItem(SS_PREFIX + key);
		if (!raw) return null;
		return JSON.parse(raw) as Entry<T>;
	} catch {
		return null;
	}
}

function ssSet(key: string, entry: Entry) {
	try {
		if (typeof sessionStorage === "undefined") return;
		// cap ~5MB – guard huge payloads (screener streams can be big)
		const json = JSON.stringify(entry);
		if (json.length > 400_000) return;
		sessionStorage.setItem(SS_PREFIX + key, json);
	} catch {
		/* quota exceeded – ignore, memory still holds */
	}
}

function isFresh(entry: Entry): boolean {
	return Date.now() - entry.fetchedAt < entry.ttl;
}

export function getFromCache<T>(key: string): { data: T; stale: boolean } | null {
	let entry = mem.get(key) as Entry<T> | undefined;
	if (!entry) {
		const ss = ssGet<T>(key);
		if (ss) {
			mem.set(key, ss);
			entry = ss;
		}
	}
	if (!entry) return null;
	return { data: entry.data, stale: !isFresh(entry) };
}

export function setCache<T>(key: string, data: T, ttl?: number) {
	const entry: Entry<T> = {
		data,
		fetchedAt: Date.now(),
		ttl: ttl ?? getDefaultTTL(key),
	};
	mem.set(key, entry as unknown as Entry);
	ssSet(key, entry as unknown as Entry);
}

export function peekCache<T>(key: string): T | null {
	const hit = getFromCache<T>(key);
	return hit ? hit.data : null;
}

export function isCacheFresh(key: string): boolean {
	const entry = mem.get(key) ?? ssGet(key);
	if (!entry) return false;
	return isFresh(entry);
}

export function invalidateCache(prefix?: string) {
	if (!prefix) {
		mem.clear();
		try {
			if (typeof sessionStorage !== "undefined") {
				for (let i = sessionStorage.length - 1; i >= 0; i--) {
					const k = sessionStorage.key(i);
					if (k?.startsWith(SS_PREFIX)) sessionStorage.removeItem(k);
				}
			}
		} catch {}
		return;
	}
	// prefix match against the *path* part before any fallback suffix
	for (const k of [...mem.keys()]) {
		if (k === prefix || k.startsWith(prefix)) mem.delete(k);
	}
	try {
		if (typeof sessionStorage !== "undefined") {
			for (let i = sessionStorage.length - 1; i >= 0; i--) {
				const k = sessionStorage.key(i);
				if (k && (k === SS_PREFIX + prefix || k.startsWith(SS_PREFIX + prefix))) {
					sessionStorage.removeItem(k);
				}
			}
		}
	} catch {}
}

/**
 * Deduplicated fetch. Concurrent callers for the same key share one promise.
 * Resolves to fresh data and populates cache.
 */
export async function dedupedFetch<T>(
	key: string,
	fetcher: () => Promise<T>,
	ttl?: number,
): Promise<T> {
	const inflight = pending.get(key) as Promise<T> | undefined;
	if (inflight) return inflight;

	const p = (async () => {
		const data = await fetcher();
		setCache(key, data, ttl);
		return data;
	})();

	pending.set(key, p);
	try {
		return await p;
	} finally {
		pending.delete(key);
	}
}

export function resolveTTL(path: string, explicitTTL?: number): number {
	return explicitTTL ?? getDefaultTTL(path);
}

// For testing / debugging
export const __debug = { mem, pending, getDefaultTTL };
