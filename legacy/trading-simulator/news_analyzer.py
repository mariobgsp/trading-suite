import json
import os
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "news_data.json")

# Load environment variables
try:
    from dotenv import load_dotenv
    # Prioritize dashboard .env since it has the keys
    load_dotenv(os.path.join(BASE_DIR, "dashboard", ".env"))
    load_dotenv(os.path.join(BASE_DIR, ".env"))
except ImportError:
    pass

# Enhanced Bilingual Fallback Keywords
BULLISH_KEYWORDS = [
    "beat", "growth", "surpassed", "partnership", "dividend", "acquisition", "upgraded",
    "laba", "untung", "meroket", "melonjak", "akuisisi", "dividen", "investasi", "ekspansi",
    "target", "rekomendasi beli", "positif", "menguat"
]
BEARISH_KEYWORDS = [
    "missed", "dropped", "fined", "investigation", "layoff", "inflation", "recession", "downside",
    "rugi", "anjlok", "merosot", "turun", "phk", "inflasi", "resesi", "denda", "gugatan",
    "melemah", "negatif", "dijual", "lepas"
]

# Configure Gemini if key is present
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
model = None
if GEMINI_API_KEY:
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-1.5-flash')
    except ImportError:
        print("[WARN] google.generativeai not installed. Falling back to keyword matching.")

def analyze_sentiment_keyword(title, description=""):
    text = (title + " " + description).lower()
    score = 0.0
    for word in BULLISH_KEYWORDS:
        if word in text:
            score += 0.3
    for word in BEARISH_KEYWORDS:
        if word in text:
            score -= 0.3
    
    score = max(-1.0, min(1.0, score))
    
    if score > 0.1: return "Bullish", score
    if score < -0.1: return "Bearish", score
    return "Neutral", 0.0

def generate_summary_keyword(title, sentiment):
    return [
        f"Significant {sentiment} movement detected.",
        f"Headline: {title}",
        "Potential impact on sector expected within 24 hours."
    ]

def analyze_with_ai(title, description):
    prompt = f"""
Analyze the following financial news for Indonesian/Global markets. 
Determine the sentiment (Bullish, Bearish, or Neutral), provide a sentiment score from -1.0 to 1.0, and write a 3-bullet-point summary of the key takeaways.

News Title: {title}
News Description: {description}

Respond strictly in valid JSON format:
{{
  "sentiment": "Bullish",
  "score": 0.8,
  "summary": [
    "Bullet point 1",
    "Bullet point 2",
    "Bullet point 3"
  ]
}}
"""
    try:
        response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
        data = json.loads(response.text)
        
        # Validation
        sentiment = data.get("sentiment", "Neutral")
        # Ensure sentiment is nicely capitalized
        if sentiment.lower() == "bullish": sentiment = "Bullish"
        elif sentiment.lower() == "bearish": sentiment = "Bearish"
        else: sentiment = "Neutral"
            
        score = float(data.get("score", 0.0))
        summary = data.get("summary", [])
        if not isinstance(summary, list) or len(summary) == 0:
            summary = [f"Headline: {title}"]
            
        return sentiment, score, summary
    except Exception as e:
        print(f"[ERROR] AI analysis failed: {e}")
        return None, None, None

def run():
    if not os.path.exists(DATA_PATH):
        return

    with open(DATA_PATH, 'r') as f:
        news_items = json.load(f)

    updated = False
    count = 0
    for item in news_items:
        if item.get("status") == "raw":
            title = item.get("title", "")
            description = item.get("description", "")
            
            # AI Analysis
            ai_success = False
            if model:
                if count > 0:
                    time.sleep(1.0) # Simple rate limit handling
                
                print(f"[AI] Analyzing: {title[:50]}...")
                sentiment, score, summary = analyze_with_ai(title, description)
                if sentiment is not None:
                    item["sentiment"] = sentiment
                    item["sentiment_score"] = score
                    item["summary"] = summary
                    ai_success = True
            
            # Fallback
            if not ai_success:
                print(f"[Keyword] Analyzing: {title[:50]}...")
                sentiment, score = analyze_sentiment_keyword(title, description)
                item["sentiment"] = sentiment
                item["sentiment_score"] = score
                item["summary"] = generate_summary_keyword(title, sentiment)

            item["status"] = "analyzed"
            updated = True
            count += 1
            
            # Save progress periodically to avoid losing data if it crashes
            if count % 10 == 0:
                with open(DATA_PATH, 'w') as f:
                    json.dump(news_items, f, indent=2)

    if updated:
        with open(DATA_PATH, 'w') as f:
            json.dump(news_items, f, indent=2)
        print(f"Successfully analyzed {count} pending news items.")
    else:
        print("No new items to analyze.")

if __name__ == "__main__":
    run()
