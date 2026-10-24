"""Stockbit JWT auth + broker summary — web-app-faithful, no evasion.

Discovery: parse /_next/static/chunks/*.js for baseURL and endpoint paths (e.g. order-trade/broker/top).
Auth: POST /login/v6/username requires user, password, recaptcha_token, recaptcha_version=RECAPTCHA_VERSION_3, player_id.
If no trusted session, obtain recaptcha_token via real browser Turnstile (executeRecaptcha("login_browser")) — don't forge.
Session reuse (preferred): reuse user's own access_token from browser storage/cookies with consent, save to 0600, handle exp.
Respect controls: 403 cf-mitigated -> show verification UI; 429 SERVICE_BUSY -> back off 30s+ after 4 rapid logins. No IP/UA rotation.
Broker/Tradebook: all broker data on exodus.stockbit.com with Authorization: Bearer + Origin. api.stockbit.com returns InvalidParameter for those paths. Use protobuf enums as-is (group_by: 1=PRICE, order_by: 1=TIME).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import requests
from requests.exceptions import HTTPError

from app import db

try:
    from dotenv import load_dotenv
    from app.config import BACKEND_ROOT
    load_dotenv(BACKEND_ROOT.parent / ".env", override=False)
    load_dotenv(BACKEND_ROOT / ".env", override=False)
except Exception:
    pass

logger = logging.getLogger(__name__)

BASE = "https://exodus.stockbit.com"
STOCKBIT_WEB = "https://stockbit.com"
CHUNK_RE = re.compile(r'/_next/static/chunks/[^"\']+\.js')
ENDPOINT_RE = re.compile(r'(order-trade/broker/top|marketdetectors|company-price-feed/v2/orderbook)')
BASE_RE = re.compile(r'https://[a-z0-9.-]*stockbit\.com[a-z0-9./-]*')

try:
    from app.config import CACHE_DIR, DATA_DIR
    _PERSISTENT_FILE = DATA_DIR / "stockbit_jwt.json"
    CACHE_FILE = CACHE_DIR / "stockbit_jwt.json"
    _LEGACY_FILE = Path.home() / ".cache" / "trading-suite" / "stockbit_jwt.json"
    _TRADINGCLI_FILE = Path.home() / ".cache" / "trading-cli" / "stockbit_jwt.json"
except Exception:
    _PERSISTENT_FILE = Path.home() / ".cache" / "trading-suite" / "stockbit_jwt.json"
    CACHE_FILE = _PERSISTENT_FILE
    _LEGACY_FILE = CACHE_FILE
    _TRADINGCLI_FILE = Path.home() / ".cache" / "trading-cli" / "stockbit_jwt.json"

BROKER_TTL = 43200


def _discover_stockbit_config(force: bool = False) -> dict[str, Any]:
    cache_key = "stockbit:discovery"
    if not force:
        cached = db.get_fresh(cache_key, 86400)
        if cached is not None:
            return cached
    try:
        html = requests.get(STOCKBIT_WEB, headers={"User-Agent": "Mozilla/5.0 Chrome/144.0.0.0"}, timeout=15).text
        chunks = CHUNK_RE.findall(html)
        chunk_urls = [STOCKBIT_WEB + c if c.startswith("/") else c for c in chunks[:12]]
        found_bases: set[str] = set()
        found_endpoints: set[str] = set()
        for url in chunk_urls:
            try:
                js = requests.get(url, timeout=15).text
                for m in BASE_RE.findall(js):
                    if "stockbit.com" in m:
                        found_bases.add(m.rstrip("/"))
                for m in ENDPOINT_RE.findall(js):
                    found_endpoints.add(m)
            except Exception:
                continue
        cfg = {
            "bases": sorted(found_bases),
            "endpoints": sorted(found_endpoints),
            "discovered_at": datetime.now(UTC).isoformat(),
            "preferred_base": "https://exodus.stockbit.com" if "https://exodus.stockbit.com" in found_bases else (sorted(found_bases)[0] if found_bases else BASE),
        }
        db.set(cache_key, cfg)
        return cfg
    except Exception as exc:
        logger.warning("stockbit discovery failed: %s", exc)
        return {"bases": [BASE], "endpoints": [], "preferred_base": BASE, "error": str(exc)[:200]}


def _decode_exp(jwt: str) -> int | None:
    try:
        payload = jwt.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        d = json.loads(base64.urlsafe_b64decode(payload))
        return d.get("exp")  # type: ignore[no-any-return]
    except Exception:
        return None


def _write_jwt_file(path: Path, jwt: str, exp: int | None) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"jwt": jwt, "exp": exp, "saved_at": int(time.time())}))
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("stockbit save %s failed: %s", path, exc)


def save_jwt(jwt: str) -> None:
    exp = _decode_exp(jwt)
    for p in {_PERSISTENT_FILE, CACHE_FILE, _LEGACY_FILE}:
        _write_jwt_file(p, jwt, exp)
    os.environ["STOCKBIT_JWT_TOKEN"] = jwt


def _load_jwt_file(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        j = json.loads(path.read_text())
        jwt = j.get("jwt")
        exp = j.get("exp")
        if exp and exp < time.time():
            logger.info("cached Stockbit JWT expired %s at %s", time.strftime("%Y-%m-%d", time.gmtime(exp)), path)
            return None
        if isinstance(jwt, str) and jwt.count(".") == 2:
            return jwt
    except Exception:
        pass
    return None


def _creds_from_env() -> tuple[str, str] | None:
    u = (os.getenv("STOCKBIT_USERNAME") or os.getenv("STOCKBIT_EMAIL") or "").strip()
    pw = (os.getenv("STOCKBIT_PASSWORD") or "").strip().strip('"').strip("'")
    if u and pw:
        return u, pw
    return None


def _obtain_recaptcha_via_browser() -> str | None:
    import subprocess, json, shutil
    node = shutil.which("node") or "node"
    script = """
const { chromium } = require(require('child_process').execSync('find ' + (process.env.HOME || '/home/mariobgsp') + '/.pi -name "playwright-core" -type d 2>/dev/null | head -1').toString().trim() + '/index.js' || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('https://stockbit.com/login', { waitUntil: 'domcontentloaded' });
  console.log('BROWSER: Please solve Turnstile/Captcha, then login. Waiting 120s...');
  const token = await page.evaluate(() => new Promise((resolve) => {
    let done=false;
    const check=()=>{ try{ const v=localStorage.getItem('recaptcha_token')||sessionStorage.getItem('recaptcha_token')|| (window).recaptcha_token; if(v && !done){done=true; resolve(v);} }catch{} };
    setInterval(check, 1000);
    try{ const orig=window.executeRecaptcha; if(orig){ window.executeRecaptcha = async (a)=>{ const t=await orig(a); if(!done){done=true; resolve(t);} return t; }; } }catch{}
    setTimeout(()=>{ if(!done) resolve(null); }, 120000);
  }));
  console.log(JSON.stringify({token}));
  await browser.close();
})().catch(e=>{ console.error(String(e)); process.exit(2); });
"""
    try:
        proc = subprocess.run([node, "-e", script], capture_output=True, text=True, timeout=140)
        if proc.returncode == 0:
            for line in proc.stdout.splitlines():
                try:
                    j = json.loads(line.strip())
                    if j.get("token"):
                        return str(j["token"])
                except Exception:
                    continue
    except Exception as exc:
        logger.warning("recaptcha browser failed: %s", exc)
    return None


def _handle_rate_limit(resp: requests.Response) -> None:
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After")
        try:
            wait = int(retry_after) if retry_after else 35
        except (TypeError, ValueError):
            wait = 35
        wait = max(wait, 30)
        logger.warning("Stockbit 429 SERVICE_BUSY, backing off %ss", wait)
        time.sleep(wait)


def login(username: str, password: str) -> str:
    cfg = _discover_stockbit_config()
    login_url = f"{STOCKBIT_WEB}/api/login/v6/username"
    recaptcha_token = _obtain_recaptcha_via_browser()
    if not recaptcha_token:
        raise RuntimeError("Recaptcha token required for Stockbit login. Please login manually in a real browser and export your access_token with consent, or solve Turnstile via verification UI. Direct POST without executeRecaptcha('login_browser') is not allowed.")
    headers = {
        "origin": "https://stockbit.com",
        "referer": "https://stockbit.com/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0",
        "accept": "application/json",
        "content-type": "application/json",
    }
    payloads = [
        {"user": username, "password": password, "recaptcha_token": recaptcha_token, "recaptcha_version": "RECAPTCHA_VERSION_3", "player_id": ""},
        {"username": username, "password": password, "recaptcha_token": recaptcha_token, "recaptcha_version": "RECAPTCHA_VERSION_3", "player_id": ""},
    ]
    for pl in payloads:
        try:
            r = requests.post(login_url, json=pl, headers=headers, timeout=20)
            if r.status_code == 403 and "cf-mitigated" in r.text.lower():
                raise RuntimeError("403 cf-mitigated: challenge required. Show verification UI and wait for user to solve Turnstile, then retry.")
            if r.status_code == 429:
                _handle_rate_limit(r)
                raise RuntimeError("429 SERVICE_BUSY: back off 30s+ before retry. Hit after 4 rapid logins.")
            if r.ok:
                j = r.json()
                for k in ("access_token", "token", "jwt", "data"):
                    v = j.get(k) if isinstance(j, dict) else None
                    if isinstance(v, str) and v.count(".") == 2:
                        save_jwt(v)
                        return v
                    if isinstance(v, dict):
                        for kk in ("access_token", "token", "jwt"):
                            vv = v.get(kk)
                            if isinstance(vv, str) and vv.count(".") == 2:
                                save_jwt(vv)
                                return vv
            logger.info("stockbit login %s -> %s %s", login_url, r.status_code, r.text[:200])
        except requests.RequestException as e:
            logger.warning("stockbit login request failed: %s", e)
            raise
    raise RuntimeError("Stockbit login failed. Reuse your own access_token from browser storage/cookies with explicit consent (preferred) — save to 0600 file.")


def load_jwt() -> str | None:
    for p in [_PERSISTENT_FILE, CACHE_FILE, _LEGACY_FILE, _TRADINGCLI_FILE]:
        jwt = _load_jwt_file(p)
        if jwt:
            if p not in (_PERSISTENT_FILE, CACHE_FILE):
                _write_jwt_file(_PERSISTENT_FILE, jwt, _decode_exp(jwt))
                _write_jwt_file(CACHE_FILE, jwt, _decode_exp(jwt))
            return jwt
    env = os.getenv("STOCKBIT_JWT_TOKEN") or os.getenv("STOCKBIT_JWT") or ""
    env = env.replace("Bearer", "").strip().replace('"', "").replace("'", "")
    if env and env.count(".") == 2:
        try:
            _write_jwt_file(_PERSISTENT_FILE, env, _decode_exp(env))
            _write_jwt_file(CACHE_FILE, env, _decode_exp(env))
        except Exception:
            pass
        return env
    creds = _creds_from_env()
    if creds:
        logger.info("Stockbit credentials present but no valid JWT. Use browser flow: solve Turnstile and reuse access_token with consent, or POST /api/intel/stockbit/login will trigger verification UI.")
    return None


def stockbit_available() -> bool:
    return load_jwt() is not None


def stockbit_status() -> dict[str, Any]:
    jwt = load_jwt()
    if not jwt:
        return {"available": False, "reason": "no JWT — set STOCKBIT_JWT_TOKEN or login with browser Turnstile (POST /api/intel/stockbit/login)"}
    exp = _decode_exp(jwt)
    if exp is None:
        return {"available": True, "jwt_len": len(jwt), "exp": None}
    remaining = exp - time.time()
    return {"available": remaining > 0, "jwt_len": len(jwt), "exp": exp, "exp_human": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(exp)), "hours_left": round(remaining / 3600, 1), "expired": remaining <= 0}


def fetch_broker_summary(emiten: str, date: str | None = None) -> dict[str, Any]:
    jwt = load_jwt()
    if not jwt:
        raise RuntimeError("no Stockbit JWT — set STOCKBIT_JWT_TOKEN")
    emiten = emiten.upper().strip()
    if not date:
        date = datetime.now(UTC).strftime("%Y-%m-%d")
    # All broker data is on exodus.stockbit.com with Bearer + Origin; api.stockbit.com returns InvalidParameter. Use protobuf enums as-is.
    url = f"{BASE}/marketdetectors/{emiten}?from={date}&to={date}&transaction_type=TRANSACTION_TYPE_NET&market_board=MARKET_BOARD_REGULER&investor_type=INVESTOR_TYPE_ALL&limit=25&group_by=1&order_by=1"
    h = {"accept": "application/json", "authorization": f"Bearer {jwt}", "origin": "https://stockbit.com", "referer": "https://stockbit.com/", "user-agent": "Mozilla/5.0 Chrome/144.0.0.0"}
    r = requests.get(url, headers=h, timeout=20)
    if r.status_code == 403 and "cf-mitigated" in r.text.lower():
        raise RuntimeError("403 cf-mitigated: show verification UI and wait for user")
    if r.status_code == 429:
        _handle_rate_limit(r)
        raise RuntimeError("429 SERVICE_BUSY")
    r.raise_for_status()
    return r.json()


def fetch_orderbook(ticker: str) -> dict[str, Any]:
    jwt = load_jwt()
    if not jwt:
        raise RuntimeError("no Stockbit JWT — set STOCKBIT_JWT_TOKEN")
    ticker = ticker.upper().strip()
    url = f"{BASE}/company-price-feed/v2/orderbook/companies/{ticker}"
    h = {"accept": "application/json", "authorization": f"Bearer {jwt}", "origin": "https://stockbit.com", "referer": "https://stockbit.com/", "user-agent": "Mozilla/5.0 Chrome/144.0.0.0"}
    r = requests.get(url, headers=h, timeout=15)
    if r.status_code == 403 and "cf-mitigated" in r.text.lower():
        raise RuntimeError("403 cf-mitigated: show verification UI")
    if r.status_code == 429:
        _handle_rate_limit(r)
        raise RuntimeError("429 SERVICE_BUSY")
    r.raise_for_status()
    return r.json()


def orderbook_snapshot(ticker: str, force: bool = False) -> dict[str, Any]:
    ticker = ticker.upper().strip()
    cache_key = f"stockbit:ob:{ticker}"
    if not force:
        cached = db.get_fresh(cache_key, 60)
        if cached is not None:
            return cached
    try:
        raw = fetch_orderbook(ticker)
    except Exception as exc:
        stale = db.get(cache_key)
        if stale is not None:
            return stale
        return {"ticker": ticker, "available": False, "error": str(exc)[:300]}
    data = raw.get("data") if isinstance(raw, dict) else None
    if not isinstance(data, dict):
        return {"ticker": ticker, "available": False, "error": "empty orderbook"}
    try:
        bid_lots = 0.0
        offer_lots = 0.0
        tbo = data.get("total_bid_offer") or {}
        bid_lots = float((tbo.get("bid") or {}).get("lot") or 0) if isinstance(tbo, dict) else 0
        offer_lots = float((tbo.get("offer") or {}).get("lot") or 0) if isinstance(tbo, dict) else 0
        if bid_lots == 0:
            bid_lots = sum(float(b.get("volume") or 0) / 100 for b in (data.get("bid") or []))
        if offer_lots == 0:
            offer_lots = sum(float(o.get("volume") or 0) / 100 for o in (data.get("offer") or []))
        total = bid_lots + offer_lots
        imbalance = (bid_lots - offer_lots) / total if total else 0.0
        spread = None
        try:
            best_bid = float((data.get("bid") or [{}])[0].get("price") or 0)
            best_offer = float((data.get("offer") or [{}])[0].get("price") or 0)
            if best_bid and best_offer:
                mid = (best_bid + best_offer) / 2
                spread = (best_offer - best_bid) / mid * 100 if mid else None
        except Exception:
            pass
        payload = {"ticker": ticker, "available": True, "bid_lots": round(bid_lots, 1), "offer_lots": round(offer_lots, 1), "imbalance": round(imbalance, 3), "spread_pct": round(spread, 3) if spread is not None else None, "levels": {"bid": len(data.get("bid") or []), "offer": len(data.get("offer") or [])}, "as_of": datetime.now(UTC).isoformat()}
        db.set(cache_key, payload)
        return payload
    except Exception as exc:
        return {"ticker": ticker, "available": False, "error": str(exc)[:300]}


def fetch_tradedone(ticker: str, limit: int = 20) -> dict[str, Any]:
    try:
        raw = fetch_orderbook(ticker)
        data = raw.get("data") if isinstance(raw, dict) else {}
        trades = (data or {}).get("trade") or (data or {}).get("trades") or []
        if trades:
            return {"ticker": ticker.upper(), "available": True, "trades": trades[:limit]}
    except Exception:
        pass
    return {"ticker": ticker.upper(), "available": False, "trades": []}


def _normalize_rows(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for k in ("data", "result", "results", "items"):
            v = raw.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                for kk in ("result", "results", "items", "data"):
                    vv = v.get(kk)
                    if isinstance(vv, list):
                        return vv
        if "broker" in raw or "broker_code" in raw or "BrokerCode" in raw:
            return [raw]
    return []


def broker_summary(ticker: str, date: str | None = None, force: bool = False) -> dict[str, Any]:
    ticker = ticker.upper().strip()
    if not date:
        date = datetime.now(UTC).strftime("%Y-%m-%d")
    cache_key = f"stockbit:broker:{ticker}:{date}"
    if not force:
        cached = db.get_fresh(cache_key, BROKER_TTL)
        if cached is not None:
            return cached
    jwt = load_jwt()
    if not jwt:
        return {"ticker": ticker, "available": False, "error": "Stockbit JWT not configured — set STOCKBIT_JWT_TOKEN or login with browser", "date": date}
    try:
        raw = fetch_broker_summary(ticker, date)
    except Exception as exc:
        # HTTPError handled via isinstance to keep single except (pi-lens boolean-in-except guard)
        if isinstance(exc, HTTPError):
            resp = getattr(exc, "response", None)
            status = getattr(resp, "status_code", 0) if resp is not None else 0  # type: ignore[attr-defined]
            if status in (401, 403):
                if status == 403 and "cf-mitigated" in str(exc).lower():
                    return {"ticker": ticker, "available": False, "error": "403 cf-mitigated: show verification UI", "date": date}
                return {"ticker": ticker, "available": False, "error": f"Stockbit auth failed ({status}) — JWT expired. Reuse access_token with consent.", "date": date}
            if status == 429:
                return {"ticker": ticker, "available": False, "error": "429 SERVICE_BUSY: back off 30s+", "date": date}
            stale = db.get(cache_key)
            if stale is not None:
                return stale
            return {"ticker": ticker, "available": False, "error": str(exc)[:300], "date": date}
        if "cf-mitigated" in str(exc).lower():
            return {"ticker": ticker, "available": False, "error": "403 cf-mitigated: show verification UI", "date": date}
        if "SERVICE_BUSY" in str(exc):
            return {"ticker": ticker, "available": False, "error": "429 SERVICE_BUSY", "date": date}
        stale = db.get(cache_key)
        if stale is not None:
            return stale
        return {"ticker": ticker, "available": False, "error": str(exc)[:300], "date": date}
    rows_raw = _normalize_rows(raw)
    rows: list[dict[str, Any]] = []
    for r in rows_raw:
        if not isinstance(r, dict):
            continue
        broker = str(r.get("broker") or r.get("broker_code") or r.get("BrokerCode") or r.get("BrokerName") or r.get("code") or "?")
        buy_lots = r.get("buy_lots") or r.get("buy") or r.get("BuyLot") or r.get("BuyLots") or r.get("buy_volume") or 0
        sell_lots = r.get("sell_lots") or r.get("sell") or r.get("SellLot") or r.get("SellLots") or r.get("sell_volume") or 0
        net_lots = r.get("net_lots") or r.get("net") or r.get("NetLot") or r.get("NetLots") or 0
        try:
            bl = float(buy_lots) if buy_lots is not None else 0
        except (TypeError, ValueError):
            bl = 0
        try:
            sl = float(sell_lots) if sell_lots is not None else 0
        except (TypeError, ValueError):
            sl = 0
        try:
            nl = float(net_lots) if net_lots is not None else bl - sl
        except (TypeError, ValueError):
            nl = bl - sl
        if bl == 0 and sl == 0 and nl == 0:
            buy_val = r.get("buy_value") or r.get("BuyValue") or r.get("ValueBuy") or 0
            sell_val = r.get("sell_value") or r.get("SellValue") or r.get("ValueSell") or 0
            try:
                nl = float(buy_val or 0) - float(sell_val or 0)
            except (TypeError, ValueError):
                pass
        rows.append({"broker": broker.upper().strip() if broker != "?" else "?", "buy_lots": bl, "sell_lots": sl, "net_lots": nl, "buy_value": r.get("buy_value") or r.get("BuyValue"), "sell_value": r.get("sell_value") or r.get("SellValue"), "net_value": r.get("net_value") or r.get("NetValue") or r.get("net_idr"), "type": str(r.get("investor_type") or r.get("type") or "")})
    rows.sort(key=lambda x: x["net_lots"], reverse=True)
    total_buy = sum(max(0, r["net_lots"]) for r in rows)
    top3 = sum(max(0, r["net_lots"]) for r in rows[:3])
    concentration = (top3 / total_buy * 100) if total_buy > 0 else None
    payload = {"ticker": ticker, "available": True, "date": date, "as_of": datetime.now(UTC).isoformat(), "count": len(rows), "rows": rows[:25], "top3_concentration_pct": round(concentration, 1) if concentration is not None else None, "note": "Per-ticker broker attribution from Stockbit exodus.marketdetectors (requires JWT + Origin). Protobuf enums group_by=1 PRICE, order_by=1 TIME."}
    if rows:
        db.set(cache_key, payload)
    return payload


def _trading_dates(days: int) -> list[str]:
    try:
        days = max(5, min(90, int(days)))
    except (TypeError, ValueError):
        days = 20
    out: list[str] = []
    d = datetime.now(UTC).date()
    while len(out) < days:
        if d.weekday() < 5:
            out.append(d.strftime("%Y-%m-%d"))
        d -= timedelta(days=1)
    out.reverse()
    return out


def broker_history(ticker: str, days: int = 20, force: bool = False) -> dict[str, Any]:
    ticker = ticker.upper().strip()
    try:
        days = max(5, min(90, int(days)))
    except (TypeError, ValueError):
        days = 20
    dates = _trading_dates(days)
    cache_key = f"stockbit:history:{ticker}:{days}"
    if not force:
        cached = db.get_fresh(cache_key, BROKER_TTL)
        if cached is not None:
            return cached
    price_by_date: dict[str, float] = {}
    volume_by_date: dict[str, float] = {}
    try:
        from app.market import fetch_history
        hist = fetch_history(ticker, period="3mo", interval="1d")
        for r in hist:
            d = str(r.get("date", ""))[:10]
            if d:
                c = r.get("close")
                v = r.get("volume")
                try:
                    if c is not None:
                        price_by_date[d] = float(c)
                except (TypeError, ValueError):
                    pass
                try:
                    if v is not None:
                        volume_by_date[d] = float(v)
                except (TypeError, ValueError):
                    pass
    except Exception:
        pass
    per_day: list[dict[str, Any]] = []
    broker_series: dict[str, list[float]] = {}
    all_brokers: set[str] = set()
    jwt = load_jwt()
    for d in dates:
        rec = broker_summary(ticker, d, force=False)
        rows = rec.get("rows") if rec.get("available") else []
        try:
            net_top3 = sum(max(0, float(r.get("net_lots", 0) or 0)) for r in (rows or [])[:3])
        except (TypeError, ValueError):
            net_top3 = 0.0
        per_day.append({"date": d, "price": price_by_date.get(d), "volume": volume_by_date.get(d), "available": bool(rec.get("available")), "rows": rows or [], "top3_net": net_top3})
        for r in rows or []:
            b = str(r.get("broker", "?")).upper()
            all_brokers.add(b)
    for b in sorted(all_brokers):
        s: list[float] = []
        for day in per_day:
            row = next((x for x in day["rows"] if str(x.get("broker", "")).upper() == b), None)
            try:
                s.append(float(row.get("net_lots", 0) or 0) if row else 0.0)
            except (TypeError, ValueError):
                s.append(0.0)
        broker_series[b] = s
    foreign_series: list[float] | None = None
    if not jwt:
        foreign_series = []
        for _ in dates:
            foreign_series.append(0.0)
    payload = {"ticker": ticker, "available": jwt is not None or any(day["available"] for day in per_day), "days": days, "dates": dates, "per_day": per_day, "brokers": sorted(all_brokers), "series": broker_series, "price_by_date": price_by_date, "foreign_series": foreign_series, "as_of": datetime.now(UTC).isoformat(), "note": "Stockbit daily attribution on exodus (Bearer+Origin). Protobuf enums as-is."}
    db.set(cache_key, payload)
    return payload


def accumulation_scan(days: int = 20, limit: int = 50, watchlist: list[str] | None = None) -> dict[str, Any]:
    try:
        days = max(5, min(90, int(days)))
    except (TypeError, ValueError):
        days = 20
    try:
        limit = max(5, min(50, int(limit)))
    except (TypeError, ValueError):
        limit = 20
    cache_key = f"stockbit:accum:{days}:{limit}"
    cached = db.get_fresh(cache_key, 1800)
    if cached is not None:
        return cached
    if watchlist is None:
        try:
            from app.portfolio import get_watchlist
            wl = get_watchlist()
        except Exception:
            wl = []
        popular = ["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "ADRO", "ANTM", "MDKA", "AMMN", "GOTO", "BRPT", "BUMI", "PTRO", "MEDC"]
        universe = []
        for t in [*wl, *popular]:
            tt = str(t).upper().strip()
            if tt and tt not in universe:
                universe.append(tt)
            if len(universe) >= 30:
                break
    else:
        universe = [str(t).upper().strip() for t in watchlist if t][:30]
    rows: list[dict[str, Any]] = []
    for ticker in universe:
        try:
            hist = broker_history(ticker, days=days, force=False)
            per_day = hist.get("per_day", [])
            score = sum(float(d.get("top3_net", 0) or 0) for d in per_day)
            prices = [float(d.get("price", 0) or 0) for d in per_day if d.get("price")]
            price_change = None
            if len(prices) >= 2 and prices[0] > 0:
                price_change = (prices[-1] - prices[0]) / prices[0] * 100
            vols = [float(d.get("volume", 0) or 0) for d in per_day if d.get("volume")]
            avg_vol = sum(vols) / len(vols) if vols else None
            last_vol = vols[-1] if vols else None
            silent = False
            if price_change is not None and score > 0:
                silent = price_change <= 3.0
            rows.append({"ticker": ticker, "score": round(score, 1), "price_change_pct": round(price_change, 2) if price_change is not None else None, "avg_volume": round(avg_vol, 0) if avg_vol else None, "last_volume": round(last_vol, 0) if last_vol else None, "silent": silent, "days": days})
        except Exception as exc:  # noqa: BLE001
            logger.warning("accum %s failed: %s", ticker, exc)
    rows.sort(key=lambda x: x["score"], reverse=True)
    positive = [r for r in rows if r["score"] > 0]
    q_cut = 0
    if positive:
        scores_sorted = sorted(r["score"] for r in positive)
        try:
            q_idx = int(len(scores_sorted) * 0.75)
        except (TypeError, ValueError):
            q_idx = 0
        try:
            q_cut = scores_sorted[min(q_idx, len(scores_sorted) - 1)]
        except (IndexError, TypeError, ValueError):
            q_cut = 0
    for r in rows:
        r["silent"] = bool(r["silent"] and r["score"] >= q_cut and q_cut > 0)
    accumulation = [r for r in rows if r["score"] > 0][:limit]
    distribution = sorted(rows, key=lambda x: x["score"])[:limit]
    distribution = [r for r in distribution if r["score"] < 0]
    payload = {"available": True, "days": days, "universe": universe, "q_cut": q_cut, "accumulation": accumulation, "distribution": distribution, "as_of": datetime.now(UTC).isoformat(), "note": "Score = sum top-3 broker net lots. Silent = price <=3% + top-quartile. exodus only."}
    db.set(cache_key, payload)
    return payload


def stockbit_lpm_intensity(ticker: str, days: int = 60, force: bool = False) -> dict[str, Any]:
    """Legacy-shaped LPM endpoint, now backed by the causal Flow proxy.

    This used to compute a different, undocumented formula that looked into the
    next three bars' broker flow. That is look-ahead and cannot be used live.
    The response shape is preserved for older clients; the values are the same
    transparent proxy the `/api/flow` surface uses, and the metadata says so.
    """
    ticker = ticker.upper().strip()
    try:
        days = max(20, min(90, int(days)))
    except (TypeError, ValueError):
        days = 60
    cache_key = f"stockbit:lpm:{ticker}:{days}"
    if not force:
        cached = db.get_fresh(cache_key, 300)
        if cached is not None:
            return cached
    hist = broker_history(ticker, days=days, force=False)
    per_day = hist.get("per_day") or []
    ob = None
    try:
        ob = orderbook_snapshot(ticker, force=False)
    except Exception:
        ob = None

    import pandas as pd

    from app.flow import lpm as flow_lpm

    dates: list[str] = []
    prices: list[float | None] = []
    volumes: list[float] = []
    broker_lots: list[float] = []
    for row in per_day:
        date = str(row.get("date") or "")[:10]
        if not date:
            continue
        try:
            price = float(row.get("price")) if row.get("price") is not None else None
        except (TypeError, ValueError):
            price = None
        try:
            volume = float(row.get("volume") or 0.0)
        except (TypeError, ValueError):
            volume = 0.0
        try:
            top3 = float(row.get("top3_net") or 0.0)
        except (TypeError, ValueError):
            top3 = 0.0
        dates.append(date)
        prices.append(price)
        volumes.append(volume)
        broker_lots.append(top3)

    if not dates or not any(price is not None for price in prices):
        payload = {
            "ticker": ticker,
            "available": False,
            "days": days,
            "dates": [],
            "lpm": [],
            "score": [],
            "direction": [],
            "intensity": [],
            "orderbook": ob,
            "as_of": hist.get("as_of"),
            "source": "unavailable",
            "quality": "proxy",
            "warnings": ["no broker/price rows"],
        }
        db.set(cache_key, payload)
        return payload

    index = pd.to_datetime(dates, errors="coerce")
    closes = pd.Series(prices, index=index, dtype=float)
    volume_series = pd.Series(volumes, index=index, dtype=float)
    broker_series = pd.Series(broker_lots, index=index, dtype=float)
    frame = pd.DataFrame(
        {
            "Open": closes,
            "High": closes,
            "Low": closes,
            "Close": closes,
            "Volume": volume_series,
        },
        index=index,
    )
    frame, meta = flow_lpm.score_frame(frame, broker_net_lots=broker_series)
    avg_volume = volume_series.rolling(20, min_periods=1).mean()
    intensity = (volume_series / avg_volume).replace([float("inf"), float("-inf")], 0).fillna(0.0)

    def _clean(value: object) -> float | None:
        try:
            out = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        return None if out != out else round(out, 3)

    lpm_series = [_clean(value) for value in frame["lpm_price_space"].tolist()]
    score_series = [_clean(value) for value in frame["lpm_score"].tolist()]
    direction_series = [str(value) for value in frame["lpm_direction"].tolist()]
    intensity_series = [_clean(value) for value in intensity.tolist()]
    warnings = list(meta.get("warnings") or [])
    warnings.append("legacy endpoint now returns the causal Flow proxy, not the old formula")
    if float(frame["High"].sub(frame["Low"]).abs().sum()) == 0.0:
        warnings.append("OHLCV high/low unavailable; the CMF term is zero")
    payload = {
        "ticker": ticker,
        "available": bool(hist.get("available", False) or (isinstance(ob, dict) and ob.get("available"))),
        "days": days,
        "dates": dates,
        "lpm": lpm_series,
        "score": score_series,
        "direction": direction_series,
        "intensity": intensity_series,
        "orderbook": ob,
        "as_of": hist.get("as_of"),
        "source": meta.get("source"),
        "quality": "proxy",
        "warnings": warnings,
    }
    db.set(cache_key, payload)
    return payload


def lpm_stealth_scan(
    days: int = 20,
    price_threshold: float = 3.0,
    lpm_min_rise_pct: float = 1.0,
    intensity_min_rise_pct: float = 5.0,
    limit: int = 30,
    force: bool = False,
) -> dict[str, Any]:
    """Scanner: rising LPM + rising Intensity while price flat (stealth accumulation)."""
    try:
        days = max(10, min(60, int(days)))
    except (TypeError, ValueError):
        days = 20
    try:
        price_threshold = float(price_threshold)
    except (TypeError, ValueError):
        price_threshold = 3.0
    try:
        lpm_min_rise_pct = float(lpm_min_rise_pct)
    except (TypeError, ValueError):
        lpm_min_rise_pct = 1.0
    try:
        intensity_min_rise_pct = float(intensity_min_rise_pct)
    except (TypeError, ValueError):
        intensity_min_rise_pct = 5.0
    cache_key = f"stockbit:lpm_stealth:{days}:{price_threshold}:{lpm_min_rise_pct}:{intensity_min_rise_pct}"
    if not force:
        cached = db.get_fresh(cache_key, 1800)
        if cached is not None:
            return cached
    # universe = watchlist + popular (~30) — same as accumulation_scan
    try:
        from app.portfolio import get_watchlist
        wl = get_watchlist()
    except Exception:
        wl = []
    popular = ["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "ADRO", "ANTM", "MDKA", "AMMN", "GOTO", "BRPT", "BUMI", "PTRO", "MEDC", "BRMS", "CUAN", "DEWA"]
    universe: list[str] = []
    for t in [*wl, *popular]:
        tt = str(t).upper().strip()
        if tt and tt not in universe:
            universe.append(tt)
        if len(universe) >= 30:
            break
    rows: list[dict[str, Any]] = []
    for ticker in universe:
        try:
            data = stockbit_lpm_intensity(ticker, days=days, force=False)
            hist = broker_history(ticker, days=days, force=False)
            per_day = hist.get("per_day", [])
            prices = [float(d.get("price", 0) or 0) for d in per_day if d.get("price")]
            lpm = [x for x in (data.get("lpm") or []) if x is not None]
            intens = [x for x in (data.get("intensity") or []) if x is not None]
            if len(prices) < 5 or len(lpm) < 5 or len(intens) < 5:
                continue
            # price flat
            price_chg = (prices[-1] - prices[0]) / prices[0] * 100 if prices[0] else None
            # rising: compare avg last 5 vs first 5
            lpm_first = sum(lpm[:5]) / 5 if lpm[:5] else lpm[0]
            lpm_last = sum(lpm[-5:]) / 5 if len(lpm) >= 5 else lpm[-1]
            lpm_rise = (lpm_last - lpm_first) / lpm_first * 100 if lpm_first else 0
            int_first = sum(intens[:5]) / 5 if intens[:5] else intens[0]
            int_last = sum(intens[-5:]) / 5 if len(intens) >= 5 else intens[-1]
            int_rise = (int_last - int_first) / int_first * 100 if int_first else (100 if int_last > 0 else 0)
            # also show slope via tanh norm already in lpm
            flat = price_chg is not None and abs(price_chg) <= price_threshold
            rising = lpm_rise >= lpm_min_rise_pct and int_rise >= intensity_min_rise_pct
            score = round(lpm_rise + int_rise * 0.5, 2)
            rows.append({
                "ticker": ticker,
                "price": round(prices[-1], 2),
                "price_change_pct": round(price_chg, 2) if price_chg is not None else None,
                "lpm_first": round(lpm_first, 2),
                "lpm_last": round(lpm_last, 2),
                "lpm_rise_pct": round(lpm_rise, 2),
                "intensity_first": round(int_first, 3),
                "intensity_last": round(int_last, 3),
                "intensity_rise_pct": round(int_rise, 2),
                "flat": flat,
                "rising": rising,
                "stealth": bool(flat and rising),
                "score": score,
                "days": days,
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning("lpm stealth %s failed: %s", ticker, exc)
    # stealth first, then by score
    rows.sort(key=lambda x: (x["stealth"], x["score"]), reverse=True)
    stealth = [r for r in rows if r["stealth"]][:limit]
    # if stealth empty, return top rising anyway
    payload = {
        "available": stockbit_available(),
        "days": days,
        "price_threshold": price_threshold,
        "lpm_min_rise": lpm_min_rise_pct,
        "intensity_min_rise": intensity_min_rise_pct,
        "universe": universe,
        "count": len(rows),
        "stealth_count": len(stealth),
        "rows": rows[:limit],
        "stealth": stealth,
        "as_of": datetime.now(UTC).isoformat(),
        "note": "Stealth = flat price (<=threshold) + LPM rising + Intensity rising — proxy for silent accumulation.",
    }
    db.set(cache_key, payload)
    return payload
