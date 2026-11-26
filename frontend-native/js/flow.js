/* flow.js — halaman "Riset teknikal".
 * Port of frontend-web/src/routes/Flow.tsx + components/FlowChart.tsx
 * (SVG part). Cards list, proxy detail with candle chart + flow-pressure
 * SVG, validation panel, and the invest case for the selected name.
 */
"use strict";

import { api } from "./api.js";
import { esc, setHTML, fmtIdr, fmtNum, fmtPct } from "./format.js";
import { REFRESH_EVENT } from "./refresh.js";
import { createCandleChart } from "./chart.js";
import { renderInvestCase } from "./invest.js";

const FLOW_TTL = 120_000;
const UNIVERSES = [["watchlist", "Watchlist"], ["movers", "Most active"], ["plan", "Tonight's plan"]];

const state = {
  universe: "watchlist",
  cards: null,
  cardsError: null,
  selected: null,
  series: null,
  history: [],
  detailError: null,
  report: null,
  reportBusy: false,
  reportError: null,
};

function toneOf(v) {
  if (v == null) return "neutral";
  return v >= 0 ? "up" : "down";
}
function yesNo(v) {
  if (v == null) return "—";
  return v ? "✓" : "✗";
}

function changeBadge(value) {
  if (value == null || Number.isNaN(value)) return `<span class="mono" style="font-size:11px;color:var(--text-ghost)">—</span>`;
  const up = value >= 0;
  const sign = up ? "+" : "";
  return `<span class="change" style="color:${up ? "var(--up)" : "var(--down)"};border-color:${up ? "var(--up)" : "var(--down)"};background:${up ? "var(--up-dim)" : "var(--down-dim)"};font-size:11px">
    <span style="font-size:9px" aria-hidden>${up ? "▲" : "▼"}</span>${sign}${value.toFixed(2)}%</span>`;
}

function flowBadge(flow) {
  const d = flow.direction;
  const tone = d === "rising" ? "var(--up)" : d === "falling" ? "var(--down)" : "var(--gold)";
  const glyph = d === "rising" ? "↑" : d === "falling" ? "↓" : "→";
  const label = d === "rising" ? "rising" : d === "falling" ? "falling" : d === "flat" ? "flat" : "unavailable";
  return `<span class="change" style="color:${tone};border-color:${tone};background:color-mix(in srgb, currentColor 8%, transparent);text-transform:uppercase;font-size:10px" title="Proxy score slope: ${flow.slope_5d ?? "—"}; not Bandarmetrics LPM">
    <span aria-hidden>${glyph}</span>LPM proxy ${esc(label)}</span>`;
}

function metric(label, value, tone) {
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text-dim)";
  return `<div style="display:flex;min-width:0;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border-soft);padding-bottom:2px">
    <span style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-ghost)">${esc(label)}</span>
    <span class="tabular" style="overflow:hidden;text-overflow:ellipsis;color:${color}">${value}</span></div>`;
}

function cardView(card) {
  const t = card.technicals;
  return `<div style="padding:12px 16px">
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px">
      <span class="font-display" style="font-size:18px;font-weight:600;color:var(--text)">${esc(card.ticker)}</span>
      <span class="mono" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--text-ghost)">${esc(card.name)}</span>
      <span class="tabular mono" style="margin-left:auto;font-size:15px;font-weight:600;color:var(--text)">${fmtIdr(card.price)}</span>
      ${changeBadge(card.change_pct)}
    </div>
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
      ${flowBadge(card.flow)}
      <span class="mono" style="font-size:10px;color:var(--text-ghost)">5D value ${fmtIdr(card.value_5d_idr, true)}</span>
      <span class="mono" style="margin-left:auto;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">proxy</span>
    </div>
    <div class="mono" style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:11px">
      ${metric("RSI", fmtNum(t.rsi14, 1), "neutral")}
      ${metric("Stoch", fmtNum(t.stoch_k, 1), "neutral")}
      ${metric("ST", t.supertrend === "bull" ? "Bull" : t.supertrend === "bear" ? "Bear" : "—", t.supertrend === "bull" ? "up" : t.supertrend === "bear" ? "down" : "neutral")}
      ${metric("Kumo", t.kumo === "above" ? "Above" : t.kumo === "below" ? "Below" : t.kumo === "inside" ? "Inside" : "—", t.kumo === "above" ? "up" : t.kumo === "below" ? "down" : "neutral")}
      ${metric("VWAP", fmtPct(t.vwap_pct), toneOf(t.vwap_pct))}
      ${metric("MA20", yesNo(t.above_ma20), t.above_ma20 == null ? "neutral" : t.above_ma20 ? "up" : "down")}
      ${metric("MA50", yesNo(t.above_ma50), t.above_ma50 == null ? "neutral" : t.above_ma50 ? "up" : "down")}
      ${metric("52W", fmtPct(t.from_52w_high_pct), "neutral")}
      ${metric("5D chg", fmtPct(t.change_5d_pct), toneOf(t.change_5d_pct))}
    </div></div>`;
}

/* ── flow-pressure SVG (port of buildFlowPath) ───────────────────── */

const FW = 1000, FH = 190, FTOP = 18, FPLOT = 112, FBAR_TOP = 146, FBAR_H = 34;
const scoreY = (v) => {
  const c = Math.max(-1, Math.min(1, v));
  return FTOP + ((1 - c) / 2) * FPLOT;
};

export function flowSvg(series) {
  const n = series.dates.length;
  const scores = series.lpm_score;
  const pts = scores
    .map((v, i) => {
      if (v == null || Number.isNaN(v)) return null;
      const x = n <= 1 ? 0 : (i / (n - 1)) * FW;
      return { x, y: scoreY(v), value: v };
    })
    .filter(Boolean);
  if (!pts.length) return `<p class="card mono" style="padding:40px 0;text-align:center;font-size:12px;color:var(--text-faint)">No proxy series for ${esc(series.ticker)}.</p>`;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1];
  const valid = series.intensity.filter((v) => v != null && Number.isFinite(v));
  const maxI = valid.length ? Math.max(...valid) : 1;
  const w = n > 1 ? Math.max(0.6, FW / n - 0.4) : FW;
  const bars = series.intensity.map((v, i) => {
    if (v == null || !Number.isFinite(v) || maxI <= 0) return "";
    const h = Math.max(0.5, (v / maxI) * FBAR_H);
    const x = n <= 1 ? 0 : (i / (n - 1)) * FW - w / 2;
    return `<rect x="${Math.max(0, x).toFixed(2)}" y="${(FBAR_TOP + FBAR_H - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="var(--blue)" opacity="0.22"/>`;
  }).join("");
  const ticks = [1, 0, -1].map((t) => `<g><line x1="0" x2="${FW}" y1="${scoreY(t)}" y2="${scoreY(t)}" stroke="var(--border)" stroke-width="${t === 0 ? 1 : 0.5}"${t === 0 ? "" : ' stroke-dasharray="3 4"'}/>
    <text x="4" y="${scoreY(t) - 3}" fill="var(--text-ghost)" font-size="10" font-family="ui-monospace, Menlo, Consolas, monospace">${t > 0 ? "+1" : t < 0 ? "-1" : "0"}</text></g>`).join("");
  return `<svg viewBox="0 0 ${FW} ${FH}" class="flow-svg" role="img" aria-label="Flow pressure proxy for ${esc(series.ticker)}">
    ${ticks}${bars}
    <path d="${path}" fill="none" stroke="var(--gold)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="3" fill="var(--gold)"/>
    <text x="${Math.min(last.x + 6, FW - 34).toFixed(2)}" y="${Math.max(last.y - 6, 12).toFixed(2)}" fill="var(--gold)" font-size="10" font-family="ui-monospace, Menlo, Consolas, monospace">${last.value.toFixed(2)}</text>
    <text x="4" y="${FBAR_TOP + FBAR_H + 3}" fill="var(--text-ghost)" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace">intensity</text>
    <text x="${FW - 4}" y="${FH - 4}" text-anchor="end" fill="var(--text-ghost)" font-size="9" font-family="ui-monospace, Menlo, Consolas, monospace">${esc(series.dates[0] ?? "")} → ${esc(series.dates[series.dates.length - 1] ?? "")}</text>
  </svg>`;
}

/* ── detail + validation ─────────────────────────────────────────── */

function detailHead(card, series) {
  return `<div style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px">
    <span class="font-display" style="font-size:24px;font-weight:600;color:var(--text)">${esc(series.ticker)}</span>
    <span class="mono" style="font-size:11px;color:var(--text-ghost)">${esc(card?.name ?? "—")}</span>
    ${card ? `<span class="tabular mono" style="margin-left:auto;font-size:16px;color:var(--text-dim)">${fmtIdr(card.price)}</span>${changeBadge(card.change_pct)}` : ""}
    <div class="mono" style="width:100%;font-size:10px;color:var(--text-ghost)">as of ${esc(series.source.as_of)} · ${esc(series.source.flow)} · quality ${esc(series.source.quality)}${series.cache ? series.cache.hit ? ` · cache ${series.cache.age_seconds}s` : " · computed" : ""}</div>
  </div>`;
}

function validationPanel() {
  const r = state.report;
  const readout = (label, value) => `<div style="border:1px solid var(--border-soft);padding:8px">
    <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-ghost)">${esc(label)}</div>
    <div class="tabular" style="margin-top:4px;font-size:15px;font-weight:600;color:var(--text)">${value}</div></div>`;
  return `<div class="card" style="margin-top:16px;padding:16px">
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px">
      <div><h3 style="margin:0;font-size:14px;font-weight:600;color:var(--text)">What the proxy is worth</h3>
        <p class="fine" style="margin-top:4px;max-width:62ch;font-size:12px">Measure the 5-session direction against the next 5 sessions. This is the proxy&rsquo;s own record, not the vendor&rsquo;s accuracy and not a promise.</p></div>
      <button type="button" class="btn" id="flow-measure"${state.reportBusy ? " disabled" : ""}>${state.reportBusy ? "measuring…" : "measure this proxy"}</button>
    </div>
    ${state.reportError ? `<p class="mono" style="margin-top:12px;font-size:11px;color:var(--down)">${esc(state.reportError)}</p>` : ""}
    ${r ? `<div class="mono" style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:11px">
      ${readout("hit rate", fmtPct(r.hit_rate_pct))}
      ${readout("baseline", fmtPct(r.baseline_hit_rate_pct))}
      ${readout("AUC", fmtNum(r.auc, 3))}
      ${readout("n", fmtNum(r.n, 0))}
      ${readout("rank IC", r.cross_section.available ? fmtNum(r.cross_section.mean_rank_ic, 3) : "—")}
      ${readout("top-bottom", r.cross_section.available ? fmtPct(r.cross_section.mean_top_bottom_pct) : "—")}
      ${readout("vendor", r.vendor_parity.available ? "sample" : "none")}
      ${readout("source", esc(r.source))}
      ${readout("cache", r.cache ? (r.cache.hit ? r.cache.age_seconds + "s" : "new") : "—")}
      <div style="grid-column:1/-1;margin-top:4px;border-top:1px solid var(--border);padding-top:8px;font-size:10px;line-height:1.7;color:var(--text-ghost)">${esc(r.warnings.join(" "))}</div>
    </div>` : ""}
  </div>`;
}

let candleHandle = null;

function renderCards() {
  const host = document.getElementById("flow-cards");
  if (!host) return;
  const cards = state.cards?.cards ?? [];
  setHTML(host, `<ul class="card" style="list-style:none;margin:0;padding:0">
    ${cards.map((c) => `<li style="border-bottom:1px solid var(--border)">
      <button type="button" data-ticker="${esc(c.ticker)}" aria-pressed="${state.selected === c.ticker}"
        style="width:100%;text-align:left;background:${state.selected === c.ticker ? "var(--panel-3)" : "none"};border:0;cursor:pointer;padding:0">${cardView(c)}</button></li>`).join("")}
    ${state.cards && cards.length === 0 ? `<li style="padding:20px;font-size:13px;color:var(--text-faint)">Nothing in this universe has enough history for a card.</li>` : ""}
    ${!state.cards && !state.cardsError ? `<li class="mono" style="padding:20px 24px;font-size:12px;color:var(--text-faint)">Reading the universe — the first pass pulls one year per name.</li>` : ""}
  </ul>
  ${state.cards?.warnings.length ? `<ul class="mono" style="list-style:none;margin:12px 0 0;padding:0;font-size:10px;line-height:1.7;color:var(--text-ghost)">${state.cards.warnings.map((w) => `<li>· ${esc(w)}</li>`).join("")}</ul>` : ""}`);
  host.querySelectorAll("[data-ticker]").forEach((b) =>
    b.addEventListener("click", () => {
      state.selected = b.getAttribute("data-ticker");
      renderCards();
      void loadDetail();
    }),
  );
}

function renderDetail() {
  const host = document.getElementById("flow-detail");
  if (!host) return;
  const card = state.cards?.cards.find((c) => c.ticker === state.selected) ?? null;
  if (candleHandle) {
    candleHandle.dispose();
    candleHandle = null;
  }
  if (state.detailError) {
    setHTML(host, `<p class="card" style="padding:16px;font-size:13px;color:var(--text-dim)">${esc(state.detailError)}</p>`);
    return;
  }
  if (!state.series) {
    setHTML(host, `<p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Loading the proxy series…</p>`);
    return;
  }
  const s = state.series;
  setHTML(host, `<div class="card" style="padding:16px">
      ${detailHead(card, s)}
      <div id="flow-candles"></div>
      <div class="card" style="margin-top:12px;padding:16px">
        <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px">
          <div><span class="eyebrow">Flow pressure (proxy)</span>
            <p class="fine" style="margin-top:4px;max-width:68ch;font-size:12px">Dimensionless score in [-1, 1], from Chaikin Money Flow and (where available) IDX foreign flow. Not Bandarmetrics LPM. Direction is the 5-session change; bars below are volume intensity.</p></div>
          <span class="mono" style="font-size:10px;color:var(--text-ghost)">${esc(s.source.flow)}</span>
        </div>
        ${flowSvg(s)}
      </div>
      ${s.warnings.length > 0 ? `<ul class="mono" style="list-style:none;margin:12px 0 0;padding:0;font-size:10px;line-height:1.7;color:var(--text-ghost)">${s.warnings.map((w) => `<li>· ${esc(w)}</li>`).join("")}</ul>` : ""}
    </div>
    <div id="flow-validation"></div>
    <div id="flow-invest"></div>`);
  const el = host.querySelector("#flow-candles");
  if (el && state.history.length) {
    candleHandle = createCandleChart(el, state.history, { height: 320, showVolume: true });
  }
  const vhost = host.querySelector("#flow-validation");
  if (vhost) {
    setHTML(vhost, validationPanel());
    const btn = vhost.querySelector("#flow-measure");
    if (btn) btn.addEventListener("click", () => void measure());
  }
  const invest = host.querySelector("#flow-invest");
  if (invest && state.selected) void renderInvestCase(invest, state.selected);
}

async function measure() {
  if (!state.selected || state.reportBusy) return;
  state.reportBusy = true;
  state.reportError = null;
  state.report = null;
  renderDetail();
  try {
    state.report = await api.post("/api/flow/validate", { tickers: [state.selected], horizon: 5, days: 250 });
  } catch (e) {
    state.reportError = e instanceof Error ? e.message : String(e);
  } finally {
    state.reportBusy = false;
    renderDetail();
  }
}

function renderMeta() {
  const host = document.getElementById("flow-meta");
  if (!host) return;
  const c = state.cards;
  setHTML(host, c ? `${c.count} names · ${esc(c.as_of)}${c.cache ? (c.cache.hit ? ` · cache ${c.cache.age_seconds}s` : " · computed") : ""}` : "reading sources…");
}

async function loadCards(refresh = false) {
  state.cardsError = null;
  try {
    const q = `universe=${state.universe}&limit=30&days=120${refresh ? "&refresh=1" : ""}`;
    state.cards = refresh
      ? await api.get(`/api/flow/cards?${q}`)
      : await api.getCached(`/api/flow/cards?${q}`, { ttl: FLOW_TTL });
  } catch (e) {
    state.cardsError = e instanceof Error ? e.message : String(e);
    state.cards = null;
  }
  if (state.cards?.cards.length && (!state.selected || !state.cards.cards.some((c) => c.ticker === state.selected))) {
    state.selected = state.cards.cards[0].ticker;
  }
  renderMeta();
  renderCards();
  if (state.selected) void loadDetail();
  else renderDetail();
}

async function loadDetail() {
  if (!state.selected) {
    renderDetail();
    return;
  }
  state.series = null;
  state.history = [];
  state.detailError = null;
  state.report = null;
  state.reportError = null;
  renderDetail();
  try {
    state.series = await api.getCached(`/api/flow/${state.selected}?days=120`, { ttl: FLOW_TTL });
  } catch (e) {
    state.detailError = e instanceof Error ? e.message : String(e);
  }
  try {
    const h = await api.getCached(`/api/market/history/${state.selected}?period=1y`, { ttl: FLOW_TTL });
    state.history = h.history ?? [];
  } catch { state.history = []; }
  renderDetail();
}

const HEADER = `<header style="margin-bottom:32px">
  <p class="eyebrow">Riset</p>
  <h1 class="font-display page-title">Riset teknikal</h1>
  <p class="lede">Panel lanjutan untuk membaca tekanan arus dana: teknikal, nilai 5 hari, dan arah tekanan untuk sekelompok saham terbatas. Garis arus di sini adalah <strong class="k">proksi transparan</strong> — bukan data broker resmi, bukan Bandarmetrics LPM — dan tidak dipakai dalam keputusan halaman Hari ini.</p>
  <div class="card" style="margin-top:16px;border-left:3px solid var(--gold);padding:16px;font-size:12px;line-height:1.65;color:var(--text-dim)">
    <p style="margin:0"><strong class="k">Yang bukan ini.</strong> Rumus LPM vendor dan datanya milik vendor. Skor di sini memakai Chaikin Money Flow plus cetakan arus asing IDX terkini (baris broker Stockbit hanya saat diminta). Levelnya tidak sebanding dengan garis vendor. Baca <a href="method.html" style="text-decoration:underline">halaman metode</a> untuk alasan rencana tidak memperdagangkan proksi arus dana.</p>
  </div></header>`;

export async function initFlow(root) {
  const render = () => {
    setHTML(root, `${HEADER}
    <div style="margin-bottom:20px;display:flex;flex-wrap:wrap;align-items:center;gap:12px">
      <select id="flow-universe" aria-label="Universe">${UNIVERSES.map(([v, l]) => `<option value="${v}"${v === state.universe ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <button type="button" class="btn" id="flow-reload">Reload cards</button>
      <span class="mono" id="flow-meta" style="margin-left:auto;font-size:11px;color:var(--text-ghost)">reading sources…</span>
    </div>
    <div id="flow-err"></div>
    <div class="grid" style="gap:24px" data-flow-cols>
      <section><div style="margin-bottom:12px;display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="margin:0;font-size:17px;font-weight:600;letter-spacing:-0.01em">Cards</h2>
          <span class="mono" style="font-size:10px;color:var(--text-ghost)">proxy quality</span></div>
        <div id="flow-cards"></div></section>
      <section style="min-width:0"><div style="margin-bottom:12px;display:flex;align-items:baseline;justify-content:space-between;gap:12px">
          <h2 style="margin:0;font-size:17px;font-weight:600;letter-spacing:-0.01em" id="flow-detail-title">Detail</h2>
          <span id="flow-detail-badge"></span></div>
        <div id="flow-detail"></div></section>
    </div>`);
    const cols = root.querySelector("[data-flow-cols]");
    if (cols && window.matchMedia("(min-width: 1024px)").matches) {
      cols.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 1.1fr)";
    }
    const sel = document.getElementById("flow-universe");
    if (sel) sel.addEventListener("change", (ev) => {
      state.universe = ev.target.value;
      state.selected = null;
      state.series = null;
      void loadCards();
    });
    const rel = document.getElementById("flow-reload");
    if (rel) rel.addEventListener("click", () => void loadCards(true));
    const err = document.getElementById("flow-err");
    if (err) {
      setHTML(err, state.cardsError ? `<p class="card" style="margin-bottom:20px;border-left:3px solid var(--down);padding:16px;font-size:13px;color:var(--text-dim)">The Flow backend is not answering: ${esc(state.cardsError)}</p>`
        : state.cards && !state.cards.available ? `<p class="card" style="margin-bottom:20px;padding:16px;font-size:13px;color:var(--text-dim)">No cards were available. ${esc(state.cards.warnings.join(" "))}</p>` : "");
    }
    const title = document.getElementById("flow-detail-title");
    if (title) title.textContent = state.selected ?? "Detail";
    const badge = document.getElementById("flow-detail-badge");
    if (badge) {
      const card = state.cards?.cards.find((c) => c.ticker === state.selected);
      setHTML(badge, card ? flowBadge(card.flow) : "");
    }
    renderCards();
    renderDetail();
  };
  window.addEventListener(REFRESH_EVENT, () => {
    render();
    void loadCards().then(() => render());
  });
  setHTML(root, `${HEADER}<p class="loading">Reading the universe…</p>`);
  await loadCards();
  render();
}
