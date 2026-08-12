import { useState, useEffect } from 'react';
import { fetchQuote } from './prices';
import type { TickerQuote } from './types';

interface Props { emiten: string }

export default function EmitenInfoCard({ emiten }: Props) {
  const [quote, setQuote] = useState<TickerQuote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!emiten) return;
    let active = true;
    setLoading(true);
    fetchQuote(emiten)
      .then(q => { if (active) setQuote(q); })
      .catch(() => { if (active) setQuote(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [emiten]);

  if (loading) return (
    <div className="bb-security-header" style={{ textAlign: 'center', padding: 14 }}>
      <div className="spinner" />
    </div>
  );
  if (!quote) return null;

  const price = quote.current_price ?? 0;
  const change = price - (quote.previous_close ?? price);
  const pctChange = quote.daily_change_pct ?? 0;
  const isPos = pctChange >= 0;
  const statColor = pctChange === 0 ? 'var(--bb-text)' : isPos ? 'var(--bb-green)' : 'var(--bb-red)';

  return (
    <div className="bb-security-header">
      <div className="bb-security-top">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="bb-security-ticker">{emiten}</div>
          </div>
          <div className="bb-security-name">{quote.currency}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="bb-security-price">{price.toLocaleString('en-US')}</div>
          <div className="bb-security-change" style={{ color: statColor }}>
            {isPos ? '+' : ''}{change.toFixed(2)} ({isPos ? '+' : ''}{pctChange.toFixed(2)}%)
          </div>
        </div>
      </div>

      <div className="bb-security-stats">
        {quote.high != null && (
          <div className="bb-security-stat">
            <span className="label">HIGH</span>
            <span className="val">{quote.high.toLocaleString('en-US')}</span>
          </div>
        )}
        {quote.low != null && (
          <div className="bb-security-stat">
            <span className="label">LOW</span>
            <span className="val">{quote.low.toLocaleString('en-US')}</span>
          </div>
        )}
        {quote.previous_close != null && (
          <div className="bb-security-stat">
            <span className="label">PREV CLOSE</span>
            <span className="val">{quote.previous_close.toLocaleString('en-US')}</span>
          </div>
        )}
        <div className="bb-security-stat">
          <span className="label">SOURCE</span>
          <span className="val" style={{ color: 'var(--bb-amber)', fontSize: '0.65rem' }}>YF</span>
        </div>
      </div>
    </div>
  );
}
