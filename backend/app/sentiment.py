"""News sentiment intelligence service.

Merges three source repos:
- sentiment-collector-analysis/app.py   (Google News RSS screener: whale radar,
  financials, corporate action, commodity/macro categories; tag extraction)
- trading-simulator/news_service.py     (IDX official + 7 RSS feeds)
- trading-simulator/news_analyzer.py    (keyword + optional Gemini sentiment)

Exposes a JSON API instead of Streamlit output.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

import feedparser

from app import db

logger = logging.getLogger(__name__)

CACHE_TTL = 600  # 10 minutes

# ─── Cleaners (from sentiment-collector-analysis/app.py) ─────────────────────


def clean_text(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r"<.*?>", "", text)
    clean = clean.replace("&nbsp;", " ").replace("&#39;", "'").replace("&quot;", '"')
    clean = clean.split(" - ")[0]
    return clean.strip()


def extract_tags(text: str) -> list[str]:
    t = text.lower()
    tags: set[str] = set()

    if any(x in t for x in ["q1", "kuartal i", "triwulan i"]):
        tags.add("Kinerja Q1")
    if any(x in t for x in ["q2", "kuartal ii", "triwulan ii", "semester i"]):
        tags.add("Kinerja Q2/H1")
    if any(x in t for x in ["q3", "kuartal iii", "triwulan iii"]):
        tags.add("Kinerja Q3")
    if any(x in t for x in ["q4", "kuartal iv", "full year", "tahunan"]):
        tags.add("Kinerja FY")

    if any(x in t for x in ["laba", "profit", "cuan", "untung"]):
        tags.add("Laba Bersih")
    if any(x in t for x in ["rugi", "boncos", "kerugian"]):
        tags.add("Rugi")
    if any(x in t for x in ["pendapatan", "revenue", "omzet"]):
        tags.add("Pendapatan")
    if any(x in t for x in ["dividen", "dividend"]):
        tags.add("Dividen")

    if any(x in t for x in ["akuisisi", "caplok", "beli saham", "ambil alih"]):
        tags.add("Akuisisi/Merger")
    if any(x in t for x in ["belanja modal", "capex", "ekspansi", "pabrik baru", "proyek baru"]):
        tags.add("Ekspansi/Capex")
    if any(x in t for x in ["jual aset", "divestasi", "lepas saham"]):
        tags.add("Divestasi")
    if any(x in t for x in ["right issue", "hmetd", "private placement"]):
        tags.add("Right Issue/PP")
    if any(x in t for x in ["stock split", "pemecahan saham"]):
        tags.add("Stock Split")
    if any(x in t for x in ["ipo", "saham perdana", "listing"]):
        tags.add("IPO")
    if any(x in t for x in ["buyback", "beli kembali"]):
        tags.add("Buyback")

    if any(x in t for x in ["prajogo", "thohir", "salim", "low tuck kwong", "insider", "borong"]):
        tags.add("Whale/Insider")
    if any(x in t for x in ["suspensi", "uma", "gembok"]):
        tags.add("Suspensi/UMA")

    if any(x in t for x in ["batubara", "coal"]):
        tags.add("Batubara")
    if any(x in t for x in ["emas", "gold"]):
        tags.add("Emas")
    if any(x in t for x in ["cpo", "sawit"]):
        tags.add("CPO")

    return sorted(tags)


def analyze_category(title: str) -> dict[str, str]:
    """Main category + accent color + CSS class for a headline."""
    tl = title.lower()

    if any(x in tl for x in ["prajogo", "thohir", "salim", "insider", "borong"]):
        return {"category": "WHALE", "label": "Whale / Insider", "color": "#9C27B0"}
    if any(
        x in tl
        for x in [
            "laba",
            "rugi",
            "kuartal",
            "q1",
            "q2",
            "q3",
            "fy",
            "kinerja",
            "pendapatan",
            "tumbuh",
        ]
    ):
        return {"category": "KINERJA", "label": "Financials", "color": "#00C853"}
    if any(
        x in tl
        for x in [
            "merger",
            "akuisisi",
            "capex",
            "ekspansi",
            "divestasi",
            "right issue",
            "stock split",
            "ipo",
            "buyback",
            "dividen",
        ]
    ):
        return {"category": "ACTION", "label": "Corporate Action", "color": "#FFC107"}
    if any(x in tl for x in ["batubara", "emas", "cpo", "nikel", "minyak", "timah"]):
        return {"category": "KOMODITAS", "label": "Commodities", "color": "#FF5722"}
    return {"category": "GLOBAL", "label": "Global / Macro", "color": "#03A9F4"}


def _analyze_sentiment(text: str) -> dict[str, Any]:
    """Keyword sentiment scoring (port of news_analyzer keyword logic)."""
    t = text.lower()
    positive = [
        "laba",
        "profit",
        "tumbuh",
        "naik",
        "meningkat",
        "rekor",
        "cuan",
        "optimis",
        "akuisisi",
        "ekspansi",
        "dividen",
        "buyback",
        "borong",
        "target",
    ]
    negative = [
        "rugi",
        "turun",
        "anjlok",
        "jeblok",
        "melemah",
        "suspensi",
        "gagal",
        "tunda",
        "krisis",
        "turunkan",
        "potong",
        "warning",
        "delisting",
    ]
    pos = sum(1 for w in positive if w in t)
    neg = sum(1 for w in negative if w in t)
    if pos == neg == 0:
        sentiment, score = "neutral", 0.0
    elif pos > neg:
        sentiment, score = "positive", round(min(1.0, 0.3 + 0.2 * (pos - neg)), 2)
    else:
        sentiment, score = "negative", round(-min(1.0, 0.3 + 0.2 * (neg - pos)), 2)
    return {"sentiment": sentiment, "score": score}


# ─── Google News RSS (sentiment-collector-analysis engine) ───────────────────

_QUERIES = [
    (
        '(Prajogo OR Thohir OR Salim OR "Insider Trading" OR "Borong Saham" OR "Private Placement") '
        "site:kontan.co.id OR site:bisnis.com OR site:cnbcindonesia.com OR site:investor.id "
        "OR site:bloombergtechnoz.com -bola -sepak -seleb -artis -gosip -viral -kriminal -polisi when:7d"
    ),
    '("Laba Bersih" OR "Rugi Bersih" OR "Kinerja Keuangan" OR "Pendapatan" OR Kuartal OR Q1 OR Q2 OR Q3 OR Q4) '
    "site:kontan.co.id OR site:bisnis.com OR site:cnbcindonesia.com OR site:investor.id when:7d",
    '(Akuisisi OR Merger OR "Belanja Modal" OR Capex OR Ekspansi OR "Right Issue" OR Dividen OR Buyback OR "Stock Split") '
    "site:kontan.co.id OR site:bisnis.com OR site:cnbcindonesia.com OR site:investor.id when:7d",
    '(Batubara OR Emas OR CPO OR Nikel OR Minyak OR "The Fed" OR Inflasi) '
    "site:kontan.co.id OR site:bisnis.com OR site:cnbcindonesia.com OR site:investor.id when:7d",
]


def _fetch_google_news() -> list[dict[str, Any]]:
    from dateutil import parser as date_parser

    all_news: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    for q in _QUERIES:
        encoded = q.replace(" ", "%20").replace('"', "%22")
        url = f"https://news.google.com/rss/search?q={encoded}&hl=id&gl=ID&ceid=ID:id"
        try:
            feed = feedparser.parse(url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("google news query failed: %s", exc)
            continue
        if not feed.entries:
            continue
        for entry in feed.entries:
            if entry.link in seen_urls:
                continue
            seen_urls.add(entry.link)
            title = clean_text(entry.title)
            if len(title) < 10 or "<" in title:
                continue
            cat = analyze_category(title)
            tags = extract_tags(title)
            source = entry.source.title if "source" in entry else "News"
            try:
                dt = date_parser.parse(entry.published)
            except Exception:  # noqa: BLE001
                dt = datetime.now(UTC)
            sentiment = _analyze_sentiment(title)
            all_news.append(
                {
                    "date": dt.isoformat(),
                    "date_str": dt.strftime("%d %b %H:%M"),
                    "source": source,
                    "title": title,
                    "link": entry.link,
                    "category": cat["category"],
                    "label": cat["label"],
                    "color": cat["color"],
                    "tags": tags,
                    **sentiment,
                }
            )

    all_news.sort(key=lambda n: n["date"], reverse=True)
    return all_news


def fetch_sentiment_news(force: bool = False) -> dict[str, Any]:
    """Fetch + cache the sentiment news feed."""
    cache_key = "sentiment:news"
    if not force:
        cached = db.get_fresh(cache_key, CACHE_TTL)
        if cached is not None:
            return cached

    items = _fetch_google_news()
    payload = {"generated_at": db.utcnow_iso(), "count": len(items), "items": items}
    if items:
        # Only cache non-empty results: a network failure yielding zero
        # items must not poison the cache as "authoritative empty".
        db.set(cache_key, payload)
    else:
        payload["degraded"] = True
    return payload


# ─── IDX official news (trading-simulator/news_service.py adapter) ───────────

_IDX_RSS_FEEDS = [
    ("idx", "https://www.idx.co.id/wp-json/wp/v2/posts?per_page=20"),
    ("cnbc", "https://www.cnbcindonesia.com/investasi/rss"),
    ("detik", "https://finance.detik.com/berita-ekonomi-bisnis/indeks"),
    ("kontan", "https://feedpress.me/kontan"),
]


def fetch_idx_news(force: bool = False) -> dict[str, Any]:
    """IDX + local finance feeds (RSS/JSON), cached."""
    import requests

    cache_key = "sentiment:idx"
    if not force:
        cached = db.get_fresh(cache_key, CACHE_TTL)
        if cached is not None:
            return cached

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source_name, url in _IDX_RSS_FEEDS:
        try:
            if url.endswith("posts?per_page=20"):
                resp = requests.get(url, timeout=8)
                for post in resp.json():
                    title = clean_text(post.get("title", {}).get("rendered", ""))
                    link = post.get("link", "")
                    if not title or link in seen:
                        continue
                    seen.add(link)
                    cat = analyze_category(title)
                    senti = _analyze_sentiment(title)
                    items.append(
                        {
                            "date": post.get("date", ""),
                            "date_str": (post.get("date") or "")[:16].replace("T", " "),
                            "source": "IDX",
                            "title": title,
                            "link": link,
                            "category": cat["category"],
                            "label": cat["label"],
                            "color": cat["color"],
                            "tags": extract_tags(title),
                            **senti,
                        }
                    )
            else:
                feed = feedparser.parse(url)
                for entry in feed.entries:
                    title = clean_text(entry.title)
                    link = entry.link
                    if not title or link in seen:
                        continue
                    seen.add(link)
                    cat = analyze_category(title)
                    senti = _analyze_sentiment(title)
                    items.append(
                        {
                            "date": getattr(entry, "published", "") or "",
                            "date_str": "",
                            "source": source_name.upper(),
                            "title": title,
                            "link": link,
                            "category": cat["category"],
                            "label": cat["label"],
                            "color": cat["color"],
                            "tags": extract_tags(title),
                            **senti,
                        }
                    )
        except Exception as exc:  # noqa: BLE001 - one feed failing must not kill the bundle
            logger.warning("feed %s failed: %s", source_name, exc)

    payload = {"generated_at": db.utcnow_iso(), "count": len(items), "items": items}
    if items:
        # Only cache non-empty results (see fetch_sentiment_news).
        db.set(cache_key, payload)
    else:
        payload["degraded"] = True
    return payload
