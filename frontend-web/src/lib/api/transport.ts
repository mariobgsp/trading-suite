/**
 * API transport — fetch wrapper, SWR cache wiring, and the `api` object
 * every page imports. No domain types live here; see ./types-*.ts.
 */

import {
	dedupedFetch,
	getFromCache,
	invalidateCache,
	peekCache,
	resolveTTL,
	setCache,
} from "../cache.ts";

export const API_BASE =
	import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		...init,
		// Let our own cache layer decide freshness — don't let the browser/http cache stale us
		cache: "no-store",
	});
	if (!res.ok) {
		let detail = res.statusText;
		try {
			const body = await res.json();
			detail = body.detail ?? body.error ?? detail;
		} catch {
			/* keep statusText */
		}
		throw new ApiError(res.status, String(detail));
	}
	return res.json() as Promise<T>;
}

type GetOpts = RequestInit & {
	ttl?: number; // override TTL ms
	swr?: boolean; // default true for GET — serve stale while revalidating
};

async function cachedGet<T>(path: string, opts: GetOpts = {}): Promise<T> {
	const { ttl, swr = true, ...init } = opts;
	const key = path; // cache key is the path (query included)
	const hit = getFromCache<T>(key);
	const ttlMs = resolveTTL(path, ttl);

	// Fresh hit -> instant return, no network
	if (hit && !hit.stale) return hit.data;

	// Stale hit + swr -> return stale immediately while revalidating in background
	if (hit && hit.stale && swr) {
		// fire-and-forget revalidation; next caller will see fresh data
		void dedupedFetch<T>(key, () => request<T>(path, init), ttlMs).catch(
			() => {},
		);
		return hit.data;
	}

	// No hit or stale without swr -> fetch (deduped) and wait
	return dedupedFetch<T>(key, () => request<T>(path, init), ttlMs);
}

export const api = {
	get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
	/** SWR-aware GET — uses memory+sessionStorage + dedupe */
	getCached: <T>(path: string, opts?: GetOpts) => cachedGet<T>(path, opts),
	post: <T>(path: string, body: unknown) =>
		request<T>(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	/** Prefetch/warm — fire and forget, deduped */
	prefetch: (path: string, ttl?: number) => {
		void cachedGet(path, { ttl, swr: false }).catch(() => {});
	},
	peek: peekCache,
	invalidate: invalidateCache,
	/** Low-level cache set — useful for optimistic updates */
	setCache,
};
