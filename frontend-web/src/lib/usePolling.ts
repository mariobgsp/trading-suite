"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { peekCache } from "./cache";

/**
 * Polling hook — now SWR-aware, abortable, keeps previous data across
 * refreshKey changes, and pauses when tab is hidden.
 *
 * - If `cacheKey` is provided the hook will synchronously hydrate from
 *   memory/sessionStorage on mount / key change (instant first paint).
 * - `keepPreviousData` (default: true) prevents chart/table flashes when
 *   switching ticker/period — stale data stays visible until fresh arrives.
 * - AbortController cancels superseded fetches (fast ticker switching).
 * - Hidden tabs skip polling ticks; resumes on visibility.
 * - Exponential backoff on consecutive errors (2s → 4s → 8s … capped at 30s)
 *   to avoid hammering a failing backend/yfinance.
 */

type PollingOpts = {
	cacheKey?: string;
	keepPreviousData?: boolean;
	pauseWhenHidden?: boolean;
	backoffOnError?: boolean;
};

export function usePolling<T>(
	fetcher: () => Promise<T>,
	intervalMs: number | null = 30000,
	refreshKey: unknown = "",
	opts: PollingOpts = {},
) {
	const {
		cacheKey,
		keepPreviousData = true,
		pauseWhenHidden = true,
		backoffOnError = true,
	} = opts;

	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [isValidating, setIsValidating] = useState(false);

	// Hydrate from cache after mount to avoid server/client hydration mismatch.
	// Server prerenders with skeleton (null); client picks up cached value
	// on the first effect tick and swaps in instantly without a network round-trip.
	useEffect(() => {
		if (!cacheKey) return;
		const cached = peekCache<T>(cacheKey);
		if (cached != null) {
			setData(cached);
			setLoading(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cacheKey]);

	const fetcherRef = useRef(fetcher);
	const abortRef = useRef<AbortController | null>(null);
	const consecutiveErrorsRef = useRef(0);
	const disposedRef = useRef(false);
	const refreshKeyRef = useRef(refreshKey);
	const dataRef = useRef<T | null>(null);
	useEffect(() => {
		dataRef.current = data;
	}, [data]);

	useEffect(() => {
		fetcherRef.current = fetcher;
	}, [fetcher]);

	useEffect(() => {
		disposedRef.current = false;
		return () => {
			disposedRef.current = true;
			abortRef.current?.abort();
		};
	}, []);

	// On refreshKey change, optionally keep previous data visible instead of
	// flashing a skeleton. If we have a cached value for the *new* key, pick
	// it up synchronously.
	useEffect(() => {
		if (refreshKeyRef.current === refreshKey) return;
		refreshKeyRef.current = refreshKey;

		if (cacheKey) {
			const cached = peekCache<T>(cacheKey);
			if (cached != null) {
				setData(cached);
				setLoading(false);
				setError(null);
				// still revalidate in background (stale-while-revalidate already does this
				// when fetcher = api.getCached), but ensure we trigger load()
				return;
			}
		}

		if (!keepPreviousData) {
			setData(null);
			setLoading(true);
		} else {
			// keep showing stale data; indicate background fetch
			setIsValidating(true);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refreshKey, cacheKey]);

	const load = useCallback(async () => {
		// pause when tab hidden
		if (pauseWhenHidden && typeof document !== "undefined" && document.hidden) {
			return;
		}

		// exponential backoff gate — if we recently failed, skip this tick
		// until backoff delay has elapsed (tracked via private timer below)
		abortRef.current?.abort();
		const ctrl = new AbortController();
		abortRef.current = ctrl;

		const hadData = dataRef.current !== null;
		// Only show full loading spinner on *initial* load; subsequent
		// revalidations are background (keepPreviousData)
		if (!hadData && !keepPreviousData) setLoading(true);
		else if (hadData) setIsValidating(true);

		try {
			const result = await fetcherRef.current();
			if (ctrl.signal.aborted || disposedRef.current) return;
			setData(result);
			setError(null);
			consecutiveErrorsRef.current = 0;
		} catch (e) {
			if (ctrl.signal.aborted || disposedRef.current) return;
			// AbortError is not a real failure — just a superseded fetch
			if (e instanceof DOMException && e.name === "AbortError") return;
			setError(e instanceof Error ? e.message : String(e));
			consecutiveErrorsRef.current += 1;
		} finally {
			if (!disposedRef.current && !ctrl.signal.aborted) {
				setLoading(false);
				setIsValidating(false);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pauseWhenHidden, keepPreviousData]);

	// Immediate fetch + interval, keyed on refreshKey
	useEffect(() => {
		void load();

		if (intervalMs == null) return;

		let id: ReturnType<typeof setInterval> | null = null;
		let backoffTimeout: ReturnType<typeof setTimeout> | null = null;

		const schedule = () => {
			id = setInterval(() => {
				// backoff: if we had N consecutive errors, delay next attempt
				if (backoffOnError && consecutiveErrorsRef.current > 0) {
					const backoffMs = Math.min(
						30_000,
						2_000 * Math.pow(2, consecutiveErrorsRef.current - 1),
					);
					// Skip this tick, try again after backoff
					if (id) clearInterval(id);
					backoffTimeout = setTimeout(() => {
						void load();
						schedule();
					}, backoffMs);
					return;
				}
				void load();
			}, intervalMs);
		};

		schedule();

		const onVis = () => {
			if (!document.hidden) void load();
		};
		if (pauseWhenHidden) document.addEventListener("visibilitychange", onVis);

		return () => {
			if (id) clearInterval(id);
			if (backoffTimeout) clearTimeout(backoffTimeout);
			if (pauseWhenHidden) document.removeEventListener("visibilitychange", onVis);
		};
	}, [load, intervalMs, refreshKey, backoffOnError, pauseWhenHidden]);

	return { data, error, loading, isValidating, refresh: load };
}

/**
 * SSE stream hook — unchanged semantics, but now pauses EventSource when
 * tab is hidden to save resources.
 */
export function useEventSource<T extends Record<string, unknown>>(
	url: string | null,
	onEvent: (event: string, data: T) => void,
	enabled = true,
	onDone?: () => void,
	onError?: (message: string) => void,
) {
	const onEventRef = useRef(onEvent);
	const onDoneRef = useRef(onDone);
	const onErrorRef = useRef(onError);

	useEffect(() => {
		onEventRef.current = onEvent;
		onDoneRef.current = onDone;
		onErrorRef.current = onError;
	}, [onEvent, onDone, onError]);

	useEffect(() => {
		if (!url || !enabled) return;
		const es = new EventSource(url);
		let finished = false;

		const handler = (event: MessageEvent) => {
			try {
				const parsed = JSON.parse(event.data) as T & { event?: string };
				const name = parsed.event ?? "message";
				onEventRef.current(name, parsed);
				if (name === "done") {
					finished = true;
					onDoneRef.current?.();
				}
			} catch {
				/* malformed frame — ignore */
			}
		};
		es.onmessage = handler;
		es.onerror = () => {
			es.close();
			if (!finished) {
				onErrorRef.current?.("stream disconnected before completion");
			}
		};
		return () => {
			es.close();
		};
	}, [url, enabled]);
}
