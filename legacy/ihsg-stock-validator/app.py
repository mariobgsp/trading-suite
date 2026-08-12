import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime, timedelta
import time

# --- CONFIG ---
st.set_page_config(
    page_title="Institutional Flow Analyzer (Quant Pro v5.7)", 
    layout="wide", 
    page_icon="🦅"
)

# --- CSS STYLING ---
st.markdown("""
<style>
    .metric-card {
        background-color: #0e1117;
        border: 1px solid #262730;
        border-radius: 5px;
        padding: 15px;
        color: white;
    }
    .conclusion-box {
        padding: 20px;
        border-radius: 10px;
        margin-bottom: 20px;
        border-left: 5px solid;
    }
    div[data-testid="stMetricValue"] {
        font-size: 24px;
        font-weight: bold;
    }
</style>
""", unsafe_allow_html=True)

# --- DATA FETCHING ---
@st.cache_data(ttl=3600)
def get_stock_data(ticker: str, period: str = "2y", interval: str = "1d") -> pd.DataFrame:
    clean_ticker = ticker.strip().upper()
    if not clean_ticker.endswith(".JK") and len(clean_ticker) == 4 and clean_ticker.isalpha():
        search_ticker = f"{clean_ticker}.JK"
    else:
        search_ticker = clean_ticker

    max_retries = 3
    for attempt in range(max_retries):
        try:
            df = yf.download(search_ticker, period=period, interval=interval, progress=False, auto_adjust=False)
            if isinstance(df.columns, pd.MultiIndex): df.columns = df.columns.get_level_values(0)
            if df.empty:
                if attempt < max_retries - 1: time.sleep(1); continue
                return None
            df.reset_index(inplace=True)
            df.columns = [c.lower() for c in df.columns]
            
            # Date normalization
            if 'datetime' in df.columns: df.rename(columns={'datetime': 'date'}, inplace=True)
            elif 'date' not in df.columns:
                for col in df.columns:
                    if pd.api.types.is_datetime64_any_dtype(df[col]): df.rename(columns={col: 'date'}, inplace=True); break
            
            req_cols = ['open', 'high', 'low', 'close', 'volume']
            if not all(col in df.columns for col in req_cols): return None
            
            df['date'] = pd.to_datetime(df['date']).dt.tz_localize(None)
            df = df[df['volume'] > 0].copy()
            return df[['date', 'open', 'high', 'low', 'close', 'volume']]
        except Exception as e:
            if attempt < max_retries - 1: time.sleep(2); continue
            st.error(f"Error fetching data: {e}")
            return None
    return None

# --- CORE ANALYZER CLASS (SMART CONTEXT - V5.5 Logic) ---
class QuantAnalyzer:
    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        self._calculate_advanced_metrics()

    def _calculate_advanced_metrics(self):
        # 1. Standard VWAP
        self.df['pv'] = self.df['close'] * self.df['volume']
        self.df['roll_pv'] = self.df['pv'].rolling(window=20).sum()
        self.df['roll_vol'] = self.df['volume'].rolling(window=20).sum()
        self.df['vwap_20'] = self.df['roll_pv'] / self.df['roll_vol']
        
        # 2. Market Structure (EMA 200 & 50)
        self.df['ema_50'] = self.df['close'].ewm(span=50, adjust=False).mean()
        self.df['ema_200'] = self.df['close'].ewm(span=200, adjust=False).mean()

        # 3. Z-Score Volume (Statistical Anomaly)
        roll_vol_mean = self.df['volume'].rolling(20).mean()
        roll_vol_std = self.df['volume'].rolling(20).std()
        self.df['vol_zscore'] = (self.df['volume'] - roll_vol_mean) / roll_vol_std

        # 4. CMF & NVI
        price_change = self.df['close'].pct_change()
        vol_drop = self.df['volume'] < self.df['volume'].shift(1)
        nvi_returns = np.where(vol_drop, price_change, 0)
        self.df['nvi'] = 1000 * np.exp(np.nancumsum(np.log(1 + nvi_returns)))
        self.df['nvi_ema'] = self.df['nvi'].ewm(span=20).mean()

        mf_multiplier = ((self.df['close'] - self.df['low']) - (self.df['high'] - self.df['close'])) / (self.df['high'] - self.df['low']).replace(0, 1)
        self.df['cmf'] = (mf_multiplier * self.df['volume']).rolling(20).sum() / self.df['volume'].rolling(20).sum()
        
        # Quarter Anchor
        last_date = self.df['date'].iloc[-1]
        q_start_month = ((last_date.month - 1) // 3) * 3 + 1
        q_start_date = datetime(last_date.year, q_start_month, 1)
        mask = self.df['date'] >= q_start_date
        if mask.sum() < 10: mask = self.df.index >= len(self.df) - 60
        self.df['anchored_pv'] = self.df['pv'].where(mask).cumsum()
        self.df['anchored_vol'] = self.df['volume'].where(mask).cumsum()
        self.df['vwap_qtd'] = self.df['anchored_pv'] / self.df['anchored_vol']
        self.df['vwap_qtd'] = self.df['vwap_qtd'].ffill()

    def get_market_context(self):
        """Menentukan Fase Pasar"""
        curr = self.df.iloc[-1]
        if curr['close'] > curr['ema_200']:
            if curr['close'] > curr['ema_50']: return "UPTREND (Markup Phase)"
            else: return "CORRECTION (in Uptrend)"
        else:
            if curr['close'] < curr['ema_50']: return "DOWNTREND (Markdown Phase)"
            else: return "POTENTIAL REVERSAL (Early)"

    def get_smart_verdict(self):
        curr = self.df.iloc[-1]
        context = self.get_market_context()
        score = 0
        reasons = []

        # Faktor 1: Anomali Volume (Z-Score)
        if curr['vol_zscore'] > 2.0:
            score += 30
            reasons.append(f"Volume Spike Ekstrim (Z-Score {curr['vol_zscore']:.1f}σ)")
        elif curr['vol_zscore'] > 1.0:
            score += 10
            reasons.append("Volume di atas rata-rata")

        # Faktor 2: Money Flow
        if curr['cmf'] > 0.15:
            score += 30
            reasons.append("Arus Uang Sangat Masif (CMF > 0.15)")
        elif curr['cmf'] > 0.05:
            score += 15
            reasons.append("Akumulasi Bersih")

        # Faktor 3: Konteks Tren
        if "UPTREND" in context:
            score += 10
            reasons.append("Mendukung Tren Utama (Follow the Trend)")
        elif "DOWNTREND" in context:
            score -= 10 
            reasons.append("⚠️ Melawan Tren Bearish (Counter-Trend)")

        # Faktor 4: Stopping Volume
        body = abs(curr['close'] - curr['open'])
        rng = curr['high'] - curr['low']
        if rng == 0: rng = 1
        if (body < rng * 0.4) and (curr['vol_zscore'] > 1.5) and (curr['close'] < curr['vwap_20']):
             score += 35
             reasons.append("Stopping Volume Valid (Smart Money Menahan Harga)")

        if score >= 70: verdict = "STRONG ACCUMULATION"
        elif score >= 45: verdict = "MODERATE ACCUMULATION"
        elif score >= 20: verdict = "NEUTRAL / WAIT"
        else: verdict = "DISTRIBUTION / AVOID"

        return verdict, score, reasons, context

    def get_smart_signals(self):
        signals = []
        for i in range(50, len(self.df)):
            row = self.df.iloc[i]
            if row['vol_zscore'] < 1.5: continue
            
            sig_type = None
            narrative = ""
            is_uptrend = row['close'] > row['ema_200']
            
            # 1. Re-Accumulation (Uptrend)
            if is_uptrend and row['cmf'] > 0.05 and row['close'] <= row['ema_50']:
                sig_type = "Re-Accumulation"
                narrative = "Bandar menambah muatan saat harga koreksi wajar (Buy on Dip). Tren jangka panjang aman."

            # 2. Stopping Volume (Downtrend)
            body = abs(row['close'] - row['open'])
            rng = row['high'] - row['low']
            if not is_uptrend and (body < rng * 0.4) and row['close'] < row['vwap_20']:
                sig_type = "Stopping Vol"
                narrative = "Upaya menahan kejatuhan harga di fase Downtrend. Spekulatif, indikasi adanya 'Floor'."

            # 3. Aggressive Breakout
            if row['close'] > row['open'] and row['cmf'] > 0.15 and row['vol_zscore'] > 2.5:
                sig_type = "Aggressive Buy"
                narrative = "Ledakan Volume + Harga. Bandar Hajar Kanan (HK) untuk memulai fase Markup."

            # 4. Distribution
            if row['cmf'] < -0.1 and row['close'] < row['open'] and row['vol_zscore'] > 2.0:
                sig_type = "Distribution"
                narrative = "Guyuran Masif. Volume tinggi candle merah. Smart money keluar (Take Profit)."

            if sig_type:
                signals.append({
                    'date': row['date'],
                    'type': sig_type,
                    'price': row['high'] if "Dist" in sig_type else row['low'],
                    'narrative': narrative,
                    'zscore': row['vol_zscore'],
                    'cmf': row['cmf']
                })
        return signals

    def detect_smart_fvg(self, lookback=120):
        fvgs = []
        subset = self.df.iloc[-lookback:].reset_index(drop=True)
        if len(subset) < 5: return []

        for i in range(2, len(subset) - 2):
            if subset.at[i, 'low'] > subset.at[i-2, 'high']:
                gap_top, gap_btm, gap_date = subset.at[i, 'low'], subset.at[i-2, 'high'], subset.at[i-1, 'date']
                future = subset.iloc[i+1:]
                mid = (gap_top + gap_btm) / 2
                if not (future['low'] <= mid).any():
                    fvgs.append({'Date': gap_date, 'Type': 'Fresh Demand (FVG)', 'Top': gap_top, 'Bottom': gap_btm, 'Color': 'rgba(0, 255, 127, 0.12)', 'Border': 'rgba(0, 255, 127, 0.5)'})

            elif subset.at[i, 'high'] < subset.at[i-2, 'low']:
                gap_btm, gap_top, gap_date = subset.at[i, 'high'], subset.at[i-2, 'low'], subset.at[i-1, 'date']
                future = subset.iloc[i+1:]
                mid = (gap_top + gap_btm) / 2
                if not (future['high'] >= mid).any():
                    fvgs.append({'Date': gap_date, 'Type': 'Fresh Supply (FVG)', 'Top': gap_top, 'Bottom': gap_btm, 'Color': 'rgba(255, 99, 71, 0.12)', 'Border': 'rgba(255, 99, 71, 0.5)'})
        return fvgs
    
    def get_history_log(self, lookback=60):
        subset = self.df.iloc[-lookback:].copy()
        def get_status(r):
            if r['vol_zscore'] > 2.0:
                if r['cmf'] > 0.1: return "🟢 BIG ACCUM"
                if r['cmf'] < -0.1: return "🔴 BIG DIST"
            return "-"
        subset['Status'] = subset.apply(get_status, axis=1)
        subset['date'] = subset['date'].dt.date
        return subset[['date', 'close', 'vol_zscore', 'cmf', 'Status']].sort_values(by="date", ascending=False)

# --- HELPER FUNCTIONS ---
def get_tick_size(price):
    if price < 200: return 1
    elif price < 500: return 2
    elif price < 2000: return 5
    elif price < 5000: return 10
    else: return 25

def estimate_ara_arb(prev_close):
    if prev_close <= 0: return 0, 0
    if prev_close < 200: limit = 0.35
    elif prev_close < 5000: limit = 0.25
    else: limit = 0.20
    raw_ara = prev_close * (1 + limit)
    raw_arb = prev_close * (1 - limit)
    tick = get_tick_size(prev_close)
    return round(raw_ara/tick)*tick, round(raw_arb/tick)*tick

# --- PLOTTING ---
def plot_smart_chart(df, ticker, fvgs, signals):
    if len(df) > 200: plot_df = df.iloc[-200:]
    else: plot_df = df
    
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.05, row_heights=[0.75, 0.25])

    # 1. Price & EMAs
    fig.add_trace(go.Candlestick(x=plot_df['date'], open=plot_df['open'], high=plot_df['high'], low=plot_df['low'], close=plot_df['close'], name='Price'), row=1, col=1)
    fig.add_trace(go.Scatter(x=plot_df['date'], y=plot_df['ema_50'], mode='lines', name='EMA 50 (Trend)', line=dict(color='#ffa500', width=1)), row=1, col=1)
    fig.add_trace(go.Scatter(x=plot_df['date'], y=plot_df['ema_200'], mode='lines', name='EMA 200 (Major)', line=dict(color='#ffffff', width=2, dash='dash')), row=1, col=1)

    # 2. Smart FVG
    min_date = plot_df['date'].iloc[0]
    future_date = plot_df['date'].iloc[-1] + timedelta(days=10)
    for fvg in fvgs:
        if fvg['Date'] >= min_date:
            x_c = [fvg['Date'], fvg['Date'], future_date, future_date, fvg['Date']]
            y_c = [fvg['Bottom'], fvg['Top'], fvg['Top'], fvg['Bottom'], fvg['Bottom']]
            fig.add_trace(go.Scatter(
                x=x_c, y=y_c, fill="toself", fillcolor=fvg['Color'], mode='lines', line=dict(color=fvg['Border'], width=0),
                text=f"<b>{fvg['Type']}</b><br>{fvg['Bottom']:,.0f} - {fvg['Top']:,.0f}", hoverinfo="text", showlegend=False, hoveron="fills"
            ), row=1, col=1)

    # 3. Signals with Narrative
    for sig in signals:
        if sig['date'] >= min_date:
            color = "#00FF00" if "Accum" in sig['type'] or "Buy" in sig['type'] else ("#FFD700" if "Stop" in sig['type'] else "#FF0000")
            symbol = "triangle-up" if color != "#FF0000" else "triangle-down"
            
            tooltip = (
                f"<b>{sig['type']}</b><br>"
                f"📅 {sig['date'].strftime('%d %b')}<br>"
                f"📊 Vol Z-Score: {sig['zscore']:.1f}σ (Extreme)<br>"
                f"🧠 <b>Analisa:</b><br>{sig['narrative']}"
            )
            fig.add_trace(go.Scatter(
                x=[sig['date']], y=[sig['price']], mode='markers', marker=dict(symbol=symbol, size=14, color=color, line=dict(width=1, color='black')),
                hovertext=tooltip, hoverinfo="text", showlegend=False
            ), row=1, col=1)

    # 4. Volume
    colors = ['#26a69a' if c >= o else '#ef5350' for c, o in zip(plot_df['close'], plot_df['open'])]
    fig.add_trace(go.Bar(x=plot_df['date'], y=plot_df['volume'], name='Volume', marker_color=colors, opacity=0.6), row=2, col=1)
    
    return fig.update_layout(
        title=dict(text=f"<b>{ticker}</b> Smart Context Analysis", x=0.05), yaxis_title="Price", template="plotly_dark", 
        height=750, margin=dict(t=50, b=20), hovermode="x unified", xaxis_rangeslider_visible=False, 
        legend=dict(orientation="h", y=1.01, x=1, xanchor="right")
    )

# --- APP LAYOUT ---
with st.sidebar:
    st.title("🦅 Quant Pro v5.7")
    st.caption("Smart Context + Manual Adimollogy")
    ticker_input = st.text_input("Ticker", value="BBRI").upper()
    run_btn = st.button("RUN ANALYSIS", type="primary")

if "analyzed" not in st.session_state: st.session_state.analyzed = False
if run_btn: st.session_state.analyzed = True

if st.session_state.analyzed:
    with st.spinner(f"Mengkalkulasi Z-Score & Struktur Pasar {ticker_input}..."):
        df_raw = get_stock_data(ticker_input)
    
    if df_raw is None:
        st.error("Data tidak ditemukan.")
    else:
        qa = QuantAnalyzer(df_raw)
        verdict, score, reasons, context = qa.get_smart_verdict()
        curr_price = df_raw['close'].iloc[-1]
        
        # Color Logic
        box_color = "#155724" if score >= 45 else ("#721c24" if score <= 30 else "#383d41")
        
        st.markdown(f"""
        <div style="background-color: {box_color}; padding: 20px; border-radius: 10px; border-left: 8px solid; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between;">
                <h3 style="margin:0; color: white;">🛡️ {verdict}</h3>
                <h3 style="margin:0; color: #f0f0f0;">{context}</h3>
            </div>
            <p style="margin-top:10px; color: #e0e0e0;"><b>Faktor Deteksi:</b> {", ".join(reasons)}</p>
        </div>
        """, unsafe_allow_html=True)

        tab1, tab2, tab3 = st.tabs(["📊 Smart Chart", "📜 Data Log", "🧮 Hybrid Strategy Calculator"])
        
        with tab1:
            fvgs = qa.detect_smart_fvg()
            signals = qa.get_smart_signals()
            st.plotly_chart(plot_smart_chart(qa.df, ticker_input, fvgs, signals), use_container_width=True)
            st.caption("Garis Putih Putus-putus = EMA 200 (Batas Bull/Bear Jangka Panjang). Segitiga Kuning = Stopping Volume.")

        with tab2:
            st.dataframe(qa.get_history_log().style.format({"vol_zscore": "{:.2f}", "cmf": "{:.2f}", "close": "{:,.0f}"}), use_container_width=True)

        # --- UPDATED ADIMOLLOGY CALCULATOR (MANUAL ROWS) ---
        with tab3:
            st.header(f"🧮 Strategy Calculator")
            est_ara, est_arb = estimate_ara_arb(curr_price)
            st.info(f"Context: Last Price = **{curr_price:,.0f}** | Est. ARA: {est_ara:,.0f} | Est. ARB: {est_arb:,.0f}")

            c_inst, c_adi = st.columns(2)
            
            with c_inst:
                st.subheader("1. Institutional (VWAP)")
                vwap_val = qa.df['vwap_qtd'].iloc[-1]
                input_vwap = st.number_input("Benchmark Price (VWAP)", min_value=0.0, value=float(vwap_val), format="%.0f")
                risk_std = st.slider("Risk Tolerance (Std Dev)", 1.0, 3.0, 2.0, 0.1)

            with c_adi:
                st.subheader("2. Adimollogy (Bandar)")
                bandar_vol = st.number_input("Bandar Volume (Lot)", min_value=0, value=0)
                bid_lot = st.number_input("Total Bid (Lot)", value=0)
                offer_lot = st.number_input("Total Offer (Lot)", value=0)
                
                # Manual Input for Rows (Market Depth)
                manual_rows = st.number_input("Jumlah Papan (Rows)", min_value=1, value=50, help="Jumlah baris antrian dari ARA ke ARB (Market Depth Real)")

            st.divider()

            if st.button("Calculate Hybrid Zones", type="primary"):
                if input_vwap > 0:
                    tick = get_tick_size(input_vwap)
                    
                    # --- INSTITUTIONAL LOGIC ---
                    std_proxy = input_vwap * 0.02 * risk_std 
                    passive_buy = input_vwap - std_proxy
                    fair_value = input_vwap
                    momentum_target = input_vwap + (std_proxy * 2)

                    # --- ADIMOLLOGY LOGIC (MANUAL ROWS) ---
                    # Logic baru: Menggunakan 'manual_rows' langsung
                    avg_row_density = (bid_lot + offer_lot) / manual_rows if manual_rows > 0 else 1
                    if avg_row_density < 1: avg_row_density = 1
                    power = bandar_vol / avg_row_density
                    
                    adi_realistis = input_vwap * 1.05 + (power / 2)
                    adi_optimal = input_vwap * 1.05 + power

                    # --- RESULTS ---
                    c_res_l, c_res_r = st.columns(2)
                    
                    with c_res_l:
                        st.success("### 🛡️ BUY ZONE (Institutional)")
                        st.metric("Passive Entry (Limit)", f"Rp {passive_buy:,.0f}", f"-{risk_std*2:.1f}% Dev")
                        st.markdown(f"**Thesis:** Bid skew below VWAP to capture mean-reversion liquidity.")

                    with c_res_r:
                        st.warning("### 🎯 SELL TARGETS (Hybrid)")
                        
                        target_data = [
                            {"Strategy": "Fair Value (Mean Rev)", "Price": fair_value, "Note": "Exit at VWAP"},
                            {"Strategy": "Momentum (Breakout)", "Price": momentum_target, "Note": f"+{risk_std*2:.1f}% Extension"},
                        ]
                        
                        if adi_realistis > fair_value: 
                            target_data.append({"Strategy": "Adimollogy (Realistis)", "Price": adi_realistis, "Note": "Avg + 5% + Power/2"})
                            target_data.append({"Strategy": "Adimollogy (Optimal)", "Price": adi_optimal, "Note": "Avg + 5% + Power"})
                        
                        df_tgt = pd.DataFrame(target_data)
                        st.dataframe(
                            df_tgt.style.format({"Price": "{:,.0f}"}), 
                            hide_index=True, 
                            use_container_width=True
                        )
                else:
                    st.error("Benchmark Price must be greater than 0")