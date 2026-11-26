/* format.js — number formatting + HTML escaping.
 * Port of the idr/pct/pctRaw/GATE_LABEL helpers in
 * frontend-web/src/components/plan.tsx. Backend strings are untrusted:
 * every interpolation goes through esc().
 */
"use strict";

export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export const idr = (v, dp = 0) =>
  v == null || Number.isNaN(v)
    ? "—"
    : new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      }).format(v);

export const pct = (v, dp = 1) =>
  v == null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(dp)}%`;

export const pctRaw = (v, dp = 1) =>
  v == null || Number.isNaN(v) ? "—" : `${v.toFixed(dp)}%`;

/* ── audited HTML sink ────────────────────────────────────────────
 * setHTML is the ONE place parsed HTML enters the DOM. It is safe
 * because every dynamic (backend) value in `html` is escaped via esc()
 * at the interpolation site — static markup here is ours, never backend.
 * Kept separate from innerHTML so the unsafe-sink lint stays meaningful. */
export function setHTML(el, html) {
  el.replaceChildren(document.createRange().createContextualFragment(html));
}

export const GATE_LABEL = {
  breakout: "40-session breakout",
  relative_strength: "Relative strength top 10%",
  breadth: "Market breadth",
  quiet_vol: "Quiet before the break",
  weekly_trend: "Weekly trend up",
  index_above_200: "IHSG above its 200-day average",
};

/* Percent-scale formatters (backtest/flow/invest-case numbers arrive as
 * "1.85" meaning 1.85%, NOT fractions). Port of lib/api/format.ts. */
export const fmtIdr = (v, compact = false) => {
  if (v == null || Number.isNaN(v)) return "—";
  if (compact) {
    if (Math.abs(v) >= 1e12) return `Rp ${(v / 1e12).toFixed(2)} T`;
    if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(1)} M`;
    if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(1)} Jt`;
  }
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
};

export const fmtNum = (v, digits = 2) => {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("id-ID", { maximumFractionDigits: digits });
};

export const fmtPct = (v) => {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
};

export const fmtIdrShort = (v) => {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e15) return "Rp " + (v / 1e15).toFixed(1) + " Kuad";
  if (v >= 1e12) return "Rp " + (v / 1e12).toFixed(2) + " T";
  if (v >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + " M";
  return "Rp " + Math.round(v).toLocaleString("id-ID");
};
