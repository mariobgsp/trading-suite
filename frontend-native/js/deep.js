/* deep.js — halaman "Periksa saham" (deep.html?ticker=XXX).
 * Port of frontend-web/src/routes/Deep.tsx + components/deep.tsx
 * (DeepHeader, Fundamental/TechnicalVerdict, RangeBar, FeedSection,
 * TickerSearch) + the price chart (createCandleChart) + trailing-year
 * pattern table. InvestCase renders via js/invest.js.
 *
 * Scales: plan detail gates are strings; backtest pattern stats here use
 * pctRaw (percent-scale raw numbers, same as the backtest page).
 */
"use strict";

import { api } from "./api.js";
import { esc, idr, pctRaw, setHTML, fmtIdrShort } from "./format.js";
import { GATE_LABEL } from "./format.js";
import { createCandleChart } from "./chart.js";
import { flowSvg } from "./flow.js";

const PERIODS = [["3mo", "3 bln"], ["6mo", "6 bln"], ["1y", "1 thn"], ["2y", "2 thn"]];

const TONE = {
  supportive: "var(--up)",
  calibrated: "var(--up)",
  caution: "var(--gold)",
  mixed: "var(--gold)",
  against: "var(--down)",
  weak: "var(--down)",
  unknown: "var(--text-ghost)",
};

const STATE_LABEL = {
  supportive: "mendukung",
  calibrated: "mendukung",
  caution: "hati-hati",
  mixed: "campuran",
  against: "melawan",
  weak: "lemah",
  unknown: "belum terukur",
};

function changeBadge(value) {
  if (value == null || Number.isNaN(value)) return `<span class="mono" style="font-size:12px;color:var(--text-ghost)">—</span>`;
  const up = value >= 0;
  const sign = up ? "+" : "";
  return `<span class="change" style="color:${up ? "var(--up)" : "var(--down)"};border-color:${up ? "var(--up)" : "var(--down)"};background:${up ? "var(--up-dim)" : "var(--down-dim)"}">
    <span style="font-size:9px" aria-hidden>${up ? "▲" : "▼"}</span>${sign}${value.toFixed(2)}%</span>`;
}

function tickerSearch() {
  return `<form class="searchwrap" method="get" action="deep.html" data-search-form>
    <input type="search" name="ticker" id="deep-q" placeholder="Cari kode saham — BBCA, TLKM, …" aria-label="Cari saham" style="width:100%;border-color:var(--border-strong);font-size:13px" autocomplete="off" />
    <ul class="searchdrop" id="deep-drop" hidden></ul>
  </form>`;
}

function wireSearch(root, ranked) {
  const q = root.querySelector("#deep-q");
  const drop = root.querySelector("#deep-drop");
  if (!q || !drop) return;
  // Native GET form: Enter submits ?ticker=XXX with no JS navigation at all.
  // The dropdown offers plain anchors; filtering only rewrites the list.
  q.addEventListener("input", () => {
    const needle = q.value.trim().toUpperCase();
    if (!needle) {
      drop.hidden = true;
      setHTML(drop, "");
      return;
    }
    const matches = (ranked ?? [])
      .filter((r) => r.ticker.includes(needle))
      .sort((a, b) => a.ticker.length - b.ticker.length || b.rs_rating - a.rs_rating)
      .slice(0, 8);
    if (!matches.length) {
      drop.hidden = true;
      return;
    }
    drop.hidden = false;
    setHTML(drop, matches.map((r) => `<li><a href="deep.html?ticker=${esc(r.ticker)}" style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:6px 12px;text-decoration:none">
      <span style="font-weight:600;color:var(--text)">${esc(r.ticker)}</span>
      <span style="display:flex;gap:12px;color:var(--text-faint)"><span class="tabular">${idr(r.close)}</span><span>RS ${esc(r.rs_rating)}</span></span>
    </a></li>`).join(""));
  });
}

function deepHeader(code, profile, detail) {
  const hasQuote = profile?.quote_live === true && profile?.price != null;
  const price = hasQuote ? profile.price : detail?.close ?? profile?.price ?? null;
  const change = hasQuote ? profile?.change_percent ?? null : null;
  const priceLabel = hasQuote ? "kuotasi terkini" : detail?.as_of ? `tutup ${detail.as_of}` : "harga tersedia";
  const chips = [
    profile?.sector ? "Sektor: " + profile.sector : null,
    profile?.industry ? "Industri: " + profile.industry : null,
    profile?.market_cap != null ? "Kap. pasar " + fmtIdrShort(profile.market_cap) : null,
    detail?.as_of ? "Data harian " + detail.as_of : null,
  ].filter(Boolean);
  return `<header style="border-bottom:1px solid var(--border);padding-bottom:24px">
    <div style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 20px">
      <h1 class="font-display" style="font-size:44px;line-height:1;letter-spacing:-0.02em;margin:0">${esc(code)}</h1>
      ${profile?.name ? `<span class="mono" style="max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-faint)">${esc(profile.name)}</span>` : ""}
      <div style="margin-left:auto;min-width:0;text-align:right">
        <span class="mono" style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-ghost)">${esc(priceLabel)}</span>
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:8px;margin-top:2px">
          <span class="tabular font-display" style="font-size:24px;color:var(--text)">${price != null ? idr(price) : "—"}</span>
          ${change != null ? changeBadge(change) : ""}
        </div>
      </div>
    </div>
    <div class="mono" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10px;color:var(--text-ghost)">
      ${chips.map((c) => `<span style="border:1px solid var(--border);background:var(--panel-2);padding:2px 8px">${esc(c)}</span>`).join("")}
      ${!profile ? `<span>membaca identitas…</span>` : ""}
    </div></header>`;
}

function verdictFrame(title, verdictText, tone, body) {
  return `<article class="card" style="min-width:0;display:flex;flex-direction:column">
    <header style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding:10px 16px">
      <h3 class="mono" style="margin:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-faint)">${esc(title)}</h3>
      <span class="change" style="color:${tone};border-color:${tone};font-size:10px">${esc(verdictText)}</span>
    </header>${body}</article>`;
}

function criteriaList(criteria) {
  if (!criteria.length) {
    return `<p class="mono card soft" style="margin:12px;padding:12px;font-size:11px;color:var(--text-faint)">Tidak ada pengukuran yang kembali dari sumber data.</p>`;
  }
  return `<ul style="list-style:none;margin:12px;padding:0;display:flex;flex-direction:column;gap:4px">
    ${criteria.map((c) => `<li title="${esc(c.detail)}" style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-left:2px solid ${TONE[c.state] ?? "var(--text-ghost)"};background:var(--panel-2);padding:6px 8px">
      <span class="mono" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">${esc(c.label)}</span>
      <span class="tabular mono" style="flex-shrink:0;font-size:11px;color:${TONE[c.state] ?? "var(--text-dim)"}">${esc(c.display)}</span></li>`).join("")}
  </ul>`;
}

function ownershipStrip(s) {
  return `<div class="mono" style="margin:0 12px 12px;border-top:1px solid var(--border);padding-top:8px;font-size:10px;line-height:1.7;color:var(--text-faint)">
    <span style="color:var(--text-ghost)">Struktur saham: </span>${fmtIdrShort(s.shares_outstanding)} lembar
    ${s.public_pct != null ? ` · float publik ${s.public_pct.toFixed(1)}%` : ""}
    ${s.owner_pct != null ? ` · pengendali ${s.owner_pct.toFixed(1)}%` : ""}
    ${s.trend !== "unknown" && s.delta_pp != null ? ` · tren kepemilikan ${esc(s.trend)} (${(s.delta_pp >= 0 ? "+" : "")}${s.delta_pp.toFixed(2)}pp antara ${esc(s.from_date ?? "—")} → ${esc(s.to_date ?? "—")})` : ""}
  </div>`;
}

function fundamentalVerdict(report) {
  const pillar = report?.fundamental ?? null;
  if (!report || !pillar) {
    return verdictFrame("Kasus fundamental", "membaca…", TONE.unknown,
      `<p class="mono" style="margin:0;padding:12px;font-size:12px;color:var(--text-faint)">Kas investasi sedang dirakit (profil, kepemilikan, pengungkapan).</p>`);
  }
  const v = pillar.verdict;
  const sentence = v.measured < 3 ? "Terlalu sedikit yang terukur untuk bilang apa-apa"
    : v.state === "supportive" ? `${v.supportive} kriteria mendukung, tidak ada yang melawan`
    : v.state === "weak" ? `${v.against} kriteria melawan — kasus lemah menurut pita yang tertulis`
    : v.state === "mixed" ? `bauran: ${v.supportive} mendukung, ${v.against} melawan` : "belum terukur";
  return verdictFrame("Kasus fundamental", STATE_LABEL[v.state] ?? v.state, TONE[v.state] ?? TONE.unknown,
    `<p class="mono" style="margin:0;padding:4px 16px 4px;font-size:11px;color:var(--text-faint)">${esc(sentence)} · ${v.measured}/${v.total} kriteria terukur</p>
    ${criteriaList(pillar.criteria)}
    ${pillar.warnings.length ? `<ul class="mono" style="list-style:none;margin:0 12px 12px;padding:8px 0 0;border-top:1px solid var(--border);font-size:10px;line-height:1.7;color:var(--text-ghost)">${pillar.warnings.map((w) => `<li>· ${esc(w)}</li>`).join("")}</ul>` : ""}
    ${report.ownership?.available ? ownershipStrip(report.ownership) : ""}`);
}

function gateMiniList(gates, required) {
  const applies = required ? new Set(required) : null;
  return `<ul style="list-style:none;margin:12px;padding:0;display:flex;flex-direction:column;gap:4px">
    ${gates.map((g) => {
      const need = applies ? applies.has(g.key) : true;
      return `<li style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding-bottom:4px;${need ? "" : "opacity:0.55"}">
        <span style="display:flex;min-width:0;align-items:baseline;gap:8px">
          <span class="mono" style="font-size:11px;color:${g.passed ? "var(--up)" : "var(--text-ghost)"}">${g.passed ? "✓" : need ? "✕" : "–"}</span>
          <span class="mono" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text-dim)">${esc(g.label || GATE_LABEL[g.key] || g.key)}</span></span>
        <span class="mono" style="flex-shrink:0;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font-size:10px;color:var(--text-ghost)">${esc(g.text)}</span></li>`;
    }).join("")}</ul>`;
}

function technicalVerdict(detail, requiredGates, technicalCriteria) {
  if (!detail) {
    return verdictFrame("Kondisi teknikal metode", "membaca…", TONE.unknown,
      `<p class="mono" style="margin:0;padding:12px;font-size:12px;color:var(--text-faint)">Rantai kondisi diukur pada bar terakhir yang utuh.</p>`);
  }
  const passed = detail.gates.filter((g) => g.passed).length;
  const applies = requiredGates ? new Set(requiredGates) : null;
  const failingRequired = detail.gates.filter((g) => !g.passed && (!applies || applies.has(g.key))).length;
  const passingMost = detail.gates.length > 0 && detail.gates.filter((g) => !g.passed).length <= Math.floor(detail.gates.length / 2);
  const st = detail.in_plan ? "supportive" : failingRequired > 0 ? (passingMost ? "caution" : "against") : "caution";
  const tone = st === "supportive" ? "var(--up)" : st === "caution" ? "var(--gold)" : "var(--down)";
  const distance = detail.distance_text === "Not close to firing yet." ? "Belum dekat dengan pemicu." : detail.distance_text;
  return verdictFrame("Kondisi teknikal metode", detail.in_plan ? "bisa dibeli" : "belum lolos", tone,
    `<p class="mono" style="margin:0;padding:4px 16px 4px;font-size:11px;color:var(--text-faint)">${passed}/${detail.gates.length} kondisi metode terpenuhi${detail.in_plan ? " — rantai penuh terbuka pada sesi ini" : " — " + esc(distance ?? failingRequired + " kondisi belum lolos")}</p>
    ${technicalCriteria.length ? `<div style="margin:0 12px 8px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--border);padding-bottom:8px">
      ${technicalCriteria.map((c) => `<span title="${esc(c.detail)}" class="mono" style="border:1px solid var(--border);background:var(--panel-2);padding:2px 6px;font-size:10px;color:${TONE[c.state] ?? "var(--text-dim)"}">${esc(c.label)} ${esc(c.display)}</span>`).join("")}</div>` : ""}
    ${detail.gates.length ? gateMiniList(detail.gates, requiredGates)
      : `<p class="mono" style="margin:0 12px 12px;font-size:12px;color:var(--text-faint)">Riwayat terlalu pendek untuk mengukur rantai metode terhadap saham ini.</p>`}
    ${detail.in_plan && detail.geometry ? `<div class="card soft" style="margin:0 12px 12px;padding:12px">
      <p class="eyebrow" style="font-size:9px">Geometri perdagangan (tetap milik metode, bukan panel ini)</p>
      <div class="mono" style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:12px">
        <span><span style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">Entry</span>${idr(detail.geometry.entry_ref)}</span>
        <span style="color:var(--up)"><span style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">Target</span>${idr(detail.geometry.target_price)}</span>
        <span style="color:var(--down)"><span style="display:block;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">Stop</span>${idr(detail.geometry.stop_price)}</span>
      </div>
      <p class="mono" style="margin:8px 0 0;border-top:1px solid var(--border);padding-top:8px;font-size:10px;color:var(--text-ghost)">Tiket penuh (ukuran, biaya) ada di layar Plan untuk nama yang termasuk dalam rencana malam ini.</p>
    </div>` : ""}`);
}

function rangeBar(high, low, price, asOf) {
  if (high == null || low == null || price == null || high <= low) return "";
  const pctPos = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
  const position = `${pctPos.toFixed(0)}% dari rentang`;
  return `<div class="card" role="img" aria-label="Rentang 52 minggu ${idr(low)} sampai ${idr(high)}; harga ${idr(price)} berada di ${position}" style="padding:16px">
    <div class="mono" style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-ghost)">
      <span>Rentang 52 minggu${asOf ? ` · sampai ${esc(asOf)}` : ""}</span><span class="tabular">${idr(low)} — ${idr(high)}</span></div>
    <div style="position:relative;margin-top:8px;height:8px;border-radius:999px;background:var(--panel-3)">
      <div style="position:absolute;top:0;bottom:0;left:0;border-radius:999px;width:${pctPos}%;background:var(--border-strong)"></div>
      <div style="position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--text);left:calc(${pctPos}% - 1px)"></div></div>
    <div class="mono" style="margin-top:4px;display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--text-dim)"><span>${position}</span><span>tutup ${idr(price)}</span></div>
  </div>`;
}

function feedSection(title, items, warnWhenEmpty) {
  return `<div class="card" style="padding:0">
    <div class="mono" style="padding:12px 12px 4px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-ghost)">${esc(title)}</div>
    ${warnWhenEmpty && items.length === 0 ? `<p class="mono" style="margin:0;padding:12px;font-size:10px;color:var(--text-faint)">${esc(warnWhenEmpty)} — tidak ada item hari ini; panel tidak mengarang.</p>`
      : `<ul style="list-style:none;margin:0;padding:0">${items.slice(0, 5).map((item) => {
        const inner = `<div style="padding:6px 12px"><p style="margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:1.4;color:var(--text-dim)">${esc(item.title)}</p>
          <p class="mono" style="margin:2px 0 0;font-size:9px;color:var(--text-ghost)">${[item.note, item.date].filter(Boolean).map(esc).join(" · ")}</p></div>`;
        return `<li style="border-bottom:1px solid var(--border)">${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noreferrer" style="display:block;text-decoration:none">${inner}</a>` : inner}</li>`;
      }).join("")}</ul>`}
  </div>`;
}

function patternTable(patterns) {
  const rows = Object.entries(patterns.strategies);
  return `<div class="card scrollx"><table class="tbl" style="min-width:640px">
    <thead><tr><th>Metode</th><th class="num">Total</th><th class="num">Max DD</th><th class="num">Win rate</th><th class="num">Order</th><th class="num" style="text-align:right">Waktu di pasar</th></tr></thead>
    <tbody class="mono" style="font-size:11px">
      ${rows.map(([, run]) => {
        const st = run.stats;
        const failed = run.error || !st || st.total_return_pct == null;
        return `<tr style="border-top:1px solid var(--border)">
          <td style="color:var(--text)">${esc(run.label)}</td>
          ${failed ? `<td colspan="5" style="text-align:right;color:var(--text-ghost)">${esc(run.error ?? "tidak cukup data")}</td>`
            : `<td class="num tabular" style="color:${(st.total_return_pct ?? 0) >= 0 ? "var(--up)" : "var(--down)"}">${pctRaw(st.total_return_pct, 2)}</td>
              <td class="num tabular" style="color:var(--text-faint)">${pctRaw(st.max_drawdown_pct, 1)}</td>
              <td class="num tabular" style="color:var(--text-dim)">${pctRaw(st.win_rate, 0)}</td>
              <td class="num tabular" style="color:var(--text-dim)">${st.total_trades ?? "—"}</td>
              <td class="num tabular" style="text-align:right;color:var(--text-dim)">${st.time_in_market_pct != null ? pctRaw(st.time_in_market_pct, 0) : "—"}</td>`}
        </tr>`;
      }).join("")}
    </tbody></table></div>
  <p class="mono" style="margin-top:8px;font-size:10px;line-height:1.7;color:var(--text-ghost)">Simulasi, bukan janji: aturan tetap dijalankan pada satu tahun terakhir ini dengan biaya nyata (${esc(patterns.fee_note)}). Indikatornya membaca tiga tahun bar, jadi jendela tidak menghitung rata-rata dari nol; rujukan beli-tahan pada jendela yang sama ikut di statistik tiap baris.</p>`;
}

let candleHandle = null;

export async function initDeep(root) {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get("ticker") ?? "").toUpperCase();

  if (candleHandle) {
    candleHandle.dispose();
    candleHandle = null;
  }

  if (!code) {
    let plan = null;
    try {
      plan = await api.getCached("/api/plan", { ttl: 300_000 });
    } catch { /* index renders without it */ }
    const ranked = plan?.ranked ?? [];
    const near = ranked.filter((r) => !r.waiting_on_market && r.gates_passed >= r.gates_total - 1).slice(0, 12);
    setHTML(root, `<header style="margin-bottom:32px;max-width:80ch">
      <p class="eyebrow">One stock, two questions</p>
      <h1 class="font-display page-title">Periksa saham</h1>
      <p class="lede">Pilih satu saham. Halaman ini mengukurnya dua kali: kasus fundamental terhadap pita yang tertulis, dan chain teknikal metode terhadap tape. Chart, struktur kepemilikan, pengungkapan KI, berita, dan proksi arus dana melengkapinya.</p></header>
      <div style="max-width:520px">${tickerSearch()}</div>
      ${near.length ? `<section style="margin-top:32px"><h2 class="mono" style="margin-bottom:12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-faint)">Menarik hari ini — satu kondisi dari lolos</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${near.map((r) => `<a href="deep.html?ticker=${esc(r.ticker)}" class="mono" style="border:1px solid var(--border);background:var(--panel);padding:8px 12px;font-size:12px;color:var(--text);text-decoration:none">${esc(r.ticker)}<span style="margin-left:8px;font-size:10px;color:var(--text-ghost)">${r.gates_passed}/${r.gates_total} · RS ${esc(r.rs_rating)}</span></a>`).join("")}</div></section>` : ""}`);
    wireSearch(root, ranked);
    return;
  }

  setHTML(root, `<nav class="mono" style="margin-bottom:24px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px;font-size:11px;color:var(--text-ghost)">
      <div style="display:flex;align-items:baseline;gap:12px"><a href="index.html" style="color:inherit;text-decoration:none">← pasar</a>
      <span style="max-width:280px">${tickerSearch()}</span></div>
      <span>Periksa saham · data riset, bukan saran</span></nav>
    <div id="deep-body"><p class="loading">Membaca ${esc(code)}…</p></div>`);
  wireSearch(root, []);

  const body = root.querySelector("#deep-body");
  const results = await Promise.allSettled([
    api.getCached("/api/plan", { ttl: 300_000 }),
    api.getCached(`/api/plan/${code}`, { ttl: 300_000 }),
    api.getCached(`/api/market/profile/${code}`, { ttl: 120_000 }),
    api.getCached(`/api/case/${code}`, { ttl: 900_000 }),
    api.getCached(`/api/flow/${code}?days=120`, { ttl: 120_000 }),
    api.getCached(`/api/analysis/backtest/${code}`, { ttl: 600_000 }),
  ]);
  const [planR, detailR, profileR, caseR, flowR, patternsR] = results;
  const plan = planR.status === "fulfilled" ? planR.value : null;
  const detail = detailR.status === "fulfilled" ? detailR.value : null;
  const detailError = detailR.status === "rejected" ? String(detailR.reason?.message ?? detailR.reason) : null;
  const profile = profileR.status === "fulfilled" ? profileR.value : null;
  const caseReport = caseR.status === "fulfilled" ? caseR.value : null;
  const flow = flowR.status === "fulfilled" ? flowR.value : null;
  const patterns = patternsR.status === "fulfilled" ? patternsR.value : null;
  const patternsError = patternsR.status === "rejected" ? String(patternsR.reason?.message ?? patternsR.reason) : null;

  const unknown = profile?.found === false && (detail?.gates ?? []).length === 0 && detailError != null;
  if (unknown) {
    setHTML(body, `<div class="card" style="padding:40px">
      <h1 class="font-display" style="font-size:30px;margin:0">${esc(code)} tidak dikenali</h1>
      <p class="fine dim" style="margin-top:8px;max-width:60ch;font-size:13px">Tidak ada profil, riwayat, atau chain metode untuk kode ini. Cari kode saham lain di kotak di atas — halaman tidak mengarang data untuk kode yang tak dikenal.</p></div>`);
    wireSearch(root, plan?.ranked ?? []);
    return;
  }

  const lines = [];
  if (detail?.breakout_level != null) lines.push({ price: detail.breakout_level, title: "Level breakout", style: "dashed" });
  if (detail?.in_plan && detail.geometry) {
    lines.push({ price: detail.geometry.target_price, title: "Target" });
    lines.push({ price: detail.geometry.stop_price, title: "Stop" });
  }

  setHTML(body, `
    ${deepHeader(code, profile, detail)}
    <section class="grid half" style="margin-top:32px;align-items:start">
      ${fundamentalVerdict(caseReport)}
      ${technicalVerdict(detail, plan?.required_gates, caseReport?.technical?.criteria ?? [])}
    </section>
    <p class="card soft mono" style="margin-top:12px;padding:8px 16px;font-size:11px;line-height:1.7;color:var(--text-faint)">Halaman ini menjawab tiga hal secara terpisah: bagaimana bisnis sahamnya (panel kiri), apakah waktunya tepat menurut aturan (panel kanan), dan di mana target serta batas ruginya bila sudah masuk rencana (pada grafik). Dua penilaian itu tidak digabung jadi satu skor — gabungan itu merdu tapi bohong.</p>
    <section style="margin-top:32px">
      <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px">
        <h2 style="margin:0;font-size:17px;font-weight:600;letter-spacing:-0.01em">Perjalanan harga</h2>
        <div style="display:flex;gap:4px" id="deep-periods">${PERIODS.map(([value, label]) => `<button type="button" class="preset" data-period="${value}" aria-pressed="${value === "1y"}">${label}</button>`).join("")}</div>
      </div>
      <div class="card" style="padding:8px"><div id="deep-chart"><p class="mono" style="margin:0;padding:40px;text-align:center;font-size:12px;color:var(--text-faint)">Memuat lilin…</p></div></div>
      <p class="mono" style="margin-top:8px;font-size:10px;line-height:1.7;color:var(--text-ghost)">Garis putus-putus: level breakout yang harus dilampaui metode. Garis tebal: target dan stop yang meminta trade melipir ke sana.</p>
    </section>
    <section style="margin-top:32px">
      <h2 style="margin:0 0 12px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;font-size:15px;font-weight:600;letter-spacing:-0.01em">Uji aturan satu tahun terakhir
        <span class="mono" id="deep-patbars" style="font-size:10px;font-weight:400;color:var(--text-ghost)">aturan tetap · — bar disimulasikan</span></h2>
      <div id="deep-patterns"><p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Menjalankan simulasi…</p></div>
    </section>
    <section class="grid" style="margin-top:32px;gap:16px" data-deep-rail>
      <div style="min-width:0">
        <h2 style="margin:0 0 12px;font-size:15px;font-weight:600" title="Proksi transparan atas tekanan dana masuk-keluar; bukan rumah produksi vendor, bukan bagian dari plan">Proksi arus dana (riset)</h2>
        <div id="deep-flow"></div>
      </div>
      <div class="grid" style="gap:16px" id="deep-feeds"></div>
    </section>`);
  const rail = body.querySelector("[data-deep-rail]");
  if (rail && window.matchMedia("(min-width: 1024px)").matches) {
    rail.style.gridTemplateColumns = "1.2fr 1fr";
  }
  wireSearch(root, plan?.ranked ?? []);

  /* chart (period-switchable) */
  const chartHost = body.querySelector("#deep-chart");
  let chartSeq = 0;
  const loadHistory = async (period) => {
    const seq = ++chartSeq;
    if (candleHandle) {
      candleHandle.dispose();
      candleHandle = null;
    }
    if (chartHost) setHTML(chartHost, `<p class="mono" style="margin:0;padding:40px;text-align:center;font-size:12px;color:var(--text-faint)">Memuat lilin…</p>`);
    try {
      const h = await api.getCached(`/api/market/history/${code}?period=${period}`, { ttl: 120_000 });
      if (seq !== chartSeq) return;
      const bars = h.history ?? [];
      if (!bars.length) {
        if (chartHost) setHTML(chartHost, `<p class="mono" style="margin:0;padding:40px;text-align:center;font-size:12px;color:var(--text-faint)">Riwayat harga tidak tersedia untuk ${esc(code)}.</p>`);
        return;
      }
      if (chartHost) {
        setHTML(chartHost, "");
        candleHandle = createCandleChart(chartHost, bars, {
          height: 380,
          showVolume: true,
          indicators: h.indicators,
          indicatorDates: h.indicators?.date,
          overlays: ["sma20", "sma50"],
          priceLines: lines,
          annotations: detail?.reason?.breakout_date ? [{ date: detail.reason.breakout_date, label: "breakout", kind: "breakout" }] : [],
        });
      }
    } catch (e) {
      if (seq === chartSeq && chartHost) setHTML(chartHost, `<p class="mono" style="margin:0;padding:24px;font-size:12px;color:var(--text-faint)">Riwayat harga tidak tersedia untuk ${esc(code)} (${esc(e instanceof Error ? e.message : String(e))}).</p>`);
    }
  };
  body.querySelectorAll("#deep-periods [data-period]").forEach((b) =>
    b.addEventListener("click", () => {
      body.querySelectorAll("#deep-periods [data-period]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      void loadHistory(b.getAttribute("data-period"));
    }),
  );
  void loadHistory("1y");

  /* patterns */
  const patHost = body.querySelector("#deep-patterns");
  const patBars = body.querySelector("#deep-patbars");
  if (patBars) patBars.textContent = `aturan tetap · ${patterns?.bars ?? "—"} bar disimulasikan`;
  if (patHost) {
    if (patternsError) setHTML(patHost, `<p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Backtest ${esc(code)} tidak tersedia (${esc(patternsError)}).</p>`);
    else if (!patterns) setHTML(patHost, `<p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Menjalankan simulasi…</p>`);
    else if (!patterns.available) setHTML(patHost, `<p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Riwayat ${esc(code)} terlalu pendek untuk disimulasikan.</p>`);
    else setHTML(patHost, patternTable(patterns, code));
  }

  /* flow + feeds rail */
  const flowHost = body.querySelector("#deep-flow");
  if (flowHost) {
    if (flow) {
      setHTML(flowHost, `<div class="card" style="padding:16px">
        <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px">
          <div><span class="eyebrow">Tekanan arus dana (proksi)</span>
            <p class="fine" style="margin-top:4px;max-width:68ch;font-size:12px">Skor tanpa dimensi dalam [-1, 1] dari Chaikin Money Flow dan, bila tersedia, arus asing IDX. Ini bukan LPM vendor. Arah adalah perubahan lima sesi; bar di bawah menunjukkan intensitas volume.</p></div>
          <span class="mono" style="font-size:10px;color:var(--text-ghost)">${esc(flow.source.flow)}</span>
        </div>
        ${flowSvg(flow)}
        ${flow.warnings.length ? `<ul class="mono" style="list-style:none;margin:8px 0 0;padding:0;font-size:10px;color:var(--text-ghost)">${flow.warnings.map((w) => `<li>· ${esc(w)}</li>`).join("")}</ul>` : ""}
      </div>`);
    } else {
      setHTML(flowHost, `<p class="card mono" style="padding:16px;font-size:12px;color:var(--text-faint)">Seri proksi tidak tersedia untuk ${esc(code)} — panel ini tidak mengarang data.</p>`);
    }
  }
  const feedsHost = body.querySelector("#deep-feeds");
  if (feedsHost) {
    setHTML(feedsHost, `
      <div id="deep-range"></div>
      ${feedSection("Pengungkapan KI (IDX)", (caseReport?.disclosures.items ?? []).map((i) => ({ title: i.title, date: i.date, note: i.category, link: i.link })), caseReport?.disclosures.available ? null : (caseReport?.disclosures.warnings[0] ?? "sumber KI tidak menjawab"))}
      ${feedSection("Berita saham ini", (caseReport?.news.items ?? []).map((i) => ({ title: i.title, date: i.date_str, note: i.source, link: i.link })), caseReport?.news.available ? null : (caseReport?.news.warnings[0] ?? "sumber berita tidak menjawab"))}`);
    try {
      const h = await api.getCached(`/api/market/history/${code}?period=1y`, { ttl: 120_000 }).catch(() => null);
      const bars = (h?.history ?? []).slice(-252);
      const rh = body.querySelector("#deep-range");
      if (rh && bars.length) {
        const hi = Math.max(...bars.map((b) => b.high));
        const lo = Math.min(...bars.map((b) => b.low));
        const last = bars[bars.length - 1];
        setHTML(rh, rangeBar(hi, lo, last.close ?? detail?.close, last.date ?? detail?.as_of));
      }
    } catch { /* range bar stays empty */ }
  }
}
