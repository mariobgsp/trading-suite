#!/usr/bin/env python3
"""
Liquidity Pressure Intensity (LPI) Calculator
=============================================
Fetches orderbook data from Stockbit API, calculates LPI from real bid/ask depth,
and stores daily snapshots for historical analysis.

LPI Formula (Orderbook-based):
- Bid Volume Weighted by Price Distance (buy pressure)
- Ask Volume Weighted by Price Distance (sell pressure)
- Normalized imbalance score
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import requests

# Add repo root to path for stockbit import
REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT))

from stockbit import StockbitClient

WIB = timezone(timedelta(hours=7))
LPI_HISTORY_PATH = REPO_ROOT / "lpi_history.json"

# Configuration
LPI_DEPTH_LEVELS = 10  # Number of depth levels to analyze
LPI_HISTORY_DAYS = 90  # Keep last 90 days of data


def load_lpi_history() -> list[dict]:
    """Load existing LPI history from JSON file."""
    if LPI_HISTORY_PATH.exists():
        try:
            with open(LPI_HISTORY_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except (json.JSONDecodeError, OSError) as e:
            print(f"[WARN] Could not load LPI history: {e}")
    return []


def save_lpi_history(history: list[dict]) -> None:
    """Save LPI history to JSON file."""
    try:
        with open(LPI_HISTORY_PATH, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[ERROR] Could not save LPI history: {e}")


def calculate_lpi_from_orderbook(orderbook: dict) -> dict:
    """
    Calculate Liquidity Pressure Intensity from orderbook data.
    
    Stockbit orderbook structure (typical):
    {
        "data": {
            "bids": [{"price": 1000, "volume": 1000, "orders": 5}, ...],
            "asks": [{"price": 1010, "volume": 500, "orders": 3}, ...],
            "last_price": 1005
        }
    }
    
    LPI Components:
    1. Bid Pressure = Sum(bid_volume * weight) where weight = 1 - (price_distance / max_distance)
    2. Ask Pressure = Sum(ask_volume * weight) where weight = 1 - (price_distance / max_distance)
    3. LPI = (Bid_Pressure - Ask_Pressure) / (Bid_Pressure + Ask_Pressure)  -> range [-1, 1]
    4. Total Liquidity = Bid_Pressure + Ask_Pressure (for intensity)
    """
    try:
        data = orderbook.get('data', {})
        bids = data.get('bids', [])
        asks = data.get('asks', [])
        last_price = data.get('last_price')
        
        if not bids or not asks or last_price is None:
            return {"error": "Invalid orderbook data"}
        
        # Limit to configured depth levels
        bids = bids[:LPI_DEPTH_LEVELS]
        asks = asks[:LPI_DEPTH_LEVELS]
        
        # Calculate max price distances for weighting
        if len(bids) > 1:
            max_bid_dist = bids[0]['price'] - bids[-1]['price']
        else:
            max_bid_dist = 0
            
        if len(asks) > 1:
            max_ask_dist = asks[-1]['price'] - asks[0]['price']
        else:
            max_ask_dist = 0
        
        max_dist = max(max_bid_dist, max_ask_dist)
        if max_dist == 0:
            max_dist = 1
        
        # Calculate weighted bid pressure
        bid_pressure = 0.0
        total_bid_vol = 0
        for bid in bids:
            price_dist = (last_price - bid['price']) / max_dist if max_dist > 0 else 0
            weight = max(0.1, 1.0 - abs(price_dist))  # Closer to mid = higher weight
            bid_pressure += bid['volume'] * weight
            total_bid_vol += bid['volume']
        
        # Calculate weighted ask pressure
        ask_pressure = 0.0
        total_ask_vol = 0
        for ask in asks:
            price_dist = (ask['price'] - last_price) / max_dist if max_dist > 0 else 0
            weight = max(0.1, 1.0 - abs(price_dist))
            ask_pressure += ask['volume'] * weight
            total_ask_vol += ask['volume']
        
        # LPI Score: normalized imbalance [-1, 1]
        total_pressure = bid_pressure + ask_pressure
        if total_pressure > 0:
            lpi_score = (bid_pressure - ask_pressure) / total_pressure
        else:
            lpi_score = 0.0
        
        # Intensity: total liquidity available (normalized)
        total_volume = total_bid_vol + total_ask_vol
        intensity = total_volume / 100000.0  # Normalize by typical volume scale
        intensity = min(1.0, max(0.0, intensity))
        
        # Spread component
        best_bid = bids[0]['price'] if bids else last_price
        best_ask = asks[0]['price'] if asks else last_price
        spread = best_ask - best_bid
        spread_pct = (spread / last_price * 100) if last_price > 0 else 0
        
        return {
            "lpi_score": round(lpi_score, 4),
            "intensity": round(intensity, 4),
            "bid_pressure": round(bid_pressure, 2),
            "ask_pressure": round(ask_pressure, 2),
            "total_bid_volume": total_bid_vol,
            "total_ask_volume": total_ask_vol,
            "spread": round(spread, 2),
            "spread_pct": round(spread_pct, 4),
            "last_price": last_price,
            "timestamp": datetime.now(tz=WIB).isoformat(),
            "depth_levels": len(bids) + len(asks)
        }
        
    except Exception as e:
        return {"error": f"LPI calculation failed: {e}"}


def capture_lpi_for_ticker(ticker: str, client: StockbitClient) -> dict | None:
    """Capture LPI for a single ticker from Stockbit orderbook."""
    # Stockbit expects ticker without .JK suffix for Indonesian stocks
    emiten = ticker.replace('.JK', '')
    
    orderbook = client.fetch_orderbook(emiten)
    if not orderbook:
        print(f"[WARN] No orderbook data for {ticker}")
        return None
    
    lpi_result = calculate_lpi_from_orderbook(orderbook)
    if "error" in lpi_result:
        print(f"[WARN] LPI calc error for {ticker}: {lpi_result['error']}")
        return None
    
    return {
        "ticker": ticker,
        "emiten": emiten,
        **lpi_result
    }


def run_lpi_capture(tickers: list[str], token: str = None) -> None:
    """
    Main function to capture LPI for all tickers.
    Can be called from engine.py or run standalone.
    """
    client = StockbitClient(token=token)
    
    if not client.token:
        print("[ERROR] STOCKBIT_JWT_TOKEN not set. Cannot fetch orderbook.")
        return
    
    today_str = datetime.now(tz=WIB).strftime("%Y-%m-%d")
    print(f"[LPI] Capturing orderbook snapshots for {len(tickers)} tickers... ({today_str})")
    
    # Load existing history
    history = load_lpi_history()
    
    # Check if we already have data for today for these tickers
    existing_today = {entry['ticker'] for entry in history 
                      if entry.get('date') == today_str}
    
    new_entries = []
    for ticker in tickers:
        if ticker in existing_today:
            print(f"  → {ticker}: Already captured today")
            continue
            
        result = capture_lpi_for_ticker(ticker, client)
        if result:
            entry = {
                "date": today_str,
                **result
            }
            new_entries.append(entry)
            history.append(entry)
            score = result['lpi_score']
            intensity = result['intensity']
            direction = "BUY" if score > 0 else "SELL" if score < 0 else "NEUTRAL"
            print(f"  → {ticker}: LPI={score:+.3f} ({direction}) Intensity={intensity:.2f} Spread={result['spread_pct']:.2f}%")
    
    # Prune old entries (keep last N days per ticker)
    cutoff_date = (datetime.now(tz=WIB) - timedelta(days=LPI_HISTORY_DAYS)).strftime("%Y-%m-%d")
    original_len = len(history)
    history = [e for e in history if e.get('date', '') >= cutoff_date]
    pruned = original_len - len(history)
    
    if pruned > 0:
        print(f"[LPI] Pruned {pruned} entries older than {LPI_HISTORY_DAYS} days")
    
    # Save updated history
    if new_entries or pruned > 0:
        save_lpi_history(history)
        print(f"[LPI] Saved {len(new_entries)} new entries. Total: {len(history)}")
    else:
        print("[LPI] No new data captured")


def get_lpi_history_for_ticker(ticker: str, days: int = 30) -> list[dict]:
    """Get LPI history for a specific ticker (last N days)."""
    history = load_lpi_history()
    ticker_history = [e for e in history if e.get('ticker') == ticker]
    # Sort by date descending
    ticker_history.sort(key=lambda x: x.get('date', ''), reverse=True)
    return ticker_history[:days]


if __name__ == "__main__":
    # Load tickers from watchlist.json
    watchlist_path = REPO_ROOT / "watchlist.json"
    if watchlist_path.exists():
        with open(watchlist_path, 'r') as f:
            tickers = json.load(f)
    else:
        tickers = ["BBCA.JK", "BBRI.JK", "BMRI.JK", "TLKM.JK", "AAPL", "TSLA"]
    
    # Get token from env
    token = os.environ.get("STOCKBIT_JWT_TOKEN")
    
    run_lpi_capture(tickers, token)