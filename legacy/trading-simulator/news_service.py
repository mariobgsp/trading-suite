import json
import requests
import xml.etree.ElementTree as ET
import os
import logging
import re
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "news_config.json")
DATA_PATH = os.path.join(BASE_DIR, "news_data.json")

def fetch_rss(url):
    try:
        response = requests.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        response.raise_for_status()
        return response.content
    except Exception as e:
        logger.error(f"Error fetching {url}: {e}")
        return None

def parse_rss(xml_content, source_config):
    news_items = []
    source_name = source_config.get('name')
    region = source_config.get('region', 'Global')
    
    try:
        root = ET.fromstring(xml_content)
        for item in root.findall(".//item"):
            title = item.find("title").text if item.find("title") is not None else "No Title"
            link = item.find("link").text if item.find("link") is not None else ""
            pub_date = item.find("pubDate").text if item.find("pubDate") is not None else ""
            description = item.find("description").text if item.find("description") is not None else ""
            
            # Simple ticker extraction (4-letter uppercase words)
            tickers = re.findall(r'\b[A-Z]{4}\b', title + " " + description)
            # Filter out common non-ticker words
            EXCLUDED = {'BUMN', 'IHSG', 'APBN', 'ASPE', 'DPJP', 'PSIB', 'KPKI', 'BKPM', 'BIKA', 'OJKI', 'BEII', 'BRIN'}
            tickers = [t for t in set(tickers) if t not in EXCLUDED]
            
            news_items.append({
                "id": hash(link),
                "title": title,
                "link": link,
                "timestamp": pub_date,
                "source": source_name,
                "region": region,
                "description": description,
                "tickers": tickers,
                "status": "raw"
            })
    except Exception as e:
        logger.error(f"Error parsing RSS for {source_name}: {e}")
    return news_items

def fetch_idx_news():
    url = "https://www.idx.co.id/primary/NewsAnnouncement/GetNewsSearch?locale=id-id&pageNumber=1&pageSize=12&isHeadline=1"
    try:
        # Using a browser-like user agent to avoid Cloudflare blocks
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.idx.co.id/id/berita/berita/'
        }
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        data = response.json()
        
        idx_news = []
        for item in data.get("Items", []):
            idx_news.append({
                "id": f"idx_{item.get('ItemId')}",
                "title": item.get("Title", "No Title"),
                "link": f"https://www.idx.co.id/id/berita/berita/", # Base URL as links are internal
                "timestamp": item.get("PublishedDate"),
                "source": "IDX Official",
                "region": "ID",
                "description": item.get("Summary", ""),
                "tickers": item.get("Tags", "").split(", ") if item.get("Tags") else [],
                "status": "raw"
            })
        return idx_news
    except Exception as e:
        logger.error(f"Error fetching IDX news: {e}")
        return []

def run():
    if not os.path.exists(CONFIG_PATH):
        logger.error("Config file not found.")
        return

    with open(CONFIG_PATH, 'r') as f:
        config = json.load(f)

    all_news = []
    
    # 1. Fetch IDX Official FIRST (Higher priority)
    logger.info("Fetching IDX Official news...")
    idx_items = fetch_idx_news()
    all_news.extend(idx_items)

    # 2. Fetch RSS sources
    for source in config.get("sources", []):
        logger.info(f"Fetching from {source['name']} ({source['region']})...")
        content = fetch_rss(source['url'])
        if content:
            items = parse_rss(content, source)
            all_news.extend(items)

    # Load existing news
    existing_news = []
    if os.path.exists(DATA_PATH):
        try:
            with open(DATA_PATH, 'r') as f:
                existing_news = json.load(f)
        except:
            existing_news = []

    # Merge and avoid duplicates based on ID
    existing_ids = {str(item.get('id')) for item in existing_news}
    new_items = [item for item in all_news if str(item.get('id')) not in existing_ids]
    
    combined = new_items + existing_news
    
    # Sort by timestamp if possible
    def get_timestamp(item):
        ts = item.get('timestamp', '')
        try:
            # Try to parse common RSS formats
            return datetime.strptime(ts, '%a, %d %b %Y %H:%M:%S %z').timestamp()
        except:
            try:
                # Try to parse IDX format (e.g. 2026-05-13T...)
                return datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
            except:
                return 0

    combined.sort(key=get_timestamp, reverse=True)

    # Keep last 500 items, but ALWAYS preserve IDX Official items
    idx_official = [item for item in combined if item.get('source') == 'IDX Official']
    others = [item for item in combined if item.get('source') != 'IDX Official']
    
    # Take top 500 from others, then merge and re-sort
    others = others[:500]
    final_combined = idx_official + others
    final_combined.sort(key=get_timestamp, reverse=True)

    with open(DATA_PATH, 'w') as f:
        json.dump(final_combined, f, indent=2)
    
    logger.info(f"Successfully processed {len(new_items)} new items. Total items in DB: {len(final_combined)}")

if __name__ == "__main__":
    run()
