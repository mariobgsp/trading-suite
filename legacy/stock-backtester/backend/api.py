from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from main import StockScanner
import pandas as pd
import numpy as np
from scipy.stats import linregress
import traceback
import json
import time
import math
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── IHSG Stock Universe (IDX-listed, ~900+ tickers) ────────────────────────
IHSG_TICKERS = [
    "AALI","ABBA","ABDA","ABMM","ACES","ACST","ADCP","ADES","ADHI","ADMF",
    "ADMG","ADMR","ADRO","AGII","AGRO","AHAP","AIMS","AISA","AKKU","AKPI",
    "AKRA","AKSI","ALDO","ALII","ALKA","ALMI","ALTO","AMAG","AMAN","AMAR",
    "AMFG","AMMS","AMRT","ANDI","ANJT","ANTM","APIC","APII","APLN","APOL",
    "ARMY","ARNA","ARTA","ARTI","ASBI","ASDM","ASGO","ASII","ASJT","ASKP",
    "ASMI","ASPI","ASRM","ASSA","ASТО","ATAP","ATLA","AUTO","AVIA","AYLS",
    "BABP","BACA","BAJA","BALI","BAPA","BATA","BAYU","BBCA","BBHI","BBKP",
    "BBLD","BBMD","BBNI","BBRI","BBSI","BBSS","BBTC","BBTN","BBYB","BCAP",
    "BCIC","BCIP","BEKS","BELI","BELL","BFIN","BGTG","BHAT","BHIT","BIKA",
    "BIMA","BIPP","BIRD","BISI","BJBR","BJTM","BKDP","BKSL","BKSW","BLTA",
    "BLTZ","BLTZ","BMHS","BMRI","BMSR","BMTR","BNBA","BNGA","BNIK","BNII",
    "BNLI","BOBA","BOGA","BOLA","BOLT","BOSS","BPFI","BPII","BPTR","BRAD",
    "BRMS","BRNA","BROK","BRPT","BSDE","BSIM","BSML","BSSR","BTEK","BTEL",
    "BTON","BTPN","BTPS","BUDI","BUEF","BUKA","BULL","BUMI","BUVA","BVIC",
    "CAKK","CANI","CARE","CASS","CBMF","CCSI","CEKA","CENT","CFIN","CFIN",
    "CINT","CITY","CKSN","CLPI","CMNT","CMNP","CMPP","CNKO","COAL","COBP",
    "COCO","COWL","CPGT","CPIN","CPRI","CPRO","CSAP","CTBN","CTRA","CTRP",
    "CTRL","DART","DAWA","DCII","DEWA","DFAM","DGIK","DILD","DIVA","DKFT",
    "DLTA","DMAS","DNAR","DNET","DOID","DPNS","DPUM","DSFI","DSNG","DSSA",
    "DUTI","DVLA","DWGL","DYAN","EAST","ECII","EDGE","EKAD","ELSA","ELTY",
    "EMDE","EMTK","ENRG","ENVY","EPMT","ERAA","ESSA","ESTA","ESTI","EXCL",
    "EXPD","FAST","FASW","FIGHT","FILM","FIMP","FIRE","FISH","FITT","FLMC",
    "FORU","FPNI","FREN","FUEL","GAMA","GAPD","GBIC","GDST","GEMA","GEMS",
    "GGRM","GHON","GJTL","GLOB","GLVA","GMFI","GMTD","GOLL","GOOD","GPRA",
    "GRIA","GSMF","GTBO","GTSI","GWSA","GZCO","HDFA","HDTX","HERO","HEXA",
    "HILL","HITS","HKMU","HMSP","HOKI","HOME","HOPE","HOTL","HRUM","IATA",
    "IBFN","IBST","ICBP","IGAR","IHSG","IKAN","IKBI","IMAS","INCI","INCO",
    "INDO","INDR","INDS","INDX","INDY","INKP","INPC","INPP","INPS","INRU",
    "INTA","INTD","INTP","IPCC","IPCM","IPPE","IPOL","IPTV","IRRA","ISAT",
    "ISSP","IUCN","JARR","JAST","JAWA","JGLE","JIHD","JKON","JMAS","JPFA",
    "JSKY","JTPE","KAEF","KARW","KBAG","KBLI","KBLM","KBLV","KDSI","KEEN",
    "KEJU","KICI","KIJA","KINO","KIOS","KITA","KKGI","KLBF","KMDS","KMTR",
    "KOIN","KONI","KOPI","KPIG","KRAS","KREN","KSIX","LAND","LCKM","LCNP",
    "LMPI","LMSH","LPCK","LPGI","LPKR","LPLI","LPPF","LPPS","LSIP","LUCK",
    "LTLS","MABA","MAMI","MAPI","MASA","MASB","MASC","MBMA","MCAS","MCOL",
    "MCOS","MDKA","MDRN","MEDC","MEGA","MFIN","MFMI","MICE","MIDI","MIKA",
    "MIRA","MKPI","MLBI","MLPL","MLPT","MMIX","MNCN","MNCS","MOLI","MPPA",
    "MPRO","MRAT","MRMA","MSIN","MSKY","MTDL","MTFN","MTLA","MTRA","MTSM",
    "MYOH","MYTX","NASI","NCKL","NETX","NFCX","NISP","NITO","NKPK","NOBU",
    "NOVA","NPGF","NRCA","NSSS","NUSA","NZIA","OCAP","OKAS","OKON","OMRE",
    "ORCA","OSAO","PACK","PADI","PALM","PAMG","PANS","PANR","PBID","PBSA",
    "PCAR","PDES","PEGE","PGAS","PGLO","PGJO","PGLI","PGMJ","PHSL","PICO",
    "PJAA","PKPK","PLAN","PLIN","PLTM","PMJS","PNBS","PNGO","PNIN","PNLF",
    "POLA","POLL","POLI","POME","POOL","POWR","PPGL","PPRO","PRDA","PRIM",
    "PTBA","PTIS","PTPP","PTRO","PTSP","PUDP","PURA","PWON","PYFA","RAJA",
    "RALS","RBMS","RDTX","REAL","RELI","REMA","RGAS","RIMO","RMD","RODA",
    "ROTI","RUIS","RUNS","SAFE","SAMF","SARI","SBMA","SCCO","SCMA","SCPI",
    "SDMU","SDPC","SDRA","SFAN","SGER","SGRO","SHIP","SIDO","SILO","SIMP",
    "SINI","SIPD","SKLT","SKYB","SMCB","SMDM","SMGR","SMMT","SMRA","SMRU",
    "SMSM","SOFA","SOSS","SOTS","SPMA","SQBB","SRAJ","SRTG","SSIA","SSMS",
    "SSTM","STTP","SUGI","SULI","SUPR","SURE","SWAT","TALF","TAMA","TARA",
    "TAXI","TBIG","TBLA","TBMS","TCID","TFIA","TFIN","TGKA","TGRA","TINS",
    "TIRA","TIRT","TITL","TLKM","TMAS","TMPI","TOBA","TOPS","TOWR","TPIA",
    "TPMA","TRIL","TRIM","TRIO","TRIS","TRJA","TRST","TRUS","TURI","ULTJ",
    "UNIC","UNIQ","UNIT","UNSP","UNTR","UNVR","URBN","VICI","VINS","VIVA",
    "WAPO","WEGE","WEHA","WIIM","WIKA","WINS","WIRG","WOMAN","WOOD","WSBP",
    "WTON","YELO","YPAS","YULE","ZBRA","ZINC","ZONE","ZYRX","BREN","AMMN",
    "CUAN","MBMA","INCO","MEDC","PTBA","SMGR","GGRM","HMSP","ICBP","INDF",
    "KLBF","UNVR","ASII","BBCA","BBRI","BBNI","BMRI","TLKM","ANTM","ADRO",
    "PTPP","WSKT","WIKA","JSMR","PGAS","AKRA","ERAA","MAPI","LSIP","SGRO",
    "AALI","SIMP","SSMS","TBLA","CPIN","JPFA","MAIN","BISI","CENT","CPGT",
    "ELSA","MEDC","RATU","BSSR","HRUM","ITMG","BUMI","DOID","PKPK","KKGI",
    "GEMS","MBAP","PTBA","ASSE","ACST","WSKT","SSIA","NRCA","WTON","BEKS",
    "MIKA","SILO","HEAL","PRDA","SAME","TSPC","KAEF","DVLA","PYFA","MRAT",
    "INAF","SQBB","SOHO","PEHA","SIDO","HRTA","TALF","FAPA","ROTI","ADES",
    "CEKA","DLTA","ICBP","MLBI","AISA","ALTO","SKLT","ULTJ","CAMP","GOOD",
    "HOKI","IIKP","KEJU","MYOR","PCAR","PDES","STTP","TBLA","FOOD","DMND",
    "BSDE","CTRA","DART","DILD","EMDE","GMTD","GRIA","IPCC","JGLE","MKPI",
    "PJAA","PPRO","PWON","RDTX","SMRA","SSIA","BKSL","LPCK","LPKR","MTLA",
    "OMRE","POLL","REAL","RODA","BEST","ARMY","AVIA","NCKL","MDKA","NICL",
]

# Deduplicate while preserving order
_seen = set()
IHSG_TICKERS_UNIQUE = []
for t in IHSG_TICKERS:
    if t not in _seen:
        _seen.add(t)
        IHSG_TICKERS_UNIQUE.append(t)
IHSG_TICKERS = IHSG_TICKERS_UNIQUE


def _round2(val: object) -> float:
    """Round to 2 decimal places. Workaround for Pyre2 round() overload issue."""
    v = float(str(val))
    return math.floor(v * 100 + 0.5) / 100


def _round1(val: object) -> float:
    """Round to 1 decimal place. Workaround for Pyre2 round() overload issue."""
    v = float(str(val))
    return math.floor(v * 10 + 0.5) / 10

app = Flask(__name__)
CORS(app)  # Enable CORS for local development

@app.route('/api/analyze', methods=['POST'])
def analyze_stock():
    """
    Analyzes a stock ticker and returns backtest results and predictions.
    
    Request JSON:
    {
        "ticker": "BBCA",
        "period": "2y"  # optional, defaults to "2y"
    }
    
    Response JSON:
    {
        "ticker": "BBCA.JK",
        "backtest_summary": [...],
        "predictions": {...},
        "historical_data": [...],
        "warning": "..." # optional liquidity warning
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'ticker' not in data:
            return jsonify({'error': 'Ticker symbol is required'}), 400
        
        ticker = data['ticker']
        period = data.get('period', '2y')
        interval = data.get('interval', '1d')
        
        # Create scanner and fetch data
        scanner = StockScanner(ticker)
        if not scanner.fetch_data(period=period, interval=interval):
            return jsonify({'error': f'Unable to fetch data for {ticker}'}), 404
        
        # Check for liquidity warning
        warning = None
        if ".JK" in scanner.ticker:
            avg_val = (scanner.df['Close'] * scanner.df['Volume']).tail(20).mean()
            if avg_val < 5_000_000_000:
                warning = "Low liquidity: Average value < 5M IDR. Signals may be unreliable."
        
        # Run backtest
        backtest_results = _get_backtest_results(scanner)
        
        # Get overview (indicators, conclusion, forecasting)
        overview = _get_overview(scanner)
        
        # Get historical price data (last 60 days for chart)
        historical_data = _get_historical_data(scanner)
        
        # Get smart money / bandarmology data
        smart_money = _get_smart_money_data(scanner)
        
        # Get news sentiment
        news_sentiment = scanner.get_news_sentiment()
        
        response = {
            'ticker': scanner.ticker,
            'backtest_summary': backtest_results,
            'overview': overview,
            'historical_data': historical_data,
            'smart_money': smart_money,
            'news_sentiment': news_sentiment
        }
        
        if warning:
            response['warning'] = warning
        
        return jsonify(response), 200
        
    except Exception as e:
        print(f"Error in analyze_stock: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def _get_backtest_results(scanner):
    """Extract backtest summary from scanner."""
    df = scanner.df.copy()
    df['Prev_MA9'] = df['MA9'].shift(1)
    df['Prev_MA21'] = df['MA21'].shift(1)
    df['Prev_MA50'] = df['MA50'].shift(1)
    df['Prev_MACD'] = df['MACD_Line'].shift(1)
    df['Prev_RSI'] = df['RSI'].shift(1)
    df['Prev_CMF'] = df['CMF'].shift(1)
    
    signals = []
    
    for i in range(50, len(df) - 20):
        curr = df.iloc[i]
        prev = df.iloc[i-1]
        
        ret_5d = scanner._get_return(i, 5)
        ret_10d = scanner._get_return(i, 10)
        ret_20d = scanner._get_return(i, 20)
        
        sig_type = None
        
        # Signal detection logic (same as main.py)
        if prev['Prev_MA9'] < prev['Prev_MA21'] and curr['MA9'] > curr['MA21']:
            sig_type = 'MA 9 > 21 (Bull Momentum)'
        elif prev['Prev_MA9'] > prev['Prev_MA21'] and curr['MA9'] < curr['MA21']:
            sig_type = 'MA 9 < 21 (Bear Momentum)'
        elif prev['Prev_MA21'] < prev['Prev_MA50'] and curr['MA21'] > curr['MA50']:
            sig_type = 'MA 21 > 50 (Bull Trend)'
        elif prev['Prev_MA21'] > prev['Prev_MA50'] and curr['MA21'] < curr['MA50']:
            sig_type = 'MA 21 < 50 (Bear Trend)'
        elif prev['Prev_MACD'] < 0 and curr['MACD_Line'] > 0:
            sig_type = 'MACD Zero Cross Up'
        elif prev['Prev_MACD'] > 0 and curr['MACD_Line'] < 0:
            sig_type = 'MACD Zero Cross Down'
        elif prev['Prev_RSI'] < 70 and curr['RSI'] >= 70:
            sig_type = 'RSI Enter >70 (Overbought)'
        elif prev['Prev_RSI'] > 40 and curr['RSI'] <= 40:
            sig_type = 'RSI Enter <40 (Oversold)'

        # --- BANDARMOLOGY SIGNALS ---
        elif prev['Prev_CMF'] < 0 and curr['CMF'] > 0:
            sig_type = 'CMF Bull Cross (Accumulation)'
        elif prev['Prev_CMF'] > 0 and curr['CMF'] < 0:
            sig_type = 'CMF Bear Cross (Distribution)'
        elif (i > 0 and not np.isnan(prev.get('Low_20', np.nan))
              and df.iloc[i-1]['Low'] < prev['Low_20']
              and curr['Close'] > curr['Low_20']
              and curr['Volume'] > 1.5 * curr['Avg_Volume_20']):
            sig_type = 'Wyckoff Spring (Smart Money Buy)'
        elif (curr['RSI'] < 30 and curr['CMF'] > 0
              and curr['Close'] <= curr['MA50'] * 1.02):
            sig_type = 'Buy on Dip (Oversold + Accumulation)'
        elif (curr['NVI'] > curr['NVI_EMA']
              and curr['Close'] < curr['MA21']
              and curr['CMF'] > 0
              and prev.get('Prev_CMF', 0) <= 0):
            sig_type = 'Buy on Weakness (Smart Money Accumulation)'
        
        if sig_type:
            signals.append({
                'Signal': sig_type,
                'Ret_5d': ret_5d,
                'Ret_10d': ret_10d,
                'Ret_20d': ret_20d
            })
    
    if not signals:
        return []
    
    res = pd.DataFrame(signals)
    summary = res.groupby('Signal').agg(
        Count=('Ret_5d', 'count'),
        Avg_5d=('Ret_5d', 'mean'),
        Avg_20d=('Ret_20d', 'mean'),
        Win_Rate_20d=('Ret_20d', lambda x: (x > 0).mean() * 100)
    ).sort_values(by='Count', ascending=False)
    
    # Convert to list of dicts for JSON
    result = []
    for signal_name, row in summary.iterrows():
        result.append({
            'signal': signal_name,
            'count': int(row['Count']),
            'avg_5d': _round2(row['Avg_5d']),
            'avg_20d': _round2(row['Avg_20d']),
            'win_rate_20d': _round2(row['Win_Rate_20d'])
        })
    
    return result


def _get_overview(scanner):
    """Get comprehensive overview data including indicators and conclusion."""
    
    df = scanner.df
    last = df.iloc[-1]
    prev = df.iloc[-2]

    # --- 1. MA Analysis ---
    def analyze_ma(short_ma, long_ma):
        s_val = float(last[short_ma])
        l_val = float(last[long_ma])
        cross = "None"
        
        # Check for recent cross (last 3 days)
        for i in range(-3, 0):
            try:
                curr_s = df[short_ma].iloc[i]
                curr_l = df[long_ma].iloc[i]
                prev_s = df[short_ma].iloc[i-1]
                prev_l = df[long_ma].iloc[i-1]
                
                if prev_s < prev_l and curr_s > curr_l:
                    cross = "Golden Cross"
                    break
                elif prev_s > prev_l and curr_s < curr_l:
                    cross = "Death Cross"
                    break
            except: pass

        trend = "BULLISH" if s_val > l_val else "BEARISH"
        return {'value_short': _round2(s_val), 'value_long': _round2(l_val), 'trend': trend, 'cross': cross}

    ma9_21 = analyze_ma('MA9', 'MA21')
    ma21_50 = analyze_ma('MA21', 'MA50')

    # --- 2. Oscillators ---
    # RSI
    rsi_val = float(last['RSI'])
    rsi_status = "Neutral"
    if rsi_val >= 70: rsi_status = "Overbought"
    elif rsi_val <= 30: rsi_status = "Oversold"

    # Stochastic
    stoch_k = float(last['Stoch_K'])
    stoch_d = float(last['Stoch_D'])
    stoch_status = "Neutral"
    if stoch_k >= 80: stoch_status = "Overbought"
    elif stoch_k <= 20: stoch_status = "Oversold"

    # MACD
    macd_line = float(last['MACD_Line'])
    macd_signal = float(last['MACD_Signal'])
    macd_hist = float(last['MACD_Hist'])
    macd_status = "Bullish" if macd_hist > 0 else "Bearish"
    
    # Check MACD Cross
    macd_cross = "None"
    if df['MACD_Hist'].iloc[-2] < 0 and macd_hist > 0:
        macd_cross = "Golden Cross"
    elif df['MACD_Hist'].iloc[-2] > 0 and macd_hist < 0:
        macd_cross = "Death Cross"

    # --- 3. Conclusion Logic ---
    score = 0
    reasons: list[str] = []

    # Trend (Weight: 3)
    if ma9_21['trend'] == 'BULLISH': score += 1
    if ma21_50['trend'] == 'BULLISH': score += 1
    if ma9_21['cross'] == 'Golden Cross': score += 2; reasons.append("MA 9/21 Golden Cross")
    if ma21_50['cross'] == 'Golden Cross': score += 3; reasons.append("MA 21/50 Golden Cross")
    if ma9_21['cross'] == 'Death Cross': score -= 2; reasons.append("MA 9/21 Death Cross")
    if ma21_50['cross'] == 'Death Cross': score -= 3; reasons.append("MA 21/50 Death Cross")

    # Momentum (Weight: 2)
    if macd_status == 'Bullish': score += 1
    if macd_cross == 'Golden Cross': score += 2; reasons.append("MACD Bullish Cross")
    if macd_cross == 'Death Cross': score -= 2; reasons.append("MACD Bearish Cross")

    # Oscillators (Reversal Logic)
    if rsi_status == 'Oversold': score += 2; reasons.append("RSI Oversold (Potential Reversal)")
    if stoch_status == 'Oversold': score += 1; reasons.append("Stoch Oversold")
    if rsi_status == 'Overbought': score -= 1; reasons.append("RSI Overbought") # Warning, not necessarily sell
    if stoch_status == 'Overbought': score -= 1; reasons.append("Stoch Overbought")

    # Determine Conclusion
    if score >= 5: conclusion = "STRONG BUY"
    elif score >= 2: conclusion = "BUY"
    elif score <= -4: conclusion = "STRONG SELL"
    elif score <= -2: conclusion = "SELL"
    else: conclusion = "WAIT / NEUTRAL"

    # --- 4. Forecasting (Existing Logic) ---
    def predict_cross(short_ma, long_ma):
        s_series = scanner.df[short_ma].tail(5)
        l_series = scanner.df[long_ma].tail(5)
        
        x = np.arange(len(s_series))
        slope_s, _, _, _, _ = linregress(x, s_series)
        slope_l, _, _, _, _ = linregress(x, l_series)
        
        curr_s = float(s_series.iloc[-1])
        curr_l = float(l_series.iloc[-1])
        gap = curr_s - curr_l
        net_slope = slope_s - slope_l
        
        status = "Diverging"
        days = None
        
        if (gap > 0 and net_slope < 0) or (gap < 0 and net_slope > 0):
            try:
                d = abs(gap / net_slope)
                status = "Converging"
                days = _round1(d)
            except ZeroDivisionError:
                pass
        
        trend = "BULLISH" if gap > 0 else "BEARISH"
        
        return {
            'trend': trend,
            'status': status,
            'days': days
        }

    return {
        'ma9_vs_ma21': analyze_ma('MA9', 'MA21'),
        'ma21_vs_ma50': analyze_ma('MA21', 'MA50'),
        'rsi': {'value': _round2(rsi_val), 'status': rsi_status},
        'stoch': {'k': _round2(stoch_k), 'd': _round2(stoch_d), 'status': stoch_status},
        'macd': {'line': _round2(macd_line), 'signal': _round2(macd_signal), 'hist': _round2(macd_hist), 'status': macd_status, 'cross': macd_cross},
        'conclusion': conclusion,
        'reasons': [reasons[i] for i in range(min(len(reasons), 3))], # Top 3 reasons
        'prediction_ma9_21': predict_cross('MA9', 'MA21'),
        'prediction_ma21_50': predict_cross('MA21', 'MA50'),
        'current_price': _round2(last['Close'])
    }


def _get_smart_money_data(scanner):
    """Get current smart money / bandarmology indicator readings."""
    df = scanner.df
    last = df.iloc[-1]

    # CMF interpretation
    cmf_val = float(last['CMF']) if pd.notna(last['CMF']) else 0.0
    if cmf_val > 0.05:
        cmf_signal = 'Accumulation'
    elif cmf_val < -0.05:
        cmf_signal = 'Distribution'
    else:
        cmf_signal = 'Neutral'

    # NVI interpretation: above its EMA = smart money bullish
    nvi_val = float(last['NVI'])
    nvi_ema_val = float(last['NVI_EMA'])
    nvi_signal = 'Smart Money Bullish' if nvi_val > nvi_ema_val else 'Smart Money Bearish'

    pvi_val = float(last['PVI'])

    # Wyckoff Spring: check last 5 days
    wyckoff_spring = False
    for i in range(-5, 0):
        try:
            idx = len(df) + i
            if idx < 1:
                continue
            prev_row = df.iloc[idx - 1]
            curr_row = df.iloc[idx]
            if (pd.notna(prev_row['Low_20'])
                and prev_row['Low'] < prev_row['Low_20']
                and curr_row['Close'] > curr_row['Low_20']
                and curr_row['Volume'] > 1.5 * curr_row['Avg_Volume_20']):
                wyckoff_spring = True
                break
        except (IndexError, KeyError):
            continue

    # Buy on Dip: current conditions
    buy_on_dip = bool(
        pd.notna(last['RSI']) and last['RSI'] < 30
        and cmf_val > 0
        and last['Close'] <= last['MA50'] * 1.02
    )

    # Buy on Weakness: NVI rising + price below MA21 + CMF positive
    buy_on_weakness = bool(
        nvi_val > nvi_ema_val
        and last['Close'] < last['MA21']
        and cmf_val > 0
    )

    return {
        'cmf': _round2(cmf_val),
        'cmf_signal': cmf_signal,
        'nvi': _round2(nvi_val),
        'nvi_ema': _round2(nvi_ema_val),
        'nvi_signal': nvi_signal,
        'pvi': _round2(pvi_val),
        'wyckoff_spring': wyckoff_spring,
        'buy_on_dip': buy_on_dip,
        'buy_on_weakness': buy_on_weakness,
    }


def _get_historical_data(scanner):
    """Get historical data for charting."""
    df = scanner.df.copy()

    # --- Pre-compute per-bar signal flags ---
    n = len(df)
    wyckoff_flags = [False] * n
    buy_dip_flags = [False] * n
    buy_weak_flags = [False] * n

    for i in range(1, n):
        row = df.iloc[i]
        prev_row = df.iloc[i - 1]

        # Wyckoff Spring: prev low broke below 20-day low, current close recovered above it with volume spike
        if (pd.notna(prev_row.get('Low_20')) and pd.notna(row.get('Low_20'))
                and pd.notna(row.get('Avg_Volume_20'))
                and prev_row['Low'] < prev_row['Low_20']
                and row['Close'] > row['Low_20']
                and row['Volume'] > 1.5 * row['Avg_Volume_20']):
            wyckoff_flags[i] = True

        # Buy on Dip: RSI oversold + CMF positive + close near MA50
        if (pd.notna(row.get('RSI')) and pd.notna(row.get('CMF')) and pd.notna(row.get('MA50'))
                and row['RSI'] < 30
                and row['CMF'] > 0
                and row['Close'] <= row['MA50'] * 1.02):
            buy_dip_flags[i] = True

        # Buy on Weakness: NVI above EMA + price below MA21 + CMF positive
        if (pd.notna(row.get('NVI')) and pd.notna(row.get('NVI_EMA'))
                and pd.notna(row.get('MA21')) and pd.notna(row.get('CMF'))
                and row['NVI'] > row['NVI_EMA']
                and row['Close'] < row['MA21']
                and row['CMF'] > 0):
            buy_weak_flags[i] = True

    result = []
    for i, (idx, row) in enumerate(df.iterrows()):
        result.append({
            'date': idx.strftime('%Y-%m-%d'),
            'open': _round2(row['Open']),
            'high': _round2(row['High']),
            'low': _round2(row['Low']),
            'close': _round2(row['Close']),
            'volume': int(row['Volume']),
            'ma9': _round2(row['MA9']) if pd.notna(row['MA9']) else None,
            'ma21': _round2(row['MA21']) if pd.notna(row['MA21']) else None,
            'ma50': _round2(row['MA50']) if pd.notna(row['MA50']) else None,
            'ma200': _round2(row['MA200']) if pd.notna(row['MA200']) else None,
            'rsi': _round2(row['RSI']) if pd.notna(row['RSI']) else None,
            'macd': _round2(row['MACD_Line']) if pd.notna(row['MACD_Line']) else None,
            'macd_signal': _round2(row['MACD_Signal']) if pd.notna(row['MACD_Signal']) else None,
            'macd_hist': _round2(row['MACD_Hist']) if pd.notna(row['MACD_Hist']) else None,
            'stoch_k': _round2(row['Stoch_K']) if pd.notna(row['Stoch_K']) else None,
            'stoch_d': _round2(row['Stoch_D']) if pd.notna(row['Stoch_D']) else None,
            'cmf': _round2(row['CMF']) if pd.notna(row['CMF']) else None,
            'nvi': _round2(row['NVI']) if pd.notna(row['NVI']) else None,
            'nvi_ema': _round2(row['NVI_EMA']) if pd.notna(row['NVI_EMA']) else None,
            'pvi': _round2(row['PVI']) if pd.notna(row['PVI']) else None,
            'wyckoff_spring': wyckoff_flags[i],
            'buy_on_dip': buy_dip_flags[i],
            'buy_on_weakness': buy_weak_flags[i],
        })

    return result


# ─── MA SQUEEZE SCREENER ─────────────────────────────────────────────────────

def _calc_indicators_screener(df: pd.DataFrame) -> pd.DataFrame:
    """Lightweight indicator calculation for screener (MA + RSI + Volume only)."""
    df = df.copy()
    # Moving averages (EMA)
    df['MA9']  = df['Close'].ewm(span=9,  adjust=False).mean()
    df['MA21'] = df['Close'].ewm(span=21, adjust=False).mean()
    df['MA50'] = df['Close'].ewm(span=50, adjust=False).mean()

    # RSI (14)
    delta = df['Close'].diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs   = gain / loss.replace(0, np.nan)
    df['RSI'] = 100 - (100 / (1 + rs))

    # Volume ratio vs 20-day average
    df['Avg_Vol20'] = df['Volume'].rolling(20).mean()
    df['Vol_Ratio'] = df['Volume'] / df['Avg_Vol20']

    # CMF (20-period)
    hl_range = (df['High'] - df['Low']).replace(0, np.nan)
    mfm = ((df['Close'] - df['Low']) - (df['High'] - df['Close'])) / hl_range
    mfm = mfm.fillna(0)
    df['CMF'] = (mfm * df['Volume']).rolling(20).sum() / df['Volume'].rolling(20).sum()

    return df


def _scan_ma_squeeze(ticker: str) -> dict | None:
    """
    Downloads daily data for one IHSG ticker and scores its MA squeeze condition.

    Squeeze criteria:
      1. MA gap %: (max(MA9,MA21,MA50) - min(MA9,MA21,MA50)) / price < threshold
      2. Convergence: MAs moving toward each other (net slope positive for bullish)
      3. Momentum bias: MA9 slope positive (upward tilt)
      4. Volume: CMF > 0 or 5-day avg volume ratio > 1.1
      5. RSI: 35–70 (room to run, not overbought)
      6. Liquidity: avg daily turnover > 1B IDR

    Returns score dict or None if ticker has no data or fails criteria.
    """
    try:
        ticker_jk = ticker if ticker.endswith('.JK') else f"{ticker}.JK"
        raw = yf.download(ticker_jk, period='3mo', interval='1d', progress=False)

        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)

        if raw.empty or len(raw) < 55:
            return None

        # Liquidity filter: avg daily value > 1B IDR
        avg_turnover = (raw['Close'] * raw['Volume']).tail(10).mean()
        if avg_turnover < 1_000_000_000:
            return None

        df = _calc_indicators_screener(raw)
        last = df.iloc[-1]

        # Require valid MAs
        if any(pd.isna([last['MA9'], last['MA21'], last['MA50'], last['RSI']])):
            return None

        price  = float(last['Close'])
        ma9    = float(last['MA9'])
        ma21   = float(last['MA21'])
        ma50   = float(last['MA50'])
        rsi    = float(last['RSI'])
        cmf    = float(last['CMF']) if pd.notna(last['CMF']) else 0.0

        # ── 1. MA Gap % (squeeze tightness) ──────────────────────────────────
        ma_max   = max(ma9, ma21, ma50)
        ma_min   = min(ma9, ma21, ma50)
        gap_pct  = ((ma_max - ma_min) / price) * 100  # % of price

        # Only consider tight squeezes (< 5% gap between all three MAs)
        if gap_pct > 5.0:
            return None

        # Squeeze score: tighter = higher (inverse of gap, scaled 0-40)
        tightness_score = max(0, (5.0 - gap_pct) / 5.0) * 40

        # ── 2. Convergence velocity ───────────────────────────────────────────
        window = 8
        recent = df.tail(window)
        x = np.arange(window)

        try:
            slope9,  *_ = linregress(x, recent['MA9'].values)
            slope21, *_ = linregress(x, recent['MA21'].values)
            slope50, *_ = linregress(x, recent['MA50'].values)
        except Exception:
            return None

        # Bullish convergence: MA9 rising faster than MA21, MA21 rising faster than MA50
        net_conv_score = 0
        if slope9 > slope21:   net_conv_score += 1
        if slope21 > slope50:  net_conv_score += 1
        if slope9 > 0:         net_conv_score += 1  # MA9 actually rising
        convergence_score = net_conv_score * 10  # max 30

        # ── 3. RSI filter + score (35–70 zone) ───────────────────────────────
        if not (35 <= rsi <= 70):
            return None
        # Optimal RSI: 45–65
        rsi_score = 15 if 45 <= rsi <= 65 else 8

        # ── 4. Volume accumulation ────────────────────────────────────────────
        vol_ratio   = float(last['Vol_Ratio']) if pd.notna(last['Vol_Ratio']) else 1.0
        avg_vol5    = float(df['Vol_Ratio'].tail(5).mean()) if len(df) >= 5 else 1.0
        vol_score   = 0
        if cmf > 0.05:     vol_score += 8
        elif cmf > 0:      vol_score += 4
        if avg_vol5 > 1.5: vol_score += 7
        elif avg_vol5 > 1.1: vol_score += 4

        # ── 5. Price above MA50 (bullish structure) ───────────────────────────
        structure_score = 5 if price > ma50 else 0

        # ── Total score (0–100) ───────────────────────────────────────────────
        total_score = tightness_score + convergence_score + rsi_score + vol_score + structure_score
        total_score = min(100, total_score)

        # Minimum threshold: only surface meaningful setups
        if total_score < 45:
            return None

        # Signal label
        if total_score >= 80:
            label = 'STRONG'
        elif total_score >= 65:
            label = 'MODERATE'
        else:
            label = 'WATCH'

        return {
            'ticker':        ticker,
            'price':         _round2(price),
            'squeeze_score': _round2(total_score),
            'ma_gap_pct':    _round2(gap_pct),
            'rsi':           _round2(rsi),
            'volume_ratio':  _round2(avg_vol5),
            'signal_label':  label,
            'ma9':           _round2(ma9),
            'ma21':          _round2(ma21),
            'ma50':          _round2(ma50),
        }

    except Exception as e:
        return None


@app.route('/api/screener/stream', methods=['POST', 'GET'])
def screener_stream():
    """
    SSE endpoint that streams MA squeeze screener results in real-time.
    Each event is a JSON line: { "type": "progress"|"result"|"done", ... }
    """
    data = request.get_json(silent=True) or {}
    tickers = data.get('tickers', IHSG_TICKERS)
    max_workers = data.get('max_workers', 20)

    def generate():
        total   = len(tickers)
        scanned = 0
        results = []

        # Yield initial info
        yield f"data: {json.dumps({'type': 'info', 'total': total})}\n\n"

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_scan_ma_squeeze, t): t for t in tickers}

            for future in as_completed(futures):
                scanned += 1
                try:
                    result = future.result()
                    if result:
                        results.append(result)
                        # Stream the new result immediately
                        yield f"data: {json.dumps({'type': 'result', 'data': result})}\n\n"
                except Exception:
                    pass

                # Stream progress every 10 tickers or when a result is found
                if scanned % 10 == 0 or result:
                    yield f"data: {json.dumps({'type': 'progress', 'scanned': scanned, 'total': total, 'found': len(results)})}\n\n"

        # Final summary
        sorted_results = sorted(results, key=lambda x: x['squeeze_score'], reverse=True)
        yield f"data: {json.dumps({'type': 'done', 'total_scanned': scanned, 'total_found': len(sorted_results), 'results': sorted_results})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*',
        }
    )


@app.route('/api/screener/tickers', methods=['GET'])
def screener_tickers():
    """Returns the list of IHSG tickers used by the screener."""
    return jsonify({'tickers': IHSG_TICKERS, 'count': len(IHSG_TICKERS)})


if __name__ == '__main__':
    print("🚀 Starting Flask API server on http://0.0.0.0:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)
