/* present.js — the display-language layer.
 * Port 1:1 of frontend-web/src/lib/present.ts (verdict/band copies only;
 * strategyCopy/screenCopy move over when the scanner/backtest pages are
 * ported). No computation here — numbers always arrive from the payload.
 */
"use strict";

export const TERMS = {
  support: "area harga yang beberapa kali memantulkan harga ke atas",
  resistance: "area harga yang beberapa kali menahan kenaikan",
  drawdown: "penurunan terdalam dari titik tertinggi saldo",
  breadth:
    "berapa banyak saham yang sedang berada di atas rata-rata harga jangka panjangnya sendiri",
};

/** Backend verdict state -> plain Indonesian. Unknown codes fall to neutral. */
export function verdictCopy(state) {
  switch (state) {
    case "ENTER":
      return {
        title: "Aturan mengizinkan beli",
        tone: "var(--up)",
        novice:
          "Semua syarat terpenuhi pada sesi terakhir, dan kandidatnya bisa dibeli dalam jumlah wajar.",
        action:
          "Pesan kandidat di bawah saat pasar buka besok, sebelum batas waktu yang tertera pada tiket.",
      };
    case "WAIT":
      return {
        title: "Tunggu dulu",
        tone: "var(--gold)",
        novice:
          "Kondisi pasar sudah sesuai, tetapi belum ada saham yang lolos semua aturan sahamnya sendiri.",
        action:
          "Tidak perlu melakukan apa pun hari ini. Halaman yang sama dicek lagi setelah sesi berikutnya.",
      };
    case "NO_TRADE":
      return {
        title: "Sekarang bukan waktunya beli",
        tone: "var(--gold)",
        novice:
          "Aturan menahan pembelian pada kondisi pasar seperti sekarang. Menunggu adalah posisinya, bukan kegagalan.",
        action: "Jangan beli hari ini. Periksa lagi saat kondisi pasar berubah.",
      };
    case "DATA_UNSAFE":
      return {
        title: "Data belum bisa dipakai",
        tone: "var(--down)",
        novice:
          "Ada pemeriksaan data yang tidak lolos, jadi aplikasi menahan semua tiket dan tidak menampilkan sinyal beli.",
        action:
          "Jangan mengandalkan angka halaman ini sampai data diperbaiki — tekan Perbarui data setelah sumber bar diperbaiki.",
      };
    default:
      return {
        title: "Status belum dikenal",
        tone: "var(--text-ghost)",
        novice:
          "Halaman menerima status baru dari backend dan menampilkannya apa adanya tanpa menebak maknanya.",
        action: "Buka halaman Cara kerja untuk penjelasan metode yang sedang dipakai.",
      };
  }
}

/** Market band -> everyday words. Unknown codes fall to neutral. */
export function bandCopy(band) {
  switch (band) {
    case "trending":
      return {
        label: "pasar naik",
        advice: "aturan boleh mencari kandidat beli",
        tone: "var(--up)",
      };
    case "sideways":
      return {
        label: "pasar menyamping",
        advice: "aturan menahan: jangan beli",
        tone: "var(--gold)",
      };
    case "capitulation":
      return {
        label: "pasar jatuh keras",
        advice: "aturan hanya mengamati",
        tone: "var(--down)",
      };
    default:
      return { label: band, advice: "—", tone: "var(--text-ghost)" };
  }
}

/** Filter scanner -> nama tugas pembaca; definisi teknis tetap dari backend. */
export function screenCopy(key, fallback) {
  const plain = {
    all: {
      label: "Semua saham",
      meaning: "Seluruh saham yang lolos syarat dasar riset (harga dan nilai transaksi minimum).",
    },
    tier1: {
      label: "Lolos semua aturan",
      meaning: "Lolos semua syarat saham dan kondisi pasar sedang mengizinkan.",
    },
    tier1_setup: {
      label: "Hampir lolos",
      meaning: "Semua syarat saham sudah lolos; tinggal menunggu kondisi pasar membuka.",
    },
    capitulation: {
      label: "Pasar jatuh: daftar pantau",
      meaning: "Saatun yang jatuh dalam dan mulai stabil — daftar amatan, bukan sinyal beli.",
    },
    breakout: {
      label: "Harga menembus batas",
      meaning: "Harga tutup di atas tertinggi 40 hari sebelumnya.",
    },
    relative_strength: {
      label: "Momentum kuat",
      meaning: "Kenaikan harganya termasuk 10% teratas di seluruh daftar saham.",
    },
    quiet_vol: {
      label: "Pergerakan relatif tenang",
      meaning: "Naik-turun harian sedang di bagian paling tenang dari riwayatnya sendiri.",
    },
  };
  return plain[key] ?? { label: fallback.label, meaning: fallback.definition };
}

/** Strategi -> satu kalimat bahasa sehari-hari. */
export function strategyCopy(key) {
  const plain = {
    buyhold: "Beli sekali di awal, simpan sampai akhir jendela.",
    tsmom: "Beli saat hasil 12 bulan terakhir positif, kosongkan saat negatif.",
    momentum: "Ikuti persilangan garis MACD, ditambah sinyal RSI.",
    meanreversion: "Beli saat harga jatuh jauh, jual saat kembali terlalu tinggi.",
    pullback: "Beli saat harga turun sebentar di dalam tren naik yang lebih besar.",
    breakout: "Beli saat harga menembus tertinggi 20 hari sebelumnya.",
    mildmover: "Beli saat harga bergerak sempit beberapa hari berturut-turut.",
    golden_cross: "Beli saat rata-rata 20 hari naik melewati rata-rata 50 hari.",
    cross_3_5: "Versi cepat dari persilangan EMA 3/5.",
    cross_9_21: "Versi sedang dari persilangan EMA 9/21.",
    gate_sma200:
      "Beli hanya saat harga di atas rata-rata 10 bulan (dihitung dari harga tutup bulanan); selain itu tahan kas.",
  };
  return plain[key] ?? "";
}

/** Strategi unggulan: hanya yang benar-benar bertransaksi; buyhold pembanding. */
export function featuredStrategy(rows) {
  const trading = rows.filter(
    (row) =>
      row.strategy !== "buyhold" &&
      row.stats != null &&
      row.stats.total_trades >= 1 &&
      row.stats.total_return_pct != null,
  );
  if (trading.length === 0) return null;
  return trading.reduce((best, row) =>
    (row.stats?.total_return_pct ?? -Infinity) > (best.stats?.total_return_pct ?? -Infinity)
      ? row
      : best,
  );
}
