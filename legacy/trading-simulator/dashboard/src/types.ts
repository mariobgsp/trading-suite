// ── Journal & Orders ──────────────────────────────────────────
export interface JournalEntry {
  date: string;
  ticker: string;
  action: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAW';
  qty: number;
  price: number;
  currency: string;
  sl_price: number;
  tp_price: number;
  trailing_stop_pct: number;
  reason: string;
  system_generated: boolean;
}

export interface PendingOrder {
  id: string;
  created_at: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  qty: number;
  trigger_price: number;
  condition: 'PRICE_AT_OR_BELOW' | 'PRICE_AT_OR_ABOVE';
  currency: string;
  sl_price: number;
  tp_price: number;
  trailing_stop_pct: number;
  reason: string;
  status: 'ACTIVE' | 'FILLED' | 'CANCELLED';
  filled_at?: string | null;
  filled_price?: number | null;
}

// ── FIFO Engine Outputs ──────────────────────────────────────
export interface Lot {
  qty: number;
  price_native: number;
  price_idr: number;
  date: string;
  currency: string;
  forex_rate: number;
  sl_price: number;
  tp_price: number;
  trailing_stop_pct: number;
}

export interface Position {
  ticker: string;
  qty: number;
  avg_buy_price_native: number;
  avg_buy_price_idr: number;
  current_price_native: number | null;
  current_price_idr: number;
  native_currency: string;
  total_value_idr: number;
  total_cost_idr: number;
  unrealized_pnl_idr: number;
  unrealized_pnl_pct: number;
  daily_change_pct: number | null;
}

export interface RealizedTrade {
  date: string;
  ticker: string;
  qty: number;
  sell_price_native: number;
  sell_price_idr: number;
  currency: string;
  cost_basis_idr: number;
  proceeds_idr: number;
  realized_pnl_idr: number;
  system_generated: boolean;
  reason: string;
}

export interface PortfolioState {
  cash_idr: number;
  total_portfolio_value_idr: number;
  net_worth_idr: number;
  live_forex_usdidr: number;
  positions: Position[];
  realized_trades: RealizedTrade[];
  total_realized_pnl_idr: number;
}

// ── Market Data ──────────────────────────────────────────────
export interface TickerQuote {
  ticker: string;
  current_price: number | null;
  previous_close: number | null;
  daily_change_pct: number | null;
  currency: string;
  high: number | null;
  low: number | null;
}

