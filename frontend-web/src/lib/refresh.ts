/**
 * One signal for "the bars moved, re-read what you are showing".
 *
 * A custom DOM event rather than a context: the four routes fetch independently
 * and none of them owns the button in the header, so the smallest honest
 * mechanism is a counter each route can subscribe to and put in its effect deps.
 */

import { useEffect, useState } from "react";

export const REFRESH_EVENT = "plan:refreshed";

/** Announce that a refresh finished, so every reader re-reads. */
export function signalRefreshDone() {
	if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

/**
 * A counter that changes when a refresh lands.
 *
 * Put it in a fetch effect's dependency list: the effect re-runs exactly when the
 * data underneath it has been replaced, and nothing else has to know about the
 * button.
 */
export function usePlanRefreshSignal(): number {
	const [nonce, setNonce] = useState(0);
	useEffect(() => {
		const onDone = () => setNonce((value) => value + 1);
		window.addEventListener(REFRESH_EVENT, onDone);
		return () => window.removeEventListener(REFRESH_EVENT, onDone);
	}, []);
	return nonce;
}
