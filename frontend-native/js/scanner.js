/* scanner.js — halaman "Cari saham".
 * Port of frontend-web/src/routes/Scanner.tsx. One fetch, then every
 * filter/sort/search/preset change re-renders the table in place (no
 * network), exactly like the React useMemo pipeline.
 */
"use strict";

import { api } from "./api.js";
import { esc, idr, pct, pctRaw, setHTML } from "./format.js";
import { bandCopy, screenCopy, TERMS } from "./present.js";
import { REFRESH_EVENT } from "./refresh.js";
import { section } from "./tonight.js";

const SORTS = [
  ["closest", "Terkait aturan"],
  ["momentum", "Momentum terkuat"],
  ["breakout", "Paling menembus 40 hari"],
  ["quiet", "Paling tenang"],
  ["turnover", "Nilai transaksi terbesar"],
  ["ticker", "A–Z"],
];

const COLUMN_PRESETS = [
  ["ringkas", "Ringkas"],
  ["performa", "Performa"],
  ["teknikal", "Teknikal"],
];

const SAVED_PRESETS = [
  { key: "likuid-momentum", label: "Likuid + momentum", filter: "relative_strength", sort: "momentum" },
  { key: "tenang-hampir", label: "Tenang + hampir lolos", filter: "tier1_setup", sort: "quiet" },
  { key: "breakout", label: "Penembus 40 hari", filter: "breakout", sort: "breakout" },
];

const state = { payload: null, failed: null, filter: "all", query: "", sort: "closest", preset: "ringkas" };

function compactIdr(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e12) return `Rp ${(v / 1e12).toFixed(1)} T`;
  if (v >= 1e9) return `Rp ${(v / 1e9).toFixed(1)} B`;
  if (v >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} M`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

function visibleRows() {
  const p = state.payload;
  if (!p) return [];
  const needle = state.query.trim().toUpperCase();
  const list = p.rows.filter(
    (r) =>
      (state.filter === "all" || r.screens.includes(state.filter)) &&
      (needle === "" || r.ticker.includes(needle)),
  );
  const sorted = [...list];
  switch (state.sort) {
    case "momentum": return sorted.sort((a, b) => b.rs_rating - a.rs_rating);
    case "breakout": return sorted.sort((a, b) => b.breakout_pct - a.breakout_pct);
    case "quiet": return sorted.sort((a, b) => a.vol20 / Math.max(a.vol20_threshold, 0.01) - b.vol20 / Math.max(b.vol20_threshold, 0.01));
    case "turnover": return sorted.sort((a, b) => (b.turnover_idr ?? 0) - (a.turnover_idr ?? 0));
    case "ticker": return sorted.sort((a, b) => a.ticker.localeCompare(b.ticker));
    default: return sorted.sort((a, b) => b.conditions_passed - a.conditions_passed || b.rs_rating - a.rs_rating);
  }
}

function chip(key, label, count, active, disabled, title) {
  return `<button type="button" class="preset" data-chip="${esc(key)}" aria-pressed="${active}"${disabled ? " disabled" : ""}${title ? ` title="${esc(title)}"` : ""}
    style="border-color:${active ? "var(--accent)" : "var(--border)"};background:${active ? "var(--accent)" : "transparent"};color:${active ? "var(--accent-fg)" : "var(--text-faint)"};text-transform:uppercase;letter-spacing:0.08em;font-size:10px;display:inline-flex;align-items:center;gap:8px;${disabled ? "cursor:not-allowed;opacity:0.4;" : ""}">
    ${esc(label)}<span class="tabular" style="color:${active ? "var(--accent-fg)" : "var(--text-ghost)"}">${idr(count)}</span></button>`;
}

function screenNote() {
  const p = state.payload;
  const screen = p.screens.find((s) => s.key === state.filter) ?? null;
  if (!screen) {
    return `<div class="card soft" style="margin-bottom:16px;padding:12px 16px">
      <p class="fine dim">Setiap filter dan artinya. Hanya <b class="k">Lolos semua aturan</b> yang punya hasil terukur sendiri; sisanya adalah syarat yang menjelaskan posisi sebuah saham.</p>
      <dl style="margin:12px 0 0;display:flex;flex-direction:column;gap:6px">
        ${p.screens.map((s) => {
          const plain = screenCopy(s.key, s);
          return `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;line-height:1.6">
            <dt class="mono" style="width:158px;flex-shrink:0;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text)">${esc(plain.label)} <span style="color:var(--text-ghost)">(${idr(s.count)})</span></dt>
            <dd style="margin:0;max-width:82ch;color:var(--text-faint)">${esc(plain.meaning)} ${!s.active ? `<i style="color:var(--gold)">Tidak aktif di pita ini.</i>` : ""}</dd>
          </div>`;
        }).join("")}
      </dl></div>`;
  }
  const plain = screenCopy(screen.key, screen);
  return `<div class="card soft" style="margin-bottom:16px;padding:12px 16px">
    <p class="fine dim"><b class="k">${esc(plain.label)}.</b> ${esc(plain.meaning)}</p>
    <details class="fold" style="margin-top:4px">
      <summary style="font-size:11px">Definisi teknis dan hasil terukur</summary>
      <p class="fine" style="margin-top:4px;font-size:11px">${esc(screen.definition)}</p>
      <p class="fine" style="margin-top:4px;font-size:11px">${esc(screen.note)}</p>
      ${screen.measured ? `<p class="mono" style="margin-top:8px;font-size:10px;line-height:1.7;color:var(--text-faint)">
        ${screen.kind === "strategy" ? "Terukur" : "Sapuan"}: <b style="color:var(--text-dim)">${pct(screen.measured.win_rate ?? screen.measured.sweep_win_rate, 1)} menang /
        ${((screen.measured.avg_ret_pct ?? screen.measured.sweep_avg_ret_pct ?? 0) >= 0 ? "+" : "")}${(screen.measured.avg_ret_pct ?? screen.measured.sweep_avg_ret_pct ?? 0).toFixed(2)}%</b>
        (${idr(screen.measured.trades ?? screen.measured.sweep_trades ?? 0)} transaksi)
        ${screen.measured.holdout_win_rate != null ? ` · holdout ${pct(screen.measured.holdout_win_rate, 1)} menang` : ""}.
        <a href="method.html" style="text-decoration:underline">Metode dan batasnya →</a></p>` : ""}
    </details></div>`;
}

function levelCell(row) {
  if (row.support == null && row.resistance == null)
    return `<span style="color:var(--text-ghost)" title="Belum ada level terkonfirmasi dalam setahun terakhir">—</span>`;
  const side = (label, level, touches, color) =>
    `<span style="color:${level == null ? "var(--text-ghost)" : color}">${label} ${level == null ? "—" : idr(level)}${touches != null && touches > 0 ? `<b style="margin-left:2px;font-weight:600">×${touches}</b>` : ""}</span>`;
  return `<span style="display:flex;align-items:center;justify-content:center;gap:12px;white-space:nowrap" title="Level terdekat tempat harga pernah berbalik; ×N = sudah N kali berbalik arah di sana dalam setahun terakhir">
    ${side("S", row.support, row.support_touches, "var(--up)")}
    ${side("R", row.resistance, row.resistance_touches, "var(--down)")}</span>`;
}

function rowHtml(row, showTech, showPerf) {
  const badges = row.screens.filter((k) => k === "tier1" || k === "tier1_setup" || k === "capitulation");
  return `<tr style="border-top:1px solid var(--border)">
    <td style="padding:6px 12px"><a href="deep.html?ticker=${esc(row.ticker)}" class="font-display" style="font-size:15px;color:var(--text);text-decoration:none">${esc(row.ticker)}</a></td>
    <td class="tabular" style="padding:6px 8px;text-align:right;color:var(--text-dim)">${idr(row.close)}</td>
    <td class="tabular" style="padding:6px 8px;text-align:right"><span style="color:${(row.change_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)"}">${pctRaw(row.change_pct, 1)}</span></td>
    ${showTech ? `<td class="tabular" style="padding:6px 8px;text-align:right"><span style="color:${row.conditions.breakout ? "var(--up)" : "var(--text-faint)"}">${(row.breakout_pct >= 0 ? "+" : "") + row.breakout_pct.toFixed(2) + "%"}</span></td>` : ""}
    ${showTech ? `<td class="tabular" style="padding:6px 8px;text-align:right"><span style="color:${row.conditions.relative_strength ? "var(--text)" : "var(--text-faint)"}">${row.rs_rating.toFixed(0)}</span></td>` : ""}
    ${showTech ? `<td class="tabular" style="padding:6px 8px;text-align:right"><span style="color:${row.conditions.quiet_vol ? "var(--up)" : "var(--text-faint)"}">${row.vol20.toFixed(1)}</span> <span style="font-size:9px;color:var(--text-ghost)">maks ${row.vol20_threshold.toFixed(1)}</span></td>` : ""}
    ${showPerf ? `<td class="tabular" style="padding:6px 8px;text-align:right;color:var(--text-faint)">${compactIdr(row.turnover_idr)}</td>` : ""}
    <td style="padding:6px 8px;text-align:center">${levelCell(row)}</td>
    <td style="padding:6px 8px">${badges.length === 0 ? `<span style="color:var(--text-ghost)">—</span>` : `<span style="display:flex;flex-wrap:wrap;gap:4px">${badges.map((k) => `<span class="pill" style="font-size:9px;color:${k === "tier1" ? "var(--up)" : "var(--gold)"};background:${k === "tier1" ? "color-mix(in srgb, var(--up) 10%, transparent)" : "color-mix(in srgb, var(--gold) 10%, transparent)"}">${k === "tier1" ? "lolos" : k === "capitulation" ? "pantau" : "hampir"}</span>`).join("")}</span>`}</td>
    <td style="padding:6px 12px"><a href="deep.html?ticker=${esc(row.ticker)}" style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-faint);text-decoration:underline dotted">Periksa →</a></td>
  </tr>`;
}

function tapeHtml(p) {
  const band = p.regime ? bandCopy(p.regime.band) : null;
  if (!band) return "";
  const f = p.freshness;
  return `<div class="card" style="margin-bottom:20px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:10px 16px;border-left:3px solid ${f?.stale ? "var(--gold)" : "var(--border)"}">
    <span class="fine dim" style="font-size:13px">Kondisi pasar: <b class="k" style="color:${band.tone}">${esc(band.label)}</b> → ${esc(band.advice)}</span>
    <a href="index.html" style="font-size:12px;color:var(--text-faint)">lihat Hari ini →</a>
    ${f ? `<span class="mono" style="margin-left:auto;font-size:10px;color:var(--text-ghost)" title="${f.stale ? `Data bar berakhir ${f.bars_session}; sesi terakhir bursa ${f.expected_session}. Muat ulang data sebelum bertindak.` : `Data bar berakhir ${f.bars_session}; sesuai jam bursa.`}">data per ${esc(f.bars_session)}${f.stale ? " · perbarui dulu" : ""}</span>` : ""}
  </div>`;
}

function renderTable() {
  const host = document.getElementById("scan-table");
  if (!host || !state.payload) return;
  const showTech = state.preset === "teknikal";
  const showPerf = state.preset !== "ringkas";
  const rows = visibleRows();
  const cols = showTech ? 10 : showPerf ? 7 : 6;
  setHTML(host, `<div class="tbl-scroll card" style="max-height:72vh;overflow:auto"><table class="tbl tbl-sticky" style="min-width:${showTech ? "960px" : showPerf ? "800px" : "640px"}">
    <thead><tr><th>Saham</th><th class="num">Harga</th><th class="num">Hari ini</th>${showTech ? `<th class="num">40 hari</th><th class="num">Momentum</th><th class="num">Volatilitas</th>` : ""}${showPerf ? `<th class="num">Nilai transaksi</th>` : ""}<th style="text-align:center">Support / Resistance</th><th>Status</th><th>Periksa</th></tr></thead>
    <tbody class="mono" style="font-size:11px">
      ${rows.map((r) => rowHtml(r, showTech, showPerf)).join("")}
      ${rows.length === 0 ? `<tr><td colspan="${cols}" style="padding:32px 16px;text-align:center;font-size:13px;color:var(--text-faint)">Tidak ada saham yang lolos filter ini malam ini.</td></tr>` : ""}
    </tbody></table></div>
    <p class="fine" style="margin-top:8px;max-width:90ch;font-size:11px">Support = ${esc(TERMS.support)}. Resistance = ${esc(TERMS.resistance)}. Angka ×N setelah harga level = sudah N kali harga berbalik arah di area itu dalam satu tahun terakhir.</p>`);
}

function renderControls() {
  const host = document.getElementById("scan-controls");
  if (!host || !state.payload) return;
  const p = state.payload;
  const rows = visibleRows();
  setHTML(host, `${tapeHtml(p)}
  ${section({
    title: `${idr(rows.length)} dari ${idr(p.rows.length)} saham`,
    subtitle: `Per ${p.session_label}. ${idr(p.universe.tradable)} dari ${idr(p.universe.codes)} kode lolos syarat dasar riset; sisanya tidak dihitung.`,
    body: `<div style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
      ${chip("all", "Semua saham", p.rows.length, state.filter === "all", false, null)}
      ${p.screens.map((s) => {
        const plain = screenCopy(s.key, s);
        return chip(s.key, plain.label, s.count, state.filter === s.key, !s.active, s.active ? s.definition : `${plain.label} tidak aktif di pita pasar ini. ${s.note}`);
      }).join("")}
    </div>
    <div style="margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
      <input type="search" id="scan-q" aria-label="Cari kode saham" placeholder="Cari kode — BBCA" value="${esc(state.query)}" style="width:210px" />
      <label class="mono" style="display:flex;align-items:center;gap:8px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">Urutkan
        <select id="scan-sort">${SORTS.map(([v, l]) => `<option value="${v}"${v === state.sort ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <div style="display:flex;align-items:center;gap:4px" role="group" aria-label="Kolom tampilan">
        ${COLUMN_PRESETS.map(([v, l]) => `<button type="button" class="preset" data-preset="${v}" aria-pressed="${state.preset === v}">${esc(l)}</button>`).join("")}</div>
      <span class="mono" style="margin-left:auto;font-size:10px;color:var(--text-ghost)">Klik saham untuk periksa lengkap</span>
    </div>
    <div style="margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
      <span class="mono" style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">Cepat:</span>
      ${SAVED_PRESETS.map((it) => `<button type="button" class="preset" data-saved="${it.key}">${esc(it.label)}</button>`).join("")}
    </div>
    <div id="scan-note"></div>`,
  })}`);
  const note = document.getElementById("scan-note");
  if (note) setHTML(note, screenNote());
  const q = document.getElementById("scan-q");
  if (q) {
    q.addEventListener("input", (ev) => {
      state.query = ev.target.value;
      renderControls();
      renderTable();
      const q2 = document.getElementById("scan-q");
      if (q2) {
        q2.focus();
        q2.setSelectionRange(q2.value.length, q2.value.length);
      }
    });
  }
  const sort = document.getElementById("scan-sort");
  if (sort) sort.addEventListener("change", (ev) => {
    state.sort = ev.target.value;
    renderControls();
    renderTable();
  });
  host.querySelectorAll("[data-chip]").forEach((b) =>
    b.addEventListener("click", () => {
      state.filter = b.getAttribute("data-chip");
      renderControls();
      renderTable();
    }),
  );
  host.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      state.preset = b.getAttribute("data-preset");
      renderControls();
      renderTable();
    }),
  );
  host.querySelectorAll("[data-saved]").forEach((b) =>
    b.addEventListener("click", () => {
      const it = SAVED_PRESETS.find((x) => x.key === b.getAttribute("data-saved"));
      if (it) {
        state.filter = it.filter;
        state.sort = it.sort;
        renderControls();
        renderTable();
      }
    }),
  );
}

export async function initScanner(root) {
  const load = async () => {
    setHTML(root, `<p class="loading">Membaca daftar riset…</p>`);
    try {
      state.payload = await api.getCached("/api/scanner", { ttl: 300_000 });
      state.failed = null;
    } catch (e) {
      setHTML(root, `<h1 class="err-title font-display">Backend tidak menjawab</h1>
        <p class="fine dim" style="margin-top:12px;max-width:60ch;font-size:14px">Jalankan <code class="mono" style="font-size:13px">./trading-suite run</code> lalu muat ulang halaman.</p>
        <p class="mono" style="margin-top:12px;font-size:11px;color:var(--text-ghost)">${esc(e instanceof Error ? e.message : String(e))}</p>`);
      return;
    }
    setHTML(root, `<header style="margin-bottom:24px">
        <h1 class="font-display" style="font-size:32px;line-height:1.2;letter-spacing:-0.02em;margin:0">Cari saham</h1>
        <p class="fine dim" style="margin-top:12px;max-width:76ch;font-size:14px">Satu baris untuk setiap saham yang lolos syarat dasar riset. Filter di bawah memakai aturan yang sama dengan halaman Hari ini — setiap filter menunjukkan jumlah hasil dan artinya. Kolom tampilan bisa diganti: Ringkas, Performa, Teknikal.</p>
      </header>
      <div id="scan-controls"></div>
      <div id="scan-table"></div>`);
    renderControls();
    renderTable();
  };
  window.addEventListener(REFRESH_EVENT, () => void load());
  await load();
}
