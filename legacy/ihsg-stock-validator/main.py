import sys
import argparse
import yfinance as yf
import pandas as pd
import numpy as np
import warnings
import re
from typing import Tuple

# Suppress warnings
warnings.filterwarnings("ignore")

class StockAnalyzer:
    def __init__(self, ticker: str):
        self.raw_ticker = ticker.strip().upper()
        self.ticker, self.clean_ticker = self._resolve_ticker(self.raw_ticker)

    def _resolve_ticker(self, ticker: str) -> Tuple[str, str]:
        base = ticker.replace(".JK", "")
        if re.match(r'^[A-Z]{4}$', base) or re.match(r'^[A-Z]{4}-[A-Z]$', base):
            return f"{base}.JK", base
        return (ticker if ticker.endswith(".JK") else f"{ticker}.JK"), base

    # --- BASIC INDICATORS ---
    def calculate_rsi(self, series: pd.Series, length: int = 14) -> pd.Series:
        delta = series.diff()
        gain = (delta.where(delta > 0, 0)).ewm(alpha=1/length, min_periods=length).mean()
        loss = (-delta.where(delta < 0, 0)).ewm(alpha=1/length, min_periods=length).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))

    def calculate_vwap_rolling(self, df, window=20):
        v = df['volume']
        p = df['close']
        return (p * v).rolling(window).sum() / v.rolling(window).sum()

    def calculate_nvi(self, close, volume) -> pd.Series:
        nvi_vals = [1000]
        vol_arr = volume.values
        close_arr = close.values
        for i in range(1, len(close)):
            if vol_arr[i] < vol_arr[i-1]:
                new_val = nvi_vals[-1] * (close_arr[i] / close_arr[i-1])
                nvi_vals.append(new_val)
            else:
                nvi_vals.append(nvi_vals[-1])
        return pd.Series(nvi_vals, index=close.index)

    # --- ADVANCED METRICS (NEW) ---
    def calculate_advanced_metrics(self, df):
        # 1. Institutional Flow (Approximation using Volume Force)
        # Positive = Buying Pressure, Negative = Selling Pressure
        change = df['close'].diff()
        df['inst_flow'] = change * df['volume']
        df['inst_flow_ma'] = df['inst_flow'].rolling(5).mean() # Smoothed 5 days

        # 2. Retail Liquidity (Amihud Illiquidity Proxy) & Inverse
        # Retail Liquidity High = Price moves fast on low vol (Thin/Retail)
        # Inverse High = Price stable on high vol (Absorption/Institutional)
        epsilon = 0.0000001
        abs_return = abs(df['close'].pct_change())
        dollar_vol = df['close'] * df['volume']
        
        # Amihud: |Return| / Dollar Volume
        df['retail_liquidity'] = (abs_return / (dollar_vol + epsilon)) * 1_000_000_000 
        
        # Inverse: Dollar Volume / |Return| (Absorption capability)
        df['inv_retail_liquidity'] = (dollar_vol / (abs_return + epsilon)) / 1_000_000_000

        # 3. Dormant Index (0-100)
        # High score = Low Volume + Low Range (Sleeping)
        vol_ratio = df['volume'] / (df['volume'].rolling(20).max() + epsilon)
        range_ratio = (df['high']-df['low']) / ((df['high']-df['low']).rolling(20).max() + epsilon)
        df['dormant_index'] = (1 - ((vol_ratio + range_ratio) / 2)) * 100

        # 4. Confirmed Flow Index (Score 0-4)
        # Composite score of Trend, VWAP, NVI, and Volume
        c1 = (df['close'] > df['close'].ewm(span=20).mean()).astype(int) # Price > EMA20
        c2 = (df['close'] > df['vwap']).astype(int)                     # Price > VWAP
        c3 = (df['nvi'] > df['nvi_ma']).astype(int)                     # Smart Money Inflow
        c4 = (df['volume'] > df['vol_ma']).astype(int)                  # High Volume
        df['conf_flow_index'] = c1 + c2 + c3 + c4

        return df

    # --- LIQUIDITY & CLASSIFICATION ---
    def check_liquidity(self, df, window=20):
        df['value'] = df['close'] * df['volume']
        avg_value = df['value'].rolling(window).mean().iloc[-1]
        
        def format_idr(val):
            if val >= 1_000_000_000_000: return f"Rp {val/1_000_000_000_000:.1f} T"
            if val >= 1_000_000_000: return f"Rp {val/1_000_000_000:.1f} M"
            if val >= 1_000_000: return f"Rp {val/1_000_000:.1f} Jt"
            return f"Rp {val:,.0f}"

        val_str = format_idr(avg_value)
        is_small_cap = avg_value < 1_000_000_000 
        
        if avg_value > 10_000_000_000:
            return "✅ HIGH LIQUIDITY", val_str, False
        elif avg_value > 1_000_000_000:
            return "✅ LIQUID", val_str, False
        elif avg_value > 200_000_000:
            return "⚠️ SMALL CAP (Volatile)", val_str, True
        else:
            return "❌ ILLIQUID (Gorengan)", val_str, True

    # --- CORE LOGIC (SMALL CAP OPTIMIZED) ---
    def get_bandar_phase(self, price, vwap):
        diff = ((price - vwap) / vwap) * 100
        if diff < -2.0: return "ACCUMULATION (Undervalued)", diff
        if -2.0 <= diff <= 2.0: return "BASE / HOLD (Fair Value)", diff
        return "MARKUP / DISTRIBUTION (Overvalued)", diff

    def detect_hidden_intent(self, curr, prev, vwap, is_small_cap=False) -> str:
        vol = curr['volume']
        avg_vol = curr['vol_ma'] if curr['vol_ma'] > 0 else 1.0
        
        range_hl = curr['high'] - curr['low']
        if range_hl == 0: mfm = 0
        else: mfm = ((curr['close'] - curr['low']) - (curr['high'] - curr['close'])) / range_hl
        
        chg = (curr['close'] - prev['close']) / prev['close'] if prev['close'] > 0 else 0
        is_price_up = chg > 0.001
        is_price_down = chg < -0.001
        is_flat = abs(chg) < 0.005
        
        vol_threshold_spike = 1.1 if is_small_cap else 1.3
        vol_threshold_low = 0.5 if is_small_cap else 0.6
        
        if curr['close'] > vwap * 1.02 and vol > avg_vol and mfm < -0.1:
             return "DISTRIBUTION (Profit Taking)"

        if is_price_up and mfm < -0.1:
            return "SILENT EXIT (Jebakan)"
            
        if is_small_cap and vol < vol_threshold_low and is_flat:
             if curr['close'] >= curr['low']: return "GUARDING (Supply Dried)"
        
        if (is_price_down or is_flat) and mfm > 0.05:
            return "SILENT ACCUM (Serok)"

        if vol > vol_threshold_spike * avg_vol and is_flat:
            if mfm > 0: return "ABSORPTION (Siap Naik)"
            return "CHURN (Tukar Barang)"

        if is_price_up and vol > avg_vol: return "MARKUP (Strong Buy)"
        if is_price_down and vol > avg_vol: return "MARKDOWN (Strong Sell)"
        
        if vol < vol_threshold_low * avg_vol:
            if is_small_cap and is_price_down: return "ABANDONED (Ditinggal)"
            return "LOW VOL (Wait & See)"

        return "NORMAL"

    # --- DISPLAY ---
    def print_market_summary(self, df):
        curr = df.iloc[-1]
        prev = df.iloc[-2]
        
        chg_pct = ((curr['close'] - prev['close']) / prev['close']) * 100
        chg_str = f"{chg_pct:+.2f}%"
        
        rsi = self.calculate_rsi(df['close']).iloc[-1]
        vwap = curr['vwap']
        phase, diff = self.get_bandar_phase(curr['close'], vwap)
        nvi_curr = df['nvi'].iloc[-1]
        nvi_ma = df['nvi_ma'].iloc[-1]
        sm_status = "Inflow (Akumulasi)" if nvi_curr > nvi_ma else "Outflow (Distribusi)"
        
        # New Metrics
        inst_flow = curr['inst_flow_ma']
        inst_flow_str = "🟢 NET BUY" if inst_flow > 0 else "🔴 NET SELL"
        
        dormant = curr['dormant_index']
        dormant_str = f"{dormant:.1f}/100"
        
        conf_idx = int(curr['conf_flow_index'])
        conf_str = "⭐⭐⭐⭐ (Strong)" if conf_idx == 4 else \
                   "⭐⭐⭐ (Good)" if conf_idx == 3 else \
                   "⭐⭐ (Neutral)" if conf_idx == 2 else "⚠️ (Weak)"

        liq_status, liq_val, is_small_cap = self.check_liquidity(df)
        
        print("\n" + "="*65)
        print(f" [1] BANDAR DETECTOR SUMMARY: {self.ticker}")
        print("="*65)
        print(f" Current Price    : {curr['close']:,.0f}")
        print(f" Day Change       : {chg_str}")
        print(f" Liquidity Status : {liq_status}")
        print(f" Avg Trans. Value : {liq_val} / hari")
        print("-" * 65)
        print(f" Bandar VWAP (20) : {vwap:,.0f}")
        print(f" Bandar Phase     : {phase} (Gap: {diff:+.2f}%)")
        print(f" Institutional Flow: {inst_flow_str} (Trend 5 Hari)")
        print(f" Confirmed Flow   : {conf_str}")
        print(f" Dormant Index    : {dormant_str} (>80 means Sleeping)")
        print(f" RSI Momentum     : {rsi:.1f}")
        
        if is_small_cap:
            print(f" Mode Analisis    : ⚠️ SMALL CAP OPTIMIZED (Lebih Sensitif)")
        else:
            print(f" Mode Analisis    : STANDARD (Big/Mid Cap)")
            
        print("-" * 65)

    def print_intent_radar(self, df, days=15):
        _, _, is_small_cap = self.check_liquidity(df)
        
        print(f"\n [2] HISTORICAL BANDAR FLOW (Last {days} Days)")
        print("=" * 145)
        # Added new columns to header
        print(f" {'DATE':<12} | {'CLOSE':<7} | {'CHG %':<7} | {'VWAP':<7} | {'INST FLOW':<9} | {'ABSORP':<7} | {'RETAIL':<7} | {'CONF':<4} | {'SIGNAL':<25}")
        print("-" * 145)

        subset = df.iloc[-days:]
        
        for i in range(len(subset)):
            idx = subset.index[i]
            loc = df.index.get_loc(idx)
            if loc == 0: continue
            
            curr = df.iloc[loc]
            prev = df.iloc[loc-1]
            
            date_str = str(curr['date']).split(" ")[0]
            chg_pct = ((curr['close'] - prev['close']) / prev['close']) * 100
            chg_str = f"{chg_pct:+.1f}%"
            vwap_str = f"{curr['vwap']:,.0f}"
            
            # Inst Flow Display
            if curr['inst_flow'] > 0: flow_sym = "🟢 In"
            else: flow_sym = "🔴 Out"
            
            # Absorption (Inverse Retail) & Retail Liquidity
            # Scale them for display to simple 0-9 scale or similar
            absorp_val = curr['inv_retail_liquidity']
            retail_val = curr['retail_liquidity']
            
            # Formatting
            abs_str = f"{absorp_val:.1f}"
            ret_str = f"{retail_val:.2f}"
            conf_val = int(curr['conf_flow_index'])
            
            intent = self.detect_hidden_intent(curr, prev, curr['vwap'], is_small_cap)
            
            display_intent = intent
            if "SILENT EXIT" in intent or "DISTRIBUTION" in intent or "ABANDONED" in intent: 
                display_intent = f"⚠️ {intent}"
            elif "ACCUM" in intent or "MARKUP" in intent or "ABSORPTION" in intent or "GUARDING" in intent: 
                display_intent = f"✅ {intent}"
            elif "LOW VOL" in intent:
                display_intent = f"💤 {intent}"
            
            print(f" {date_str:<12} | {curr['close']:<7,.0f} | {chg_str:<7} | {vwap_str:<7} | {flow_sym:<9} | {abs_str:<7} | {ret_str:<7} | {conf_val:<4} | {display_intent}")

        print("-" * 145)
        print(" Legend:")
        print(" INST FLOW: Proxied by Price Action x Volume. Green=Net Buy Pressure.")
        print(" ABSORP (Inv Retail): High number = Price stable on high volume (Big Money absorbing).")
        print(" RETAIL (Liquidity): High number = Price moves easily on low volume (Thin/Retail dominated).")
        print(" CONF (Confirmed Flow): 0-4 Score (Trend, VWAP, NVI, Volume). 4 is strongest.")

    def fetch_data(self, interval="1d", period="1y"):
        tickers = [self.ticker, self.clean_ticker]
        for t in tickers:
            try:
                df = yf.Ticker(t).history(period=period, interval=interval)
                if not df.empty:
                    df.reset_index(inplace=True)
                    df.columns = [c.lower() for c in df.columns]
                    rename_map = {'date': 'date', 'open': 'open', 'high': 'high', 'low': 'low', 'close': 'close', 'volume': 'volume'}
                    df.rename(columns=rename_map, inplace=True)
                    
                    df['vol_ma'] = df['volume'].rolling(20).mean()
                    df['vwap'] = self.calculate_vwap_rolling(df, 20)
                    df['nvi'] = self.calculate_nvi(df['close'], df['volume'])
                    df['nvi_ma'] = df['nvi'].rolling(20).mean()
                    
                    # Calculate New Metrics
                    df = self.calculate_advanced_metrics(df)
                    
                    return df
            except: continue
        return None

    def run(self):
        print(f"\n[+] Analyzing {self.ticker} ...")
        df = self.fetch_data()
        
        if df is None:
            print("[-] Data tidak ditemukan.")
            return

        self.print_market_summary(df)
        self.print_intent_radar(df, days=30) # Increased days for better context
        
        print("\n[KAMUS SINYAL]")
        print(" ✅ GUARDING: Volume sepi + Harga dijaga stabil (Supply Kering).")
        print(" ⚠️ SILENT EXIT: Harga naik, tapi Money Flow (MFM) negatif.")
        print(" 🟢 INST FLOW: Estimasi arus uang institusi (Price x Vol trend).")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("ticker", help="Ticker Saham (Contoh: BBRI)")
    args = parser.parse_args()
    
    app = StockAnalyzer(args.ticker)
    app.run()