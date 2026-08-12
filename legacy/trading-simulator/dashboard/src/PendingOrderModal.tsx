import { useState } from 'react';
import type { PendingOrder, TickerQuote } from './types';
import { todayWIB, uid, idr } from './utils';

interface Props {
  quotes: Map<string, TickerQuote>;
  liveForex: number;
  onSubmit: (order: PendingOrder) => void;
  onClose: () => void;
}

export default function PendingOrderModal({ quotes, liveForex, onSubmit, onClose }: Props) {
  const [ticker, setTicker] = useState('');
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const [triggerPrice, setTriggerPrice] = useState('');
  const [condition, setCondition] = useState<'PRICE_AT_OR_BELOW' | 'PRICE_AT_OR_ABOVE'>('PRICE_AT_OR_BELOW');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [trail] = useState('');
  const [reason, setReason] = useState('');

  const quote = quotes.get(ticker.toUpperCase());
  const currentPrice = quote?.current_price;
  const currency = quote?.currency || (ticker.toUpperCase().endsWith('.JK') ? 'IDR' : 'USD');
  const triggerVal = parseFloat(triggerPrice) || 0;

  const isID = ticker.toUpperCase().endsWith('.JK');
  const isCrypto = ticker.toUpperCase().includes('-USD') || ticker.toUpperCase().includes('BTC') || ticker.toUpperCase().includes('ETH');
  
  const multiplier = isID ? 100 : 1;
  const inputLabel = isID ? 'Quantity (Lots)' : isCrypto ? 'Quantity (Coins)' : 'Quantity (Shares)';
  const helperText = isID 
    ? `1 Lot = 100 Shares. Total: ${(parseFloat(qty) || 0) * multiplier} Shares` 
    : isCrypto 
    ? 'Input exact amount of coins/tokens' 
    : '1 Lot = 1 Share. Input number of shares';

  const actualQty = (parseFloat(qty) || 0) * multiplier;
  const totalIDR = (currency === 'IDR' ? triggerVal : triggerVal * liveForex) * actualQty;

  const handleSubmit = () => {
    if (!ticker || !qty || !triggerPrice) return;
    const order: PendingOrder = {
      id: uid(),
      created_at: todayWIB(),
      ticker: ticker.toUpperCase(),
      action,
      qty: actualQty,
      trigger_price: triggerVal,
      condition,
      currency,
      sl_price: parseFloat(sl) || 0,
      tp_price: parseFloat(tp) || 0,
      trailing_stop_pct: parseFloat(trail) || 0,
      reason: reason || `${condition === 'PRICE_AT_OR_BELOW' ? 'Support buy' : 'Breakout buy'} @ ${triggerPrice}`,
      status: 'ACTIVE',
      filled_at: null,
      filled_price: null,
    };
    onSubmit(order);
  };

  return (
    <div className="overlay" onClick={handleClose}>
      <div className={`modal ${isClosing ? 'fade-out' : 'fade-in'}`} onClick={e => e.stopPropagation()}>
        <h2>📋 New Pending Order</h2>

        <div className="field">
          <label>Action</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn ${action === 'BUY' ? 'btn-green' : ''}`} style={{ flex: 1 }} onClick={() => setAction('BUY')}>Buy</button>
            <button className={`btn ${action === 'SELL' ? 'btn-red' : ''}`} style={{ flex: 1 }} onClick={() => setAction('SELL')}>Sell</button>
          </div>
        </div>

        <div className="field">
          <label>Ticker</label>
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="e.g. BBCA.JK, TSLA" list="po-tickers" />
          <datalist id="po-tickers">
            {Array.from(quotes.keys()).map(t => <option key={t} value={t} />)}
          </datalist>
        </div>

        <div className="field">
          <label>Condition</label>
          <select value={condition} onChange={e => setCondition(e.target.value as typeof condition)}>
            <option value="PRICE_AT_OR_BELOW">Price ≤ trigger (Support Buy)</option>
            <option value="PRICE_AT_OR_ABOVE">Price ≥ trigger (Breakout Buy)</option>
          </select>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Trigger Price ({currency})</label>
            <input type="number" value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)} placeholder="Target price" step="any" />
          </div>
          <div className="field">
            <label>{inputLabel}</label>
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" min="0" step="any" />
            {ticker && qty && <div style={{ fontSize: '.75rem', color: 'var(--text2)', marginTop: 4 }}>{helperText}</div>}
          </div>
        </div>

        {currentPrice != null && (
          <div style={{ fontSize: '.78rem', color: 'var(--text2)', marginBottom: 12, fontFamily: 'JetBrains Mono, monospace' }}>
            Current: {currentPrice.toLocaleString('en-US')} {currency} · Est. total: {idr(totalIDR)}
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label>Stop Loss</label>
            <input type="number" value={sl} onChange={e => setSl(e.target.value)} placeholder="Optional" step="any" />
          </div>
          <div className="field">
            <label>Take Profit</label>
            <input type="number" value={tp} onChange={e => setTp(e.target.value)} placeholder="Optional" step="any" />
          </div>
        </div>

        <div className="field">
          <label>Reason / Notes</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Support bounce at MA50" />
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={handleClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!ticker || !qty || !triggerPrice}>
            Create Pending Order
          </button>
        </div>
      </div>
    </div>
  );
}
