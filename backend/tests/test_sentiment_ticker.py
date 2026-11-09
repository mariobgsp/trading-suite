"""The per-ticker news query names the issuer and caches its answer."""

from __future__ import annotations

import pytest

from app import db, sentiment

CODE = "ZZZZ"
CACHE_KEY = f"sentiment:ticker:{CODE}"


@pytest.fixture(autouse=True)
def _clear_ticker_cache():
    db.delete(CACHE_KEY)
    yield
    db.delete(CACHE_KEY)


def _item(title: str = "ZZZZ books a profit") -> dict:
    return {
        "date": "2026-11-08T10:00:00+00:00",
        "date_str": "08 Nov 10:00",
        "source": "Kontan",
        "title": title,
        "link": "https://kontan.co.id/" + title.replace(" ", "-"),
    }


def test_query_names_the_ticker_and_the_company(monkeypatch):
    queries: list[str] = []

    def fake(query: str) -> list[dict]:
        queries.append(query)
        return [_item(), _item("ZZZZ second headline")]

    monkeypatch.setattr(sentiment, "_google_items", fake)
    payload = sentiment.fetch_ticker_news(CODE, "Zeta Corp")

    assert payload["available"] is True
    assert payload["count"] == 2
    assert CODE in queries[0]
    assert "Zeta Corp" in queries[0]
    assert "when:30d" in queries[0]


def test_second_call_is_served_from_the_cache(monkeypatch):
    calls: list[str] = []

    def fake(query: str) -> list[dict]:
        calls.append(query)
        return [_item()]

    monkeypatch.setattr(sentiment, "_google_items", fake)
    first = sentiment.fetch_ticker_news(CODE, "")
    second = sentiment.fetch_ticker_news(CODE, "")

    assert len(calls) == 1
    assert first["count"] == second["count"] == 1


def test_no_headlines_is_a_real_answer(monkeypatch):
    monkeypatch.setattr(sentiment, "_google_items", lambda query: [])
    payload = sentiment.fetch_ticker_news(CODE, "")
    assert payload["available"] is True
    assert payload["items"] == []
    assert "no headlines" in payload["warnings"][0]


def test_market_headlines_are_not_this_stocks_news(monkeypatch):
    monkeypatch.setattr(
        sentiment,
        "_google_items",
        lambda query: [
            _item("IHSG menguat, simak rekomendasi saham hari ini"),
            _item("ZZZZ cetak rekor laba"),
            _item("Zeta Corp bukukan laba bersih"),
        ],
    )
    payload = sentiment.fetch_ticker_news(CODE, "Zeta Corp")
    titles = [item["title"] for item in payload["items"]]
    assert "ZZZZ cetak rekor laba" in titles
    assert "Zeta Corp bukukan laba bersih" in titles
    assert all("IHSG" not in title for title in titles)
