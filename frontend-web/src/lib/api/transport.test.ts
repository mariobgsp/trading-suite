import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Polyfill sessionStorage for cache module
const store = new Map<string, string>();
if (typeof globalThis.sessionStorage === "undefined") {
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
}

import { ApiError, api } from "./transport.ts";
import { invalidateCache, __debug } from "../cache.ts";

function mockFetchOnce(response: {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}) {
  globalThis.fetch = async () => response as Response;
}

describe("ApiError", () => {
  it("carries status and message", () => {
    const err = new ApiError(404, "not found");
    assert.equal(err.status, 404);
    assert.equal(err.message, "not found");
    assert.ok(err instanceof Error);
  });
});

describe("api.get — request", () => {
  afterEach(() => {
    delete (globalThis as unknown as { fetch?: typeof fetch }).fetch;
  });

  it("resolves JSON on ok", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ hello: "world" }),
    });
    const data = await api.get<{ hello: string }>("/api/test");
    assert.deepEqual(data, { hello: "world" });
  });

  it("throws ApiError with detail on 404", async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ detail: "No ticker" }),
    });
    await assert.rejects(
      () => api.get("/api/missing"),
      (e: unknown) => {
        assert.ok(e instanceof ApiError);
        assert.equal((e as ApiError).status, 404);
        assert.equal((e as ApiError).message, "No ticker");
        return true;
      },
    );
  });

  it("falls back to statusText when json has no detail", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });
    await assert.rejects(
      () => api.get("/api/bad"),
      (e: unknown) => {
        assert.equal((e as ApiError).message, "Internal Server Error");
        return true;
      },
    );
  });

  it("sends cache: no-store", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      } as Response;
    };
    await api.get("/api/check");
    assert.equal((capturedInit as RequestInit).cache, "no-store");
  });
});

describe("api.getCached — SWR + dedupe", () => {
  beforeEach(() => {
    invalidateCache();
    store.clear();
    __debug.mem.clear();
    __debug.pending.clear();
    delete (globalThis as unknown as { fetch?: unknown }).fetch;
  });
  afterEach(() => {
    delete (globalThis as unknown as { fetch?: unknown }).fetch;
  });

  it("fresh hit returns without network", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ price: 9000 }),
      } as Response;
    };
    const r1 = await api.getCached<{ price: number }>("/api/market/quote/BBCA");
    assert.equal(r1.price, 9000);
    assert.equal(fetchCalls, 1);
    // second call — cache fresh, no extra fetch
    const r2 = await api.getCached<{ price: number }>("/api/market/quote/BBCA");
    assert.equal(r2.price, 9000);
    assert.equal(fetchCalls, 1);
  });

  it("stale hit + swr returns stale while revalidating in background", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ v: fetchCalls }),
      } as Response;
    };
    // First fetch populates cache
    await api.getCached<{ v: number }>("/api/market/quote/BBCA");
    // Force stale
    const entry = __debug.mem.get("/api/market/quote/BBCA") as unknown as {
      fetchedAt: number;
    };
    entry.fetchedAt = Date.now() - 20_000; // older than 12s TTL for quote
    // swr=true (default) → returns stale immediately
    const r = await api.getCached<{ v: number }>("/api/market/quote/BBCA");
    assert.equal(r.v, 1);
    // background revalidation should have fired (fetchCalls becomes 2 eventually)
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(fetchCalls, 2);
  });

  it("api.post sends JSON body", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ ok: true }),
      } as Response;
    };
    await api.post<{ ok: boolean }>("/api/portfolio/journal", {
      action: "BUY",
      ticker: "BBCA",
    });
    const body = JSON.parse(capturedBody!);
    assert.equal(body.ticker, "BBCA");
  });
});
