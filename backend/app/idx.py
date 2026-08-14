"""IDX (Bursa Efek Indonesia) direct scraper — no Stockbit dependency.

Serves the data Stockbit used to provide straight from the official IDX
website (`www.idx.co.id/primary/*` JSON endpoints). The exchange's public
API needs no key but sits behind Cloudflare TLS/HTTP2 fingerprinting, so
plain `requests` gets 403. This module uses `curl_cffi` with Chrome
impersonation plus a homepage warm-up to seed cookies — the community-proven
bypass (nichsedge/idx-bei, agentpixelated MCP, markusprap, all active 2026
pipelines). A real browser also works; curl_cffi is lighter and faster.

Feature coverage from IDX directly:
  - Foreign flow per stock        -> GetStockSummary  (ForeignBuy/ForeignSell)
  - Whole-universe foreign flow   -> one GetStockSummary call for all ~960 names
  - Ownership structure           -> GetCompanyProfilesDetail (PemegangSaham[])
  - Announcements                 -> GetAnnouncement (+ StaticData PDF links)
  - Exchange-level broker ranking -> GetBrokerSummary
  - Market recap / indices        -> GetIndexSummary / GetRecapSummary

The ONE thing IDX does not publish publicly is per-stock broker attribution
(which broker bought/sold a specific stock). That gap is documented, not
faked: Broker Intel shows exchange-level broker volume + per-stock foreign
flow instead.
"""

from __future__ import annotations

import logging
import math
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

from curl_cffi import requests as cf_requests
from curl_cffi.requests import Session as CFSession

from app import db

logger = logging.getLogger(__name__)

IDX_BASE = "https://www.idx.co.id"
IDX_API = f"{IDX_BASE}/primary"

# Cache TTLs (seconds) — EOD data, so a daily-ish refresh is plenty.
FOREIGN_TTL = 3600
OWNERSHIP_TTL = 86400  # shareholder structure changes rarely
OWNERSHIP_HIST_MAX = 24  # keep ~2 years of monthly-ish snapshots per ticker
ANNOUNCEMENT_TTL = 600
BROKER_TTL = 3600

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)
_HEADERS = {
    "User-Agent": _UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en-US;q=0.9,id;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.idx.co.id/",
}

# curl_cffi sessions are not thread-safe; one per thread, like db.py.
_thread_local = threading.local()


def _session() -> CFSession:
    """Per-thread curl_cffi session with Chrome impersonation + cookie warm-up."""
    s = getattr(_thread_local, "idx_session", None)
    if s is None:
        s = cf_requests.Session(impersonate="chrome")
        # Warm-up GET seeds the __cf_bm / cf_clearance cookies that unlock /primary.
        try:
            s.get(IDX_BASE + "/", headers={"User-Agent": _UA}, timeout=30)
        except Exception as exc:  # noqa: BLE001 - warm-up failure is non-fatal
            logger.warning("idx warm-up failed: %s", exc)
        _thread_local.idx_session = s
    return s


def _get_json(path: str, params: dict[str, Any] | None = None, timeout: int = 40) -> Any:
    """GET an IDX /primary JSON endpoint with impersonation; raises on 403/5xx.

    curl_cffi is the fast path. If Cloudflare escalates to a managed JS
    challenge ("Just a moment..." 403), fall back to a real headless
    Chromium page fetch — a browser always passes the fingerprint gate.
    """
    try:
        s = _session()
        resp = s.get(IDX_API + path, headers=_HEADERS, params=params, timeout=timeout)
        if resp.status_code in (403, 429, 500, 502, 503, 504):
            # Cookie may have expired; refresh the session once and retry.
            logger.info(
                "idx %s -> %s; refreshing session and retrying",
                path,
                resp.status_code,
            )
            s.close()
            _thread_local.idx_session = None
            s = _session()
            resp = s.get(IDX_API + path, headers=_HEADERS, params=params, timeout=timeout)
        if resp.status_code == 403 and "Just a moment" in resp.text:
            logger.info("idx %s hit a JS challenge; falling back to browser", path)
            return _browser_get_json(path, params, timeout)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        # Last-resort: the browser path can succeed where curl_cffi cannot.
        if _browser_available():
            return _browser_get_json(path, params, timeout)
        raise


# ─── Browser fallback (playwright-core via Node bridge) ───────────────────────

_browser_available_cache: bool | None = None


def _browser_available() -> bool:
    """Whether the Node playwright-core bridge + a Chromium binary exist."""
    global _browser_available_cache
    if _browser_available_cache is None:
        _browser_available_cache = bool(
            _node() and _pw_core_path() is not None and _chromium_binary().exists()
        )
    return bool(_browser_available_cache)


def _node() -> str:
    import shutil

    return shutil.which("node") or "node"


def _chromium_binary() -> Any:
    import pathlib

    for rev in ("chromium-1234", "chromium-1228"):
        p = pathlib.Path.home() / ".cache" / "ms-playwright" / rev / "chrome-linux64" / "chrome"
        if p.exists():
            return p
    return pathlib.Path("/nonexistent")


def _pw_core_path() -> Any:
    """Resolve playwright-core from the pi agent install (or any node_modules)."""
    import pathlib

    candidates = [
        pathlib.Path.home() / ".pi/agent/npm/node_modules/playwright-core/index.js",
        pathlib.Path.home() / ".hermes/agent/npm/node_modules/playwright-core/index.js",
    ]
    return next((p for p in candidates if p.exists()), None)


def _browser_get_json(path: str, params: dict[str, Any] | None = None, timeout: int = 60) -> Any:
    """Fetch an IDX JSON endpoint inside a real headless Chromium page.

    The backend has no Python playwright, but the host has playwright-core
    plus a Chromium build already installed (used by the browser tooling).
    Bridge to it: a tiny Node script warms the real site to seed Cloudflare
    cookies, then calls fetch() from the page — same origin, real TLS, real
    JS runtime — and prints the JSON body to stdout.
    """
    import json
    import subprocess
    from urllib.parse import urlencode

    url = IDX_API + path
    if params:
        url += "?" + urlencode(params)
    script = """
const { chromium } = require(process.env.PW_CORE);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PW_CHROMIUM,
    args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],
  });
  try {
    const ctx = await browser.newContext({
      userAgent: process.env.PW_UA,
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(process.env.PW_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    const result = await page.evaluate(async (u) => {
      const r = await fetch(u, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' },
      });
      const t = await r.text();
      return { status: r.status, text: t };
    }, process.env.PW_URL);
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(2); });
"""

    pw_core = _pw_core_path()
    if pw_core is None:
        raise RuntimeError("playwright-core not found for idx browser fallback")

    env = {
        "PW_CORE": str(pw_core.parent),
        "PW_CHROMIUM": str(_chromium_binary()),
        "PW_UA": _UA,
        "PW_BASE": IDX_BASE,
        "PW_URL": url,
    }
    proc = subprocess.run(
        [_node(), "-e", script],
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout + 15,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"idx browser bridge failed: {proc.stderr.strip()[:200]}")
    try:
        out = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as exc:
        raise RuntimeError(
            f"idx browser bridge returned non-JSON: {proc.stdout.strip()[:120]}"
        ) from exc
    if out.get("status") != 200:
        raise RuntimeError(
            f"browser fetch {path} -> {out.get('status')}: " + str(out.get("text", ""))[:120]
        )
    try:
        return json.loads(out["text"])
    except (ValueError, KeyError, TypeError) as exc:
        raise RuntimeError(f"idx browser bridge body not JSON: {exc}") from exc


def idx_available() -> bool:
    """IDX is always the primary source; probe only confirms reachability."""
    try:
        j = _get_json(
            "/TradingSummary/GetStockSummary", {"length": 1, "start": 0, "date": _last_trade_day()}
        )
        return bool(j.get("data"))
    except Exception:  # noqa: BLE001 - probe must never raise
        return False


def _last_trade_day() -> str:
    """Most recent weekday as YYYYMMDD (IDX closes weekends/holidays)."""
    d = datetime.now(UTC).date()
    while d.weekday() >= 5:  # Sat=5, Sun=6
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


def _to_float(v: Any) -> float | None:
    try:
        f = float(v)
        return f if not math.isnan(f) else None
    except (TypeError, ValueError):
        return None


# ─── Foreign flow ─────────────────────────────────────────────────────────────


def _fetch_daily_summary(date: str | None = None) -> list[dict[str, Any]]:
    """One call returns the whole market's EOD summary (incl. foreign flow).

    IDX publishes EOD data after the close; early in the day the latest date
    can be empty. Walk back up to 5 days to the most recent non-empty
    trading day.
    """
    target = date or _last_trade_day()
    key = f"idx:summary:{target}"
    cached = db.get_fresh(key, FOREIGN_TTL)
    if cached is not None:
        return cached
    rows: list[dict[str, Any]] = []
    # Parse as a UTC-aware date — %Y%m%d carries no timezone info.
    d = datetime.strptime(target, "%Y%m%d").replace(tzinfo=UTC).date()
    for _ in range(5):
        day = d.strftime("%Y%m%d")
        j = _get_json(
            "/TradingSummary/GetStockSummary",
            {"length": 9999, "start": 0, "date": day},
        )
        rows = j.get("data") or []
        if rows:
            key = f"idx:summary:{day}"
            db.set(key, rows)
            break
        d -= timedelta(days=1)
    return rows


def foreign_flow(ticker: str, force: bool = False) -> dict[str, Any]:
    """Net foreign flow for one ticker from the official daily summary."""
    ticker = ticker.upper()
    cache_key = f"intel:foreign:{ticker}"
    if not force:
        cached = db.get_fresh(cache_key, FOREIGN_TTL)
        if cached is not None:
            return cached
    try:
        rows = _fetch_daily_summary()
    except Exception as exc:  # noqa: BLE001
        logger.warning("foreign flow %s failed: %s", ticker, exc)
        stale = db.get(cache_key)
        if stale is not None:
            return stale
        return {"ticker": ticker, "available": True, "error": "IDX upstream unavailable"}
    row = next((r for r in rows if str(r.get("StockCode", "")).upper() == ticker), None)
    if row is None:
        return {
            "ticker": ticker,
            "available": True,
            "error": f"{ticker} not in today's IDX summary",
        }
    fb = _to_float(row.get("ForeignBuy")) or 0.0
    fs = _to_float(row.get("ForeignSell")) or 0.0
    close = _to_float(row.get("Close")) or 0.0
    volume = _to_float(row.get("Volume")) or 0.0
    payload = {
        "ticker": ticker,
        "available": True,
        "as_of": row.get("Date") or datetime.now(UTC).isoformat(),
        "price": close,
        "net_foreign_lots": round((fb - fs) / 100, 2),
        "net_foreign_idr": round((fb - fs) * close),
        "foreign_buy_lots": round(fb / 100, 2),
        "foreign_sell_lots": round(fs / 100, 2),
        "foreign_buy_idr": round(fb * close),
        "foreign_sell_idr": round(fs * close),
        "total_volume": volume,
        "broker_count": 0,
        "rows": [
            {
                "broker": "IDX",
                "side": "buy",
                "type": "Asing",
                "lots": round(fb / 100, 2),
                "value_idr": round(fb * close),
                "avg_price": close,
            },
            {
                "broker": "IDX",
                "side": "sell",
                "type": "Asing",
                "lots": round(fs / 100, 2),
                "value_idr": round(fs * close),
                "avg_price": close,
            },
        ],
    }
    db.set(cache_key, payload)
    return payload


def foreign_flow_universe(force: bool = False) -> dict[str, Any]:
    """Net foreign flow for the whole IDX universe — ONE IDX call."""
    cache_key = "intel:foreign:universe"
    if not force:
        cached = db.get_fresh(cache_key, FOREIGN_TTL)
        if cached is not None:
            return cached
    try:
        rows = _fetch_daily_summary()
    except Exception as exc:  # noqa: BLE001
        logger.warning("foreign universe failed: %s", exc)
        stale = db.get(cache_key)
        if stale is not None:
            return stale
        return {"available": True, "error": str(exc)[:200], "rows": []}
    # IDX's summary has no sector; join TradingView's universe for sector labels.
    sector_by_ticker: dict[str, str] = {}
    try:
        from app.movers import fetch_universe

        for u in fetch_universe():
            sector_by_ticker[u["symbol"]] = str(u.get("sector") or "—")
    except Exception as exc:  # noqa: BLE001 - sector enrichment is best-effort
        logger.warning("sector enrichment skipped: %s", exc)
    out: list[dict[str, Any]] = []
    for r in rows:
        fb = _to_float(r.get("ForeignBuy")) or 0.0
        fs = _to_float(r.get("ForeignSell")) or 0.0
        close = _to_float(r.get("Close")) or 0.0
        prev = _to_float(r.get("Previous")) or 0.0
        if close <= 0:
            continue
        symbol = str(r.get("StockCode", "")).upper()
        # GetStockSummary's `Change` is the absolute price move, not a %.
        change_pct = ((close - prev) / prev * 100) if prev > 0 else None
        out.append(
            {
                "ticker": symbol,
                "name": str(r.get("StockName", "")),
                "sector": sector_by_ticker.get(symbol, "—"),
                "price": round(close, 2),
                "change_percent": round(change_pct, 2) if change_pct is not None else None,
                "net_foreign_idr": round((fb - fs) * close),
                "net_foreign_lots": round((fb - fs) / 100, 2),
                "foreign_buy_lots": round(fb / 100, 2),
                "foreign_sell_lots": round(fs / 100, 2),
                "volume": _to_float(r.get("Volume")) or 0.0,
            }
        )
    out.sort(key=lambda x: x["net_foreign_idr"], reverse=True)
    payload = {
        "available": True,
        "count": len(out),
        "as_of": datetime.now(UTC).isoformat(),
        "rows": out,
    }
    if out:
        db.set(cache_key, payload)
    return payload


# ─── Broker summary (exchange level) ──────────────────────────────────────────


def broker_summary(force: bool = False) -> dict[str, Any]:
    """Exchange-level broker volume/value/frequency ranking (all of IDX)."""
    cache_key = "intel:broker:summary"
    if not force:
        cached = db.get_fresh(cache_key, BROKER_TTL)
        if cached is not None:
            return cached
    rows: list[dict[str, Any]] = []
    as_of = datetime.now(UTC).isoformat()
    d = datetime.now(UTC).date()
    for _ in range(5):
        day = d.strftime("%Y%m%d")
        try:
            j = _get_json(
                "/TradingSummary/GetBrokerSummary",
                {"length": 9999, "start": 0, "date": day},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("broker summary failed: %s", exc)
            stale = db.get(cache_key)
            if stale is not None:
                return stale
            return {"available": True, "error": str(exc)[:200], "rows": []}
        rows = j.get("data") or []
        if rows:
            as_of = day
            break
        d -= timedelta(days=1)
    out = [
        {
            "broker": str(r.get("FirmName", "")),
            "code": str(r.get("IDFirm", "")),
            "volume": _to_float(r.get("Volume")) or 0.0,
            "value_idr": _to_float(r.get("Value")) or 0.0,
            "frequency": _to_float(r.get("Frequency")) or 0.0,
            # IDX does not publish net buy/sell direction per broker.
            "net_lots": 0,
            "net_idr": 0,
            "type": "IDX",
            "tickers": [],
            "ticker_count": 0,
        }
        for r in rows
    ]
    out.sort(key=lambda x: x["value_idr"], reverse=True)
    payload = {
        "available": True,
        "count": len(out),
        "as_of": as_of,
        "covered_tickers": len(out),
        "rows": out,
    }
    if out:
        db.set(cache_key, payload)
    return payload


# ─── Ownership ────────────────────────────────────────────────────────────────


def ownership_structure(ticker: str, force: bool = False) -> dict[str, Any]:
    """Shareholder / board structure from IDX company profiles (PemegangSaham)."""
    ticker = ticker.upper()
    cache_key = f"intel:ownership:{ticker}"
    if not force:
        cached = db.get_fresh(cache_key, OWNERSHIP_TTL)
        if cached is not None:
            return cached
    try:
        j = _get_json(
            "/ListedCompany/GetCompanyProfilesDetail",
            {"KodeEmiten": ticker, "language": "id-id"},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("ownership %s failed: %s", ticker, exc)
        stale = db.get(cache_key)
        if stale is not None:
            return stale
        return {"ticker": ticker, "available": False, "error": str(exc)[:200]}
    profile = (j.get("Profiles") or [{}])[0]
    shareholders = [
        {
            "name": str(s.get("Nama", "")),
            "shares": s.get("Jumlah"),
            "percent": s.get("Persentase"),
            "category": str(s.get("Kategori", "")),
            "controlling": bool(s.get("Pengendali")),
        }
        for s in j.get("PemegangSaham") or []
    ]
    payload = {
        "ticker": ticker,
        "available": True,
        "as_of": datetime.now(UTC).isoformat(),
        "name": profile.get("NamaEmiten"),
        "sector": profile.get("Sektor"),
        "sub_sector": profile.get("SubSektor"),
        "listing_date": profile.get("TanggalPencatatan"),
        "shareholders": shareholders,
        "board": {
            "direktur": [
                {"name": str(d.get("Nama", "")), "position": str(d.get("Jabatan", ""))}
                for d in j.get("Direktur") or []
            ],
            "komisaris": [
                {"name": str(d.get("Nama", "")), "position": str(d.get("Jabatan", ""))}
                for d in j.get("Komisaris") or []
            ],
        },
        "subsidiaries": [
            {"name": str(a.get("Nama", "")), "percent": a.get("Persentase")}
            for a in j.get("AnakPerusahaan") or []
        ],
    }
    db.set(cache_key, payload)
    _ownership_snapshot(ticker, shareholders)
    return payload


def _ownership_snapshot(ticker: str, shareholders: list[dict[str, Any]]) -> None:
    """Append today's snapshot to the per-ticker history archive (deduped).

    Only distinct holder sets are stored (keyed by date + sorted names), so
    intra-day refetches don't pile up identical entries. The archive powers
    period-over-period diffs and threshold watch.
    """
    hist_key = f"intel:ownership:hist:{ticker}"
    try:
        hist = db.get(hist_key) or []
    except Exception:  # noqa: BLE001
        hist = []
    if not isinstance(hist, list):
        hist = []
    day = datetime.now(UTC).date().isoformat()
    sig = sorted(f"{s.get('name')}|{s.get('percent')}" for s in shareholders if s.get("name"))
    last = hist[-1] if hist else None
    if last and last.get("sig") == sig:
        return  # identical to the last stored snapshot — nothing changed
    snapshot = {
        "date": day,
        "sig": sig,
        "holders": [
            {
                "name": s.get("name"),
                "percent": s.get("percent"),
                "category": s.get("category", ""),
                "controlling": bool(s.get("controlling")),
            }
            for s in shareholders
        ],
    }
    hist.append(snapshot)
    db.set(hist_key, hist[-OWNERSHIP_HIST_MAX:])


def ownership_history(ticker: str) -> dict[str, Any]:
    """Ownership-change history for one ticker: snapshots + latest diff.

    Computes the change between the two most recent snapshots: entered,
    exited, and changed holders, plus holders crossing the 5/25/50% lines.
    """
    ticker = ticker.upper()
    hist_key = f"intel:ownership:hist:{ticker}"
    try:
        hist = db.get(hist_key) or []
    except Exception:  # noqa: BLE001
        hist = []
    if not isinstance(hist, list) or not hist:
        return {"ticker": ticker, "available": True, "snapshots": [], "changes": None}

    snapshots = [{k: v for k, v in s.items() if k != "sig"} for s in hist]
    changes = _ownership_diff(hist[-2], hist[-1]) if len(hist) >= 2 else None
    return {
        "ticker": ticker,
        "available": True,
        "snapshots": snapshots,
        "changes": changes,
    }


def _ownership_diff(
    before: dict[str, Any] | None,
    after: dict[str, Any],
) -> dict[str, Any] | None:
    """Diff two snapshots: entered/exited/changed holders + threshold crosses."""
    if before is None:
        return None
    b = {h["name"]: h for h in before.get("holders", [])}
    a = {h["name"]: h for h in after.get("holders", [])}
    pct = lambda h: h.get("percent") if isinstance(h.get("percent"), (int, float)) else None
    entered = [{"name": n, "percent": pct(a[n])} for n in a if n not in b]
    exited = [{"name": n, "percent": pct(b[n])} for n in b if n not in a]
    changed = []
    for n, hn in a.items():
        if n in b:
            bp, ap = pct(b[n]), pct(hn)
            if bp is not None and ap is not None and abs(ap - bp) >= 0.05:
                changed.append({"name": n, "from": bp, "to": ap, "delta": round(ap - bp, 2)})
    # Threshold watch: holders crossing 5 / 25 / 50% lines.
    thresholds = [5.0, 25.0, 50.0]
    crossed = []
    for n, hn in a.items():
        if n not in b:
            continue
        bp, ap = pct(b[n]), pct(hn)
        if bp is None or ap is None:
            continue
        for t in thresholds:
            if (bp < t <= ap) or (bp >= t > ap):
                crossed.append(
                    {
                        "name": n,
                        "from": bp,
                        "to": ap,
                        "threshold": t,
                        "dir": "above" if ap >= t else "below",
                    }
                )
    if not entered and not exited and not changed and not crossed:
        return None
    return {
        "from_date": before.get("date"),
        "to_date": after.get("date"),
        "entered": entered,
        "exited": exited,
        "changed": changed,
        "crossed": crossed,
    }


# ─── Announcements ────────────────────────────────────────────────────────────


def announcements(limit: int = 30, force: bool = False) -> dict[str, Any]:
    """Official IDX announcements with attachment PDF links."""
    cache_key = f"intel:announcements:{limit}"
    if not force:
        cached = db.get_fresh(cache_key, ANNOUNCEMENT_TTL)
        if cached is not None:
            return cached
    date_to = datetime.now(UTC).date()
    date_from = date_to - timedelta(days=45)
    try:
        j = _get_json(
            "/ListedCompany/GetAnnouncement",
            {
                "kodeEmiten": "",
                "indexFrom": 0,
                "pageSize": max(limit, 10),
                "dateFrom": date_from.strftime("%Y%m%d"),
                "dateTo": date_to.strftime("%Y%m%d"),
                "lang": "id",
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("announcements failed: %s", exc)
        stale = db.get(cache_key)
        if stale is not None:
            return stale
        return {"available": True, "error": str(exc)[:200], "items": []}
    items = []
    for reply in j.get("Replies") or []:
        p = reply.get("pengumuman") or {}
        atts = reply.get("attachments") or []
        link = None
        if atts:
            link = f"{IDX_BASE}/StaticData/{atts[0].get('FullSavePath', '').lstrip('/')}"
        items.append(
            {
                "title": str(p.get("JudulPengumuman", "")),
                "category": str(p.get("JenisPengumuman", "")),
                "date": str(p.get("TglPengumuman", "")),
                "ticker": str(p.get("Kode_Emiten", "")),
                "link": link,
            }
        )
    payload = {
        "available": True,
        "count": len(items),
        "as_of": datetime.now(UTC).isoformat(),
        "items": items,
    }
    if items:
        db.set(cache_key, payload)
    return payload


# ─── Heatmap (whole-market treemap data) ─────────────────────────────────────


def _swr(cache_key: str, builder, force: bool = False) -> dict[str, Any] | None:
    """Stale-while-revalidate helper for slow IDX-scrape endpoints.

    Returns fresh cache if valid; otherwise serves the stale copy instantly
    and kicks off a background refresh; only blocks on the very first fetch
    (no cache at all). Builders must return a payload dict or None on failure
    (None is never cached).
    """
    if not force:
        cached = db.get_fresh(cache_key, FOREIGN_TTL)
        if cached is not None:
            return cached
        stale = db.get(cache_key)
        if stale is not None:
            # Refresh in background; users get the stale copy now (~0ms).
            def refresh() -> None:
                try:
                    payload = builder()
                    if payload is not None:
                        db.set(cache_key, payload)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("background refresh %s failed: %s", cache_key, exc)

            threading.Thread(target=refresh, daemon=True, name=f"swr:{cache_key}").start()
            return stale
    return builder()


def _heatmap_builder() -> dict[str, Any] | None:
    """Fetch + shape the whole-market heatmap payload (slow: 1-2s cold)."""
    try:
        rows = _fetch_daily_summary()
    except Exception as exc:  # noqa: BLE001
        logger.warning("heatmap failed: %s", exc)
        return None
    # Join TradingView universe for sector labels (best-effort).
    sector_by_ticker: dict[str, str] = {}
    try:
        from app.movers import fetch_universe

        for u in fetch_universe():
            sector_by_ticker[u["symbol"]] = str(u.get("sector") or "—")
    except Exception as exc:  # noqa: BLE001
        logger.warning("heatmap sector join skipped: %s", exc)
    out: list[dict[str, Any]] = []
    for r in rows:
        close = _to_float(r.get("Close")) or 0.0
        prev = _to_float(r.get("Previous")) or 0.0
        if close <= 0:
            continue
        symbol = str(r.get("StockCode", "")).upper()
        change_pct = ((close - prev) / prev * 100) if prev > 0 else None
        fb = _to_float(r.get("ForeignBuy")) or 0.0
        fs = _to_float(r.get("ForeignSell")) or 0.0
        listed = _to_float(r.get("ListedShares")) or 0.0
        out.append(
            {
                "ticker": symbol,
                "name": str(r.get("StockName", "")),
                "sector": sector_by_ticker.get(symbol, "Lainnya"),
                "price": round(close, 2),
                "change_pct": round(change_pct, 2) if change_pct is not None else None,
                # Market-cap proxy: listed shares x close (no free-float field in the summary).
                "market_cap": listed * close,
                "listed_shares": listed,
                "volume": _to_float(r.get("Volume")) or 0.0,
                "value_idr": _to_float(r.get("Value")) or 0.0,
                "foreign_net": round((fb - fs) * close),
            }
        )
    if not out:
        return None
    return {
        "available": True,
        "count": len(out),
        "as_of": datetime.now(UTC).isoformat(),
        "rows": out,
    }


def market_heatmap(force: bool = False) -> dict[str, Any]:
    """Whole-IDX-universe data for the treemap: size = market cap, color = %chg.

    One GetStockSummary call supplies all ~963 stocks (price, change, foreign
    flow, volume, listed shares); sector labels are joined from the TradingView
    universe (IDX's summary has no sector field).
    """
    cache_key = "intel:heatmap"
    payload = _swr(cache_key, _heatmap_builder, force)
    if payload is not None:
        if force:
            db.set(cache_key, payload)
        return payload
    stale = db.get(cache_key)
    if stale is not None:
        return stale
    return {"available": True, "error": "no market data", "rows": []}


# ─── Movers (JCI point contribution) ─────────────────────────────────────────


def _jci_close() -> float:
    """Latest JCI (COMPOSITE) close from the index summary, walking back to
    the most recent day with published data (EOD posts after market close)."""
    d = datetime.now(UTC).date()
    for _ in range(5):
        try:
            j = _get_json(
                "/TradingSummary/GetIndexSummary",
                {"date": d.strftime("%Y%m%d"), "length": 9999, "start": 0},
            )
            for r in j.get("data") or []:
                if r.get("IndexCode") == "COMPOSITE":
                    c = _to_float(r.get("Close")) or 0.0
                    if c > 0:
                        return c
        except Exception as exc:  # noqa: BLE001
            logger.warning("jci close failed for %s: %s", d, exc)
        d -= timedelta(days=1)
    return 0.0


def movers(range_days: int = 1, limit: int = 50, force: bool = False) -> dict[str, Any]:
    """Leaders/laggards ranked by JCI point contribution.

    PTS = (change_pct/100) * (market_cap / total_market_cap) * JCI_close — the
    standard index-contribution decomposition. Uses listed-shares * close as
    the market-cap proxy (GetStockSummary has no explicit free-float cap).
    Serves stale instantly and refreshes in the background (see _swr).
    """
    cache_key = f"intel:movers:{range_days}:{limit}"
    payload = _swr(
        cache_key,
        lambda: _movers_builder(range_days, limit),
        force,
    )
    if payload is not None:
        if force:
            db.set(cache_key, payload)
        return payload
    stale = db.get(cache_key)
    if stale is not None:
        return stale
    return {
        "available": True,
        "error": "no market data",
        "leaders": [],
        "laggards": [],
        "jci": None,
    }


def _movers_builder(range_days: int, limit: int) -> dict[str, Any] | None:
    """Fetch + shape the movers payload (slow: 1-2s cold)."""
    rows: list[dict[str, Any]] = []
    # Walk back until we have a non-empty trading day for the range start.
    d = datetime.now(UTC).date()
    target_date = None
    for _ in range(range_days + 5):
        day_rows = []
        try:
            day_rows = _fetch_daily_summary(d.strftime("%Y%m%d"))
        except Exception:  # noqa: BLE001
            day_rows = []
        if day_rows:
            target_date = d.strftime("%Y%m%d")
            rows = day_rows
            break
        d -= timedelta(days=1)
    if not rows:
        return None

    jci = _jci_close()
    weighted: list[dict[str, Any]] = []
    total_cap = 0.0
    parsed: list[tuple[dict[str, Any], float, float]] = []
    for r in rows:
        close = _to_float(r.get("Close")) or 0.0
        prev = _to_float(r.get("Previous")) or 0.0
        listed = _to_float(r.get("ListedShares")) or 0.0
        if close <= 0 or listed <= 0:
            continue
        cap = listed * close
        total_cap += cap
        change_pct = ((close - prev) / prev * 100) if prev > 0 else 0.0
        parsed.append((r, cap, change_pct))
    for r, cap, change_pct in parsed:
        symbol = str(r.get("StockCode", "")).upper()
        pts = (change_pct / 100.0) * (cap / total_cap) * jci if total_cap > 0 and jci > 0 else None
        weighted.append(
            {
                "ticker": symbol,
                "name": str(r.get("StockName", "")),
                "price": round(_to_float(r.get("Close")) or 0.0, 2),
                "change_pct": round(change_pct, 2),
                "pts": round(pts, 3) if pts is not None else None,
                "idx_mv_pct": round(cap / total_cap * 100, 2) if total_cap > 0 else None,
                "volume": _to_float(r.get("Volume")) or 0.0,
                "value_idr": _to_float(r.get("Value")) or 0.0,
            }
        )
    leaders = sorted(weighted, key=lambda x: x["pts"] or -1e18, reverse=True)[:limit]
    laggards = sorted(weighted, key=lambda x: x["pts"] or 1e18)[:limit]
    payload = {
        "available": True,
        "as_of": datetime.now(UTC).isoformat(),
        "trade_date": target_date,
        "jci": round(jci, 2) if jci else None,
        "range_days": range_days,
        "up_count": sum(1 for w in weighted if w["change_pct"] > 0),
        "down_count": sum(1 for w in weighted if w["change_pct"] < 0),
        "flat_count": sum(1 for w in weighted if w["change_pct"] == 0),
        "leaders": leaders,
        "laggards": laggards,
    }
    return payload
