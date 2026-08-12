import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polling hook that refetches immediately whenever `refreshKey` changes
 * (e.g. ticker or period), then every `intervalMs`.
 *
 * `fetcher` may change identity every render — the stable `load` closure
 * reads the latest fetcher through a ref, so we never refetch on every
 * render; only `refreshKey` and `intervalMs` trigger runs.
 */
export function usePolling<T>(
	fetcher: () => Promise<T>,
	intervalMs: number | null = 30000,
	refreshKey: unknown = "",
) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const fetcherRef = useRef(fetcher);
	const disposedRef = useRef(false);

	// Keep the latest fetcher without touching the ref during render
	useEffect(() => {
		fetcherRef.current = fetcher;
	}, [fetcher]);

	// Mark disposed on unmount so a late fetch never calls setState
	useEffect(() => {
		disposedRef.current = false;
		return () => {
			disposedRef.current = true;
		};
	}, []);

	const load = useCallback(async () => {
		try {
			const result = await fetcherRef.current();
			if (!disposedRef.current) {
				setData(result);
				setError(null);
			}
		} catch (e) {
			if (!disposedRef.current) {
				setError(e instanceof Error ? e.message : String(e));
			}
		} finally {
			if (!disposedRef.current) setLoading(false);
		}
	}, []);

	// Immediate fetch + interval, keyed on refreshKey so ticker/period
	// changes trigger an instant reload.
	useEffect(() => {
		void load();
		if (intervalMs == null) return;
		const id = setInterval(() => void load(), intervalMs);
		return () => clearInterval(id);
	}, [load, intervalMs, refreshKey]);

	return { data, error, loading, refresh: load };
}

/**
 * SSE stream hook.
 *
 * `onEvent(eventName, data)` fires per frame. `onDone` fires on a clean
 * `done` event (stream finished server-side). `onError(message)` fires
 * when the stream dies *without* a clean `done` — the hook then closes
 * and does NOT auto-reconnect, so callers can surface the failure
 * (e.g. stop a "running" spinner) instead of hanging forever.
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
				// Unexpected death (network drop, 500, proxy timeout):
				// surface it instead of hanging or silently looping.
				onErrorRef.current?.("stream disconnected before completion");
			}
		};
		return () => {
			es.close();
		};
	}, [url, enabled]);
}
