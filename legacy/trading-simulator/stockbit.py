import os
import logging
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

STOCKBIT_BASE_URL = 'https://exodus.stockbit.com'
STOCKBIT_AUTH_URL = 'https://stockbit.com'

class StockbitClient:
    """Client for extracting data from Stockbit API."""

    def __init__(self, token=None):
        self.token = token or os.getenv("STOCKBIT_JWT_TOKEN")
        if not self.token:
            logger.warning("STOCKBIT_JWT_TOKEN is not set. API calls will likely fail.")

    def _get_headers(self) -> dict:
        return {
            'accept': 'application/json',
            'authorization': f'Bearer {self.token}',
            'origin': 'https://stockbit.com',
            'referer': 'https://stockbit.com/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7',
            'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
        }

    def _handle_response(self, response: requests.Response, api_name: str) -> dict:
        if response.status_code == 401:
            logger.error(f"{api_name}: Token expired or invalid (401)")
            # You could optionally raise a custom TokenExpiredError here
            response.raise_for_status()
        
        try:
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            logger.error(f"{api_name} HTTP error: {e}")
            raise
        except ValueError as e:
            logger.error(f"{api_name} JSON decode error: {e}")
            raise

    def fetch_market_detector(self, ticker: str, from_date: str, to_date: str) -> dict | None:
        """Fetch market detector (bandarmology) data for a given ticker and date range."""
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
            return self._handle_response(response, 'Market Detector API')
        except Exception as e:
            logger.error(f"Failed to fetch market detector for {ticker}: {e}")
            return None

    def fetch_orderbook(self, emiten: str) -> dict | None:
        """Fetch Orderbook data (market data)"""
        url = f"{STOCKBIT_BASE_URL}/company-price-feed/v2/orderbook/companies/{emiten}"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            return self._handle_response(response, 'Orderbook API')
        except Exception as e:
            logger.error(f"Failed to fetch orderbook for {emiten}: {e}")
            return None

    def fetch_emiten_info(self, emiten: str) -> dict | None:
        """Fetch Emiten Info (including sector)"""
        url = f"{STOCKBIT_BASE_URL}/emitten/{emiten}/info"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            return self._handle_response(response, 'Emiten Info API')
        except Exception as e:
            logger.error(f"Failed to fetch emiten info for {emiten}: {e}")
            return None

    def fetch_sectors(self) -> list[str]:
        """Fetch all sectors list"""
        url = f"{STOCKBIT_BASE_URL}/emitten/sectors"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            data = self._handle_response(response, 'Sectors API')
            sectors = [item.get('name') for item in data.get('data', []) if item.get('name')]
            return sectors
        except Exception as e:
            logger.error(f"Failed to fetch sectors: {e}")
            return []

    def fetch_watchlist_groups(self) -> list[dict]:
        """Fetch all watchlist groups"""
        url = f"{STOCKBIT_BASE_URL}/watchlist?page=1&limit=500"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            data = self._handle_response(response, 'Watchlist Groups API')
            return data.get('data', []) if isinstance(data.get('data'), list) else []
        except Exception as e:
            logger.error(f"Failed to fetch watchlist groups: {e}")
            return []

    def fetch_watchlist(self, watchlist_id: int = None) -> dict | None:
        """Fetch Watchlist data by ID (or default if not provided)"""
        try:
            if not watchlist_id:
                groups = self.fetch_watchlist_groups()
                default_group = next((w for w in groups if w.get('is_default')), groups[0] if groups else None)
                if not default_group:
                    raise ValueError('No watchlist found')
                watchlist_id = default_group.get('watchlist_id')

            url = f"{STOCKBIT_BASE_URL}/watchlist/{watchlist_id}?page=1&limit=500"
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            json_data = self._handle_response(response, 'Watchlist Detail API')

            # Map symbol to company_code for compatibility
            if json_data.get('data', {}).get('result'):
                for item in json_data['data']['result']:
                    item['company_code'] = item.get('symbol') or item.get('company_code')

            return json_data
        except Exception as e:
            logger.error(f"Failed to fetch watchlist {watchlist_id}: {e}")
            return None

    def fetch_key_stats(self, emiten: str) -> dict | None:
        """Fetch KeyStats data for a stock"""
        url = f"{STOCKBIT_BASE_URL}/keystats/ratio/v1/{emiten}?year_limit=10"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            json_data = self._handle_response(response, 'KeyStats API')
            
            categories = json_data.get('data', {}).get('closure_fin_items_results', [])
            
            def find_category(name: str):
                category = next((c for c in categories if c.get('keystats_name') == name), None)
                if not category:
                    return []
                return [r.get('fitem') for r in category.get('fin_name_results', [])]

            return {
                'currentValuation': find_category('Current Valuation'),
                'incomeStatement': find_category('Income Statement'),
                'balanceSheet': find_category('Balance Sheet'),
                'profitability': find_category('Profitability'),
                'growth': find_category('Growth'),
            }
        except Exception as e:
            logger.error(f"Failed to fetch keystats for {emiten}: {e}")
            return None

    def fetch_historical_summary(self, emiten: str, start_date: str, end_date: str, limit: int = 12) -> list[dict]:
        """Fetch historical price summary from Stockbit"""
        url = f"{STOCKBIT_BASE_URL}/company-price-feed/historical/summary/{emiten}?period=HS_PERIOD_DAILY&start_date={start_date}&end_date={end_date}&limit={limit}&page=1"
        try:
            response = requests.get(url, headers=self._get_headers(), timeout=10)
            json_data = self._handle_response(response, 'Historical Summary API')
            return json_data.get('data', {}).get('result', [])
        except Exception as e:
            logger.error(f"Failed to fetch historical summary for {emiten}: {e}")
            return []

    def delete_watchlist_item(self, watchlist_id: int, company_id: int) -> bool:
        """Delete item from watchlist"""
        url = f"{STOCKBIT_BASE_URL}/watchlist/{watchlist_id}/company/{company_id}/item"
        try:
            response = requests.delete(url, headers=self._get_headers(), timeout=10)
            self._handle_response(response, 'Delete Watchlist Item API')
            return True
        except Exception as e:
            logger.error(f"Failed to delete watchlist item {company_id} from {watchlist_id}: {e}")
            return False

    def fetch_news(self, category: str = None, page: int = 1, limit: int = 20) -> list[dict]:
        """Fetch general news or category-specific news from Stockbit."""
        url = f"{STOCKBIT_BASE_URL}/news"
        params = {'page': page, 'limit': limit}
        if category:
            params['category'] = category

        try:
            response = requests.get(url, headers=self._get_headers(), params=params, timeout=10)
            data = self._handle_response(response, 'News API')
            return data.get('data', [])
        except Exception as e:
            logger.error(f"Failed to fetch news: {e}")
            return []

    def fetch_announcements(self, page: int = 1, limit: int = 20) -> list[dict]:
        """Fetch official IDX announcements from Stockbit."""
        url = f"{STOCKBIT_BASE_URL}/news/announcement"
        params = {'page': page, 'limit': limit}

        try:
            response = requests.get(url, headers=self._get_headers(), params=params, timeout=10)
            data = self._handle_response(response, 'Announcements API')
            return data.get('data', [])
        except Exception as e:
            logger.error(f"Failed to fetch announcements: {e}")
            return []

    def fetch_stream_by_emiten(self, ticker: str, page: int = 1, limit: int = 20) -> list[dict]:
        """Fetch community stream posts for a specific ticker."""
        url = f"{STOCKBIT_BASE_URL}/stream/stocks/{ticker}"
        params = {'page': page, 'limit': limit}

        try:
            response = requests.get(url, headers=self._get_headers(), params=params, timeout=10)
            data = self._handle_response(response, 'Stream API')
            return data.get('data', {}).get('stream', [])
        except Exception as e:
            logger.error(f"Failed to fetch stream for {ticker}: {e}")
            return []

def get_top_broker(market_detector_data: dict) -> dict | None:
    """Extract the top broker by net buy value."""
    if not market_detector_data:
        return None
        
    try:
        data = market_detector_data.get('data', {})
        broker_summary = data.get('broker_summary', {})
        brokers_buy = broker_summary.get('brokers_buy', [])
        
        if not brokers_buy:
            return None
            
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
    """Extract the bandar detector summary."""
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
                'total_buyer': detector.get('total_buyer', 0),
                'total_seller': detector.get('total_seller', 0),
                'number_broker_buysell': detector.get('number_broker_buysell', 0),
                'broker_accdist': detector.get('broker_accdist', '-'),
                'volume': detector.get('volume', 0),
                'value': detector.get('value', 0),
                'average': detector.get('average', 0),
            },
            'topBuyers': broker_summary.get('brokers_buy', [])[:4],
            'topSellers': broker_summary.get('brokers_sell', [])[:4],
        }
    except Exception as e:
        logger.error(f"Error parsing broker summary: {e}")
        return None
