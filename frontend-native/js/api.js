/* api.js — fetch wrapper. Port of frontend-web/src/lib/api/transport.ts
 * (minus the Tailwind/React parts): same API_BASE rule, same error shapes,
 * memory cache with TTL + in-flight dedupe + stale-while-revalidate.
 * shortcut: persistence is memory-only (no sessionStorage) — a reload
 * refetches; acceptable for the pilot, add sessionStorage when porting
 * the polling pages (scanner/deep) that hydrate from cache.
 */
"use strict";

const { port } = window.location;
const sameOrigin = port === "" || port === "80" || port === "443";

export const API_BASE =
  (window.VITE_API_URL || "") ||
  (sameOrigin ? "" : `http://${window.location.hostname}:8000`);

export class ApiError extends Error {
  constructor(status, message, code, attempt) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.attempt = attempt;
  }
}

async function request(path, init) {
  const res = await fetch(`${API_BASE}${path}`, { ...init, cache: "no-store" });
  if (!res.ok) {
    let detail = res.statusText;
    let code;
    let attempt;
    try {
      const body = await res.json();
      const error = body && body.error;
      if (typeof error === "string") {
        detail = error;
      } else if (error && typeof error === "object") {
        if (typeof error.message === "string") detail = error.message;
        else detail = JSON.stringify(error);
        if (typeof error.code === "string") code = error.code;
      } else if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (body.detail != null) {
        detail = JSON.stringify(body.detail);
      }
      if (!code && typeof body.code === "string") code = body.code;
      if (!code && typeof body.error_code === "string") code = body.error_code;
      attempt = body.attempt;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, String(detail), code, attempt);
  }
  return res.json();
}

/* ── tiny TTL cache ─────────────────────────────────────────────── */
const store = new Map(); // key -> { data, exp }
const inflight = new Map(); // key -> Promise

export function resolveTTL(path, ttl) {
  if (ttl != null) return ttl;
  if (path.startsWith("/api/plan")) return 60_000;
  return 60_000;
}

export function invalidate(prefix) {
  for (const key of [...store.keys()]) {
    if (!prefix || key.startsWith(prefix)) store.delete(key);
  }
}

function deduped(key, fn, ttl) {
  const running = inflight.get(key);
  if (running) return running;
  const p = fn()
    .then((data) => {
      store.set(key, { data, exp: Date.now() + ttl });
      inflight.delete(key);
      return data;
    })
    .catch((e) => {
      inflight.delete(key);
      throw e;
    });
  inflight.set(key, p);
  return p;
}

async function cachedGet(path, opts = {}) {
  const { ttl, swr = true, ...init } = opts;
  const hit = store.get(path);
  const ttlMs = resolveTTL(path, ttl);
  if (hit && Date.now() < hit.exp) return hit.data;
  if (hit && swr) {
    void deduped(path, () => request(path, init), ttlMs).catch(() => {});
    return hit.data;
  }
  return deduped(path, () => request(path, init), ttlMs);
}

export const api = {
  get: (path, init) => request(path, init),
  getCached: (path, opts) => cachedGet(path, opts),
  post: (path, body) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  invalidate,
};
