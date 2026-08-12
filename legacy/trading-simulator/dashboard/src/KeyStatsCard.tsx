import { useState, useEffect } from 'react';
import { fetchQuote } from './prices';
import type { TickerQuote } from './types';

interface Props { emiten: string }

export default function KeyStatsCard({ emiten }: Props) {
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
    <div className="card fade-in">
      <div className="card-title">Key Stats</div>
      <div className="spinner" style={{ margin: '16px auto', display: 'block' }} />
    </div>
  );
  if (!quote) return null;

  return (
    <div className="card fade-in" id="keystats-card">
      <div className="card-header">
        <div className="card-title" style={{ margin: 0 }}>Key Stats — {emiten}</div>
      </div>
      <table className="keystats-table">
        <tbody>
          <tr>
            <td className="keystats-label">CURRENT PRICE</td>
            <td className="keystats-value">{quote.current_price?.toLocaleString('en-US') ?? '—'}</td>
          </tr>
          <tr>
            <td className="keystats-label">PREV CLOSE</td>
            <td className="keystats-value">{quote.previous_close?.toLocaleString('en-US') ?? '—'}</td>
          </tr>
          <tr>
            <td className="keystats-label">DAILY CHANGE</td>
            <td className="keystats-value" style={{ color: (quote.daily_change_pct ?? 0) >= 0 ? 'var(--bb-green)' : 'var(--bb-red)' }}>
              {quote.daily_change_pct != null ? `${quote.daily_change_pct >= 0 ? '+' : ''}${quote.daily_change_pct.toFixed(2)}%` : '—'}
            </td>
          </tr>
          <tr>
            <td className="keystats-label">HIGH</td>
            <td className="keystats-value">{quote.high?.toLocaleString('en-US') ?? '—'}</td>
          </tr>
          <tr>
            <td className="keystats-label">LOW</td>
            <td className="keystats-value">{quote.low?.toLocaleString('en-US') ?? '—'}</td>
          </tr>
          <tr>
            <td className="keystats-label">CURRENCY</td>
            <td className="keystats-value">{quote.currency ?? '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
