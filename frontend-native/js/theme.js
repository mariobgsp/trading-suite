/* theme.js — preference, <html> class, toggle wiring.
 * Port of frontend-web/src/lib/theme.ts (preference half). The boot script
 * in each page's <head> applies the class before first paint; this module
 * owns everything after that. Charts need no palette here — the pilot
 * ships no canvas charts (those arrive with the backtest/deep pages).
 */
"use strict";

export const THEME_KEY = "ts-theme";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
const ORDER = ["system", "light", "dark"];
const LABEL = { system: "Auto", light: "Terang", dark: "Gelap" };

function systemIsDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(SYSTEM_DARK_QUERY).matches
  );
}

export function getThemePref() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system")
      return stored;
  } catch {
    /* storage disabled */
  }
  return "system";
}

export function isDarkTheme() {
  const pref = getThemePref();
  return pref === "system" ? systemIsDark() : pref === "dark";
}

export function setThemePref(pref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage disabled: the class still applies for this session */
  }
  document.documentElement.classList.toggle(
    "dark",
    pref === "system" ? systemIsDark() : pref === "dark",
  );
}

function label(pref, dark) {
  return `Tema: ${LABEL[pref]} (tampil ${dark ? "gelap" : "terang"}). Klik untuk ganti.`;
}

/** Wire every [data-theme-toggle] button on the page. */
export function initTheme() {
  // Reconcile with the boot script (storage-disabled or stale-class cases).
  document.documentElement.classList.toggle("dark", isDarkTheme());
  const paint = () => {
    const pref = getThemePref();
    const dark = isDarkTheme();
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.textContent = LABEL[pref];
      btn.setAttribute("aria-label", label(pref, dark));
      btn.setAttribute("title", label(pref, dark));
    });
  };
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = ORDER[(ORDER.indexOf(getThemePref()) + 1) % ORDER.length];
      setThemePref(next);
      paint();
    });
  });
  window
    .matchMedia(SYSTEM_DARK_QUERY)
    .addEventListener("change", () => getThemePref() === "system" && paint());
  paint();
}
