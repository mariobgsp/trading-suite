## sentiment-collector-analysis
# 🦅 Ultimate Market Screener (Indonesia Stock Exchange)

A high-performance Streamlit dashboard designed for traders to screen weekly news catalysts for the Indonesian Stock Exchange (IHSG). 

This tool automatically aggregates, filters, and categorizes news from trusted financial sources (Kontan, Bisnis, CNBC Indonesia, Investor.id) to highlight actionable market intelligence while strictly filtering out noise (celebrity, sports, viral news).

## 🚀 Key Features

1.  **Whale & Insider Radar** 🐋
    * Tracks movements of big players (Prajogo Pangestu, Thohir, Salim Group, Low Tuck Kwong).
    * Detects "Insider Trading" (buying/selling by directors/commissioners) and Private Placements.

2.  **Financial & Capex Monitor** 💰🏢
    * **Earnings:** Automatically tags quarterly reports (Q1, Q2, Q3, FY), Profit, Loss, and Revenue growth.
    * **Corporate Action:** Detects Mergers, Acquisitions, Capex (Capital Expenditure), Expansions, Right Issues, and Dividends.

3.  **Commodity & Macro Watch** 🛢️🌍
    * Monitors key commodities affecting IHSG (Coal, Gold, CPO, Nickel, Oil).
    * Tracks Global Macro triggers (The Fed, Inflation, Geopolitics).

4.  **Smart Noise Filtration** 🛡️
    * Uses strict negative lookups to ban irrelevant news (Soccer, Celebrity, Crime, Viral trends).
    * Only fetches from "White-listed" financial domains.

5.  **Zero-Headless Architecture** ⚡
    * Uses `feedparser` (RSS) instead of Selenium.
    * Extremely fast, low CPU/RAM usage, and no risk of browser version conflicts.

## 🛠️ Prerequisites

* **OS:** Linux (Fedora/Ubuntu), Windows, or macOS.
* **Python:** Version 3.8 or higher.

## 📦 Installation Guide

1.  **Clone or Create Project Folder**
    Open your terminal/VS Code and navigate to your project directory.

2.  **Create a Virtual Environment (Recommended)**
    ```bash
    # For Linux/macOS
    python3 -m venv .venv
    source .venv/bin/activate

    # For Windows
    python -m venv .venv
    .venv\Scripts\activate
    ```

3.  **Install Dependencies**
    Install the required Python libraries:
    ```bash
    pip install streamlit pandas feedparser python-dateutil
    ```

## 🖥️ How to Run

1.  Ensure your virtual environment is active.
2.  Run the Streamlit app:
    ```bash
    streamlit run app.py
    ```
3.  The dashboard will open automatically in your default web browser (usually at `http://localhost:8501`).

## 📖 Usage Manual

1.  **Full Scan:** Click the **"🔄 FULL SCAN"** button in the left sidebar. The app will fetch the last 7 days of news.
2.  **Tabs Navigation:** Use the tabs at the top to switch views:
    * *💰 KINERJA:* Earnings reports & financial performance.
    * *🏢 AKSI & CAPEX:* M&A, factory expansions, spending.
    * *🐋 WHALE:* Conglomerate moves & insider buys.
    * *🛢️ KOMODITAS:* Energy & metal prices.
3.  **Smart Filter:** Use the dropdown in the sidebar ("Cari Topik") to drill down into specific tags like "Kinerja Q1", "Dividen", or "Prajogo".

## ⚙️ Configuration

To modify the news sources or keywords, open `app.py` and edit the `fetch_news_data()` function:

* **`sites` variable:** Add or remove news domains (must use `site:domain.com` format).
* **`exclude` variable:** Add keywords you want to block (prefix with `-`).
* **`queries` list:** Adjust the search logic for specific sectors.

## ⚠️ Disclaimer

This tool is for **informational purposes only**. It acts as a news aggregator. The developer is not responsible for any trading decisions made based on this data. Always do your own research (DYOR).

---
*Built with ❤️ using Python & Streamlit on Fedora.*