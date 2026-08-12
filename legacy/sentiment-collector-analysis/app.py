import streamlit as st
import pandas as pd
import feedparser
from datetime import datetime
from dateutil import parser as date_parser
import re

# --- KONFIGURASI HALAMAN ---
st.set_page_config(
    page_title="Pro Trader Screener (Ultimate)",
    page_icon="🦅",
    layout="wide"
)

# --- CSS STYLING ---
st.markdown("""
<style>
    .news-card {
        background-color: #161b22;
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 10px;
        border: 1px solid #30363d;
    }
    .news-card:hover { border-color: #8b949e; }
    
    .cat-whale { border-left: 4px solid #9C27B0; } /* Ungu (Bandar/Insider) */
    .cat-fin { border-left: 4px solid #00C853; }   /* Hijau (Laba/Kinerja) */
    .cat-corp { border-left: 4px solid #FFC107; }   /* Kuning (Merger/Action) */
    .cat-comm { border-left: 4px solid #FF5722; }   /* Orange (Komoditas) */
    .cat-macro { border-left: 4px solid #03A9F4; }  /* Biru (Global) */
    
    .meta-row { font-size: 0.75rem; color: #8b949e; margin-bottom: 5px; }
    .source-badge { background: #21262d; padding: 2px 6px; border-radius: 4px; color: #c9d1d9; }
    
    .title-link {
        font-size: 1.05rem;
        font-weight: 600;
        color: #58a6ff;
        text-decoration: none;
        display: block;
        margin-bottom: 8px;
    }
    .title-link:hover { text-decoration: underline; color: #79c0ff; }
    
    .tag-pill {
        display: inline-block;
        font-size: 0.7rem;
        padding: 2px 8px;
        border-radius: 10px;
        background: #232830;
        color: #c9d1d9;
        margin-right: 5px;
        border: 1px solid #484f58;
        margin-top: 4px;
    }
</style>
""", unsafe_allow_html=True)

# --- FUNGSI CLEANER ---
def clean_text(text):
    if not text: return ""
    clean = re.sub(r'<.*?>', '', text)
    clean = clean.replace('&nbsp;', ' ').replace('&#39;', "'").replace('&quot;', '"')
    clean = clean.split(" - ")[0]
    return clean.strip()

# --- LOGIC TAGS (AUTO-DETECT SEMUA EVENT) ---
def extract_tags(text):
    text = text.lower()
    tags = set()
    
    # 1. PERIODE LAPORAN KEUANGAN
    if any(x in text for x in ['q1', 'kuartal i ', 'triwulan i ']): tags.add("Kinerja Q1")
    if any(x in text for x in ['q2', 'kuartal ii ', 'triwulan ii ', 'semester i ']): tags.add("Kinerja Q2/H1")
    if any(x in text for x in ['q3', 'kuartal iii ', 'triwulan iii ']): tags.add("Kinerja Q3")
    if any(x in text for x in ['q4', 'kuartal iv ', 'full year', 'tahunan']): tags.add("Kinerja FY")
    
    # 2. METRIK KEUANGAN
    if any(x in text for x in ['laba', 'profit', 'cuan', 'untung']): tags.add("Laba Bersih")
    if any(x in text for x in ['rugi', 'boncos', 'kerugian']): tags.add("Rugi")
    if any(x in text for x in ['pendapatan', 'revenue', 'omzet']): tags.add("Pendapatan")
    if any(x in text for x in ['dividen', 'dividend']): tags.add("Dividen")
    
    # 3. AKSI KORPORASI & ASET
    if any(x in text for x in ['akuisisi', 'caplok', 'beli saham', 'ambil alih']): tags.add("Akuisisi/Merger")
    if any(x in text for x in ['belanja modal', 'capex', 'ekspansi', 'pabrik baru', 'proyek baru']): tags.add("Ekspansi/Capex")
    if any(x in text for x in ['jual aset', 'divestasi', 'lepas saham']): tags.add("Divestasi")
    if any(x in text for x in ['right issue', 'hmetd', 'private placement']): tags.add("Right Issue/PP")
    if any(x in text for x in ['stock split', 'pemecahan saham']): tags.add("Stock Split")
    if any(x in text for x in ['ipo', 'saham perdana', 'listing']): tags.add("IPO")
    if any(x in text for x in ['buyback', 'beli kembali']): tags.add("Buyback")
    
    # 4. MARKET & INSIDER
    if any(x in text for x in ['prajogo', 'thohir', 'salim', 'low tuck kwong', 'insider', 'borong']): tags.add("Whale/Insider")
    if any(x in text for x in ['suspensi', 'uma ', 'gembok']): tags.add("Suspensi/UMA")
    
    # 5. KOMODITAS
    if any(x in text for x in ['batubara', 'coal']): tags.add("Batubara")
    if any(x in text for x in ['emas', 'gold']): tags.add("Emas")
    if any(x in text for x in ['cpo', 'sawit']): tags.add("CPO")
    
    return list(tags)

# --- LOGIC KATEGORI UTAMA (TABS) ---
def analyze_category(title):
    title_lower = title.lower()
    
    # Prioritas 1: Whale & Insider
    if any(x in title_lower for x in ['prajogo', 'thohir', 'salim', 'insider', 'borong']):
        return "🐋 WHALE", "cat-whale", "#9C27B0"
        
    # Prioritas 2: Laporan Keuangan (Financials)
    elif any(x in title_lower for x in ['laba', 'rugi', 'kuartal', 'q1', 'q2', 'q3', 'fy', 'kinerja', 'pendapatan', 'tumbuh']):
        return "💰 KINERJA", "cat-fin", "#00C853"
        
    # Prioritas 3: Corporate Action (Akuisisi, Capex, RI)
    elif any(x in title_lower for x in ['merger', 'akuisisi', 'capex', 'ekspansi', 'divestasi', 'right issue', 'stock split', 'ipo', 'buyback', 'dividen']):
        return "🏢 ACTION", "cat-corp", "#FFC107"
        
    # Prioritas 4: Komoditas
    elif any(x in title_lower for x in ['batubara', 'emas', 'cpo', 'nikel', 'minyak', 'timah']):
        return "🛢️ KOMODITAS", "cat-comm", "#FF5722"
        
    # Prioritas 5: Global/Macro
    else:
        return "🌍 GLOBAL", "cat-macro", "#03A9F4"

# --- FETCHING ENGINE (UPDATED QUERIES) ---
def fetch_news_data():
    sites = "site:kontan.co.id OR site:bisnis.com OR site:cnbcindonesia.com OR site:investor.id OR site:bloombergtechnoz.com"
    exclude = "-bola -sepak -seleb -artis -gosip -viral -kriminal -polisi"
    
    # Query diperluas mencakup Financials & Capex
    queries = [
        # 1. Whale & Insider
        f"(Prajogo OR Thohir OR Salim OR \"Insider Trading\" OR \"Borong Saham\" OR \"Private Placement\") {sites} {exclude} when:7d",
        
        # 2. Financials (Laba, Q1-Q4, Kinerja)
        f"(\"Laba Bersih\" OR \"Rugi Bersih\" OR \"Kinerja Keuangan\" OR \"Pendapatan\" OR Kuartal OR Q1 OR Q2 OR Q3 OR Q4) {sites} {exclude} when:7d",
        
        # 3. Corporate Action (Akuisisi, Capex, Ekspansi, RI)
        f"(Akuisisi OR Merger OR \"Belanja Modal\" OR Capex OR Ekspansi OR \"Right Issue\" OR Dividen OR Buyback OR \"Stock Split\") {sites} {exclude} when:7d",
        
        # 4. Komoditas & Global
        f"(Batubara OR Emas OR CPO OR Nikel OR Minyak OR \"The Fed\" OR Inflasi) {sites} {exclude} when:7d"
    ]
    
    all_news = []
    seen_urls = set()
    
    my_bar = st.progress(0, text="Deep Scanning Market...")
    
    for i, q in enumerate(queries):
        encoded = q.replace(" ", "%20").replace('"', '%22')
        url = f"https://news.google.com/rss/search?q={encoded}&hl=id&gl=ID&ceid=ID:id"
        feed = feedparser.parse(url)
        
        my_bar.progress((i + 1) * 20, text=f"Processing Channel {i+1}...")
        
        if not feed.entries: continue
            
        for entry in feed.entries:
            if entry.link in seen_urls: continue
            seen_urls.add(entry.link)
            
            clean_title = clean_text(entry.title)
            if len(clean_title) < 10 or "<" in clean_title: continue
            
            cat_name, css_class, color = analyze_category(clean_title)
            specific_tags = extract_tags(clean_title)
            
            source = entry.source.title if 'source' in entry else "News"
            try:
                dt = date_parser.parse(entry.published)
                date_str = dt.strftime("%d %b %H:%M")
            except:
                dt = datetime.now()
                date_str = "Baru saja"
                
            all_news.append({
                "dt": dt,
                "date_str": date_str,
                "source": source,
                "title": clean_title,
                "link": entry.link,
                "category": cat_name,
                "css": css_class,
                "color": color,
                "tags": specific_tags
            })
            
    my_bar.progress(100, text="Selesai!")
    return pd.DataFrame(all_news)

# --- UI ---
st.title("🦅 Ultimate Market Screener")
st.caption("Whale • Financials (Q1-Q4) • Capex • Merger • Macro")

with st.sidebar:
    st.header("Control Panel")
    if st.button("🔄 FULL SCAN", type="primary"):
        df = fetch_news_data()
        if not df.empty:
            df.sort_values(by="dt", ascending=False, inplace=True)
            st.session_state['data_v6'] = df
            st.success(f"Dapat {len(df)} berita.")
        else:
            st.error("Gagal mengambil data.")

    st.divider()

    selected_tags = []
    if 'data_v6' in st.session_state and not st.session_state['data_v6'].empty:
        df = st.session_state['data_v6']
        all_unique_tags = set()
        for tags_list in df['tags']:
            all_unique_tags.update(tags_list)
        
        st.subheader("🔍 Smart Filter")
        selected_tags = st.multiselect(
            "Cari Topik (misal: Kinerja Q1, Capex, Laba):",
            options=sorted(list(all_unique_tags))
        )

# --- RENDERER (NO INDENTATION BUG) ---
def render_card(row):
    tags_html = ""
    for t in row['tags']:
        tags_html += f'<span class="tag-pill">{t}</span>'
        
    html = f"""<div class="news-card {row['css']}">
<div class="meta-row">
<span class="source-badge">{row['source']}</span>
<span style="float:right;">{row['date_str']}</span>
</div>
<a href="{row['link']}" target="_blank" class="title-link">{row['title']}</a>
<div style="margin-top:5px;">
<span style="color:{row['color']}; font-weight:bold; font-size:0.8em; margin-right:10px;">{row['category']}</span>
{tags_html}
</div>
</div>"""
    st.markdown(html, unsafe_allow_html=True)

# --- DISPLAY ---
if 'data_v6' in st.session_state and not st.session_state['data_v6'].empty:
    df_display = st.session_state['data_v6']
    
    if selected_tags:
        df_display = df_display[df_display['tags'].apply(lambda x: any(tag in x for tag in selected_tags))]
    
    # METRICS
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total News", len(df_display))
    c2.metric("Laporan Keuangan", len(df_display[df_display['category'] == "💰 KINERJA"]))
    c3.metric("Corp Action/Capex", len(df_display[df_display['category'] == "🏢 ACTION"]))
    c4.metric("Whale/Insider", len(df_display[df_display['category'] == "🐋 WHALE"]))
    
    st.divider()
    
    if df_display.empty:
        st.warning("Tidak ada berita yang cocok.")
    else:
        # TABS BARU YANG LEBIH LENGKAP
        t1, t2, t3, t4, t5, t6 = st.tabs([
            "💰 KINERJA (Q1-Q4)", 
            "🏢 AKSI & CAPEX", 
            "🐋 WHALE", 
            "🛢️ KOMODITAS", 
            "🌍 GLOBAL", 
            "📄 SEMUA"
        ])
        
        with t1:
            st.caption("Laba Bersih, Rugi, Pendapatan, Kinerja Kuartalan (Q1/Q2/Q3/Q4)")
            subset = df_display[df_display['category'] == "💰 KINERJA"]
            for _, r in subset.iterrows(): render_card(r)
        with t2:
            st.caption("Merger, Akuisisi, Belanja Modal (Capex), Ekspansi, Right Issue, Dividen")
            subset = df_display[df_display['category'] == "🏢 ACTION"]
            for _, r in subset.iterrows(): render_card(r)
        with t3:
            subset = df_display[df_display['category'] == "🐋 WHALE"]
            for _, r in subset.iterrows(): render_card(r)
        with t4:
            subset = df_display[df_display['category'] == "🛢️ KOMODITAS"]
            for _, r in subset.iterrows(): render_card(r)
        with t5:
            subset = df_display[df_display['category'] == "🌍 GLOBAL"]
            for _, r in subset.iterrows(): render_card(r)
        with t6:
            for _, r in df_display.iterrows(): render_card(r)

else:
    st.info("👋 Klik **FULL SCAN** di sidebar.")