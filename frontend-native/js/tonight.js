/* tonight.js — halaman "Hari ini" (/).
 * Port of frontend-web/src/routes/Tonight.tsx + the pieces it composes:
 * AlertBook, VerdictHero, StandDownPanel, IntegrityList, EvidenceBadge,
 * CorrectedEvidenceCard, WatchRow, CapitulationWatch, RegimeDriftStrip,
 * LimitsPanel. Structure and copy are identical; only the renderer changed
 * (string templates instead of JSX).
 *
 * Units (from the live payloads — keep in sync with format.js):
 * win_rate/breadth are FRACTIONS (0.79 -> "79.5%"); avg_ret_pct, ret5,
 * dist_200_pct, atr14_pct, round_trip are PERCENT numbers (4.16 -> "+4.16%").
 */
"use strict";

import { api } from "./api.js";
import { esc, fmtPct, idr, pct, pctRaw, GATE_LABEL, setHTML } from "./format.js";
import { bandCopy, verdictCopy } from "./present.js";
import { REFRESH_EVENT } from "./refresh.js";

/* ── small atoms ─────────────────────────────────────────────────── */

export function section({ id, title, subtitle, right, body }) {
  return `
  <section class="block"${id ? ` id="${esc(id)}"` : ""}>
    <div class="sec-head">
      <h2 class="sec-title">${esc(title)}</h2>
      ${right ? `<span class="sec-right">${esc(right)}</span>` : ""}
    </div>
    ${subtitle ? `<p class="sec-sub">${esc(subtitle)}</p>` : ""}
    ${body}
  </section>`;
}

export function tierTag(role) {
  const label =
    role === "walk_forward_corrected"
      ? "corrected walk-forward"
      : role === "replay"
        ? "one-window replay"
        : "searched — best of many";
  const color = role === "walk_forward_corrected" ? "var(--up)" : "var(--gold)";
  return `<span class="badge" style="color:${color};border-color:color-mix(in srgb, currentColor 30%, transparent)">${esc(label)}</span>`;
}

export function provenanceList(citations) {
  if (!citations || !citations.length) return "";
  return `<ol class="rows" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;list-style:none">
    ${citations
      .map(
        (c) => `<li style="font-size:11px;line-height:1.6;color:var(--text-faint);padding:0 0 6px">
          <span class="mono" style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-ghost)">${esc(c.doc)}:${esc(c.line)}</span>
          <span style="color:var(--text-dim)">&ldquo;${esc(c.quote)}&rdquo;</span>
        </li>`,
      )
      .join("")}
  </ol>`;
}

/* ── verdict ─────────────────────────────────────────────────────── */

function integrityList(checks) {
  if (!checks || !checks.length) return "";
  return `<ul class="check" style="list-style:none;margin:16px 0 0;padding:12px 0 0;border-top:1px solid var(--border)">
    ${checks
      .map(
        (c) => `<li>
          <span class="mono" style="margin-top:3px;font-size:11px;color:${c.ok ? "var(--up)" : "var(--down)"}" aria-hidden>${c.ok ? "✓" : "✕"}</span>
          <span style="color:${c.ok ? "var(--text-faint)" : "var(--text-dim)"}">
            <span style="color:var(--text)">${esc(c.label)}</span> — ${esc(c.detail)}
          </span>
        </li>`,
      )
      .join("")}
  </ul>`;
}

function standDownPanel(verdict) {
  const c = verdict.stand_down_case;
  if (!c) return "";
  const side = c.sideways;
  const book = c.book;
  return `<div class="card soft pad">
    <p class="eyebrow">Kenapa menunggu adalah hasilnya</p>
    ${
      side && side.win_rate != null && side.avg_ret_pct != null
        ? `<p class="fine dim" style="margin-top:8px">Studi menjalankan aturan yang sama di pita menyamping:
           <span style="color:var(--text)">${pct(side.win_rate, 1)} menang</span> dengan
           <span style="color:var(--text)">${fmtPct(side.avg_ret_pct)}</span> per transaksi. Pita itu
           bergerak ${fmtPct(side.drift_5s_pct)} per lima sesi, sementara satu putaran transaksi berbiaya
           ${pctRaw(c.round_trip_pct, 2)}; untuk menutup biaya, pergerakan itu harus tertangkap
           ${side.capture_needed_x ?? "—"}× pergerakan itu.</p>`
        : ""
    }
    ${
      book && book.trend_only && book.trend_only.available && book.with_sideways && book.with_sideways.available
        ? `<p class="fine dim" style="margin-top:8px">Pemindaian dan periode yang sama, ${idr(book.slots)} slot: bila pita menyamping dilewati, buku menghasilkan
           <span style="color:var(--up)">${fmtPct(book.trend_only.total_pct)}</span> dengan penurunan terdalam
           ${book.trend_only.max_drawdown_pct != null ? book.trend_only.max_drawdown_pct.toFixed(1) : "—"}%. Bila pita itu diperdagangkan,
           hasilnya <span style="color:var(--down)">${fmtPct(book.with_sideways.total_pct)}</span> dengan penurunan terdalam
           ${book.with_sideways.max_drawdown_pct != null ? book.with_sideways.max_drawdown_pct.toFixed(1) : "—"}%.</p>`
        : ""
    }
    <p class="mono rule" style="font-size:11px;color:var(--text-ghost)">
      Pita ini mencakup ${pct(c.bands && c.bands.sideways, 0)} dari
      ${c.sessions_measured != null ? idr(c.sessions_measured) : "—"} sesi terukur. Median breadth jangka panjang
      ${pct(c.long_run_median, 0)}.</p>
  </div>`;
}

export function evidenceBadge(evidence, roundTripPct) {
  const ok = evidence.clears_bar;
  const roleLabel =
    evidence.role === "searched_census"
      ? "Hasil terbaik dari konfigurasi yang dicari"
      : evidence.role === "walk_forward_corrected"
        ? "Hasil walk-forward terkoreksi"
        : evidence.role === "replay"
          ? "Replay satu jendela, bukan walk-forward"
          : "Diukur pada metode ini";
  const cell = (label, value) => `
    <div>
      <div class="tabular" style="font-size:24px;font-weight:700;line-height:1;color:${ok ? "var(--up)" : "var(--text)"}">${value}</div>
      <div class="mono" style="margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint)">${esc(label)}</div>
    </div>`;
  return `<div class="card soft pad" style="width:100%">
    <p class="eyebrow">${esc(roleLabel)}</p>
    <div class="grid cols3" style="margin-top:12px">
      ${cell("menang", pct(evidence.win_rate, 1))}
      ${cell("rata-rata / transaksi", fmtPct(evidence.avg_ret_pct, 1))}
      ${cell("sampel uji", evidence.oos_trades != null ? idr(evidence.oos_trades) : "—")}
    </div>
    <p class="fine rule">
      ${
        evidence.measured
          ? `${
              roundTripPct != null
                ? `Biaya ${pctRaw(roundTripPct, 2)} per putaran transaksi sudah masuk ke setiap transaksi. `
                : "Fee dan slippage sudah masuk ke setiap transaksi terukur. "
            }<a href="method.html#holdout" style="text-decoration:underline;text-underline-offset:2px">Hasil pada data yang tidak dilihat</a>`
          : "Belum ada hasil terukur — baca aturannya tanpa angka."
      }
    </p>
    ${
      evidence.role === "searched_census"
        ? `<p class="fine" style="margin-top:8px;color:var(--text-ghost)">Angka hasil pencarian, bukan ramalan. Baris ini salah satu konfigurasi yang diperingkat studi; holdout adalah ekspektasinya.</p>`
        : ""
    }
  </div>`;
}

export function correctedEvidenceCard(evidence) {
  const provenance = evidence.provenance ?? [];
  const cited = (label) => provenance.find((c) => c.label === label)?.value ?? null;
  const survivorship = cited("tier1_survivorship_avg_ret_pct");
  const holdout = cited("tier1_holdout_avg_ret_pct");
  const evStat = (label, value, note) => `
    <div>
      <div class="tabular" style="font-size:22px;font-weight:700;line-height:1;color:var(--text)">${value}</div>
      <div class="mono" style="margin-top:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint)">${esc(label)}</div>
      ${note ? `<div class="mono" style="margin-top:4px;font-size:10px;color:var(--text-ghost)">${esc(note)}</div>` : ""}
    </div>`;
  return `<div class="card pad">
    <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px">
      ${tierTag(evidence.role)}
      <span class="mono" style="font-size:10px;color:var(--text-ghost)">${esc(evidence.source)}</span>
    </div>
    <div class="grid cols4" style="margin-top:16px">
      ${evStat("Win rate", pct(evidence.win_rate, 1), evidence.win_rate_lo != null && evidence.win_rate_hi != null ? `Wilson ${pct(evidence.win_rate_lo, 0)}–${pct(evidence.win_rate_hi, 0)}` : undefined)}
      ${evStat("Avg per trade", fmtPct(evidence.avg_ret_pct), evidence.profit_factor != null ? `profit factor ${evidence.profit_factor.toFixed(2)}` : undefined)}
      ${evStat("Out-of-sample trades", idr(evidence.oos_trades), evidence.n_specs != null ? `pooled over ${evidence.n_specs} donchian variants` : undefined)}
      ${evStat("Max drawdown", evidence.max_drawdown_pct != null ? `−${Math.abs(evidence.max_drawdown_pct).toFixed(1)}%` : "—", evidence.book_return_pct != null ? `10M book ${fmtPct(evidence.book_return_pct, 1)}` : undefined)}
    </div>
    <p class="fine dim" style="margin-top:16px;max-width:86ch">${esc(evidence.caveat)}</p>
    ${
      evidence.single_spec_trades != null
        ? `<p class="fine dim" style="margin-top:12px;max-width:86ch"><span style="color:var(--text)">${idr(evidence.single_spec_trades)} of those trades belong to the window this screen runs.</span>
           The rest are the study's other donchian variants pooled into the same published row. Quoting the pool as this screen's own sample would overstate it roughly fourfold.</p>`
        : ""
    }
    ${
      survivorship != null || holdout != null
        ? `<p class="fine dim rule" style="max-width:86ch">
           ${survivorship != null ? `Dropping the best 20% of tickers leaves <span style="color:var(--text)">${fmtPct(survivorship)}</span> per trade. ` : ""}
           ${holdout != null ? `On folds no search saw, the same family reads <span style="color:var(--text)">${fmtPct(holdout)}</span>. ` : ""}
           Both say the same thing: a high hit rate on a thin, concentrated sample.</p>`
        : ""
    }
    ${provenanceList(provenance)}
  </div>`;
}

function verdictHero(plan) {
  const v = plan.verdict;
  const copy = verdictCopy(v.state);
  const tone = copy.tone;
  return `<section class="card hero accent-left" style="border-left-color:${tone}" aria-live="polite">
    <div class="hero-in">
      <div style="min-width:0">
        <p class="eyebrow">Data sesi ${esc(plan.session_label)} · rencana untuk ${esc(plan.horizon)}</p>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px">
          <span class="dot" style="background:${tone}" aria-hidden></span>
          <span class="font-display hero-title" style="color:${tone}">${esc(copy.title)}</span>
          <span class="hero-state">${esc(v.state)}</span>
        </div>
        <p class="hero-novice">${esc(copy.novice)}</p>
        <div class="hero-action" style="border-color:${tone}">
          <p class="lbl">Yang perlu dilakukan</p>
          <p>${esc(copy.action)}</p>
        </div>
        ${
          v.state === "ENTER"
            ? `<p class="fine dim" style="margin-top:12px;max-width:64ch">Pesan sebelum pukul <span class="mono" style="color:var(--text)">${esc(v.place_by)}</span> WIB. ${esc(v.place_note)}</p>`
            : ""
        }
        <details class="fold">
          <summary>Lihat alasan teknis dan angka lengkapnya</summary>
          <p class="fine dim" style="margin-top:8px;max-width:64ch;font-size:13px">${esc(v.headline)}</p>
          <p class="fine" style="margin-top:4px;max-width:64ch">${esc(v.detail)}</p>
          <p class="fine" style="margin-top:8px;max-width:64ch"><span style="color:var(--text-dim)">Saran teknis: </span>${esc(v.action)}</p>
          <p class="fine" style="margin-top:4px;max-width:64ch"><span style="color:var(--text-dim)">Yang akan mengubah keputusan: </span>${esc(v.change_needed)}</p>
          <p class="mono" style="margin-top:8px;font-size:11px;line-height:1.7;color:var(--text-ghost)">
            ${idr(plan.regime.universe_size)} saham di atas rata-rata 200 hari miliknya · breadth ${pct(plan.regime.breadth, 0)}
            ${plan.regime.index_close != null ? ` · IHSG ${idr(plan.regime.index_close)}` : ""}<br>
            Dicek lagi ${esc(v.recheck_on)} · ${v.recheck_basis === "exchange_calendar" ? "dari kalender bursa" : "hari kerja berikutnya, hari libur belum diverifikasi"}
          </p>
        </details>
        ${v.state === "DATA_UNSAFE" ? integrityList(v.integrity) : ""}
      </div>
      ${
        v.state !== "ENTER" && v.stand_down_case
          ? `<div class="hero-side">${standDownPanel(v)}</div>`
          : ""
      }
    </div>
  </section>`;
}

/* ── alert book ──────────────────────────────────────────────────── */

const STATE_TONE = {
  ENTER: "var(--up)",
  WAIT: "var(--gold)",
  NO_TRADE: "var(--gold)",
  DATA_UNSAFE: "var(--down)",
};

function entryCard(e) {
  return `<li class="entry">
    <div class="entry-top">
      <div class="entry-id">
        <span class="entry-rank">#${esc(e.rank)}</span>
        <a class="font-display entry-tk" href="deep.html?ticker=${esc(e.ticker)}">${esc(e.ticker)}</a>
        <span class="entry-name">${esc(e.name)}</span>
      </div>
      <span class="entry-size">${e.position_idr != null ? `ukuran ${idr(e.position_idr)}` : ""}</span>
    </div>
    <p class="entry-why">${esc(e.why)}</p>
    <div class="entry-grid">
      <div><p class="k">Entry</p><p class="v">${e.entry_ref != null ? idr(e.entry_ref) : "—"}</p></div>
      <div><p class="k">Target</p><p class="v" style="color:var(--up)">${e.target_price != null ? idr(e.target_price) : "—"}${e.target_pct != null ? ` (${e.target_pct > 0 ? "+" : ""}${e.target_pct}%)` : ""}</p></div>
      <div><p class="k">Stop</p><p class="v" style="color:var(--down)">${e.stop_price != null ? idr(e.stop_price) : "—"}${e.stop_pct != null ? ` (${e.stop_pct}%)` : ""}</p></div>
      <div><p class="k">Risiko Rp</p><p class="v">${e.max_loss_idr != null ? idr(e.max_loss_idr) : "—"}</p></div>
    </div>
  </li>`;
}

function alertBook(feed, failed) {
  if (failed) {
    return `<section class="card pad accent-left" style="border-left-color:var(--down)">
      <p class="eyebrow">Rencana sesi gagal dimuat</p>
      <p class="fine dim" style="margin-top:4px;font-size:13px">${esc(failed)}</p>
      <button type="button" class="btn" data-retry-feed style="margin-top:12px">Coba lagi</button>
    </section>`;
  }
  if (!feed) {
    return `<section class="card pad"><p class="eyebrow">Rencana sesi berikutnya · memuat…</p></section>`;
  }
  const tone = STATE_TONE[feed.state] ?? "var(--gold)";
  const hasEntries = feed.entries.length > 0;
  return `<section class="card accent-left" style="border-left-color:${tone}" aria-live="polite">
    <div class="pad" style="padding:20px">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px">
        <p class="eyebrow">Rencana sesi berikutnya · data ${esc(feed.session_label)}</p>
        <span class="mono" style="font-size:10px;color:var(--text-ghost)">entry di pembukaan ${esc(feed.next_session ?? "—")} · ${hasEntries ? `${feed.entries.length} kandidat` : "tanpa tiket"}</span>
      </div>
      ${feed.stale ? `<span class="badge" style="margin-top:8px;border-color:var(--gold);color:var(--gold)">data ${feed.data_age_days ?? "?"} hari — periksa dulu</span>` : ""}
      ${
        hasEntries
          ? `<ul style="list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:12px">${feed.entries.map(entryCard).join("")}</ul>
             ${feed.book_overflow.length > 0 || feed.watchlist_count > 0 ? `<p class="fine" style="margin-top:12px">+${feed.book_overflow.length + feed.watchlist_count} kandidat lain masuk daftar pantau — maksimal 5 posisi terbuka sesuai aturan risiko.</p>` : ""}`
          : `<div style="margin-top:8px">
               <p style="font-size:14px;line-height:1.65;color:var(--text)">${esc(feed.headline ?? "Kondisi tidak terpenuhi — tidak ada yang layak entry pada sesi berikutnya.")}</p>
               ${
                 feed.no_trade_reasons.length > 0
                   ? `<ul style="list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px">${feed.no_trade_reasons.map((r) => `<li style="border-left:2px solid var(--gold);padding-left:12px;font-size:13px;color:var(--text-dim)">${esc(r)}</li>`).join("")}</ul>`
                   : ""
               }
             </div>`
      }
    </div>
  </section>`;
}

/* ── watchlist / capitulation / gates ────────────────────────────── */

function watchRow(w) {
  return `<li>
    <div class="watchrow">
      <a class="font-display tk" href="deep.html?ticker=${esc(w.ticker)}">${esc(w.ticker)}</a>
      <span class="px tabular">${idr(w.close)}</span>
      <span class="blk">tertahan oleh ${esc(GATE_LABEL[w.blocked_by] ?? w.blocked_by)}</span>
      <span class="dist">${esc(w.distance_text)}</span>
    </div>
  </li>`;
}

function capitulationWatch(plan) {
  const items = plan.capitulation_watch ?? [];
  if (!items.length) return "";
  const ev = plan.capitulation_evidence;
  const cell = (label, value, sub) => `
    <div class="cell" style="padding:12px 16px">
      <div class="stat-label">${esc(label)}</div>
      <div class="tabular" style="margin-top:4px;font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:700;color:var(--text)">${value}</div>
      <div style="margin-top:2px;font-size:11px;line-height:1.4;color:var(--text-faint)">${esc(sub)}</div>
    </div>`;
  return section({
    title: "Pantauan capitulation tier 3",
    subtitle:
      "Saham yang akan ditandai aturan capitulation-bounce studi pada sesi ini. Ini petunjuk, bukan hasil: setiap sel sapuan gagal pada batas 80% menang dan +5% per transaksi, dan aturan itu patah pada jendela kuartalan serta setelah koreksi survivorship. Tidak ada order di sini.",
    right: `${items.length} saham`,
    body: `
      <ul class="rows card">
        ${items
          .map(
            (t) => `<li>
              <div class="watchrow">
                <span class="font-display" style="font-size:18px;line-height:1;color:var(--text)">${esc(t.ticker)}</span>
                <span class="px tabular">${t.close != null ? t.close.toFixed(0) : "—"}</span>
                <span class="mono" style="font-size:11px;color:var(--text-ghost)">rsi2 ${t.rsi2 != null ? t.rsi2.toFixed(1) : "—"}</span>
                <span class="mono" style="font-size:11px;color:var(--text-ghost)">5 sesi ${pctRaw(t.ret5, 2)}</span>
                <span class="mono" style="font-size:11px;color:var(--text-ghost)">${pctRaw(t.dist_200_pct, 1)} terhadap MA 200</span>
                <span class="mono" style="font-size:11px;color:var(--text-ghost)">ATR ${pctRaw(t.atr14_pct, 1)}</span>
                <span class="pill" style="margin-left:auto;color:var(--gold);background:color-mix(in srgb, var(--gold) 14%, transparent)">pantau saja</span>
              </div>
            </li>`,
          )
          .join("")}
      </ul>
      ${
        ev
          ? `<div class="card pad accent-left" style="margin-top:16px;border-left-color:var(--gold)">
               <p class="fine dim" style="max-width:80ch;font-size:13px">${esc(ev.why)}</p>
               <dl class="cells c4" style="margin-top:16px">
                 ${ev.sweep.illiquid ? cell("Sapuan saham tipis, cfg 6", `${pctRaw(ev.sweep.illiquid.t3_win_rate, 1)} / ${fmtPct(ev.sweep.illiquid.t3_avg_ret_pct)}`, `${ev.sweep.illiquid.t3_n} transaksi, ${ev.sweep.illiquid.t3_folds} fold, lolos=${String(ev.sweep.illiquid.hit)}`) : ""}
                 ${ev.sweep.liquid_control ? cell("Kontrol likuid", `${pctRaw(ev.sweep.liquid_control.t3_win_rate, 1)} / ${fmtPct(ev.sweep.liquid_control.t3_avg_ret_pct)}`, `${ev.sweep.liquid_control.t3_n} transaksi, lolos=${String(ev.sweep.liquid_control.hit)}`) : ""}
                 ${ev.clean_universe.win_rate != null ? cell("Universe bersih", `${pctRaw(ev.clean_universe.win_rate, 2)} / ${fmtPct(ev.clean_universe.avg_ret_pct)}`, "studi meninggalkan tier ini setelah perbaikan harga beku") : ""}
                 ${ev.quarterly ? cell("Stres kuartalan", `${pctRaw(ev.quarterly.win_rate, 1)} / ${fmtPct(ev.quarterly.avg_ret_pct)}`, `${ev.quarterly.n} transaksi, pf ${ev.quarterly.profit_factor.toFixed(2)}`) : ""}
               </dl>
             </div>`
          : ""
      }`,
  });
}

function gateRow({ label, ok, value, need, note, required = true }) {
  const tone = !required ? "var(--text-ghost)" : ok ? "var(--up)" : "var(--gold)";
  const bg = !required
    ? "var(--panel-3)"
    : ok
      ? "color-mix(in srgb, var(--up) 12%, transparent)"
      : "color-mix(in srgb, var(--gold) 14%, transparent)";
  return `<div class="cell">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
      <span class="stat-label">${esc(label)}</span>
      <span class="pill" style="color:${tone};background:${bg}">${required ? (ok ? "terbuka" : "tertutup") : "konteks"}</span>
    </div>
    <div class="tabular stat-value big">${esc(value)}</div>
    <div class="mono" style="margin-top:4px;font-size:11px;color:var(--text-ghost)">${esc(need)}</div>
    <p class="fine" style="margin-top:12px;max-width:56ch">${esc(note)}</p>
  </div>`;
}

function driftStrip(regime) {
  const drift = regime.measured_drift;
  if (!drift || drift.mean_drift_5s_pct == null) return "";
  const positive = drift.mean_drift_5s_pct >= 0;
  const sessions = drift.sessions != null ? idr(drift.sessions) : "—";
  return `<div class="card soft" style="margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;padding:12px 16px">
    <span class="stat-label">Rata-rata pergerakan 5 sesi di pita ini</span>
    <span class="mono tabular" style="font-size:15px;font-weight:600;color:${positive ? "var(--up)" : "var(--down)"}">${fmtPct(drift.mean_drift_5s_pct)}</span>
    <span class="mono" style="font-size:11px;color:var(--text-dim)">dari ${esc(sessions)} sesi</span>
  </div>`;
}

function limitsPanel(plan) {
  const corrected = plan.corrected;
  const replay = plan.five_year;
  const tiers = ("tiers" in (replay ?? {}) ? replay.tiers : undefined) ?? [];
  const tier1 = tiers.find((t) => (t.tier ?? "").toLowerCase().startsWith("tier 1"));
  const pooled = tiers.find((t) => (t.tier ?? "").toLowerCase().includes("pooled"));
  const book = plan.verdict && plan.verdict.stand_down_case && plan.verdict.stand_down_case.book;
  const provenance = (corrected && corrected.provenance) ?? [];
  const cited = (label) => provenance.find((c) => c.label === label)?.value ?? null;
  const survivorship = cited("tier1_survivorship_avg_ret_pct");
  const holdout = cited("tier1_holdout_avg_ret_pct");
  const li = (inner) => (inner ? `<li>${inner}</li>` : "");
  const dd = (v) => (v == null ? "—" : `−${Math.abs(v).toFixed(1)}%`);
  return section({
    title: "Risiko yang perlu dipahami",
    subtitle:
      "Baca ini sebelum transaksi pertama, bukan setelah kerugian pertama. Semua angka di bawah diukur pada metode ini, dan setiap baris adalah alasan untuk memakai ukuran posisi lebih kecil daripada yang disarankan headline.",
    body: `<div class="grid half">
      <div class="card pad">
        <p class="eyebrow">Drawdown menurut jendela</p>
        <ul class="fine dim" style="list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px">
          ${li(corrected && corrected.max_drawdown_pct != null ? `Fold walk-forward, universe terkoreksi: <span style="color:var(--text)">${dd(corrected.max_drawdown_pct)}</span> penurunan terdalam${corrected.book_return_pct != null ? `, pada buku yang menghasilkan <span style="color:var(--up)">${fmtPct(corrected.book_return_pct, 1)}</span>` : ""}.` : "")}
          ${li(tier1 ? `Replay lima tahun, sepuluh slot: <span style="color:var(--down)">${dd(tier1.book_max_drawdown_pct)}</span> penurunan terdalam untuk <span style="color:var(--up)">${fmtPct(tier1.book_total_pct, 1)}</span>. Satu jendela, universe dikunci pada tanggal akhir — survivorship ikut masuk.` : "")}
          ${li(pooled ? `Replay yang sama dengan semua tier diperdagangkan: <span style="color:var(--down)">${fmtPct(pooled.book_total_pct, 1)}</span>, dari penurunan terdalam ${dd(pooled.book_max_drawdown_pct)}. Itulah biaya "perdagangkan setiap sinyal".` : "")}
          ${li(book && book.with_sideways && book.with_sideways.available ? `Pita menyamping diperdagangkan, bukan dilewati: <span style="color:var(--down)">${fmtPct(book.with_sideways.total_pct, 1)}</span> dengan penurunan terdalam ${dd(book.with_sideways.max_drawdown_pct)}, dibanding <span style="color:var(--up)">${fmtPct(book.trend_only.total_pct, 1)}</span> dengan penurunan terdalam ${dd(book.trend_only.max_drawdown_pct)} bila dilewati.` : "")}
        </ul>
        <p class="fine rule">Leverage tidak dimodelkan di mana pun dalam studi ini, dan satu baris yang memodelkannya menempatkan gearing tiga kali pada −98.29%. Bila broker menawarkan leverage untuk metode ini, bacaan jujurnya adalah belum ada yang mengukurnya.</p>
      </div>
      <div class="card pad">
        <p class="eyebrow">Dua haircut</p>
        <ul class="fine dim" style="list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px">
          ${li(survivorship != null ? `Buang 20% ticker terbaik dan edge terkoreksi menjadi <span style="color:var(--text)">${fmtPct(survivorship)}</span> per transaksi — secara statistik tidak berarti. Labanya hidup di sedikit nama.` : "")}
          ${li(holdout != null ? `Pada fold yang tidak pernah dilihat pencarian, keluarga aturan yang sama membaca <span style="color:var(--text)">${fmtPct(holdout)}</span> per transaksi.` : "")}
          ${li(plan.holdout ? `Studi mencari ${plan.holdout.search_cells ?? "—"} kombinasi; ${plan.holdout.search_cells_clearing ?? 0} lolos kedua batasnya pada data sendiri dan ${plan.holdout.winners_surviving ?? 0} dari ${plan.holdout.winners_tested ?? 0} yang terbaik bertahan di fold yang tidak dilihat.` : "")}
          ${li(`Stop sebesar −${plan.candidates[0] && plan.candidates[0].geometry ? Math.abs(plan.candidates[0].geometry.stop_pct).toFixed(0) : "35"}% memang disengaja, dan sesi yang membuka di luar stop terisi pada harga pembukaan itu — lebih buruk daripada stop. Itu terukur, bukan hipotetis.`)}
        </ul>
        <p class="fine rule">Semua ini bukan alasan melewati metode. Ini alasan mengambil posisi seukuran kerugian yang siap Anda catat, dan menyiapkan angka itu sebelum order.</p>
      </div>
    </div>
    <div class="card soft pad accent-left" style="margin-top:20px;border-left-color:var(--gold)">
      <p class="eyebrow">Sebelum memasang order · disiplin, bukan pengukuran</p>
      <ul class="fine dim" style="list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px">
        <li>· Satu posisi per nama; maksimal sepuluh posisi terbuka sekaligus.</li>
        <li>· Ukuran dari tiket, bukan keyakinan: 2% dari median nilai transaksi 60 sesi nama itu.</li>
        <li>· Jangan menambah posisi yang rugi, dan jangan merata-ratakan posisi ke bawah.</li>
        <li>· Tidak ada entry baru bila verdict bukan ENTER.</li>
        <li>· Tulis exit sebelum entry: target, stop, dan batas waktu holding.</li>
        <li>· Tanpa leverage dan tanpa short — keduanya tidak diukur di sini.</li>
      </ul>
    </div>`,
  });
}

/* ── page ────────────────────────────────────────────────────────── */

function backendDown(message) {
  return `
    <h1 class="err-title font-display">Backend tidak menjawab</h1>
    <p class="fine dim" style="margin-top:12px;max-width:60ch;font-size:14px">Jalankan <code class="mono" style="font-size:13px">./trading-suite run</code> lalu muat ulang halaman. Analisis pertama membaca seluruh daftar riset, jadi butuh beberapa detik.</p>
    <p class="mono" style="margin-top:12px;font-size:11px;color:var(--text-ghost)">${esc(message)}</p>`;
}

function renderTonight(root, plan, feedState) {
  const { regime, watchlist, evidence } = plan;
  const band = bandCopy(regime.band);
  const holdout = plan.holdout;
  setHTML(root, `
    ${verdictHero(plan)}
    ${
      holdout && !holdout.winners_surviving
        ? `<div class="card pad accent-left" style="margin-top:24px;border-left-color:var(--gold)">
             <p class="fine dim" style="font-size:13px"><span style="font-weight:600;color:var(--text)">Sebelum menindaklanjuti kandidat:</span>
             dari ${idr(holdout.search_cells)} kombinasi aturan yang dicoba riset, hanya ${holdout.search_cells_clearing} yang lolos batas 80% menang dan +5% per transaksi sekaligus — dan ${holdout.winners_surviving} dari ${holdout.winners_tested} yang di bawa ke depan tetap bertahan di data uji. Hasil terbaik yang pernah dicapai:
             <span style="color:var(--text)">${pct(holdout.best_holdout_win_rate, 1)} menang dan ${fmtPct(holdout.best_holdout_avg_ret_pct)} per transaksi</span>.
             <a href="method.html#holdout" style="text-decoration:underline;text-underline-offset:2px">Baca catatan holdout</a></p>
           </div>`
        : ""
    }
    <div style="margin-top:24px" data-feed>${alertBook(feedState.feed, feedState.failed)}</div>
    ${
      watchlist.length > 0
        ? section({
            title: "Hampir lolos: daftar pantau",
            subtitle:
              "Belum bisa dibeli. Saham di sini lolos sebagian besar syarat tetapi masih tertahan pada sesi ini. Daftar ini bukan order; klik satu nama untuk melihat syarat yang belum terbuka.",
            right: `${watchlist.length} saham`,
            body: `<ul class="rows card">${watchlist.map(watchRow).join("")}</ul>`,
          })
        : ""
    }
    ${capitulationWatch(plan)}
    ${section({
      title: "Seberapa andal metodenya",
      subtitle: "Angka out-of-sample dengan biaya di dalam setiap transaksi. Batasnya sama pentingnya dengan hasilnya.",
      body: `${evidenceBadge(evidence, plan.costs.round_trip)}
        <p class="fine" style="max-width:86ch;margin-top:12px">Rincian per fold:
          <span class="mono" style="font-size:12px;color:var(--text-dim)">${esc(evidence.fold_detail || "—")}</span></p>`,
    })}
    <details class="fold">
      <summary>Lihat angka dan cara perhitungannya</summary>
      <div class="fold-body">
        ${section({
          title: "Kondisi pasar (syarat semua saham)",
          subtitle: "Saat syarat ini tertutup, tidak ada saham di daftar riset yang memenuhi aturan — itu metode yang melindungi, bukan aplikasi yang rusak.",
          body: `
            <div class="card soft" style="margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:12px 16px">
              <span class="stat-label">Pita malam ini</span>
              <span class="font-display" style="font-size:18px;font-weight:600;color:${band.tone}">${esc(band.label)}</span>
              <span class="fine dim" style="font-size:12px">→ ${esc(band.advice)}</span>
            </div>
            ${driftStrip(regime)}
            <div class="cells c2">
              ${gateRow({ label: "Kondisi pasar (breadth)", ok: regime.breadth_open, value: pct(regime.breadth, 1), need: `butuh ${pct(regime.breadth_threshold, 0)}`, note: `Berapa banyak dari ${idr(regime.universe_size)} saham yang berada di atas rata-rata 200 hari miliknya sendiri. Median lima tahun: ${pct(regime.breadth_median, 0)}.` })}
              ${gateRow({ label: "IHSG di atas rata-rata 200 hari", ok: regime.index_above_200 ?? false, required: (plan.required_gates ?? []).includes("index_above_200"), value: regime.index_above_200 ? "Ya" : "Tidak", need: idr(regime.index_close), note: "Konteks saja — metode ini berdagang pada kondisi seluruh daftar, bukan pada indeks." })}
            </div>`,
        })}
        ${limitsPanel(plan)}
      </div>
    </details>`);
  const retry = root.querySelector("[data-retry-feed]");
  if (retry) retry.addEventListener("click", () => void loadFeed(root, plan));
}

async function loadFeed(root, plan) {
  const slot = root.querySelector("[data-feed]");
  if (slot) setHTML(slot, alertBook(null, null));
  try {
    const feed = await api.getCached("/api/alerts/feed", { ttl: 60_000 });
    const slot2 = root.querySelector("[data-feed]");
    if (slot2) {
      setHTML(slot2, alertBook(feed, null));
      const retry = slot2.querySelector("[data-retry-feed]");
      if (retry) retry.addEventListener("click", () => void loadFeed(root, plan));
    }
  } catch (e) {
    const slot2 = root.querySelector("[data-feed]");
    if (slot2) {
      setHTML(slot2, alertBook(null, e instanceof Error ? e.message : String(e)));
      const retry = slot2.querySelector("[data-retry-feed]");
      if (retry) retry.addEventListener("click", () => void loadFeed(root, plan));
    }
  }
}

export async function initTonight(root) {
  let plan = null;
  const load = async () => {
    setHTML(root, `<p class="loading">Membaca data riset — beberapa detik.</p>`);
    try {
      plan = await api.getCached("/api/plan", { ttl: 60_000 });
    } catch (e) {
      setHTML(root, backendDown(e instanceof Error ? e.message : String(e)));
      return;
    }
    renderTonight(root, plan, { feed: null, failed: null });
    void loadFeed(root, plan);
  };
  window.addEventListener(REFRESH_EVENT, () => void load());
  await load();
}
