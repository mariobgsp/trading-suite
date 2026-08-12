import { useState } from 'react';
import type { JournalEntry, TickerQuote } from './types';
import { todayWIB, idr } from './utils';

interface Props {
  quotes: Map<string, TickerQuote>;
  liveForex: number;
  positions: { ticker: string; qty: number; native_currency: string }[];
  onSubmit: (entry: JournalEntry) => void;
  onClose: () => void;
  defaultTicker?: string;
  defaultAction?: 'BUY' | 'SELL';
}

export default function TradeModal({ quotes, liveForex, positions, onSubmit, onClose, defaultTicker = '', defaultAction = 'BUY' }: Props) {
  const [action, setAction] = useState<'BUY' | 'SELL'>(defaultAction);
  const [ticker, setTicker] = useState(defaultTicker);
  const [qty, setQty] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [trail, setTrail] = useState('');
  const [reason, setReason] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const isID = ticker.toUpperCase().endsWith('.JK');
  const isCrypto = ticker.toUpperCase().includes('-USD') || ticker.toUpperCase().includes('BTC') || ticker.toUpperCase().includes('ETH');
  
  const multiplier = isID ? 100 : 1;
  const inputLabel = isID ? 'Quantity (Lots)' : isCrypto ? 'Quantity (Coins)' : 'Quantity (Shares)';
  const helperText = isID 
    ? `1 Lot = 100 Shares. Total: ${(parseFloat(qty) || 0) * multiplier} Shares` 
    : isCrypto 
    ? 'Input exact amount of coins/tokens' 
    : '1 Lot = 1 Share. Input number of shares';

  const quote = quotes.get(ticker.toUpperCase());
  const price = quote?.current_price ?? 0;
  const currency = quote?.currency || (ticker.toUpperCase().endsWith('.JK') ? 'IDR' : 'USD');
  const priceIDR = currency === 'IDR' ? price : price * liveForex;
  
  const actualQty = (parseFloat(qty) || 0) * multiplier;
  const totalIDR = priceIDR * actualQty;

  const maxShares = action === 'SELL' ? positions.find(p => p.ticker === ticker.toUpperCase())?.qty ?? 0 : Infinity;
  const maxInput = action === 'SELL' ? maxShares / multiplier : Infinity;

  const handleSubmit = () => {
    if (!ticker || !qty || price === 0) return;
    const entry: JournalEntry = {
      date: todayWIB(),
      ticker: ticker.toUpperCase(),
      action,
      qty: actualQty,
      price,
      currency,
      sl_price: parseFloat(sl) || 0,
      tp_price: parseFloat(tp) || 0,
      trailing_stop_pct: parseFloat(trail) || 0,
      reason: reason || `Manual ${action} via dashboard`,
      system_generated: false,
    };
    onSubmit(entry);
  };

  return (
    <div className="overlay" onClick={handleClose}>
      <div className={`modal ${isClosing ? 'fade-out' : 'fade-in'}`} onClick={e => e.stopPropagation()}>
        <h2>{action === 'BUY' ? '🟢 Buy' : '🔴 Sell'} at Market Price</h2>

        <div className="field">
          <label>Action</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn ${action === 'BUY' ? 'btn-green' : ''}`} style={{ flex: 1 }} onClick={() => setAction('BUY')}>Buy</button>
            <button className={`btn ${action === 'SELL' ? 'btn-red' : ''}`} style={{ flex: 1 }} onClick={() => setAction('SELL')}>Sell</button>
          </div>
        </div>

        <div className="field">
          <label>Ticker Symbol</label>
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="e.g. AAPL, GOTO.JK, BTC-USD" list="ticker-list" />
          <datalist id="ticker-list">
            {Array.from(quotes.keys()).map(t => <option key={t} value={t} />)}
            {positions.map(p => <option key={p.ticker} value={p.ticker} />)}
          </datalist>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Live Price ({currency})</label>
            <input value={price ? price.toLocaleString('en-US') : 'N/A'} disabled />
          </div>
          <div className="field">
            <label>{inputLabel} {action === 'SELL' && maxInput < Infinity ? `(max ${maxInput})` : ''}</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" min="0" step="any" />
            {ticker && qty && <div style={{ fontSize: '.75rem', color: 'var(--text2)', marginTop: 4 }}>{helperText}</div>}
          </div>
        </div>

        <div className="field">
          <label>Total Cost (IDR)</label>
          <input value={totalIDR > 0 ? idr(totalIDR) : '—'} disabled />
        </div>

        {action === 'BUY' && (
          <div className="field-row">
            <div className="field">
              <label>Stop Loss ({currency})</label>
              <input type="number" value={sl} onChange={e => setSl(e.target.value)} placeholder="Optional" step="any" />
            </div>
            <div className="field">
              <label>Take Profit ({currency})</label>
              <input type="number" value={tp} onChange={e => setTp(e.target.value)} placeholder="Optional" step="any" />
            </div>
          </div>
        )}

        {action === 'BUY' && (
          <div className="field">
            <label>Trailing Stop %</label>
            <input type="number" value={trail} onChange={e => setTrail(e.target.value)} placeholder="Optional, e.g. 5" step="any" />
          </div>
        )}

        <div className="field">
          <label>Reason / Notes</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional note" />
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={handleClose}>Cancel</button>
          <button className={`btn ${action === 'BUY' ? 'btn-green' : 'btn-red'}`} onClick={handleSubmit} disabled={!ticker || !qty || price === 0}>
            {action} {ticker || '...'} @ {price ? price.toLocaleString('en-US') : '?'}
          </button>
        </div>
      </div>
    </div>
  );
}
