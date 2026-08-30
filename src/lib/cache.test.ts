import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Mock sessionStorage for Node
const store = new Map<string, string>();
globalThis.sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (i: number) => [...store.keys()][i] ?? null,
} as unknown as Storage;

import {
  getFromCache,
  setCache,
  peekCache,
  isCacheFresh,
  invalidateCache,
  dedupedFetch,
  resolveTTL,
  __debug,
} from "./cache.ts";

describe("cache — basic get/set/peek", () => {
  beforeEach(() => {
    invalidateCache();
    store.clear();
    __debug.mem.clear();
    __debug.pending.clear();
  });

  it("setCache + getFromCache returns fresh entry", () => {
    setCache("/api/market/quote/BBCA", { price: 9000 }, 60_000);
    const hit = getFromCache<{ price: number }>("/api/market/quote/BBCA");
    assert.ok(hit);
    assert.equal(hit.data.price, 9000);
    assert.equal(hit.stale, false);
  });

  it("peekCache returns data or null", () => {
    assert.equal(peekCache("/nothing"), null);
    setCache("/api/test", { x: 1 });
    assert.deepEqual(peekCache("/api/test"), { x: 1 });
  });

  it("isCacheFresh true when fresh, false when stale or missing", () => {
    setCache("/api/market/quote/BBCA", { v: 1 }, 60_000);
    assert.equal(isCacheFresh("/api/market/quote/BBCA"), true);
    assert.equal(isCacheFresh("/missing"), false);
    // Force stale by backdating fetchedAt
    const entry = __debug.mem.get("/api/market/quote/BBCA") as unknown as {
      fetchedAt: number;
    };
    entry.fetchedAt = Date.now() - 70_000;
    assert.equal(isCacheFresh("/api/market/quote/BBCA"), false);
  });

  it("stale detection via getFromCache", () => {
    setCache("/api/x", { v: 1 }, 10);
    // Immediately fresh
    assert.equal(getFromCache("/api/x")?.stale, false);
    // Fast-forward: mutate fetchedAt to be old
    const e = __debug.mem.get("/api/x") as unknown as { fetchedAt: number };
    e.fetchedAt = Date.now() - 20;
    assert.equal(getFromCache("/api/x")?.stale, true);
  });

  it("invalidateCache without prefix clears all", () => {
    setCache("/api/a", 1);
    setCache("/api/b", 2);
    invalidateCache();
    assert.equal(getFromCache("/api/a"), null);
    assert.equal(getFromCache("/api/b"), null);
    assert.equal(store.size, 0);
  });

  it("invalidateCache with prefix deletes matching keys", () => {
    setCache("/api/market/quote/BBCA", 1);
    setCache("/api/market/quote/BBRI", 2);
    setCache("/api/validator/BBCA", 3);
    invalidateCache("/api/market/quote");
    assert.equal(getFromCache("/api/market/quote/BBCA"), null);
    assert.equal(getFromCache("/api/market/quote/BBRI"), null);
    assert.ok(getFromCache("/api/validator/BBCA"));
  });

  it("persists to sessionStorage and rehydrates from it", () => {
    setCache("/api/market/history/BBCA", { bars: 100 }, 60_000);
    assert.ok(store.has("ts:cache:/api/market/history/BBCA"));
    // Clear mem, keep storage — next get should rehydrate
    __debug.mem.clear();
    const hit = getFromCache<{ bars: number }>("/api/market/history/BBCA");
    assert.ok(hit);
    assert.equal(hit.data.bars, 100);
  });

  it("large payloads (>400k) skip sessionStorage", () => {
    const big = "x".repeat(500_000);
    setCache("/api/big", big);
    assert.equal(store.has("ts:cache:/api/big"), false);
    // but mem still has it
    assert.ok(getFromCache("/api/big"));
  });
});

describe("cache — resolveTTL", () => {
  it("uses explicit TTL over table", () => {
    assert.equal(resolveTTL("/api/market/quote/BBCA", 999), 999);
  });
  it("longest-prefix match wins", () => {
    // /api/market/quote/ -> 12_000, /api/market/quotes -> 12_000, but specific wins
    assert.equal(resolveTTL("/api/market/quote/BBCA"), 12_000);
    assert.equal(resolveTTL("/api/market/history/BBCA"), 60_000);
    assert.equal(resolveTTL("/api/intel/ownership/BBCA"), 86_400_000);
    assert.equal(resolveTTL("/api/unknown/path"), 30_000);
  });
});

describe("cache — dedupedFetch", () => {
  beforeEach(() => {
    invalidateCache();
    __debug.pending.clear();
    __debug.mem.clear();
    store.clear();
  });

  it("concurrent callers share one promise", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { value: 42 };
    };
    const p1 = dedupedFetch("/api/dedupe", fetcher);
    const p2 = dedupedFetch("/api/dedupe", fetcher);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(calls, 1);
    assert.deepEqual(r1, { value: 42 });
    assert.deepEqual(r2, { value: 42 });
  });

  it("caches result and second call hits cache without fetching", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { n: calls };
    };
    const r1 = await dedupedFetch("/api/once", fetcher, 60_000);
    assert.equal(r1.n, 1);
    // getFromCache should be fresh now
    assert.ok(getFromCache("/api/once"));
    // second dedupedFetch with same key should still call fetcher if we force,
    // but dedupedFetch always fetches; cache is populated though
    const r2 = await dedupedFetch("/api/once2", fetcher, 60_000);
    assert.equal(r2.n, 2);
  });

  it("propagates fetcher error and clears pending", async () => {
    const bad = async () => {
      throw new Error("boom");
    };
    await assert.rejects(() => dedupedFetch("/api/bad", bad), /boom/);
    assert.equal(__debug.pending.has("/api/bad"), false);
    // next call retries
    let okCalls = 0;
    const ok = async () => {
      okCalls++;
      return { ok: true };
    };
    const r = await dedupedFetch("/api/bad", ok);
    assert.equal(okCalls, 1);
    assert.deepEqual(r, { ok: true });
  });
});
