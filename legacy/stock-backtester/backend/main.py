import yfinance as yf
import pandas as pd
import numpy as np
import sys
from scipy.stats import linregress
from simple_sentiment import SimpleSentiment
import signal

# --- CONFIGURATION ---
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 1000)
pd.options.display.float_format = '{:.2f}'.format

class StockScanner:
    def __init__(self, ticker_input):
        self.ticker = self._format_ticker(ticker_input)
        self.df = None

    def _format_ticker(self, ticker_input):
        """Auto-formats for IHSG if needed."""
        t = ticker_input.upper()
        # Assume IHSG if 4 letters and not crypto/US format
        if len(t) == 4 and not t.endswith(".JK") and "-" not in t:
            return f"{t}.JK"
        return t

    def fetch_data(self, period="2y", interval="1d"):
        """Fetches data and calculates indicators."""
        
        # Increase period for larger intervals to ensure enough data for indicators
        if interval == "1wk":
            period = "5y" if period == "2y" else period
        elif interval == "1mo":
            period = "max" if period == "2y" else period

        print(f"\n--- 🇮🇩 Analyzing {self.ticker} ({period}, {interval}) ---")
        try:
            self.df = yf.download(self.ticker, period=period, interval=interval, progress=False)
            
            # Handle MultiIndex (Fix for new yfinance versions)
            if isinstance(self.df.columns, pd.MultiIndex):
                self.df.columns = self.df.columns.get_level_values(0)

            if self.df.empty:
                print(f"❌ Error: Data not found for {self.ticker}.")
                return False

            # Liquidity Check (Skip for Crypto/US)
            if ".JK" in self.ticker:
                avg_val = (self.df['Close'] * self.df['Volume']).tail(20).mean()
                if avg_val < 5_000_000_000:
                    print(f"⚠️  WARNING: Low Liquidity (Avg Val < 5M IDR). Signals may be unreliable.")

            self._calculate_indicators()
            return True
        except Exception as e:
            print(f"Error fetching data: {e}")
            return False

    def _calculate_indicators(self):
        df = self.df
        # Moving Averages
        df['MA9'] = df['Close'].ewm(span=9, adjust=False).mean()
        df['MA21'] = df['Close'].ewm(span=21, adjust=False).mean()
        df['MA50'] = df['Close'].ewm(span=50, adjust=False).mean()
        df['MA200'] = df['Close'].ewm(span=200, adjust=False).mean()

        # MACD (12, 26, 9)
        df['EMA12'] = df['Close'].ewm(span=12, adjust=False).mean()
        df['EMA26'] = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD_Line'] = df['EMA12'] - df['EMA26']
        df['MACD_Signal'] = df['MACD_Line'].ewm(span=9, adjust=False).mean()
        df['MACD_Hist'] = df['MACD_Line'] - df['MACD_Signal']
        
        # RSI (14)
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI'] = 100 - (100 / (1 + rs))

        # Stochastic Oscillator (14, 3, 3)
        # %K = (Current Close - Lowest Low) / (Highest High - Lowest Low) * 100
        # %D = 3-day SMA of %K
        low_14 = df['Low'].rolling(window=14).min()
        high_14 = df['High'].rolling(window=14).max()
        df['Stoch_K'] = 100 * ((df['Close'] - low_14) / (high_14 - low_14))
        df['Stoch_D'] = df['Stoch_K'].rolling(window=3).mean()

        # --- BANDARMOLOGY / SMART MONEY INDICATORS ---

        # CMF (Chaikin Money Flow, 20-period)
        high_low_range = df['High'] - df['Low']
        mfm = ((df['Close'] - df['Low']) - (df['High'] - df['Close'])) / high_low_range
        mfm = mfm.fillna(0)  # handle zero-range bars
        mfv = mfm * df['Volume']
        df['CMF'] = mfv.rolling(window=20).sum() / df['Volume'].rolling(window=20).sum()

        # NVI (Negative Volume Index) - tracks smart money on low-volume days
        nvi_values = np.ones(len(df)) * 1000.0
        for i in range(1, len(df)):
            prev_vol = float(df['Volume'].iloc[i - 1])
            if prev_vol > 0 and float(df['Volume'].iloc[i]) < prev_vol:
                price_change = (float(df['Close'].iloc[i]) - float(df['Close'].iloc[i - 1])) / float(df['Close'].iloc[i - 1])
                nvi_values[i] = nvi_values[i - 1] * (1 + price_change)
            else:
                nvi_values[i] = nvi_values[i - 1]
        df['NVI'] = nvi_values
        df['NVI_EMA'] = df['NVI'].ewm(span=255, adjust=False).mean()

        # PVI (Positive Volume Index) - tracks retail/crowd on high-volume days
        pvi_values = np.ones(len(df)) * 1000.0
        for i in range(1, len(df)):
            prev_vol = float(df['Volume'].iloc[i - 1])
            if prev_vol > 0 and float(df['Volume'].iloc[i]) > prev_vol:
                price_change = (float(df['Close'].iloc[i]) - float(df['Close'].iloc[i - 1])) / float(df['Close'].iloc[i - 1])
                pvi_values[i] = pvi_values[i - 1] * (1 + price_change)
            else:
                pvi_values[i] = pvi_values[i - 1]
        df['PVI'] = pvi_values

        # Support levels for Wyckoff Spring detection
        df['Low_20'] = df['Low'].rolling(window=20).min()
        df['Avg_Volume_20'] = df['Volume'].rolling(window=20).mean()

    def get_news_sentiment(self):
        """Fetches news and calculates sentiment polarity using SimpleSentiment with Timeout."""
        try:
            # Mock news for fallback
            mock_news = [
                {'title': f"{self.ticker} reports strong earnings growth", 'publisher': 'Financial Times', 'link': '#', 'sentiment': 'BULLISH', 'score': 0.8},
                {'title': "Market outlook remains positive for the sector", 'publisher': 'Reuters', 'link': '#', 'sentiment': 'BULLISH', 'score': 0.6},
                {'title': "Analysts upgrade price target", 'publisher': 'Bloomberg', 'link': '#', 'sentiment': 'BULLISH', 'score': 0.7},
                {'title': "Mixed results from competitors", 'publisher': 'CNBC', 'link': '#', 'sentiment': 'NEUTRAL', 'score': 0.0},
                {'title': "Global economic concerns weigh on market", 'publisher': 'WSJ', 'link': '#', 'sentiment': 'BEARISH', 'score': -0.4}
            ]

            # Try fetching real news with a strict timeout
            class TimeoutError(Exception): pass
            def handler(signum, frame): raise TimeoutError()
            
            # Register the signal function handler
            signal.signal(signal.SIGALRM, handler)
            signal.alarm(3) # 3 seconds timeout for yfinance
            
            try:
                t = yf.Ticker(self.ticker)
                news = t.news
                signal.alarm(0) # Disable alarm
            except (TimeoutError, Exception) as e:
                print(f"News fetch timed out or failed: {e}. Using mock data.")
                return mock_news

            if not news:
                print("No news found. Using mock data.")
                return mock_news

            analyzer = SimpleSentiment()
            results = []
            
            for n in news[:10]: # Analyze latest 10 news items
                title = n.get('title', '')
                link = n.get('link', '')
                publisher = n.get('publisher', '')
                publish_time = n.get('providerPublishTime', 0)
                
                if not title: continue
                
                # Sentiment Analysis using SimpleSentiment
                score = analyzer.analyze(title)
                
                # Categorize sentiment
                sentiment = "NEUTRAL"
                if score >= 0.2:
                    sentiment = "BULLISH"
                elif score <= -0.2:
                    sentiment = "BEARISH"
                
                results.append({
                    'title': title,
                    'link': link,
                    'publisher': publisher,
                    'publish_time': publish_time,
                    'sentiment': sentiment,
                    'score': round(score, 2)
                })
                
            return results

        except Exception as e:
            print(f"Error fetching news sentiment: {e}")
            return []

    def run_backtest(self):
        """Retests historical signals."""
        if self.df is None: return

        df = self.df.copy()
        # Shift for crossover detection
        df['Prev_MA9'] = df['MA9'].shift(1)
        df['Prev_MA21'] = df['MA21'].shift(1)
        df['Prev_MA50'] = df['MA50'].shift(1)
        df['Prev_MACD'] = df['MACD_Line'].shift(1)
        df['Prev_RSI'] = df['RSI'].shift(1)
        df['Prev_CMF'] = df['CMF'].shift(1)

        signals = []
        
        # Loop through history (stop 20 days early for forward calc)
        for i in range(50, len(df) - 20):
            curr = df.iloc[i]
            prev = df.iloc[i-1]
            
            # Future Returns
            ret_5d = self._get_return(i, 5)
            ret_10d = self._get_return(i, 10)
            ret_20d = self._get_return(i, 20)
            
            sig_type = None

            # --- SIGNAL DEFINITIONS ---
            # 1. MA 9/21
            if prev['Prev_MA9'] < prev['Prev_MA21'] and curr['MA9'] > curr['MA21']:
                sig_type = 'MA 9 > 21 (Bull Momentum)'
            elif prev['Prev_MA9'] > prev['Prev_MA21'] and curr['MA9'] < curr['MA21']:
                sig_type = 'MA 9 < 21 (Bear Momentum)'
            
            # 2. MA 21/50
            elif prev['Prev_MA21'] < prev['Prev_MA50'] and curr['MA21'] > curr['MA50']:
                sig_type = 'MA 21 > 50 (Bull Trend)'
            elif prev['Prev_MA21'] > prev['Prev_MA50'] and curr['MA21'] < curr['MA50']:
                sig_type = 'MA 21 < 50 (Bear Trend)'

            # 3. MACD Zero
            elif prev['Prev_MACD'] < 0 and curr['MACD_Line'] > 0:
                sig_type = 'MACD Zero Cross Up'
            elif prev['Prev_MACD'] > 0 and curr['MACD_Line'] < 0:
                sig_type = 'MACD Zero Cross Down'

            # 4. RSI
            elif prev['Prev_RSI'] < 70 and curr['RSI'] >= 70:
                sig_type = 'RSI Enter >70 (Overbought)'
            elif prev['Prev_RSI'] > 40 and curr['RSI'] <= 40:
                sig_type = 'RSI Enter <40 (Oversold)'

            # --- BANDARMOLOGY SIGNALS ---

            # 5. CMF Cross (Accumulation / Distribution shift)
            elif prev['Prev_CMF'] < 0 and curr['CMF'] > 0:
                sig_type = 'CMF Bull Cross (Accumulation)'
            elif prev['Prev_CMF'] > 0 and curr['CMF'] < 0:
                sig_type = 'CMF Bear Cross (Distribution)'

            # 6. Wyckoff Spring: price dips below 20-day support, then recovers with volume
            elif (i > 0 and not np.isnan(prev.get('Low_20', np.nan))
                  and df.iloc[i-1]['Low'] < prev['Low_20']
                  and curr['Close'] > curr['Low_20']
                  and curr['Volume'] > 1.5 * curr['Avg_Volume_20']):
                sig_type = 'Wyckoff Spring (Smart Money Buy)'

            # 7. Buy on Dip: RSI oversold + CMF positive + near MA50 support
            elif (curr['RSI'] < 30 and curr['CMF'] > 0
                  and curr['Close'] <= curr['MA50'] * 1.02):
                sig_type = 'Buy on Dip (Oversold + Accumulation)'

            # 8. Buy on Weakness: NVI rising (smart money) while price falling
            elif (curr['NVI'] > curr['NVI_EMA']
                  and curr['Close'] < curr['MA21']
                  and curr['CMF'] > 0
                  and prev.get('Prev_CMF', 0) <= 0):
                sig_type = 'Buy on Weakness (Smart Money Accumulation)'

            if sig_type:
                signals.append({
                    'Signal': sig_type,
                    'Ret_5d': ret_5d, 'Ret_10d': ret_10d, 'Ret_20d': ret_20d
                })

        # Summarize
        if not signals:
            print("No signals found in this period.")
            return

        res = pd.DataFrame(signals)
        summary = res.groupby('Signal').agg(
            Count=('Ret_5d', 'count'),
            Avg_5d=('Ret_5d', 'mean'),
            Avg_20d=('Ret_20d', 'mean'),
            Win_Rate_20d=('Ret_20d', lambda x: (x > 0).mean() * 100)
        ).sort_values(by='Count', ascending=False)

        print(f"\n📊 HISTORICAL BEHAVIOR (Last 2 Years)")
        print(summary)

    def run_prediction(self):
        """Predicts future crossovers based on current slope."""
        if self.df is None: return

        print(f"\n🔮 FUTURE PREDICTION (Based on current velocity)")
        
        # Helper to calc slope and intersection
        def predict_cross(short_ma, long_ma, name_short, name_long):
            # Get last 5 days
            s_series = self.df[short_ma].tail(5)
            l_series = self.df[long_ma].tail(5)
            
            # Linear Regression on slopes
            x = np.arange(len(s_series))
            slope_s, _, _, _, _ = linregress(x, s_series)
            slope_l, _, _, _, _ = linregress(x, l_series)
            
            curr_s = s_series.iloc[-1]
            curr_l = l_series.iloc[-1]
            gap = curr_s - curr_l
            net_slope = slope_s - slope_l # How fast gap is closing

            status = "Diverging (No Cross)"
            days = "N/A"
            
            # Logic: If Gap is + and Slope is -, they are converging
            if (gap > 0 and net_slope < 0) or (gap < 0 and net_slope > 0):
                d = abs(gap / net_slope)
                status = f"Converging in ~{d:.1f} days"
            
            trend = "BULLISH" if gap > 0 else "BEARISH"
            print(f"   • {name_short} vs {name_long}: Currently {trend}. {status}")

        predict_cross('MA9', 'MA21', 'MA 9', 'MA 21')
        predict_cross('MA21', 'MA50', 'MA 21', 'MA 50')
        
        # Current Price Context
        last_price = self.df['Close'].iloc[-1]
        last_rsi = self.df['RSI'].iloc[-1]
        print(f"   • Current Price: {last_price:,.0f} | RSI: {last_rsi:.1f}")

    def _get_return(self, idx, days):
        try:
            future = self.df.iloc[idx + days]['Close']
            curr = self.df.iloc[idx]['Close']
            return ((future - curr) / curr) * 100
        except IndexError:
            return np.nan

# --- MAIN EXECUTION ---
if __name__ == "__main__":
    if len(sys.argv) > 1:
        ticker = sys.argv[1]
    else:
        ticker = input("Enter Ticker (e.g. BBCA): ")

    scanner = StockScanner(ticker)
    if scanner.fetch_data():
        scanner.run_backtest()
        scanner.run_prediction()