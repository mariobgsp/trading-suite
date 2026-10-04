import { useSyncExternalStore } from "react";

/**
 * Theme preference, the <html class="dark"> class, and the resolved chart
 * palette.
 *
 * Two consumers:
 *  - ThemeToggle, which writes the preference and flips the class.
 *  - The lightweight-charts components. lightweight-charts paints to a canvas
 *    and cannot read CSS custom properties, so it needs concrete colour
 *    strings — and it needs them again every time the theme changes, because
 *    canvas pixels do not follow a stylesheet. `useChartPalette()` therefore
 *    returns a NEW object whenever the theme flips (and a stable one
 *    otherwise), which the charts put in their effect dependency arrays so the
 *    chart is rebuilt with the new colours.
 *
 * The very first application of the class happens in the inline boot script in
 * index.html, which must run before first paint; this module takes over from
 * there.
 */

export type ThemePref = "system" | "light" | "dark";

/** Keep in sync with the inline boot script in index.html. */
export const THEME_KEY = "ts-theme";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Colours the charts need, resolved from the :root / .dark token set. */
export interface ChartPalette {
	/** --text-faint: axis + crosshair text. */
	ink: string;
	/** --border: grid lines, scale borders, crosshair label chip. */
	grid: string;
	up: string;
	down: string;
	gold: string;
	violet: string;
	blue: string;
}

function token(name: string): string {
	if (typeof document === "undefined") return "";
	return getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
}

function readPalette(): ChartPalette {
	return {
		ink: token("--text-faint"),
		grid: token("--border"),
		up: token("--up"),
		down: token("--down"),
		gold: token("--gold"),
		violet: token("--violet"),
		blue: token("--blue"),
	};
}

/**
 * The charts need translucent variants of the palette (grid washes, histogram
 * bars, dashed reference lines). Rather than a token per alpha, derive them
 * from the resolved base colour so they follow the theme automatically.
 */
export function withAlpha(color: string, alpha: number): string {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
	if (hex) {
		let digits = hex[1];
		if (digits.length === 3)
			digits = digits[0]! + digits[0]! + digits[1]! + digits[1]! + digits[2]! + digits[2]!;
		const n = Number.parseInt(digits, 16);
		return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
	}
	const fn = /^rgba?\(([^)]+)\)$/i.exec(color);
	if (fn) {
		const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
		if (parts.length >= 3)
			return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
	}
	return color;
}

const listeners = new Set<() => void>();
let palette: ChartPalette = readPalette();
let watchingSystem = false;
let started = false;

function refreshPalette(): boolean {
	const next = readPalette();
	// Identity must only change when a value actually changed, so
	// useSyncExternalStore does not loop on unrelated renders.
	const same = (Object.keys(next) as (keyof ChartPalette)[]).every(
		(k) => next[k] === palette[k],
	);
	if (same) return false;
	palette = next;
	return true;
}

function publish() {
	for (const fn of listeners) fn();
}

export function getChartPalette(): ChartPalette {
	return palette;
}

function subscribe(fn: () => void): () => void {
	if (!started) {
		started = true;
		// Reconcile with the inline boot script: it applies the class before
		// paint but cannot be reactive, so storage-disabled or stale-class
		// cases are settled here, on the first subscriber.
		document.documentElement.classList.toggle("dark", isDarkTheme());
		refreshPalette();
	}
	listeners.add(fn);
	if (!watchingSystem) {
		watchingSystem = true;
		// Follow the OS while the preference is "system".
		window.matchMedia(SYSTEM_DARK_QUERY).addEventListener("change", () => {
			if (getThemePref() === "system") setThemePref("system");
		});
	}
	return () => {
		listeners.delete(fn);
	};
}

/** Resolved chart colours. New object identity on every theme change. */
export function useChartPalette(): ChartPalette {
	return useSyncExternalStore(subscribe, getChartPalette, getChartPalette);
}

/* ── Preference ─────────────────────────────────────────────────────────── */

function systemIsDark(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia(SYSTEM_DARK_QUERY).matches
	);
}

export function getThemePref(): ThemePref {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === "light" || stored === "dark" || stored === "system")
			return stored;
	} catch {
		/* storage disabled */
	}
	return "system";
}

export function isDarkTheme(): boolean {
	const pref = getThemePref();
	return pref === "system" ? systemIsDark() : pref === "dark";
}

/**
 * Writes the preference, syncs the <html> class and republishes the chart
 * palette. Re-applying the current preference is the cheap way to re-run the
 * resolution when the OS changes.
 */
export function setThemePref(pref: ThemePref): void {
	try {
		localStorage.setItem(THEME_KEY, pref);
	} catch {
		/* storage disabled: the class still applies for this session */
	}
	const dark = pref === "system" ? systemIsDark() : pref === "dark";
	document.documentElement.classList.toggle("dark", dark);
	refreshPalette();
	publish();
}

export function useThemePref(): ThemePref {
	return useSyncExternalStore(subscribe, getThemePref, getThemePref);
}