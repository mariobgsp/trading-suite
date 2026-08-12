import { useState, useEffect } from 'react';

interface Props {
  forex: number;
  watchlistItems: Array<{ ticker: string; price: number; pct: number }>;
}

function getIDXSession(): { label: string; cls: string } {
  // IDX session times in WIB (UTC+7)
  const now = new Date();
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const h = wib.getHours();
  const m = wib.getMinutes();
  const mins = h * 60 + m;
  const day = wib.getDay(); // 0=Sun, 6=Sat

  if (day === 0 || day === 6) return { label: 'CLOSED', cls: 'bb-session-closed' };
  if (mins >= 9 * 60 && mins < 11 * 60 + 30) return { label: 'SESSION 1', cls: 'bb-session-open' };
  if (mins >= 11 * 60 + 30 && mins < 13 * 60 + 30) return { label: 'PRE-OPEN 2', cls: 'bb-session-pre' };
  if (mins >= 13 * 60 + 30 && mins < 16 * 60) return { label: 'SESSION 2', cls: 'bb-session-open' };
  if (mins >= 16 * 60 && mins < 16 * 60 + 15) return { label: 'PRE-CLOSE', cls: 'bb-session-pre' };
  return { label: 'CLOSED', cls: 'bb-session-closed' };
}

export default function BloombergStatusBar({ forex, watchlistItems }: Props) {
  const [clock, setClock] = useState('');
  const [session, setSession] = useState(getIDXSession());

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const wib = now.toLocaleString('en-US', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
      setClock(wib);
      setSession(getIDXSession());
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Duplicate the tape items for seamless looping
  const tapeItems = watchlistItems.length > 0 ? [...watchlistItems, ...watchlistItems] : [];

  return (
    <div className="bb-statusbar">
      <div className="bb-statusbar-logo">
        ▸ TRADING TERMINAL
      </div>

      <div className="bb-statusbar-tape">
        {tapeItems.length > 0 ? (
          <div className="bb-tape-track" style={{ animationDuration: `${Math.max(30, tapeItems.length * 4)}s` }}>
            {tapeItems.map((item, i) => {
              const isPos = item.pct >= 0;
              const isZero = item.pct === 0;
              return (
                <span key={i} className="bb-tape-item">
                  <span className="bb-tape-ticker">{item.ticker}</span>
                  <span className="bb-tape-price">{item.price.toLocaleString('en-US')}</span>
                  <span className={isZero ? 'bb-tape-chg-flat' : isPos ? 'bb-tape-chg-pos' : 'bb-tape-chg-neg'}>
                    {isPos ? '+' : ''}{item.pct.toFixed(2)}%
                  </span>
                </span>
              );
            })}
          </div>
        ) : (
          <span style={{ padding: '0 14px', fontSize: '0.65rem', color: 'rgba(255,102,0,0.5)' }}>
            ── NO WATCHLIST DATA ──
          </span>
        )}
      </div>

      <div className="bb-statusbar-right">
        <div className="bb-statusbar-cell">
          <span className="label">IDX</span>
          <span className={session.cls}>{session.label}</span>
        </div>
        <div className="bb-statusbar-cell">
          <span className="label">USD/IDR</span>
          <span className="value">{Math.round(forex).toLocaleString('id-ID')}</span>
        </div>
        <div className="bb-statusbar-cell" style={{ minWidth: 90 }}>
          <span className="label">WIB</span>
          <span className="value" style={{ fontVariantNumeric: 'tabular-nums' }}>{clock}</span>
        </div>
      </div>
    </div>
  );
}
