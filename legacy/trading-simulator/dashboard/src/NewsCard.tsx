import { useState, useEffect } from 'react';

interface Props { emiten?: string }

type NewsTab = 'portal' | 'idx';
type Region = 'ID' | 'Global' | 'All';

const SENTIMENT_CLR = (s: string) => {
  if (s === 'Bullish') return 'var(--bb-green)';
  if (s === 'Bearish') return 'var(--bb-red)';
  return 'var(--bb-text3)';
};

export default function NewsCard({ emiten }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<NewsTab>('portal');
  const [region, setRegion] = useState<Region>('ID');

  useEffect(() => {
    setLoading(true);
    const doFetch = async () => {
      try {
        let data: any[] = [];
        if (activeTab === 'portal') {
          const res = await fetch('/api/files/news_data.json');
          if (res.ok) {
            data = await res.json();
            // Filter by region if not 'All'
            if (region !== 'All') {
              data = data.filter((item: any) => (item.region === region) || (!item.region && region === 'Global'));
            }
            // Filter by emiten if provided
            if (emiten) {
              const upperEmiten = emiten.toUpperCase();
              data = data.filter((item: any) =>
                item.title?.toUpperCase().includes(upperEmiten) ||
                item.description?.toUpperCase().includes(upperEmiten) ||
                item.tickers?.includes(upperEmiten)
              );
            }
          }
        } else if (activeTab === 'idx') {
          const res = await fetch('/api/files/news_data.json');
          if (res.ok) {
            data = await res.json();
            data = data.filter((item: any) => item.source === 'IDX Official');
          }
        }
        setItems(data);
      } catch (err) {
        console.error('Fetch error:', err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    doFetch();
  }, [emiten, activeTab, region]);

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      const diff = Date.now() - d.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'NOW';
      if (mins < 60) return `${mins}m`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h`;
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    } catch { return ts; }
  };

  const stripHtml = (html: string) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
  };

  return (
    <div className="card fade-in" id="news-card">
      <div className="card-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div className="card-title" style={{ padding: 0, background: 'none', border: 'none', color: 'var(--bb-amber)' }}>
            {emiten ? `${emiten} NEWS WIRE` : 'MARKET NEWS WIRE'}
          </div>
          {loading && <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1 }} />}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div className="date-range-btns">
            <button className={`date-range-btn ${activeTab === 'portal' ? 'active' : ''}`} onClick={() => setActiveTab('portal')}>PORTALS</button>
            <button className={`date-range-btn ${activeTab === 'idx' ? 'active' : ''}`} onClick={() => setActiveTab('idx')}>IDX</button>
          </div>
          {activeTab === 'portal' && (
            <div className="date-range-btns">
              <button className={`date-range-btn ${region === 'ID' ? 'active' : ''}`} onClick={() => setRegion('ID')}>ID</button>
              <button className={`date-range-btn ${region === 'Global' ? 'active' : ''}`} onClick={() => setRegion('Global')}>GLB</button>
              <button className={`date-range-btn ${region === 'All' ? 'active' : ''}`} onClick={() => setRegion('All')}>ALL</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        {!loading && items.length === 0 && (
          <div className="empty">
            NO NEWS FOUND{emiten ? ` FOR ${emiten}` : ''}
          </div>
        )}
        {!loading && items.map((item, i) => {
          const title = item.title || item.body?.split('\n')[0] || item.content?.split('\n')[0] || 'UNTITLED';
          const body  = item.description || item.body || item.content || '';
          const time  = item.timestamp || item.created_at || item.published_at || '';
          const source = item.source || '';
          const url  = item.link || item.url || '';
          const tickers = item.tickers || [];
          const sentiment = item.sentiment;

          return (
            <div key={i} className="news-item">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span style={{
                    fontSize: '0.58rem', background: 'rgba(255,102,0,0.12)', color: 'var(--bb-amber)',
                    padding: '1px 5px', borderRadius: 2, fontWeight: 700, letterSpacing: '0.06em',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}>
                    {source.toUpperCase().slice(0, 12)}
                  </span>
                  {item.region && (
                    <span style={{
                      fontSize: '0.58rem', color: item.region === 'ID' ? 'var(--bb-cyan)' : 'var(--bb-yellow)',
                      fontWeight: 700, fontFamily: 'JetBrains Mono, monospace'
                    }}>
                      [{item.region}]
                    </span>
                  )}
                  {sentiment && (
                    <span style={{ fontSize: '0.58rem', color: SENTIMENT_CLR(sentiment), fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                      {sentiment === 'Bullish' ? '▲' : sentiment === 'Bearish' ? '▼' : '—'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {tickers.slice(0, 3).map((t: string) => (
                    <span key={t} style={{ fontSize: '0.58rem', color: 'var(--bb-amber2)', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>${t}</span>
                  ))}
                  {time && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--bb-text3)', fontFamily: 'JetBrains Mono, monospace' }}>{formatTime(time)}</span>
                  )}
                </div>
              </div>
              <div className="news-title" style={{ fontSize: '0.78rem' }}>
                {url ? <a href={url} target="_blank" rel="noopener noreferrer">{stripHtml(title)}</a> : stripHtml(title)}
              </div>
              {body && title !== body && (
                <div className="news-snippet" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {stripHtml(body)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
