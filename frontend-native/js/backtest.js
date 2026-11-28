/* backtest.js — halaman "Uji strategi".
 * Port of frontend-web/src/routes/Backtest.tsx. Form (target + period +
 * presets), compare fetch, winner card, equity multi-line chart with
 * clickable legend (lightweight-charts via js/chart.js), full strategy
 * table + error rows, and the shipped method's own record.
 *
 * Scales: backtest stats are PERCENT numbers (fmtPct/pctRaw); the plan
 * win_rate fractions use pct(). NOTE: the React MethodEvidence renders the
 * corrected win_rate with pctRaw ("0.8%"); the fraction form pct() ("76.3%")
 * is used here to match the Method page.
 */
"use strict";

import { api } from "./api.js";
import { esc, setHTML, fmtIdr, fmtNum, fmtPct, pct, pctRaw } from "./format.js";
import { strategyCopy, featuredStrategy } from "./present.js";
import { REFRESH_EVENT } from "./refresh.js";
import { createEquityChart, readPalette, withAlpha } from "./chart.js";

const PERIODS = [
  ["6mo", "6 bln"],
  ["1y", "1 thn"],
  ["2y", "2 thn"],
  ["5y", "5 thn"],
];
const PRESETS = ["^JKSE", "BBCA", "BBRI", "ASII", "TLKM"];

const DATE_FMT = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit", month: "short", year: "numeric",
});

function dateText(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : DATE_FMT.format(parsed);
}

function resultWindow(result) {
  const curves = [
    result?.hold_target?.curve,
    ...(result?.strategies ?? []).map((row) => row.curve),
  ];
  const curve = curves.find((points) => Array.isArray(points) && points.length);
  if (!curve) return null;
  return {
    start: dateText(curve[0].date),
    end: dateText(curve[curve.length - 1].date),
  };
}

const LINE_ORDER = [
  "golden_cross", "gate_sma200", "breakout", "tsmom", "momentum",
  "pullback", "cross_9_21", "meanreversion", "mildmover", "cross_3_5", "buyhold",
];

const state = { ticker: "^JKSE", typed: "^JKSE", period: "2y", result: null, loading: false, error: null, methodCard: null };

function rankedRows(result) {
  if (!result) return [];
  return result.strategies
    .filter((r) => r.stats != null)
    .sort((a, b) => (b.stats.total_return_pct ?? 0) - (a.stats.total_return_pct ?? 0));
}

function erroredRows(result) {
  if (!result) return [];
  return result.strategies.filter((r) => r.error);
}

function stat(label, value) {
  return `<div class="card" style="padding:16px">
    <div class="stat-label">${esc(label)}</div>
    <div class="tabular font-display" style="margin-top:4px;font-size:22px;color:var(--text)">${value}</div></div>`;
}

function winnerCard(result) {
  const best = featuredStrategy(result.strategies);
  if (!best || !best.stats) {
    return `<div class="card" style="border-left:3px solid var(--gold);padding:20px">
      <p class="eyebrow">Jawaban pendek periode ini</p>
      <p style="margin-top:8px;max-width:86ch;font-size:15px;line-height:1.65;color:var(--text)">Tidak ada strategi yang membuka satu pun transaksi di periodenya ini — tidak ada yang bisa dinyatakan unggul, dan halaman ini tidak memilih pemenang dari angka kosong.</p></div>`;
  }
  const copy = strategyCopy(best.strategy);
  const stats = best.stats;
  const indexTotal = result.hold_index.total_pct ?? result.hold_target.total_pct;
  const baselineLabel = result.ticker === "^JKSE" || result.hold_index.total_pct != null
    ? "Sementara beli-tahan IHSG pada jendela yang sama memberi"
    : "Sementara beli-tahan target ini pada jendela yang sama memberi";
  const beat = indexTotal != null && stats.total_return_pct > indexTotal;
  const alpha = best.alpha_vs_index_pct == null ? "—"
    : (best.alpha_vs_index_pct >= 0 ? "+" : "") + best.alpha_vs_index_pct.toFixed(2) + "pp";
  return `<div class="card" style="border-left:3px solid ${beat ? "var(--up)" : "var(--down)"};padding:20px">
    <p class="eyebrow">Pengembalian tertinggi di jendela ini</p>
    <p style="margin-top:8px;max-width:86ch;font-size:15px;line-height:1.65;color:var(--text)">
      <strong>${esc(best.label)}</strong> mencatat ${fmtPct(stats.total_return_pct)} selama
      ${fmtNum(result.bars, 0)} sesi (${stats.total_trades} transaksi,
      ${fmtPct(stats.win_rate)} menang, penurunan terdalam
      ${Math.abs(stats.max_drawdown_pct).toFixed(1)}%, berada di pasar
      ${stats.time_in_market_pct.toFixed(0)}% dari waktu).
      ${copy ? esc(copy) + " " : ""}${indexTotal != null ? esc(baselineLabel) + " " + fmtPct(indexTotal) + " — selisih " + alpha + "." : "Baseline pembanding tidak tersedia untuk periode ini."}</p>
    <p class="mono" style="margin-top:8px;font-size:10px;color:var(--text-ghost)">Ini peringkat pengembalian satu jendela, bukan pemenang walk-forward; lihat kolom walk-forward per metode di bawah.</p></div>`;
}

let equityHandle = null;

function lineColors(pal) {
  return {
    tsmom: pal.violet, momentum: pal.blue, meanreversion: pal.gold,
    pullback: pal.up, breakout: withAlpha(pal.up, 0.85),
    mildmover: withAlpha(pal.violet, 0.55), golden_cross: pal.ink,
    gate_sma200: pal.down, cross_3_5: withAlpha(pal.blue, 0.5),
    cross_9_21: withAlpha(pal.gold, 0.55), buyhold: withAlpha(pal.ink, 0.75),
  };
}

function renderEquity(host, result) {
  if (equityHandle) {
    equityHandle.dispose();
    equityHandle = null;
  }
  const pal = readPalette();
  const colors = lineColors(pal);
  const curves = {};
  if (result.hold_index.curve && result.hold_index.curve.length > 1) {
    curves.__index = {
      color: pal.ink, width: 2, dashed: true,
      points: result.hold_index.curve.map((p) => ({ date: p.date, value: p.value })),
    };
  }
  const featured = featuredStrategy(result.strategies);
  for (const row of result.strategies) {
    if (!row.curve || row.curve.length < 2) continue;
    const on = row.strategy === "buyhold" || (featured && row.strategy === featured.strategy);
    curves[row.strategy] = {
      color: colors[row.strategy] ?? pal.ink, width: 1,
      hidden: !on,
      points: row.curve.map((p) => ({ date: p.date, value: p.value })),
    };
  }
  setHTML(host, `<div class="card" style="padding:8px"><div id="bt-chart"></div>
    <div class="legend">${[...result.strategies]
      .filter((r) => r.curve && r.curve.length > 1)
      .sort((a, b) => LINE_ORDER.indexOf(a.strategy) - LINE_ORDER.indexOf(b.strategy))
      .map((r) => {
        const on = r.strategy === "buyhold" || (featured && r.strategy === featured.strategy);
        return `<button type="button" data-line="${esc(r.strategy)}"${on ? "" : ' class="off"'}><span aria-hidden>—</span>${esc(r.label)}</button>`;
      }).join("")}
      <span style="margin-left:auto;color:var(--text-ghost)">klik legend untuk menarik/menyembunyikan garis</span></div></div>`);
  const el = host.querySelector("#bt-chart");
  if (!el) return;
  const visible = {};
  for (const [k, c] of Object.entries(curves)) visible[k] = !c.hidden;
  equityHandle = createEquityChart(el, curves, {});
  host.querySelectorAll("[data-line]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.getAttribute("data-line");
      visible[k] = !visible[k];
      equityHandle.setVisible(k, visible[k]);
      b.classList.toggle("off", !visible[k]);
    }),
  );
}

function alphaBasis(result) {
  return result.ticker === "^JKSE" || result.hold_index?.total_pct != null ? "IHSG" : "target";
}

function strategyTable(result) {
  const rows = rankedRows(result);
  const basisLabel = alphaBasis(result);
  if (!rows.length) {
    return `<p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Tidak ada metode yang berhasil disimulasikan pada data ini.</p>`;
  }
  return `<div class="card scrollx"><table class="tbl">
    <thead><tr><th>Metode</th><th class="num">Transaksi</th><th class="num">Menang</th><th class="num">Rata untung / rugi</th><th class="num">Total</th><th class="num">CAGR</th><th class="num">Max DD</th><th class="num" title="Pengembalian metode dikurangi beli-tahan pembanding pada jendela yang sama.">α vs ${esc(basisLabel)}</th><th class="num">Waktu di pasar</th><th style="text-align:center">Walk-forward</th></tr></thead>
    <tbody class="mono" style="font-size:11px">
      ${rows.map((row) => {
        const s = row.stats;
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px 12px"><span style="color:var(--text)">${esc(row.label)}</span> <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-ghost)">${esc(row.kin)}</span></td>
          <td class="num tabular">${s.total_trades}</td>
          <td class="num tabular">${pctRaw(s.win_rate, 0)}</td>
          <td class="num tabular"><span style="color:${s.avg_win_pct >= 0 ? "var(--up)" : "var(--down)"}">${fmtPct(s.avg_win_pct)}</span><span style="padding:0 4px;color:var(--text-ghost)">/</span><span style="color:${s.avg_loss_pct >= 0 ? "var(--up)" : "var(--down)"}">${fmtPct(s.avg_loss_pct)}</span></td>
          <td class="num tabular"><span style="color:${s.total_return_pct >= 0 ? "var(--up)" : "var(--down)"}">${fmtPct(s.total_return_pct)}</span></td>
          <td class="num tabular" style="color:var(--text-dim)">${fmtPct(s.annualized_return_pct)}</td>
          <td class="num tabular" style="color:var(--down)">${Math.abs(s.max_drawdown_pct).toFixed(1)}%</td>
          <td class="num tabular">${row.alpha_vs_index_pct == null ? `<span style="color:var(--text-ghost)">—</span>`
            : `<span style="color:${row.alpha_vs_index_pct >= 0 ? "var(--up)" : "var(--down)"}">${(row.alpha_vs_index_pct >= 0 ? "+" : "") + row.alpha_vs_index_pct.toFixed(2)}pp</span>`}</td>
          <td class="num tabular" style="color:var(--text-dim)">${s.time_in_market_pct.toFixed(0)}%</td>
          <td style="padding:6px 8px;text-align:center">${row.walk_forward
            ? `<span title="IS ${fmtPct(row.walk_forward.is_return_pct)} / OOS ${fmtPct(row.walk_forward.oos_return_pct)}" style="color:${row.walk_forward.consistent ? "var(--up)" : "var(--gold)"}">${row.walk_forward.consistent ? "konsisten" : "OOS lebih lemah"}</span>`
            : `<span style="color:var(--text-ghost)">—</span>`}</td>
        </tr>`;
      }).join("")}
    </tbody></table></div>`;
}

function errorRows(result) {
  const errors = erroredRows(result);
  if (!errors.length) return "";
  return `<ul class="mono" style="list-style:none;margin:8px 0 0;padding:0;font-size:10px;line-height:1.7;color:var(--text-ghost)">
    ${errors.map((r) => `<li>· ${esc(r.label)} gagal dijalankan: ${esc(r.error ?? "tanpa keterangan")}</li>`).join("")}</ul>`;
}

function methodEvidence(card) {
  const e = card.corrected ?? card.evidence;
  const holdout = card.holdout;
  const tiers = (card.five_year && card.five_year.tiers) || [];
  return `<section style="margin-top:40px;border-top:1px solid var(--border);padding-top:32px">
    <header style="margin-bottom:16px"><h2 class="font-display" style="margin:0;font-size:24px">Catatan metode yang dikirim malam ini</h2>
      <p class="fine dim" style="margin-top:4px;max-width:74ch;font-size:13px">Angka di bawah bukan simulasi layar ini. Mereka keluar dari studi walk-forward dengan biaya di dalam tiap order; <a href="method.html" style="text-decoration:underline">halaman metode lengkap</a> menyimpan sitasi file-per-barisnya.</p></header>
    <div class="grid cols4">
      ${stat("Menang (dikoreksi)", pct(e.win_rate, 1))}
      ${stat("Per transaksi", fmtPct(e.avg_ret_pct))}
      ${stat("Transaksi OOS", e.oos_trades != null ? fmtNum(e.oos_trades, 0) : "—")}
      ${stat("Holdout", holdout ? (holdout.winners_surviving ?? 0) + "/" + (holdout.winners_tested ?? 0) : "—")}
    </div>
    ${tiers.length ? `<div class="card scrollx" style="margin-top:16px"><table class="tbl">
      <thead><tr><th>Tier</th><th class="num">Buku (${esc(card.five_year.window ?? "replay")})</th><th class="num">Menang</th><th class="num">Max DD buku</th><th class="num">Transaksi</th></tr></thead>
      <tbody class="mono" style="font-size:11px">${tiers.map((t) => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 12px">${esc(t.tier)}</td>
        <td class="num tabular"><span style="color:${(t.book_total_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)"}">${fmtPct(t.book_total_pct)}</span></td>
        <td class="num tabular">${pct(t.win_rate, 1)}</td>
        <td class="num tabular" style="color:var(--down)">${t.book_max_drawdown_pct == null ? "—" : `−${Math.abs(t.book_max_drawdown_pct).toFixed(1)}%`}</td>
        <td class="num tabular" style="color:var(--text-dim)">${t.trades != null ? fmtNum(t.trades, 0) : "—"}</td></tr>`).join("")}
      </tbody></table></div>` : ""}
    <p class="fine" style="margin-top:12px;max-width:80ch;font-size:12px">Perlu dibaca sebelum order pertama: replay lima tahun adalah satu jendela dengan universe terkunci di akhir periode (survivorship utuh), jadi tidak sebanding dengan walk-forward. Yang paling menggoda di atas kertas justru pemegang catatan terburuk di buku — <a href="method.html" style="text-decoration:underline">baca tafsirannya</a>.</p>
  </section>`;
}

function formHtml() {
  return `<section class="card" style="margin-bottom:24px;padding:16px">
    <div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px">
      <label style="display:flex;flex-direction:column;gap:4px">
        <span class="mono" style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-ghost)">Target</span>
        <input type="text" id="bt-ticker" value="${esc(state.typed)}" aria-label="Kode saham atau indeks" style="width:180px" /></label>
      <div style="display:flex;gap:4px">${PERIODS.map(([v, l]) => `<button type="button" class="preset" data-bt-period="${v}" aria-pressed="${state.period === v}">${esc(l)}</button>`).join("")}</div>
      <div style="display:flex;gap:4px">${PRESETS.map((p) => `<button type="button" class="preset" data-bt-preset="${esc(p)}" aria-pressed="${state.ticker === p}">${p === "^JKSE" ? "IHSG" : esc(p)}</button>`).join("")}</div>
      <button type="button" class="btn" id="bt-run">Jalankan</button>
    </div>
    <div id="bt-meta" class="mono" style="margin-top:12px;font-size:10px;color:var(--text-ghost)"></div>
  </section>`;
}

function wireForm(root) {
  const input = root.querySelector("#bt-ticker");
  if (input) {
    input.addEventListener("input", (ev) => { state.typed = ev.target.value; });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void run(root); });
  }
  root.querySelectorAll("[data-bt-period]").forEach((b) =>
    b.addEventListener("click", () => {
      state.period = b.getAttribute("data-bt-period");
      wireFormPaint(root);
      void fetchCompare(root);
    }),
  );
  root.querySelectorAll("[data-bt-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const code = b.getAttribute("data-bt-preset");
      state.ticker = code;
      state.typed = code;
      const inp = root.querySelector("#bt-ticker");
      if (inp) inp.value = code;
      wireFormPaint(root);
      void fetchCompare(root);
    }),
  );
  const runBtn = root.querySelector("#bt-run");
  if (runBtn) runBtn.addEventListener("click", () => void run(root));
}

function wireFormPaint(root) {
  root.querySelectorAll("[data-bt-period]").forEach((b) =>
    b.setAttribute("aria-pressed", b.getAttribute("data-bt-period") === state.period ? "true" : "false"));
  root.querySelectorAll("[data-bt-preset]").forEach((b) =>
    b.setAttribute("aria-pressed", b.getAttribute("data-bt-preset") === state.ticker ? "true" : "false"));
}

function run(root) {
  const code = (state.typed.trim().toUpperCase() || "^JKSE");
  state.ticker = code;
  state.typed = code;
  const inp = root.querySelector("#bt-ticker");
  if (inp) inp.value = code;
  wireFormPaint(root);
  void fetchCompare(root);
}

let compareSeq = 0;

async function fetchCompare(root) {
  const seq = ++compareSeq;
  state.loading = true;
  state.error = null;
  state.result = null;
  paintResult(root);
  try {
    const code = encodeURIComponent(state.ticker);
    const result = await api.getCached(`/api/backtest/compare?ticker=${code}&period=${state.period}&capital=10000000`, { ttl: 600_000 });
    if (seq !== compareSeq) return;
    state.result = result;
  } catch (e) {
    if (seq !== compareSeq) return;
    state.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === compareSeq) {
      state.loading = false;
      paintResult(root);
    }
  }
}

function paintMeta(root) {
  const meta = root.querySelector("#bt-meta");
  const r = state.result;
  if (!meta) return;
  const window = resultWindow(r);
  const windowText = window?.start && window?.end ? ` · ${esc(window.start)}–${esc(window.end)}` : "";
  setHTML(meta, r ? `Target: ${r.ticker === "^JKSE" ? "IHSG (indeks, bukan saham)" : esc(r.ticker) + " (saham)"} · ${fmtNum(r.bars, 0)} sesi${windowText} · modal ${fmtIdr(r.capital)} · ${esc(r.fees.note)} · exit ${esc(r.fees.exit_note)}${r.cache?.hit ? ` · cache ${r.cache.age_seconds} dtk` : ""}` : state.loading ? "Menjalankan simulasi…" : "");
}

function paintResult(root) {
  const host = root.querySelector("#bt-result");
  if (!host) return;
  const r = state.result;
  paintMeta(root);
  if (state.error) {
    setHTML(host, `<p class="card" style="margin-bottom:20px;border-left:3px solid var(--down);padding:16px;font-size:13px;color:var(--text-dim)">Perbandingan gagal: ${esc(state.error)}</p>`);
    return;
  }
  if (!r) {
    setHTML(host, state.loading ? `<p class="loading">Menjalankan simulasi…</p>` : "");
    return;
  }
  const hasIndexCurve = (r.hold_index?.curve?.length ?? 0) > 1;
  const baselineBasis = alphaBasis(r);
  setHTML(host, `${winnerCard(r)}
    <section style="margin-top:24px"><h2 style="margin:0 0 12px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;font-size:17px;font-weight:600;letter-spacing:-0.01em">Kurva ekuitas
      <span class="mono" style="font-size:10px;color:var(--text-ghost)">normalisasi ke 100 · ${hasIndexCurve ? "putus-putus tebal = beli-tahan IHSG" : "garis beli-tahan = target"}</span></h2>
      <div id="bt-equity"></div></section>
    <details class="fold" style="margin-top:24px"><summary style="font-size:15px;font-weight:600;color:var(--text)">Lihat semua strategi dan angka teknis</summary>
      <div class="fold-body"><section><h2 style="margin:0 0 12px;font-size:17px;font-weight:600;letter-spacing:-0.01em">Statistik per metode</h2>
      ${strategyTable(r)}${errorRows(r)}</section></div></details>
    <section class="card soft mono" style="margin-top:24px;padding:16px;font-size:11px;line-height:1.7;color:var(--text-faint)">
      <p style="margin:0"><strong style="color:var(--text)">Cara membaca.</strong> Rasio menang = pangsa transaksi yang ditutup berkeuntungan. Max drawdown diukur pada ekuitas berjalan; posisi terbuka dihitung mark-to-market. Kolom α = pengembalian metode − pengembalian beli-tahan ${esc(baselineBasis)}: angka yang menunjukkan siapa yang benar-benar unggul dan siapa yang hanya menyalin pasar. Waktu di pasar menunjukkan berapa lama strategi berdiri di dalam posisi. Simulasi bukan pembuktian: aturan tetap yang tidak dilatih pada data ini keluar dengan angka, bukan dengan janji.</p></section>
    ${state.methodCard ? methodEvidence(state.methodCard) : `<div id="bt-method"></div>`}`);
  const eq = host.querySelector("#bt-equity");
  if (eq) renderEquity(eq, r);
}

const HEADER = `<header style="margin-bottom:28px">
  <p class="eyebrow">Metode, diukur</p>
  <h1 class="font-display page-title">Uji strategi</h1>
  <p class="lede">Semua metode dijalankan pada satu target dengan model biaya yang sama (fee + slippage di setiap transaksi), lalu diadu dengan kinerja indeks. Target bawaannya IHSG itu sendiri, jadi kurva beli-tahan memang mengikuti gerak indeks — bukan hasil sebuah metode. Ketik kode saham (misal BBCA) untuk mengadu metode di saham itu. Rantai Tier 1 yang jadi hasil studi tidak diukur di halaman ini; angkanya hidup di halaman Metode.</p>
</header>`;

export async function initBacktest(root) {
  setHTML(root, `${HEADER}${formHtml()}<div id="bt-result"></div>`);
  wireForm(root);
  if (equityHandle) {
    equityHandle.dispose();
    equityHandle = null;
  }
  try {
    state.methodCard = await api.getCached("/api/plan/method", { ttl: 300_000 });
  } catch { /* evidence panel stays empty */ }
  paintResult(root);
  await fetchCompare(root);
  window.addEventListener(REFRESH_EVENT, () => void fetchCompare(root));
}
