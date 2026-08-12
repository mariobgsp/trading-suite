#!/usr/bin/env python3
"""
Backtester Engine
Fetches 5 years of historical data for a given ticker and the JCI index (^JKSE).
Evaluates correlation, and simulates trades for MACD, RSI, and Stochastic strategies.
Uses fixed Stop Loss (5%) and Trailing Stop (10%) to "cut losses early and let profits run".
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
import warnings

import pandas as pd
import yfinance as yf

# Suppress warnings from pandas and yfinance
warnings.filterwarnings("ignore")

REPO_ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = REPO_ROOT / "output"

JCI_TICKER = "^JKSE"
PERIOD = "5y"

STOP_LOSS_PCT = 0.05
TRAILING_STOP_PCT = 0.10

def fetch_data(ticker, period=PERIOD):
    try:
        tk = yf.Ticker(ticker)
        df = tk.history(period=period)
        if df.empty:
            return None
        # Make index timezone naive for easier comparison
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        return df
    except Exception as e:
        print(f"Error fetching data for {ticker}: {e}")
        return None

def calculate_macd(df):
    df = df.copy()
    ema12 = df['Close'].ewm(span=12, adjust=False).mean()
    ema26 = df['Close'].ewm(span=26, adjust=False).mean()
    df['MACD'] = ema12 - ema26
    df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
    df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']
    
    # Generate signals
    df['MACD_Signal_Cross'] = 0
    # Cross above (Golden Cross)
    mask_above = (df['MACD'] > df['MACD_Signal']) & (df['MACD'].shift(1) <= df['MACD_Signal'].shift(1))
    df.loc[mask_above, 'MACD_Signal_Cross'] = 1
    # Cross below (Death Cross)
    mask_below = (df['MACD'] < df['MACD_Signal']) & (df['MACD'].shift(1) >= df['MACD_Signal'].shift(1))
    df.loc[mask_below, 'MACD_Signal_Cross'] = -1
    return df

def calculate_rsi(df, window=14):
    df = df.copy()
    delta = df['Close'].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    
    avg_gain = gain.ewm(com=window-1, adjust=False).mean()
    avg_loss = loss.ewm(com=window-1, adjust=False).mean()
    
    rs = avg_gain / avg_loss
    df['RSI'] = 100 - (100 / (1 + rs))
    
    # Generate signals: 
    # Buy when RSI crosses above 30
    df['RSI_Signal'] = 0
    mask_buy = (df['RSI'] > 30) & (df['RSI'].shift(1) <= 30)
    df.loc[mask_buy, 'RSI_Signal'] = 1
    # Sell when RSI crosses below 70
    mask_sell = (df['RSI'] < 70) & (df['RSI'].shift(1) >= 70)
    df.loc[mask_sell, 'RSI_Signal'] = -1
    
    return df

def calculate_stochastic(df, window=14, smooth=3):
    df = df.copy()
    l14 = df['Low'].rolling(window=window).min()
    h14 = df['High'].rolling(window=window).max()
    
    df['Stoch_K'] = 100 * ((df['Close'] - l14) / (h14 - l14))
    df['Stoch_D'] = df['Stoch_K'].rolling(window=smooth).mean()
    
    # Generate signals:
    # Buy when K crosses above D, and both are < 20
    df['Stoch_Signal'] = 0
    mask_buy = (df['Stoch_K'] > df['Stoch_D']) & (df['Stoch_K'].shift(1) <= df['Stoch_D'].shift(1)) & (df['Stoch_D'] < 20)
    df.loc[mask_buy, 'Stoch_Signal'] = 1
    # Sell when K crosses below D, and both are > 80
    mask_sell = (df['Stoch_K'] < df['Stoch_D']) & (df['Stoch_K'].shift(1) >= df['Stoch_D'].shift(1)) & (df['Stoch_D'] > 80)
    df.loc[mask_sell, 'Stoch_Signal'] = -1
    
    return df

def simulate_trades(df, signal_col):
    """
    Simulate trades based on signal_col (1 for Buy, -1 for Sell).
    Applies fixed Stop Loss and Trailing Stop.
    """
    trades = []
    holding = False
    entry_price = 0
    highest_price = 0
    
    for date, row in df.iterrows():
        close = row['Close']
        low = row['Low']
        high = row['High']
        
        if not holding:
            if row[signal_col] == 1:
                holding = True
                entry_price = close
                highest_price = entry_price
        else:
            # Update highest price for trailing stop
            if high > highest_price:
                highest_price = high
                
            trigger = None
            sell_price = close
            
            # Check Stop Loss
            if low <= entry_price * (1 - STOP_LOSS_PCT):
                trigger = "Stop Loss"
                sell_price = entry_price * (1 - STOP_LOSS_PCT)
            
            # Check Trailing Stop
            elif low <= highest_price * (1 - TRAILING_STOP_PCT) and highest_price > entry_price:
                trigger = "Trailing Stop"
                sell_price = highest_price * (1 - TRAILING_STOP_PCT)
                
            # Check Opposite Signal
            elif row[signal_col] == -1:
                trigger = "Sell Signal"
                sell_price = close
                
            if trigger:
                profit_pct = (sell_price - entry_price) / entry_price * 100
                trades.append({
                    "trigger": trigger,
                    "profit_pct": profit_pct
                })
                holding = False
                entry_price = 0
                highest_price = 0

    if not trades:
        return {"total_trades": 0, "win_rate": 0.0, "avg_profit_pct": 0.0, "avg_loss_pct": 0.0}
        
    wins = [t['profit_pct'] for t in trades if t['profit_pct'] > 0]
    losses = [t['profit_pct'] for t in trades if t['profit_pct'] <= 0]
    
    win_rate = len(wins) / len(trades) * 100 if trades else 0
    avg_profit = sum(wins) / len(wins) if wins else 0
    avg_loss = sum(losses) / len(losses) if losses else 0
    
    return {
        "total_trades": len(trades),
        "win_rate": round(win_rate, 2),
        "avg_profit_pct": round(avg_profit, 2),
        "avg_loss_pct": round(avg_loss, 2)
    }

def analyze_correlation(jci_df, stock_df):
    """
    Check how the stock behaves when JCI closes lower.
    """
    if jci_df is None or stock_df is None:
        return None
        
    # Align dates
    common_index = jci_df.index.intersection(stock_df.index)
    if common_index.empty:
        return None
        
    jci = jci_df.loc[common_index]
    stock = stock_df.loc[common_index]
    
    jci_daily_ret = jci['Close'].pct_change()
    stock_daily_ret = stock['Close'].pct_change()
    
    # Days JCI went down
    jci_down_mask = jci_daily_ret < 0
    jci_down_days = jci_down_mask.sum()
    
    if jci_down_days == 0:
        return {"jci_down_days": 0, "stock_down_days": 0, "stock_up_days": 0, "resilience_pct": 0.0}
        
    # Of those days, how many did the stock go down vs up/unchanged?
    stock_down_on_jci_down = (stock_daily_ret[jci_down_mask] < 0).sum()
    stock_resilient_on_jci_down = (stock_daily_ret[jci_down_mask] >= 0).sum()
    
    resilience_pct = (stock_resilient_on_jci_down / jci_down_days) * 100
    
    return {
        "jci_down_days": int(jci_down_days),
        "stock_down_days": int(stock_down_on_jci_down),
        "stock_up_days": int(stock_resilient_on_jci_down),
        "resilience_pct": round(resilience_pct, 2)
    }

def main():
    # If a ticker is passed, use it. Otherwise, look for the main holding or default to BBCA.JK
    # A bit simplistic, but we can default to BBCA.JK if no args
    ticker = sys.argv[1] if len(sys.argv) > 1 else "BBCA.JK"
    
    print(f"Fetching 5y data for JCI ({JCI_TICKER}) and {ticker}...")
    jci_df = fetch_data(JCI_TICKER)
    stock_df = fetch_data(ticker)
    
    if stock_df is None or stock_df.empty:
        print(f"Failed to fetch data for {ticker}.")
        sys.exit(1)
        
    print("Calculating indicators...")
    df = calculate_macd(stock_df)
    df = calculate_rsi(df)
    df = calculate_stochastic(df)
    
    print("Simulating trades...")
    macd_stats = simulate_trades(df, 'MACD_Signal_Cross')
    rsi_stats = simulate_trades(df, 'RSI_Signal')
    stoch_stats = simulate_trades(df, 'Stoch_Signal')
    
    print("Analyzing JCI correlation...")
    corr_stats = analyze_correlation(jci_df, stock_df)
    
    results = {
        "generated_at": datetime.now().isoformat(),
        "ticker": ticker,
        "period": PERIOD,
        "jci_correlation": corr_stats,
        "macd_stats": macd_stats,
        "rsi_stats": rsi_stats,
        "stoch_stats": stoch_stats
    }
    
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "backtest_results.json"
    
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
        
    print(f"\n✅ Backtest complete for {ticker}.")
    print(json.dumps(results, indent=2))
    print(f"\nSaved to {out_path}")

if __name__ == "__main__":
    main()
