import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

/**
 * Global pending-view counter — every usePolling fetch in flight bumps it.
 * Lets the shell show a top progress bar whenever ANY data-driven view is
 * still loading (first paint, route change, or poll refresh), without each
 * route wiring its own indicator.
 */
const pendingSubs = new Set<() => void>();
let pendingCount = 0;

function emitPending() {
	for (const fn of pendingSubs) fn();
}

function incPending() {
	pendingCount++;
	emitPending();
}

function decPending() {
	if (pendingCount > 0) pendingCount--;
	emitPending();
}

function subscribePending(fn: () => void) {
	pendingSubs.add(fn);
	return () => {
		pendingSubs.delete(fn);
	};
}

/** React hook: number of views currently awaiting data (0 = idle). */
export function usePendingViews(): number {
	// getServerSnapshot: SSR must render the idle state (0) — fetches only
	// start client-side, so the server snapshot is always zero.
	return useSyncExternalStore(
		subscribePending,
		() => pendingCount,
		() => 0,
	);
}

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
	// refreshing = a fetch is in flight (true on every poll/refresh, not just
	// the first load) — lets panels show a spinner while stale data stays up.
	const [refreshing, setRefreshing] = useState(false);
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
		incPending();
		setRefreshing(true);
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
			setRefreshing(false);
			decPending();
		}
	}, []);

	// Immediate fetch + interval, keyed on refreshKey so ticker/period
	// changes trigger an instant reload. The first load is deferred a tick so
	// the synchronous setState(refreshing) doesn't fire inside the effect.
	useEffect(() => {
		const first = setTimeout(() => void load(), 0);
		if (intervalMs == null) return () => clearTimeout(first);
		const id = setInterval(() => void load(), intervalMs);
		return () => {
			clearTimeout(first);
			clearInterval(id);
		};
	}, [load, intervalMs, refreshKey]);

	return { data, error, loading, refreshing, refresh: load };
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
