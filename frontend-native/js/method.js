/* method.js — halaman "Cara kerja" (method.html).
 * Port of frontend-web/src/routes/Method.tsx + RegimeSection
 * (components/regimes.tsx). Same section order, same copy, same numbers;
 * renderer is string templates. Shared atoms imported from tonight.js
 * (section/tierTag/provenanceList/evidenceBadge/correctedEvidenceCard).
 *
 * Units: win_rate/breadth FRACTIONS; avg_ret_pct/round_trip/drifts PERCENT.
 */
"use strict";

import { api } from "./api.js";
import { esc, idr, pct, pctRaw, setHTML } from "./format.js";
import { REFRESH_EVENT } from "./refresh.js";
import {
  section,
  provenanceList,
  evidenceBadge,
  correctedEvidenceCard,
} from "./tonight.js";

function stat(label, value, note) {
  return `
    <div>
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value tabular">${value}</div>
      ${note ? `<div class="stat-note">${esc(note)}</div>` : ""}
    </div>`;
}

function testRow(question, answer, good) {
  return `<li style="display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;font-size:13px">
    <span style="color:var(--text-dim)">${esc(question)}</span>
    <span class="mono" style="font-size:12px;color:${good ? "var(--up)" : "var(--gold)"}">${esc(answer)}</span>
  </li>`;
}

/* ── header ──────────────────────────────────────────────────────── */

function header(card, e) {
  return `<header style="margin-bottom:40px">
    <h1 class="font-display page-title">Cara kerja, dan hasil terukurnya</h1>
    <p class="lede">Aturan yang berjalan: ${esc(card.family)} × ${esc(card.exit_method)}. Ringkasnya —
      <b class="k">${pct(e.win_rate, 1)} dari transaksi untung, rata-rata
      ${e.avg_ret_pct != null ? `+${e.avg_ret_pct.toFixed(2)}%` : "—"} tiap transaksi,
      dari ${idr(e.oos_trades)} transaksi terukur</b>.
      Setiap aturan di bawah disalin dari studi di ${esc(card.studies_at)}, dan satu uji
      menjalankan ulang kode sinyal studi untuk membuktikan keduanya masih sepakat.</p>
  </header>`;
}

/* ── holdout + shipped ───────────────────────────────────────────── */

function holdoutSection(card) {
  if (!card.holdout) return "";
  const h = card.holdout;
  return section({
    id: "holdout",
    title: "Does it hold up on data the search never saw?",
    subtitle:
      "This is the question the study was asked directly, and it built a holdout to answer it rather than argue. Read this before the headline number above.",
    body: `<div class="card pad">
      <p style="max-width:80ch;font-size:14px;line-height:1.65;color:var(--text)">${esc(h.verdict)}</p>
      <div class="grid cols4" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        ${stat("Configurations searched", idr(h.search_cells), "entry × exit cells")}
        ${stat("Cleared both bars", `${h.search_cells_clearing ?? 0} / ${h.search_cells ?? 0}`, "on the folds they were searched on")}
        ${stat("Survived the holdout", `${h.winners_surviving ?? 0} / ${h.winners_tested ?? 0}`, "carried forward unchanged")}
        ${stat("Best on unseen data", h.best_holdout_win_rate != null ? `${pct(h.best_holdout_win_rate, 1)} / +${(h.best_holdout_avg_ret_pct ?? 0).toFixed(2)}%` : "—", "win rate / per trade")}
      </div>
      ${
        h.win_rate_decay_pp != null
          ? `<p class="mono" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:11px;line-height:1.7;color:var(--text-ghost)">
             Average change from search to holdout:
             <span style="color:var(--down)">${h.win_rate_decay_pp.toFixed(2)}pp win rate</span>
             ${h.return_decay_pp != null ? `<span style="color:var(--down)">${h.return_decay_pp.toFixed(2)}pp per trade</span>` : ""}</p>`
          : ""
      }
    </div>`,
  });
}

function shippedBox(card) {
  if (!card.shipped || !("entry" in card.shipped)) return "";
  const s = card.shipped;
  return section({
    title: "The shipped rules, as searched",
    subtitle: "The exact configuration this screen runs, and the range it was measured over.",
    body: `<div class="card pad">
      <p class="eyebrow">The exact rules this app runs, measured on the folds that ranked them</p>
      <p class="mono" style="margin-top:8px;font-size:12px;line-height:1.7;color:var(--text-dim)">
        ${esc(s.entry)}<br>${esc(s.exit)}<br>${esc(s.regime_gate)}</p>
      <div class="grid cols3" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        ${stat("Trades", `${s.search_trades_lo ?? 0}–${s.search_trades_hi ?? 0}`, `across ${s.rows_matched} census rows`)}
        ${stat("Win rate", s.search_win_rate_lo != null ? `${pct(s.search_win_rate_lo, 1)}–${pct(s.search_win_rate_hi ?? 0, 1)}` : "—", s.any_row_clears_win_bar ? "at least one row reaches 80%" : "no row reaches 80%")}
        ${stat("Per trade", s.search_avg_ret_lo != null ? `${s.search_avg_ret_lo > 0 ? "+" : ""}${s.search_avg_ret_lo.toFixed(2)}% to ${s.search_avg_ret_hi && s.search_avg_ret_hi > 0 ? "+" : ""}${(s.search_avg_ret_hi ?? 0).toFixed(2)}%` : "—", "the range, not the best row")}
      </div>
      <p class="fine" style="margin-top:16px">${esc(s.note)}</p>
    </div>`,
  });
}

/* ── regime bands + tradability + five-year + bar ─────────────────── */

function regimeDetails(card) {
  const rb = card.regime_bands;
  if (!rb) return "";
  const bands = ["capitulation", "sideways", "trending"];
  const fq = rb.frequency;
  return `<details class="fold" id="regime">${""}
    <summary class="big">Kapan aturannya berdagang, dan seberapa sering<span class="fold-sub">(rincian teknis)</span></summary>
    <div class="fold-body">
    ${section({
      id: "regime-body",
      title: "Pita pasar dan frekuensinya",
      subtitle: rb.note,
      body: `<div class="cells c3">
        ${bands
          .map((band) => {
            const active = band === "trending";
            const edge =
              band === "trending"
                ? `breadth ≥ ${rb.trending.toFixed(2)}`
                : band === "sideways"
                  ? `${rb.capitulation.toFixed(2)} – ${rb.trending.toFixed(2)}`
                  : `< ${rb.capitulation.toFixed(2)}`;
            const action = band === "trending" ? "trade" : band === "sideways" ? "stay flat" : "watch only";
            return `<div class="cell${active ? " soft" : ""}">
              <div class="stat-label">${esc(band)}</div>
              <div class="mono tabular" style="margin-top:8px;font-size:15px;font-weight:600;line-height:1;color:var(--text)">${esc(edge)}</div>
              <div class="mono" style="margin-top:8px;font-size:11px;color:var(--text-dim)">${esc(action)}</div>
            </div>`;
          })
          .join("")}
      </div>
      ${
        fq
          ? `<div class="card pad" style="margin-top:16px">
               <p class="eyebrow">How often, over ${idr(fq.sessions)} measured sessions</p>
               <div class="grid cols4" style="margin-top:16px">
                 ${stat("Cleared the gate", pct(fq.share_trending, 1), `${idr(fq.days_b60)} sessions`)}
                 ${stat("Cleared 0.50", pct(fq.days_b50 / fq.sessions, 1), `${idr(fq.days_b50)} sessions`)}
                 ${stat("Cleared 0.45", pct(fq.days_b45 / fq.sessions, 1), `${idr(fq.days_b45)} sessions`)}
                 ${stat("Below 0.45", pct(fq.share_below_45, 1), "stays flat or watches")}
               </div>
               <p class="fine" style="margin-top:16px;max-width:80ch">Roughly one session in ${Math.round(1 / Math.max(fq.share_trending, 0.0001))} lets the screen trade. Patience is the position most days.</p>
             </div>`
          : ""
      }`,
    })}
    </div>
  </details>`;
}

function tradabilitySection(card) {
  const t = card.tradability;
  if (!t) return "";
  return section({
    id: "tradability",
    title: "Names the screen refuses to consider",
    subtitle: t.why,
    body: `<div class="cells c3">
      <div class="cell">${stat("Minimum price", idr(t.min_price_idr), "names below this never enter")}</div>
      <div class="cell">${stat("Max frozen share", pct(t.max_frozen_fraction, 0), "price-frozen names excluded")}</div>
      <div class="cell">${stat("Universe", "liquid IDX", "turnover floor applies")}</div>
    </div>`,
  });
}

function fiveYearSection(card) {
  const fy = card.five_year;
  if (!fy || !("tiers" in fy)) return "";
  return section({
    id: "five-year",
    title: "Five years in one window",
    subtitle: fy.window,
    body: `<div class="cells c4">
      ${fy.tiers
        .map(
          (t) => `<div class="cell">
            <div class="stat-label">${esc(t.tier)}</div>
            <div class="mono tabular" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;color:var(--text-dim)">
              <span>${idr(t.trades)} trades</span><span>${pct(t.win_rate, 1)}</span>
              <span style="color:${(t.avg_ret_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)"}">${(t.avg_ret_pct ?? 0) >= 0 ? "+" : ""}${(t.avg_ret_pct ?? 0).toFixed(2)}% per trade</span>
            </div>
            <div class="mono tabular" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px">
              <span style="color:var(--text-ghost)">book </span>
              <span style="color:${(t.book_total_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)"}">${(t.book_total_pct ?? 0) >= 0 ? "+" : ""}${(t.book_total_pct ?? 0).toFixed(2)}%</span>
              ${t.book_taken != null ? `<span style="color:var(--text-ghost)"> from ${t.book_taken} taken</span>` : ""}
            </div>
          </div>`,
        )
        .join("")}
    </div>
    <p class="fine" style="margin-top:12px">${esc(fy.caveat)} The gap between the per-trade column and the book column is the point:
    a slot-filling book takes whichever signals arrive first, and those are not the good ones. A method that averages
    +3.99% per trade and loses 2.64% as a book has not been shown to make money.</p>`,
  });
}

function barSection(card) {
  if (!card.bar) return "";
  const b = card.bar;
  return section({
    title: "The bar it was measured against",
    subtitle: "Stated before the result, because a target chosen after the fact measures nothing.",
    body: `<div class="card pad"><p style="font-size:14px;line-height:1.65;color:var(--text-dim)">To clear the bar a cell needs
      <b class="k">${pct(b.win_rate, 0)} win rate</b> with
      <b class="k">more than +${b.avg_trade_pct.toFixed(0)}%</b> average profit per closed trade, out-of-sample,
      on at least ${b.min_trades} trades, with no fold below 60%. Fees and slippage —
      ${pctRaw(card.costs.round_trip_pct, 2)} a round trip — are inside every measured figure.</p></div>`,
  });
}

/* ── rules / families / exits / horizons ─────────────────────────── */

function rulesSection(card) {
  return section({
    id: "rules",
    title: "The rule chain",
    subtitle: `All of these must hold on the close of the last session before a name is buyable. This family is: ${card.family_summary}. No scoring, no weighting, no discretion.`,
    body: `<ol class="card" style="list-style:none;margin:0;padding:0">
      ${card.rules
        .map(
          (r, i) => `<li style="display:flex;gap:16px;border-bottom:1px solid var(--border);padding:16px">
            <span class="mono" style="margin-top:2px;font-size:11px;color:var(--text-ghost)">${String(i + 1).padStart(2, "0")}</span>
            <div style="min-width:0">
              <p style="margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--text)">${esc(r.label)}
              ${!r.required ? `<span class="badge" style="border-color:var(--border);background:var(--panel-3);font-weight:400;color:var(--text-ghost)">not used here</span>` : ""}</p>
              <p class="fine dim" style="margin-top:4px;max-width:76ch;font-size:13px">${esc(r.explain)}</p>
              <p class="mono" style="margin-top:6px;font-size:11px;color:var(--text-ghost)">${esc(r.source)}</p>
            </div>
          </li>`,
        )
        .join("")}
    </ol>`,
  });
}

function familiesSection(card) {
  if (!card.families || card.families.length <= 1) return "";
  return section({
    id: "families",
    title: "Which measured family this runs",
    subtitle:
      "The study cleared both bars with three different sets of conditions. They are not interchangeable — each needs a different market, so they fire on different days. This one trades in the most folds without any fold falling under the study's 60% fragility line.",
    body: `<div class="cells c3">
      ${card.families
        .map((f) => {
          const active = f.family === card.family;
          return `<div class="cell${active ? " soft" : ""}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span class="stat-label">${active ? "in use" : "also measured"}</span>
              ${f.fold_worst_win_rate != null ? `<span class="mono tabular" style="font-size:10px;color:${f.fold_worst_win_rate < 0.6 ? "var(--gold)" : "var(--text-ghost)"}">worst fold ${pct(f.fold_worst_win_rate, 0)}</span>` : ""}
            </div>
            <p style="margin-top:8px;font-size:13px;font-weight:600;line-height:1.4;color:var(--text)">${esc(f.summary)}</p>
            <div class="mono tabular" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;color:var(--text-dim)">
              <span>${idr(f.oos_trades)} trades</span><span>${pct(f.win_rate, 1)}</span>
              <span style="color:var(--up)">+${(f.avg_ret_pct ?? 0).toFixed(1)}%</span>
            </div>
          </div>`;
        })
        .join("")}
    </div>`,
  });
}

function exitsSection(card) {
  const g = card.exit_geometry;
  if (!g) return "";
  return section({
    title: "How it exits",
    subtitle:
      "The stop is far wider than the target, and that is deliberate. The win rate is mostly the probability that a near target is reached before a far one; the average return is what keeps the result honest.",
    body: `<div class="cells c3">
      <div class="cell">${stat("Target", `+${g.target_pct}%`, undefined)}</div>
      <div class="cell">${stat("Stop", `−${g.stop_pct}%`, undefined)}</div>
      <div class="cell">${stat("Hold cap", `${g.hold_bars} sessions`, `about ${(g.hold_bars / 5).toFixed(0)} weeks`)}</div>
    </div>`,
  });
}

function horizonsSection(card) {
  if (!card.horizons || !card.horizons.length) return "";
  return `<details class="fold" id="horizons">
    <summary class="big">Jangka waktu: yang diukur, dan yang ditolak<span class="fold-sub">(rincian teknis)</span></summary>
    <div class="fold-body">
    ${section({
      id: "horizons-body",
      title: "Jangka waktu: yang diukur, dan yang ditolak",
      subtitle:
        "Studi menjawab pertanyaan day-trade dengan pengukuran, bukan dengan mengangkat bahu. Yang lebih pendek dari swing diuji lalu ditolak, atau tidak pernah diuji — keduanya dinyatakan di sini.",
      body: `<ul class="card" style="list-style:none;margin:0;padding:0">
        ${card.horizons
          .map(
            (h) => `<li style="background:var(--panel);padding:20px;border-bottom:1px solid var(--border)">
              <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px">
                <span class="font-display" style="font-size:17px;letter-spacing:-0.01em;color:var(--text)">${esc(h.label)}</span>
                <span class="badge" style="color:${h.tradeable ? "var(--up)" : "var(--gold)"};border-color:color-mix(in srgb, currentColor 30%, transparent)">${esc(h.verdict)}</span>
              </div>
              <p class="fine dim" style="margin-top:8px;max-width:86ch;font-size:13px">${esc(h.detail)}</p>
              ${
                h.evidence && h.evidence.measured
                  ? `<div class="grid cols3" style="margin-top:12px">
                       ${stat("Win rate", pct(h.evidence.win_rate, 1), undefined)}
                       ${stat("Avg per trade", h.evidence.avg_ret_pct != null ? `+${h.evidence.avg_ret_pct.toFixed(2)}%` : "—", undefined)}
                       ${stat("Out-of-sample trades", idr(h.evidence.oos_trades), undefined)}
                     </div>`
                  : ""
              }
              ${provenanceList(h.provenance)}
            </li>`,
          )
          .join("")}
      </ul>`,
    })}
    </div>
  </details>`;
}

/* ── corrected / costs / result / book / ladder ──────────────────── */

function correctedSection(card) {
  if (!card.corrected) return "";
  return section({
    id: "corrected",
    title: "What the study tells you to trade",
    subtitle:
      "The corrected result: clean universe, price-frozen names excluded, tiered costs. It is smaller than the searched maximum below, and it is the number the study publishes.",
    body: correctedEvidenceCard(card.corrected),
  });
}

function costsSection(card) {
  const idx = card.idx;
  return section({
    id: "costs",
    title: "What a round trip really costs",
    subtitle:
      "Two cost models, kept apart on purpose. The study's flat 0.50% is inside every backtested figure; the IDX overlay below is what a retail account pays on top of the levels this screen quotes.",
    body: `<div class="grid half">
      <div class="card pad">
        <p class="eyebrow">The study&rsquo;s model</p>
        <p class="tabular mono" style="margin-top:12px;font-size:26px;font-weight:700;line-height:1;color:var(--text)">${pctRaw(card.costs.round_trip_pct, 2)}</p>
        <p class="fine dim" style="margin-top:8px;max-width:60ch">${esc(card.costs.note)} ${esc(card.costs.idx_note)}</p>
      </div>
      <div class="card pad">
        <p class="eyebrow">The IDX overlay</p>
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px 24px">
          ${stat("Broker fees", pctRaw((idx.broker_fee_buy + idx.broker_fee_sell) * 100, 2), undefined)}
          ${stat("Exchange side", pctRaw((idx.exchange_fee_buy + idx.exchange_fee_sell) * 100, 2), undefined)}
          ${stat("Round lot", `${idr(idx.lot_size)} shares`, undefined)}
          ${stat("Stamp duty", `${idr(idx.stamp_duty_idr)} above ${idr(idx.stamp_duty_above_idr)}`, undefined)}
        </div>
        <p class="fine dim" style="margin-top:12px;max-width:60ch">Fees are only half of it: a two-tick spread is 2.40% of a Rp100 name and
        0.90% of a Rp10,000 one, which is why the screen keeps a Rp50 price floor even though the rulebook now allows Rp1. ${esc(idx.economic_floor_note)}</p>
      </div>
    </div>
    <div class="card pad" style="margin-top:20px">
      <p class="eyebrow">Tick size by price band (rulebook, 28 Sep 2026)</p>
      <div class="chips">
        ${idx.tick_bands.map((b) => `<span class="chip tabular">${idr(b.low)}–${b.high != null ? idr(b.high) : "up"} <span style="color:var(--text)">Rp${idr(b.tick)}</span></span>`).join("")}
      </div>
      <p class="fine dim" style="margin-top:12px;max-width:86ch">Flat tax on a round trip at two ticks: 100% at Rp1, 2% at Rp50, 1% at Rp100,
      0.50% at Rp1,000, 0.25% at Rp10,000. The bands are dated because the rulebook moved on 28 September 2026 and the auto-rejection table moves again on 1 January 2027.</p>
    </div>`,
  });
}

function resultSection(card, e) {
  const folds = (e.fold_detail || "").split(/\s+/).filter(Boolean);
  return section({
    id: "result",
    title: "What the search ranked, before the correction",
    subtitle:
      "Every row below is a cell the study searched over. It is evidence of what the search found, not of what to expect — which is why the corrected result sits above it.",
    body: `<div class="grid side320">
      <div class="card pad">
        <div class="grid cols3">
          ${stat("Win rate", pct(e.win_rate, 2), undefined)}
          ${stat("Avg per trade", e.avg_ret_pct != null ? `+${e.avg_ret_pct.toFixed(2)}%` : "—", undefined)}
          ${stat("Out-of-sample trades", idr(e.oos_trades), undefined)}
        </div>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <p class="eyebrow">Per fold — trades / win rate / average</p>
          <div class="chips">
            ${folds
              .map((part, i) => {
                const idxColon = part.indexOf(":");
                const fold = idxColon >= 0 ? part.slice(0, idxColon) : `#${i}`;
                const rest = (idxColon >= 0 ? part.slice(idxColon + 1) : "").split("/");
                return `<span class="chip tabular"><span style="color:var(--text-ghost)">${esc(fold)}</span> ${esc(rest[0] ?? "")} trades · ${esc(rest[1] ?? "")}% · ${esc(rest[2] ?? "")}%</span>`;
              })
              .join("")}
          </div>
        </div>
      </div>
      ${evidenceBadge(e, card.costs.round_trip_pct)}
    </div>`,
  });
}

function bookSection(card) {
  const d = card.deployment;
  if (!d || !d.available) return "";
  const row = (label, b) => {
    if (!b) return "";
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:10px 0;font-size:13px;color:var(--text)">${esc(label)}</td>
      <td class="num mono tabular" style="font-size:12px;color:var(--text-dim)">${esc(b.taken)}</td>
      <td class="num mono tabular" style="font-size:12px;color:var(--text-dim)">${esc(b.win_rate)}%</td>
      <td class="num mono tabular" style="font-size:12px;color:var(--up)">+${esc(b.total_return_pct)}%</td>
      <td class="num mono tabular" style="font-size:12px;color:var(--down)">${esc(b.max_dd_pct)}%</td>
      <td class="num mono tabular" style="font-size:12px;color:var(--text-dim)">${idr(Number(b.avg_exposure) * 100, 0)}%</td>
    </tr>`;
  };
  return section({
    id: "book",
    title: "What it does as a book, not just per trade",
    subtitle:
      "A win rate per trade says nothing about how much to hold or how deep the drawdown gets. The study measured that separately, at ten positions and equal weight, with costs inside every trade.",
    body: `<div class="grid" style="grid-template-columns:1fr">
      <div style="display:grid;gap:20px" class="book2">
        <div class="card pad">
          <table class="tbl">
            <thead><tr>${["Book", "Taken", "Win", "Total", "Max DD", "Invested"].map((h, i) => `<th${i > 0 ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead>
            <tbody>
              ${row("This method alone", d.single_family_book)}
              ${row("All qualifying methods, ranked", d.book)}
            </tbody>
          </table>
          <p class="fine rule">${esc(d.note)}</p>
        </div>
        <div class="card soft pad">
          <p class="eyebrow">Not a rate to plan against</p>
          <div class="tabular mono strike" style="margin-top:8px;font-size:30px;font-weight:700;line-height:1;color:var(--text-faint)">
            ${d.walk_forward_pct_per_year != null ? `+${d.walk_forward_pct_per_year}%` : "—"}
          </div>
          <div class="mono" style="margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-ghost)">per year, walk-forward — struck through on purpose</div>
          <p class="fine" style="margin-top:16px">${esc(d.walk_forward_caveat)}</p>
        </div>
      </div>
    </div>`,
  });
}

function ladderSection(card, e) {
  if (!card.ladder || !card.ladder.length) return "";
  return section({
    id: "ladder",
    title: "Every measured row that clears both bars",
    subtitle: `${card.ladder.length} of ${idr(e.total_cells_measured)} measured combinations cleared it. These are not independent methods: they are neighbouring exit geometries of the same entry rules, so they share most of their trades. Read them as one finding, not a list of many.`,
    body: `<div class="card scrollx"><table class="tbl">
      <thead><tr>${["Entry rule", "Exit", "Trades", "Win rate", "Avg / trade", "Worst fold"].map((h, i) => `<th${i > 1 ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead>
      <tbody>
        ${card.ladder
          .map(
            (r) => `<tr style="border-bottom:1px solid var(--border)">
              <td class="mono" style="font-size:11px;color:var(--text-faint)">${esc(r.family)}</td>
              <td style="font-size:12px;color:var(--text)">${esc(r.exit_method)}</td>
              <td class="num mono tabular" style="color:var(--text-dim)">${idr(r.oos_trades)}</td>
              <td class="num mono tabular" style="color:var(--text-dim)">${pct(r.win_rate, 2)}</td>
              <td class="num mono tabular" style="color:var(--up)">+${(r.avg_ret_pct ?? 0).toFixed(2)}%</td>
              <td class="num mono tabular" style="color:${(r.fold_worst_win_rate ?? 1) < 0.6 ? "var(--gold)" : "var(--text-faint)"}">${pct(r.fold_worst_win_rate, 1)}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table></div>`,
  });
}

/* ── robustness ──────────────────────────────────────────────────── */

function robustnessSection(card, e) {
  const r = card.robustness;
  if (!r) return "";
  const q = r.quarterly;
  const surv = r.survivorship;
  const mt = r.multiple_testing;
  return section({
    id: "robustness",
    title: "What could make this number wrong",
    subtitle:
      "Three passes that were left open and then measured. The headline clears the bar and each of these says something it does not — which is not a contradiction to resolve in the app's favour, it is the shape of the result.",
    body: `
    ${
      q && q.below_bar
        ? `<div class="card pad accent-left" style="margin-bottom:20px;border-left-color:var(--gold)">
             <p class="eyebrow">Sampled every three months instead of six</p>
             <div style="margin-top:12px;display:flex;flex-wrap:wrap;align-items:baseline;gap:12px 32px">
               <div><div class="tabular mono" style="font-size:30px;font-weight:700;line-height:1;color:var(--gold)">${(q.pick_win_rate ?? 0).toFixed(1)}%</div>
               <div class="mono" style="margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">win rate</div></div>
               <div><div class="tabular mono strike" style="font-size:30px;font-weight:700;line-height:1;color:var(--text-faint)">${pct(e.win_rate, 1)}</div>
               <div class="mono" style="margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">on six-month windows</div></div>
               <div><div class="tabular mono" style="font-size:30px;font-weight:700;line-height:1;color:var(--text)">${q.windows_lost_money}/${q.windows_traded}</div>
               <div class="mono" style="margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">windows lost money</div></div>
               <div><div class="tabular mono" style="font-size:30px;font-weight:700;line-height:1;color:var(--text-dim)">${card.bar.win_rate * 100}%</div>
               <div class="mono" style="margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">the bar</div></div>
             </div>
             <p class="fine dim" style="margin-top:16px;max-width:78ch;font-size:13px">The same method, the same data, with the test window cut from six months to a
             quarter. It averages ${q.pick_avg_ret_pct != null ? `${q.pick_avg_ret_pct >= 0 ? "+" : ""}${q.pick_avg_ret_pct.toFixed(2)}%` : "—"}
             per trade and returns ${q.pick_total_return_pct != null ? `+${q.pick_total_return_pct.toFixed(2)}%` : "—"},
             but the win rate falls under the ${card.bar.win_rate * 100}% this method is credited with. Two quarters
             carry the whole result. A quarter is also too short to hold the 30 trades a cell needs before the bar can be scored at all, in
             ${q.windows_too_short_for_the_bar} of the ${q.windows_total} windows — so this is not a case of the
             bar being tested quarterly and missed. It is the bar being untestable quarterly, and the pooled result when it is measured anyway.</p>
             <p class="fine" style="margin-top:12px;max-width:78ch">${esc(r.revisions_note)}</p>
           </div>`
        : ""
    }
    <div class="grid half">
      ${
        surv && surv.available
          ? `<div class="card pad">
               <p class="eyebrow">Remove the best names</p>
               <p class="fine dim" style="margin-top:8px;font-size:13px">${esc(surv.note)}</p>
               <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">
                 ${surv.curve
                   .map((row) => {
                     const stressed = row.bound === "survivorship" || row.bound === "both";
                     const bad = (row.avg_ret_pct ?? 0) < 0;
                     return `<div class="tierline mono tabular"${stressed ? ' style="color:var(--gold)"' : ""}>
                       <span style="width:112px;flex-shrink:0;color:var(--text-faint)">${esc(row.bound)}</span>
                       <span style="width:56px;text-align:right;color:var(--text-ghost)">${idr(row.trades)}</span>
                       <span style="width:56px;text-align:right">${pct(row.win_rate, 1)}</span>
                       <span style="width:64px;text-align:right;color:${bad ? "var(--down)" : "var(--up)"}">${(row.avg_ret_pct ?? 0) >= 0 ? "+" : ""}${(row.avg_ret_pct ?? 0).toFixed(2)}%</span>
                     </div>`;
                   })
                   .join("")}
               </div>
               <p class="fine rule">Rebuilt on the names that survived, the same cell goes from
               <span style="color:var(--up)">+${(surv.baseline_avg_pct ?? 0).toFixed(2)}%</span> per trade to
               <span style="color:var(--down)">${(surv.worst_drop_avg_pct ?? 0).toFixed(2)}%</span>.
               Survivorship bias only runs one way, so a panel holding the names that died would sit below even this — every published return is an upper bound.</p>
             </div>`
          : ""
      }
      ${
        mt && mt.available
          ? `<div class="card pad">
               <p class="eyebrow">How much of this is the search</p>
               <p class="fine dim" style="margin-top:8px;font-size:13px">${idr(mt.cells_searched)} trading cells were searched with the target already known. Three standard tests, three answers:</p>
               <ul style="list-style:none;margin:16px 0 0;padding:0;display:flex;flex-direction:column;gap:10px">
                 ${testRow("Is something in the set real?", `yes — p = ${mt.spa_p != null ? mt.spa_p.toFixed(4) : "—"}`, true)}
                 ${testRow("Is the top row better than the best alternative it was mined against?", `not distinguishable — p = ${mt.reality_check_p != null ? mt.reality_check_p.toFixed(2) : "—"}`, false)}
                 ${testRow("Is this exact exit a discovery?", "no — deflated Sharpe of zero", false)}
               </ul>
               <p class="fine rule">What survives is the <span style="color:var(--text-dim)">pattern</span> —
               breakout, plus breadth, plus relative strength, plus quiet volatility. Not this particular exit geometry, and not the difference between it and its neighbours in the ladder above.</p>
             </div>`
          : ""
      }
    </div>
    ${
      r.flags && r.flags.length
        ? `<div class="card soft pad" style="margin-top:20px">
             <p class="eyebrow">In one line each</p>
             <ul style="list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px">
               ${r.flags.map((f) => `<li style="display:flex;gap:12px;font-size:13px;line-height:1.6;color:var(--text-dim)"><span style="margin-top:7px;width:4px;height:4px;flex-shrink:0;border-radius:999px;background:var(--gold)" aria-hidden></span><span style="max-width:86ch">${esc(f)}</span></li>`).join("")}
             </ul>
             <p class="fine rule">All of which the headline number is: ${esc(r.headline_is)}.</p>
           </div>`
        : ""
    }`,
  });
}

/* ── regime ledger ───────────────────────────────────────────────── */

const BAND_LABEL = { trending: "Trending", sideways: "Sideways", capitulation: "Capitulation" };
const TIER_LABEL = { tier1: "Tier 1 - the shipped chain", tier2: "Tier 2 - the flat band", tier3: "Tier 3 - capitulation" };

function flowText(flow) {
  const head =
    "The study measured " + flow.indicators + " flow indicators for their forward AUC against breadth. The best flow reading is " +
    flow.best_flow.indicator + " at " + flow.best_flow.auc.toFixed(3) + ", against breadth at " + flow.breadth_auc.toFixed(3) + ". ";
  return head + (flow.breadth_leads
    ? "Volume flow lags price breadth rather than leading it, so no flow gate is applied."
    : "A flow indicator now out-measures breadth; the app should be revisited.");
}

function regimeSection(card, capitulation) {
  if (!card) return "";
  const bands = card.bands;
  const holdout = card.holdout;
  const replays = card.replays;
  const tiers = card.tiers;
  const flow = card.flow;
  const exits = card.exits;
  return section({
    id: "regimes",
    title: "The three regimes, measured",
    subtitle: "The verdict is cut on breadth bands. These are the rounds that measured what, if anything, is tradable inside each band - and refused nearly all of it. Every figure below is read from the artifacts on each request.",
    body: `
    ${
      bands
        ? `<div style="margin-bottom:32px"><h3 class="eyebrow" style="margin-bottom:8px">What each band did over the next five sessions</h3>
           <div class="card scrollx"><table class="tbl" style="min-width:640px">
             <thead><tr><th>Band</th><th>Breadth</th><th class="num">Mean drift</th><th class="num">Median</th><th class="num">Sessions</th><th class="num">Folds</th></tr></thead>
             <tbody class="mono" style="font-size:12px;color:var(--text-dim)">
               ${["trending", "sideways", "capitulation"].filter((k) => bands[k]).map((key) => {
                 const rowB = bands[key];
                 const positive = (rowB.mean_drift_5s_pct ?? 0) >= 0;
                 const range = key === "trending" ? "≥ 0.60" : key === "sideways" ? "0.25 – 0.60" : "< 0.25";
                 return `<tr style="border-bottom:1px solid var(--border)">
                   <td style="color:var(--text)">${BAND_LABEL[key] ?? key}</td>
                   <td style="color:var(--text-faint)">${range}</td>
                   <td class="num tabular" style="color:${positive ? "var(--up)" : "var(--down)"}">${rowB.mean_drift_5s_pct != null ? (rowB.mean_drift_5s_pct >= 0 ? "+" : "") + rowB.mean_drift_5s_pct.toFixed(2) : "—"}</td>
                   <td class="num tabular">${rowB.median_drift_5s_pct != null ? rowB.median_drift_5s_pct.toFixed(2) : "—"}</td>
                   <td class="num tabular">${rowB.sessions.toLocaleString()}</td>
                   <td class="num tabular">${rowB.folds}</td>
                 </tr>`;
               }).join("")}
             </tbody>
           </table></div>
           <p class="fine" style="margin-top:8px;max-width:80ch">Capitulation is the only non-trending band with a positive drift, and it
           is still not tradable as measured: the tier-3 rule built for it failed the bar on every sweep cell and broke under quarterly windows.
           ${card.bands_note ? esc(card.bands_note) : ""}</p></div>`
        : ""
    }
    ${
      holdout
        ? `<div style="margin-bottom:32px"><h3 class="eyebrow" style="margin-bottom:8px">Unseen folds: did any regime cell hold?</h3>
           <div class="card scrollx"><table class="tbl" style="min-width:720px">
             <thead><tr><th>Regime</th><th class="num">Cells re-run</th><th class="num">Held</th><th>Best on unseen folds</th><th class="num">Win</th><th class="num">Avg</th></tr></thead>
             <tbody class="mono" style="font-size:12px;color:var(--text-dim)">
               ${Object.values(holdout.regimes).map((row) => `<tr style="border-bottom:1px solid var(--border)">
                 <td style="color:var(--text)">${esc(row.label)}</td>
                 <td class="num tabular">${row.cells_tested}</td>
                 <td class="num tabular" style="color:${row.holds ? "var(--up)" : "var(--gold)"}">${esc(row.holds)}</td>
                 <td>${esc(row.best_hold.family)}</td>
                 <td class="num tabular">${pctRaw(row.best_hold.win_rate, 1)}</td>
                 <td class="num tabular">${pctRaw(row.best_hold.avg_ret_pct, 2)}</td>
               </tr>`).join("")}
             </tbody>
           </table></div>
           <p class="fine" style="margin-top:8px;max-width:80ch">The study ranked each cell on the search half, then re-ran the top
           twenty-five unchanged on folds no search had touched. Held is how many still cleared the bar there.</p></div>`
        : ""
    }
    ${
      replays
        ? `<div style="margin-bottom:32px"><h3 class="eyebrow" style="margin-bottom:8px">The frozen winners, and what stress did to them</h3>
           <div class="card scrollx"><table class="tbl" style="min-width:820px">
             <thead><tr><th>Regime</th><th>Frozen spec</th><th class="num">Replay</th><th class="num">Book</th><th class="num">After survivorship</th><th class="num">Quarterly</th></tr></thead>
             <tbody class="mono" style="font-size:12px;color:var(--text-dim)">
               ${Object.entries(replays.replays).map(([key, row]) => {
                 const q = replays.quarterly[key];
                 return `<tr style="border-bottom:1px solid var(--border)">
                   <td style="color:var(--text)">${BAND_LABEL[key] ?? key}</td>
                   <td style="color:var(--text-faint)">${esc(row.family)} ${esc(row.side)}, ${esc(row.trades)} trades</td>
                   <td class="num tabular">${pctRaw(row.win_rate, 1)} / ${pctRaw(row.avg_ret_pct, 2)}</td>
                   <td class="num tabular">${pctRaw(row.book_total_pct, 1)} (${pctRaw(row.book_max_dd_pct, 1)} dd)</td>
                   <td class="num tabular" style="color:var(--down)">${pctRaw(row.survivorship_win_rate, 1)} / ${pctRaw(row.survivorship_avg_ret_pct, 2)}</td>
                   <td class="num tabular">${q ? `${pctRaw(q.win_rate, 1)} / ${pctRaw(q.avg_ret_pct, 2)} (${q.losing_windows} of ${q.windows} windows losing)` : "—"}</td>
                 </tr>`;
               }).join("")}
             </tbody>
           </table></div>
           <p class="fine" style="margin-top:8px;max-width:80ch">Each row is the rank-one spec the regime search froze, projected over
           the full history and then re-measured on three-month windows and with the best-performing names removed. Both stresses turn every regime negative.</p></div>`
        : ""
    }
    ${
      tiers
        ? `<div style="margin-bottom:32px"><h3 class="eyebrow" style="margin-bottom:8px">Tier 1, tier 2 and tier 3: full panel, survivorship, quarterly</h3>
           <div class="card scrollx"><table class="tbl" style="min-width:760px">
             <thead><tr><th>Tier</th><th class="num">Full panel</th><th class="num">Survivorship</th><th class="num">Trend folds</th><th class="num">Quarterly</th></tr></thead>
             <tbody class="mono" style="font-size:12px;color:var(--text-dim)">
               ${Object.entries(tiers.tiers).map(([key, block]) => `<tr style="border-bottom:1px solid var(--border)">
                 <td style="color:var(--text)">${TIER_LABEL[key] ?? key}</td>
                 ${["full", "survivorship", "trend"].map((bound) => {
                   const r2 = block.bounds[bound];
                   return `<td class="num tabular">${r2 ? `${pctRaw(r2.win_rate, 1)} / ${pctRaw(r2.avg_ret_pct, 2)} (${r2.n})` : "—"}</td>`;
                 }).join("")}
                 <td class="num tabular">${block.quarterly ? `${pctRaw(block.quarterly.win_rate, 1)} / ${pctRaw(block.quarterly.avg_ret_pct, 2)} (${block.quarterly.n})` : "—"}</td>
               </tr>`).join("")}
             </tbody>
           </table></div>
           <p class="fine" style="margin-top:8px;max-width:80ch">Tier 2 is the same rules forced to trade the flat band, which is the
           loss the verdict avoids. Tier 3 is the capitulation bounce. Both are shown with their stressed rows, because a tier table without them is a headline with better lighting.</p></div>`
        : ""
    }
    <div class="grid half">
      ${
        flow
          ? `<div class="card pad"><h3 class="eyebrow" style="margin-bottom:8px">Do flow indicators lead?</h3>
             <p class="fine dim" style="font-size:13px">${esc(flowText(flow))}</p>
             <p class="mono" style="margin-top:12px;font-size:11px;color:var(--text-ghost)">${esc(flow.source)}</p></div>`
          : ""
      }
      ${
        exits
          ? `<div class="card pad"><h3 class="eyebrow" style="margin-bottom:8px">The exit census</h3>
             <p class="fine dim" style="margin-bottom:12px">Every exit method the study pooled out-of-sample, so the switcher quotes measured numbers rather than an opinion about exits.</p>
             <ul style="list-style:none;margin:0;padding:0">
               ${exits.exits.slice(0, 8).map((row) => `<li style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:8px 0;border-top:1px solid var(--border);font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--text-dim)">
                 <span style="color:var(--text)">${esc(row.exit_method)}</span>
                 <span style="color:var(--text-ghost)">${esc(row.trades)} trades</span>
                 <span class="tabular" style="margin-left:auto">${pctRaw(row.win_rate, 1)} win</span>
                 <span class="tabular" style="color:${row.avg_ret_pct >= 0 ? "var(--up)" : "var(--down)"}">${pctRaw(row.avg_ret_pct, 2)} avg</span>
               </li>`).join("")}
             </ul>
             <p class="mono" style="margin-top:12px;font-size:11px;color:var(--text-ghost)">${esc(exits.source)}</p></div>`
          : ""
      }
    </div>
    ${
      capitulation
        ? `<div style="margin-top:32px"><h3 class="eyebrow" style="margin-bottom:8px">The capitulation tier, and why it is a watch</h3>
           <div class="card pad accent-left" style="border-left-color:var(--gold)">
             <p class="fine dim" style="max-width:80ch;font-size:13px">${esc(capitulation.why)}</p>
           </div></div>`
        : ""
    }`,
  });
}

/* ── "what this is not" + page ───────────────────────────────────── */

function isNotSection(card) {
  const lines = [
    card.holdout
      ? `The headline clears the bar; nothing else does. ${card.holdout.search_cells_clearing} of ${card.holdout.search_cells} searched configurations cleared both bars, and ${card.holdout.winners_surviving} of ${card.holdout.winners_tested} held up on data the search never saw.`
      : "The headline clears the bar on the data it was searched on. Whether it survives unseen data has not been measured here.",
    "The result is not evenly earned. It comes from six-month windows; sampled quarterly it wins less, and two quarters carry the profit.",
    "Rebuilt on names that survived, the same cell earns less than zero per trade. The panel is a survivor panel and every return here is an upper bound.",
    "It is long-only and buys liquid IDX names. It says nothing about other markets, intraday holds, or shorting — the short twin measured 54.7% in the same study.",
    "It is one method. The ladder above is neighbouring exit geometries of the same entry rules, not separate discoveries.",
    `Costs of ${pctRaw(card.costs.round_trip_pct, 2)} a round trip are inside every measured trade, but your broker may charge more. Check before sizing.`,
  ];
  return section({
    title: "What this is not",
    body: `<div class="card soft pad"><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px">
      ${lines.map((line) => `<li style="display:flex;gap:12px;font-size:13px;line-height:1.6;color:var(--text-dim)">
        <span style="margin-top:8px;width:4px;height:4px;flex-shrink:0;border-radius:999px;background:var(--text-ghost)" aria-hidden></span>
        <span style="max-width:86ch">${esc(line)}</span></li>`).join("")}
    </ul></div>`,
  });
}

export async function initMethod(root) {
  const load = async () => {
    setHTML(root, `<p class="loading">Loading the method…</p>`);
    let card = null;
    try {
      card = await api.getCached("/api/plan/method", { ttl: 60_000 });
    } catch (e) {
      setHTML(
        root,
        `<h1 class="err-title font-display">Backend tidak menjawab</h1>
         <p class="fine dim" style="margin-top:12px;max-width:60ch;font-size:14px">Jalankan <code class="mono" style="font-size:13px">./trading-suite run</code> lalu muat ulang halaman.</p>
         <p class="mono" style="margin-top:12px;font-size:11px;color:var(--text-ghost)">${esc(e instanceof Error ? e.message : String(e))}</p>`,
      );
      return;
    }
    const e = card.evidence;
    setHTML(
      root,
      `${header(card, e)}
       ${holdoutSection(card)}
       ${shippedBox(card)}
       ${regimeDetails(card)}
       ${tradabilitySection(card)}
       ${fiveYearSection(card)}
       ${barSection(card)}
       ${rulesSection(card)}
       ${familiesSection(card)}
       ${exitsSection(card)}
       ${horizonsSection(card)}
       ${correctedSection(card)}
       ${costsSection(card)}
       ${resultSection(card, e)}
       ${bookSection(card)}
       ${ladderSection(card, e)}
       ${robustnessSection(card, e)}
       ${regimeSection(card.regimes, card.capitulation)}
       ${isNotSection(card)}`,
    );
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  };
  window.addEventListener(REFRESH_EVENT, () => void load());
  await load();
}
