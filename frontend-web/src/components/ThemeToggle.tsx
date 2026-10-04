"use client";

import {
	isDarkTheme,
	setThemePref,
	useThemePref,
	type ThemePref,
} from "@/lib/theme";

const ORDER: ThemePref[] = ["system", "light", "dark"];

const LABEL: Record<ThemePref, string> = {
	system: "Auto",
	light: "Light",
	dark: "Dark",
};

/**
 * Header theme control. Cycles system → light → dark; the choice is persisted
 * and the resolved class lives on <html>. Styled to match the nav's
 * mono/uppercase/tracking treatment.
 */
export default function ThemeToggle() {
	const pref = useThemePref();
	const resolved = isDarkTheme() ? "dark" : "light";

	return (
		<button
			type="button"
			aria-label={`Theme: ${LABEL[pref]} (showing ${resolved}). Click to change.`}
			title={`Theme: ${LABEL[pref]} (showing ${resolved})`}
			onClick={() => setThemePref(ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]!)}
			className="shrink-0 rounded-[var(--radius-control)] border border-[var(--border)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
		>
			{LABEL[pref]}
		</button>
	);
}