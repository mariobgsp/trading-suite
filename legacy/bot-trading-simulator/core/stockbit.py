import os
import logging
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

STOCKBIT_BASE_URL = 'https://exodus.stockbit.com'

class StockbitClient:
    """Client for extracting data from Stockbit API."""
    
    def __init__(self):
        self.token = os.getenv("STOCKBIT_JWT_TOKEN")
        if not self.token:
            logger.warning("STOCKBIT_JWT_TOKEN is not set in environment variables.")
            
    def _get_headers(self) -> dict:
        return {
            'accept': 'application/json',
            'authorization': f'Bearer {self.token}',
            'origin': 'https://stockbit.com',
            'referer': 'https://stockbit.com/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        }

    def fetch_market_detector(self, ticker: str, from_date: str, to_date: str) -> dict | None:
        """
        Fetch market detector (bandarmology) data for a given ticker and date range.
        Dates should be in 'YYYY-MM-DD' format.
        """
        if not self.token:
            return None
            
        url = f"{STOCKBIT_BASE_URL}/marketdetectors/{ticker}"
        params = {
            'from': from_date,
            'to': to_date,
            'transaction_type': 'TRANSACTION_TYPE_NET',
            'market_board': 'MARKET_BOARD_REGULER',
            'investor_type': 'INVESTOR_TYPE_ALL',
            'limit': '25'
        }
        
        try:
            response = requests.get(url, headers=self._get_headers(), params=params, timeout=10)
            if response.status_code == 401:
                logger.error("Stockbit token expired or invalid.")
                return None
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Failed to fetch market detector for {ticker}: {e}")
            return None

def get_top_broker(market_detector_data: dict) -> dict | None:
    """
    Extract the top broker by net buy value.
    """
    if not market_detector_data:
        return None
        
    try:
        data = market_detector_data.get('data', {})
        broker_summary = data.get('broker_summary', {})
        brokers_buy = broker_summary.get('brokers_buy', [])
        
        if not brokers_buy:
            return None
            
        # Sort by bval (buy value) descending
        sorted_brokers = sorted(brokers_buy, key=lambda x: float(x.get('bval', 0)), reverse=True)
        top_broker = sorted_brokers[0]
        
        return {
            'bandar': top_broker.get('netbs_broker_code'),
            'barangBandar': round(float(top_broker.get('blot', 0))),
            'rataRataBandar': round(float(top_broker.get('netbs_buy_avg_price', 0)))
        }
    except Exception as e:
        logger.error(f"Error parsing top broker: {e}")
        return None

def get_broker_summary(market_detector_data: dict) -> dict | None:
    """
    Extract the bandar detector summary.
    """
    if not market_detector_data:
        return None
        
    try:
        data = market_detector_data.get('data', {})
        detector = data.get('bandar_detector', {})
        broker_summary = data.get('broker_summary', {})
        
        return {
            'detector': {
                'top1': detector.get('top1', {'vol': 0, 'percent': 0, 'amount': 0, 'accdist': '-'}),
                'top3': detector.get('top3', {'vol': 0, 'percent': 0, 'amount': 0, 'accdist': '-'}),
                'top5': detector.get('top5', {'vol': 0, 'percent': 0, 'amount': 0, 'accdist': '-'}),
                'avg': detector.get('avg', {'vol': 0, 'percent': 0, 'amount': 0, 'accdist': '-'}),
                'accdist': detector.get('broker_accdist', '-')
            },
            'topBuyers': broker_summary.get('brokers_buy', [])[:4],
            'topSellers': broker_summary.get('brokers_sell', [])[:4],
        }
    except Exception as e:
        logger.error(f"Error parsing broker summary: {e}")
        return None
