/* paper.js — halaman "Akun latihan".
 * Port of frontend-web/src/routes/Paper.tsx. Read-only book:
 * pending orders, open positions, closed trades, stats strip.
 */
"use strict";

import { api } from "./api.js";
import { esc, idr, pctRaw, setHTML } from "./format.js";
import { REFRESH_EVENT } from "./refresh.js";
import { section } from "./tonight.js";

function panel(title, body) {
  return `<div class="card" style="margin-top:24px;padding:20px 20px 24px">
    <h2 style="margin:0 0 8px;font-size:15px;font-weight:600;color:var(--text)">${esc(title)}</h2>${body}</div>`;
}

function empty(text) {
  return `<p class="fine" style="font-size:13px">${esc(text)}</p>`;
}

function stat(label, value, tone) {
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text)";
  return `<div class="cell"><div class="stat-label">${esc(label)}</div>
    <div class="tabular" style="margin-top:4px;font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:700;line-height:1;color:${color}">${value}</div></div>`;
}

function table(head, rowsHtml, minWidth) {
  return `<div class="card scrollx"><table class="tbl" style="min-width:${minWidth}">
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>`;
}

function renderReady(snap, plan) {
  const stats = snap.stats ?? null;
  const positions = snap.open_positions ?? [];
  const trades = snap.closed_trades ?? [];
  const pending = snap.pending_orders ?? [];
  const planOpen = plan?.open ?? false;
  const settledThrough = snap.settledThrough ?? null;
  const stale = settledThrough && plan?.as_of && settledThrough < plan.as_of;

  return `
  ${stale ? panel("Buku latihan tertinggal dari data terbaru",
    `<p class="fine" style="max-width:76ch;font-size:13px">Sudah dihitung sampai ${esc(settledThrough ?? "—")} padahal sesi terbaru adalah ${esc(plan?.as_of ?? "tidak diketahui")}. Batas rugi yang tertembus di tengah celah itu belum dibukukan, jadi saldo di bawah belum angka hari ini.</p>`) : ""}
  <div class="cells c4" style="margin-top:${stale ? "20px" : "0"}">
    ${stat("Saldo", `Rp${idr(snap.equity_idr)}`, undefined)}
    ${stat("Tunai", `Rp${idr(snap.cash_idr)}`, undefined)}
    ${stat("Untung/rugi", `${(snap.pnl_idr ?? 0) >= 0 ? "+" : ""}Rp${idr(snap.pnl_idr)}`, (snap.pnl_idr ?? 0) >= 0 ? "up" : "down")}
    ${stat("Hasil", pctRaw(snap.return_pct), undefined)}
  </div>
  <p class="mono" style="margin-top:12px;font-size:11px;color:var(--text-ghost)">
    Dimulai ${esc(snap.started ?? "—")} · dihitung sampai ${esc(settledThrough ?? "—")} ·
    ${planOpen ? "aturan sedang berdagang" : "aturan sedang menahan"} ·
    ${stats ? `${stats.closed_count} selesai / ${stats.open_count} terbuka` : ""}</p>
  ${section({
    title: "Menunggu pembukaan pasar",
    subtitle: "Order yang ditempatkan aturan malam ini. Order terisi pada harga pembukaan sesi berikutnya, berapapun pembukaannya — bukan pada level pemicunya.",
    right: `${pending.length} order`,
    body: pending.length === 0 ? empty("Tidak ada order yang menunggu. Aturannya sedang menahan, atau posisinya sudah penuh.")
      : table(["Ticker", "Shares", "Stop", "Target", "Hold", "Fills"],
        pending.map((o) => `<tr style="border-bottom:1px solid var(--border)">
          <td class="mono" style="font-weight:600;color:var(--text)">${esc(o.ticker)}</td>
          <td class="mono" style="color:var(--text-faint)">${idr(o.shares)}</td>
          <td class="mono" style="color:var(--text-faint)">${o.stop == null ? "—" : idr(o.stop)}</td>
          <td class="mono" style="color:var(--text-faint)">${o.target == null ? "—" : idr(o.target)}</td>
          <td class="mono" style="color:var(--text-faint)">${o.hold_bars == null ? "—" : `${o.hold_bars} bars`}</td>
          <td class="mono" style="color:var(--text-faint)">${esc(o.fill_after)}</td></tr>`).join(""), "640px"),
  })}
  ${section({
    title: "Posisi terbuka",
    subtitle: "Dihargai dengan penutupan terakhir yang benar-benar tercetak tiap saham. Saham tanpa bar baru menampilkan harga masuknya dan tanggal datanya sendiri, bukan angka karangan.",
    right: `${positions.length} positions`,
    body: positions.length === 0 ? empty("Tanpa posisi. Buku latihan menunggu sinyal berikutnya.")
      : `<div class="card scrollx"><table class="tbl" style="min-width:720px">
        <thead><tr>${["Ticker", "Lots", "Entry", "Last", "Unrealised", "Stop", "Target", "Value"].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${positions.map((p) => `<tr style="border-bottom:1px solid var(--border)">
          <td class="mono" style="font-weight:600;color:var(--text)">${esc(p.ticker)}</td>
          <td class="mono">${idr(p.lots)}</td>
          <td class="mono">${idr(p.entry_price)}</td>
          <td class="mono">${p.last_price == null ? "—" : idr(p.last_price)}</td>
          <td class="mono" style="color:${p.unrealized_idr >= 0 ? "var(--up)" : "var(--down)"}">${idr(p.unrealized_idr)} (${pctRaw(p.unrealized_pct)})</td>
          <td class="mono" style="color:var(--text-faint)">${p.stop == null ? "—" : idr(p.stop)}</td>
          <td class="mono" style="color:var(--text-faint)">${p.target == null ? "—" : idr(p.target)}</td>
          <td class="mono">${idr(p.value_idr)}</td></tr>`).join("")}</tbody></table></div>`,
  })}
  ${section({
    title: "Transaksi selesai",
    subtitle: "Alasan tiap posisi keluar: batas rugi, target, atau jangka waktu habis. Batas rugi yang tertembus saat gap dicatat pada harga pembukaan, bukan pada level batasnya.",
    right: stats?.profit_factor == null ? "" : `PF ${stats.profit_factor}`,
    body: trades.length === 0 ? empty("No round trip yet. The first one is the first honest number.")
      : table(["Ticker", "In", "Out", "Entry", "Exit", "P&L", "Return", "Why"],
        trades.map((t) => `<tr style="border-bottom:1px solid var(--border)">
          <td class="mono" style="font-weight:600;color:var(--text)">${esc(t.ticker)}</td>
          <td class="mono" style="color:var(--text-faint)">${esc(t.entry_date)}</td>
          <td class="mono" style="color:var(--text-faint)">${esc(t.exit_date)}</td>
          <td class="mono" style="color:var(--text-faint)">${idr(t.entry_price)}</td>
          <td class="mono" style="color:var(--text-faint)">${idr(t.exit_price)}</td>
          <td class="mono" style="color:var(--text-faint)">${t.pnl_idr >= 0 ? "+" : ""}${idr(t.pnl_idr)}</td>
          <td class="mono" style="color:var(--text-faint)">${pctRaw(t.return_pct)}</td>
          <td class="mono" style="color:var(--text-faint)">${esc(t.reason)}</td></tr>`).join(""), "640px"),
  })}
  <p class="mono" style="margin-top:40px;max-width:80ch;font-size:11px;line-height:1.7;color:var(--text-ghost)">
    Charged on every fill: ${stats?.costs.buy_fee_pct ?? 0.15}% buy fee,
    ${stats?.costs.sell_fee_pct ?? 0.25}% sell fee (brokerage plus the final sales tax) and
    ${stats?.costs.slippage_pct ?? 0.15}% slippage per side. The same model the tickets quote.
    A paper result read without those costs is a different result.</p>`;
}

const HEADER = `<header style="margin-bottom:32px">
  <h1 class="font-display" style="font-size:26px;letter-spacing:-0.01em;margin:0">Akun latihan</h1>
  <p class="fine" style="margin-top:8px;max-width:76ch;font-size:13px">Uang latihan Rp5 juta — bukan akun nyata, tidak ada order yang dikirim ke broker. Aturan dari halaman Hari ini dijalankan otomatis setiap sinkronisasi, supaya kelihatan apakah metodenya bertahan dari biayanya sendiri pada hari-hari ketika ia berbicara.</p>
</header>`;

export async function initPaper(root) {
  const load = async () => {
    setHTML(root, `${HEADER}${panel("Membaca buku latihan…", `<p class="fine">Mengambil catatan transaksi…</p>`)}`);
    let snap = null;
    let plan = null;
    let error = null;
    try {
      snap = await api.getCached("/api/paper/state", { ttl: 60_000 });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    try {
      plan = await api.getCached("/api/plan", { ttl: 300_000 });
    } catch { /* the book is readable without tonight's plan */ }
    if (error) {
      setHTML(root, `${HEADER}${panel("Buku latihan tidak bisa dibaca", `<p class="fine">${esc(error)}</p>`)}`);
      return;
    }
    if (!snap) {
      setHTML(root, `${HEADER}${panel("Membaca buku latihan…", `<p class="fine">Mengambil catatan transaksi…</p>`)}`);
      return;
    }
    if (!snap.hasBook) {
      setHTML(root, `${HEADER}${panel("Buku latihan belum dibuka",
        `<p class="fine" style="max-width:70ch;font-size:13px">Buku ini terbuka pada sinkronisasi pertama setelah aplikasi dipasang: kandidat halaman Hari ini menjadi order, dan pembukaan sesi berikutnya mengisinya. Tidak ada yang dipesan dengan tangan, jadi tidak ada yang perlu dilakukan selain menunggu jadwal sinkronisasi.</p>`)}`);
      return;
    }
    setHTML(root, `${HEADER}${renderReady(snap, plan)}`);
  };
  window.addEventListener(REFRESH_EVENT, () => void load());
  await load();
}
