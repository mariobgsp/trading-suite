/* invest.js — "Invest case": the selected name, asked twice.
 * Port of frontend-web/src/components/InvestCase.tsx. Shared by the Flow
 * page and the Deep page: fundamental + technical pillar cards (criteria
 * graph), share strip, KI disclosure + headline feeds.
 * Self-contained: call renderInvestCase(container, ticker).
 */
"use strict";

import { api } from "./api.js";
import { esc, setHTML, fmtIdrShort } from "./format.js";

const TONE = {
  supportive: "var(--up)",
  caution: "var(--gold)",
  against: "var(--down)",
  unknown: "var(--text-ghost)",
  mixed: "var(--gold)",
  weak: "var(--down)",
};

export function fmtNum(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("id-ID", { maximumFractionDigits: digits });
}

function fmtShares(v) {
  if (v == null || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)} T`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)} Jt`;
  return Math.round(v).toLocaleString("id-ID");
}

function verdictBadge(verdict) {
  const color = TONE[verdict.state] ?? "var(--text-ghost)";
  return `<span class="change" style="color:${color};border-color:${color};background:color-mix(in srgb, currentColor 8%, transparent);text-transform:uppercase;letter-spacing:0.08em;font-size:10px">${esc(verdict.state)}</span>`;
}

function criteriaGraph(criteria, verdict) {
  return `<div class="case-graph" style="margin-top:16px">
    ${criteria.map((c, i) => `<div title="${esc(c.detail)}" style="grid-column:1;grid-row:${i + 1};min-width:0;border:1px solid var(--border);border-left:2px solid ${TONE[c.state] ?? "var(--text-ghost)"};background:var(--panel-2);padding:6px 8px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
          <span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">${esc(c.label)}</span>
          <span class="tabular mono" style="flex-shrink:0;font-size:11px;color:${TONE[c.state] ?? "var(--text-dim)"}">${esc(c.display)}</span>
        </div></div>`).join("")}
    ${criteria.map((c, i) => `<span aria-hidden="true" style="grid-column:2;grid-row:${i + 1};align-self:center;border-top:1px ${c.state === "unknown" ? "dashed" : "solid"} var(--border-strong)"></span>`).join("")}
    <div style="grid-column:3;grid-row:1 / span ${criteria.length};display:flex;align-items:center;border-left:1px solid var(--border-strong);padding-left:8px">
      <div style="width:100%;border:1px solid ${TONE[verdict.state] ?? "var(--text-ghost)"};background:var(--panel-2);padding:8px;text-align:center">
        <div class="mono" style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:${TONE[verdict.state] ?? "var(--text-ghost)"}">${esc(verdict.state)}</div>
        <div class="mono" style="margin-top:4px;font-size:9px;line-height:1.6;color:var(--text-ghost)">${verdict.supportive} for · ${verdict.caution} caution<br>${verdict.against} against · ${verdict.unknown} unknown</div>
      </div>
    </div>
  </div>`;
}

function shareStrip(s) {
  if (!s.available) {
    return `<div style="margin-top:12px"><p class="mono" style="border-left:2px solid var(--gold);padding-left:8px;font-size:10px;line-height:1.7;color:var(--text-faint)">Share structure unavailable — ${esc(s.warnings[0] ?? "the IDX register did not answer.")}</p>
      ${s.shares_outstanding != null ? `<p class="mono" style="margin-top:4px;font-size:10px;color:var(--text-ghost)">shares outstanding ${fmtShares(s.shares_outstanding)}</p>` : ""}</div>`;
  }
  const trend = s.trend !== "unknown" && s.delta_pp != null
    ? ` · tren kepemilikan ${s.trend} (${(s.delta_pp >= 0 ? "+" : "")}${s.delta_pp.toFixed(2)}pp antara ${s.from_date ?? "—"} → ${s.to_date ?? "—"})` : "";
  return `<div class="mono" style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px;font-size:10px;line-height:1.7;color:var(--text-faint)">
    <span style="color:var(--text-ghost)">Struktur saham: </span>${fmtIdrShort(s.shares_outstanding)} lembar
    ${s.public_pct != null ? ` · float publik ${fmtNum(s.public_pct, 1)}%` : ""}
    ${s.owner_pct != null ? ` · pengendali ${fmtNum(s.owner_pct, 1)}%` : ""}${esc(trend)}</div>`;
}

function pillarCard(pillar, structure) {
  return `<article class="card" style="min-width:0;padding:16px">
    <header style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px">
      <div><p class="eyebrow" style="font-size:9px">${esc(pillar.name)}</p>
        <h3 style="margin-top:4px;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:var(--text)">${esc(pillar.label)} validity</h3></div>
      ${verdictBadge(pillar.verdict)}
    </header>
    <p class="mono" style="margin-top:6px;font-size:10px;color:var(--text-ghost)">${pillar.verdict.measured} of ${pillar.verdict.total} criteria measured</p>
    ${structure ? shareStrip(structure) : ""}
    ${!pillar.available ? `<p class="mono" style="margin-top:12px;border-left:2px solid var(--gold);padding-left:8px;font-size:10px;line-height:1.7;color:var(--text-faint)">No ${esc(pillar.name)} measurement came back — ${esc(pillar.warnings[0] ?? "the source did not answer.")}</p>` : ""}
    ${pillar.criteria.length > 0 ? criteriaGraph(pillar.criteria, pillar.verdict)
      : !pillar.available ? "" : `<p class="card soft" style="margin-top:16px;padding:12px;font-size:12px;line-height:1.6;color:var(--text-faint)">No measurements for this name.</p>`}
    ${pillar.available && pillar.warnings.length > 0 ? `<ul class="mono" style="list-style:none;margin:12px 0 0;padding:0;font-size:10px;line-height:1.7;color:var(--text-ghost)">${pillar.warnings.map((w) => `<li>· ${esc(w)}</li>`).join("")}</ul>` : ""}
  </article>`;
}

function feedCard(eyebrow, title, available, items, warnings, dateOf, subOf) {
  return `<div class="card" style="padding:16px">
    <p class="eyebrow" style="font-size:9px">${esc(eyebrow)}</p>
    <h3 style="margin-top:4px;font-size:15px;font-weight:600;color:var(--text)">${esc(title)}</h3>
    ${!available ? `<p class="mono" style="margin-top:8px;font-size:10px;color:var(--gold)">${esc(warnings[0] ?? "source did not answer")}</p>` : ""}
    <ul style="list-style:none;margin:12px 0 0;padding:0">
      ${items.slice(0, 8).map((item) => `<li style="padding:8px 0;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span class="mono" style="flex-shrink:0;font-size:9px;color:var(--text-ghost)">${esc((dateOf(item) ?? "").slice(0, 10))}</span>
          ${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noreferrer" style="min-width:0;font-size:12px;line-height:1.4;color:var(--text-dim)">${esc(item.title)}</a>`
            : `<span style="min-width:0;font-size:12px;line-height:1.4;color:var(--text-dim)">${esc(item.title)}</span>`}
        </div>
        ${subOf(item) ? `<div class="mono" style="margin-top:2px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">${esc(subOf(item))}</div>` : ""}
      </li>`).join("")}
    </ul></div>`;
}

function investSection(report) {
  return `<div class="grid half" style="align-items:start">
      ${pillarCard(report.fundamental, report.ownership)}
      ${pillarCard(report.technical)}
    </div>
    <div class="grid half" style="margin-top:20px;align-items:start">
      ${feedCard("Keterbukaan", "KI filings", report.disclosures.available, report.disclosures.items, report.disclosures.warnings, (i) => i.date, (i) => i.category)}
      ${feedCard("Headlines", "News", report.news.available, report.news.items, report.news.warnings, (i) => i.date_str || i.date, (i) => i.source)}
    </div>`;
}

/** Render the invest-case section for one ticker into container. */
export async function renderInvestCase(container, ticker) {
  setHTML(container, `<section style="margin-top:40px;border-top:1px solid var(--border);padding-top:28px">
    <div style="margin-bottom:20px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 16px">
      <div><p class="eyebrow">Invest case</p>
        <h2 class="font-display" style="margin-top:8px;font-size:24px;line-height:1;letter-spacing:-0.01em">${esc(ticker)} — how valid is an investment?</h2></div>
      <span class="mono" style="font-size:10px;color:var(--text-ghost)">reading the company, the register and the tape…</span>
    </div>
    <p class="fine" style="margin-bottom:20px;max-width:80ch;font-size:13px">Two questions, answered separately: is the business worth owning, and is the tape willing to pay for it? Each criterion is a measurement against a written band. The verdict counts those measurements; it predicts nothing.</p>
    <div data-invest-body><p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Reading the company and the tape…</p></div>
  </section>`);
  const body = container.querySelector("[data-invest-body]");
  try {
    const report = await api.getCached(`/api/case/${ticker.toUpperCase()}`, { ttl: 900_000 });
    if (body) setHTML(body, investSection(report));
  } catch (e) {
    if (body) setHTML(body, `<p class="card" style="border-left:3px solid var(--down);padding:16px;font-size:13px;color:var(--text-dim)">The case backend is not answering: ${esc(e instanceof Error ? e.message : String(e))}</p>`);
  }
}
