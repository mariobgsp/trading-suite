import { useState, useEffect, useCallback } from 'react';
import type { JournalEntry, PendingOrder, PortfolioState, TickerQuote } from './types';
import { readLocalFile, writeLocalFile } from './github';
import { fetchQuotes, fetchForexRate } from './prices';
import { computePortfolio } from './engine';
import { idr, pct, todayWIB } from './utils';
import TradeModal from './TradeModal';
import PendingOrderModal from './PendingOrderModal';
import EmitenInfoCard from './EmitenInfoCard';
import KeyStatsCard from './KeyStatsCard';
import NewsCard from './NewsCard';
import BacktestCard from './BacktestCard';
import BloombergStatusBar from './BloombergStatusBar';
import TradingChart from './components/TradingChart';
import LPIChart from './LPIChart';

interface Toast { id: number; msg: string; type: 'success' | 'error'; isClosing?: boolean }
type TabKey = 'portfolio' | 'market' | 'fundamentals' | 'news';

function App() {
  // ── Trading state (PRESERVED) ───────────────────────────
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [quotes, setQuotes] = useState<Map<string, TickerQuote>>(new Map());
  const [liveForex, setLiveForex] = useState(16300);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('');

  const [showTrade, setShowTrade] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [tradeDef, setTradeDef] = useState<{ ticker?: string; action?: 'BUY' | 'SELL' }>({});

  // ── UI state ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>('portfolio');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerSearch, setTickerSearch] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = (msg: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => {
      setToasts(current => current.map(x => x.id === id ? { ...x, isClosing: true } : x));
    }, 3800);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  };

  // ── Load all data (PRESERVED) ───────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [j, w, p, forex] = await Promise.all([
        readLocalFile<JournalEntry[]>('journal.json'),
        readLocalFile<string[]>('watchlist.json'),
        readLocalFile<PendingOrder[]>('pending_orders.json'),
        fetchForexRate(),
      ]);
      setJournal(j); setWatchlist(w); setPendingOrders(p); setLiveForex(forex);

      const journalTickers = j.filter(e => !['DEPOSIT', 'WITHDRAW'].includes(e.action)).map(e => e.ticker);
      const activePendingTickers = p.filter(o => o.status === 'ACTIVE').map(o => o.ticker);
      const allTickers = [...new Set([...journalTickers, ...w, ...activePendingTickers])];

      const q = await fetchQuotes(allTickers);
      setQuotes(q);

      const state = computePortfolio(j, q, forex);
      setPortfolio(state);
      setLastUpdate(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' }) + ' WIB');
      toast('DATA LOADED');
    } catch (e: unknown) {
      toast('LOAD FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Execute trade (PRESERVED) ───────────────────────────
  const executeTrade = async (entry: JournalEntry) => {
    try {
      const updated = [...journal, entry];
      await writeLocalFile('journal.json', updated);
      setJournal(updated);
      const state = computePortfolio(updated, quotes, liveForex);
      setPortfolio(state);
      setShowTrade(false);
      toast(`✓ ${entry.action} ${entry.qty}× ${entry.ticker} @ ${entry.price}`);
    } catch (e: unknown) {
      toast('TRADE FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  // ── Pending orders (PRESERVED) ──────────────────────────
  const createPendingOrder = async (order: PendingOrder) => {
    try {
      const updated = [...pendingOrders, order];
      await writeLocalFile('pending_orders.json', updated);
      setPendingOrders(updated);
      setShowPending(false);
      toast(`PENDING: ${order.ticker} @ ${order.trigger_price}`);
    } catch (e: unknown) {
      toast('FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  const cancelPendingOrder = async (id: string) => {
    try {
      const updated = pendingOrders.map(o => o.id === id ? { ...o, status: 'CANCELLED' as const } : o);
      await writeLocalFile('pending_orders.json', updated);
      setPendingOrders(updated);
      toast('ORDER CANCELLED');
    } catch (e: unknown) {
      toast('FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  // ── Check pending triggers (PRESERVED) ──────────────────
  const checkPendingTriggers = useCallback(async () => {
    const active = pendingOrders.filter(o => o.status === 'ACTIVE');
    const triggered: { order: PendingOrder; entry: JournalEntry }[] = [];
    for (const order of active) {
      const q = quotes.get(order.ticker);
      if (!q || q.current_price == null) continue;
      const price = q.current_price;
      let hit = false;
      if (order.condition === 'PRICE_AT_OR_BELOW' && price <= order.trigger_price) hit = true;
      if (order.condition === 'PRICE_AT_OR_ABOVE' && price >= order.trigger_price) hit = true;
      if (hit) {
        triggered.push({
          order,
          entry: {
            date: todayWIB(), ticker: order.ticker, action: order.action,
            qty: order.qty, price: order.trigger_price, currency: order.currency,
            sl_price: order.sl_price, tp_price: order.tp_price, trailing_stop_pct: order.trailing_stop_pct,
            reason: `Pending filled: ${order.condition} @ ${order.trigger_price}`,
            system_generated: true,
          },
        });
      }
    }
    if (triggered.length === 0) return;
    try {
      const newJournal = [...journal, ...triggered.map(t => t.entry)];
      const newPending = pendingOrders.map(o => {
        const t = triggered.find(x => x.order.id === o.id);
        return t ? { ...o, status: 'FILLED' as const, filled_at: t.entry.date, filled_price: t.entry.price } : o;
      });
      await Promise.all([
        writeLocalFile('journal.json', newJournal),
        writeLocalFile('pending_orders.json', newPending),
      ]);
      setJournal(newJournal); setPendingOrders(newPending);
      const state = computePortfolio(newJournal, quotes, liveForex);
      setPortfolio(state);
      for (const t of triggered) toast(`FILLED: ${t.entry.action} ${t.entry.qty}× ${t.entry.ticker}`);
    } catch (e: unknown) {
      toast('AUTO-FILL FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  }, [pendingOrders, quotes, journal, liveForex]);

  useEffect(() => { if (quotes.size > 0) checkPendingTriggers(); }, [quotes.size]); // eslint-disable-line

  // ── Watchlist management (PRESERVED) ────────────────────
  const addToWatchlist = async (ticker: string) => {
    if (watchlist.includes(ticker)) { toast(`${ticker} ALREADY IN WATCHLIST`, 'error'); return; }
    try {
      const updated = [...watchlist, ticker];
      await writeLocalFile('watchlist.json', updated);
      setWatchlist(updated);
      const q = await fetchQuotes([...Array.from(quotes.keys()), ticker]);
      setQuotes(q);
      toast(`ADDED ${ticker}`);
    } catch (e: unknown) { toast('FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error'); }
  };

  const removeFromWatchlist = async (ticker: string) => {
    try {
      const updated = watchlist.filter(t => t !== ticker);
      await writeLocalFile('watchlist.json', updated);
      setWatchlist(updated);
      toast(`REMOVED ${ticker}`);
    } catch (e: unknown) { toast('FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error'); }
  };

  // ── Ticker selection ─────────────────────────────────────
  const handleTickerSelect = (ticker: string) => {
    setSelectedTicker(ticker);
    setActiveTab('market');
  };

  const handleSearchSubmit = () => {
    if (tickerSearch.trim()) {
      handleTickerSelect(tickerSearch.trim().toUpperCase());
      setTickerSearch('');
    }
  };

  const ps = portfolio;
  const activeOrders = pendingOrders.filter(o => o.status === 'ACTIVE');
  const filledOrders = pendingOrders.filter(o => o.status !== 'ACTIVE');

  const TABS: { key: TabKey; label: string; fkey: string; badge?: number }[] = [
    { key: 'portfolio',    label: 'PORTFOLIO',    fkey: 'F1', badge: ps?.positions.length },
    { key: 'market',       label: 'MARKET INTEL', fkey: 'F2' },
    { key: 'fundamentals', label: 'FUNDAMENTALS', fkey: 'F3' },
    { key: 'news',         label: 'NEWS WIRE',    fkey: 'F4' },
  ];

  return (
    <div className="app-shell">
      {/* ── Bloomberg Status Bar ──────────────────────── */}
      <BloombergStatusBar forex={liveForex} watchlistItems={[]} />

      <div className="app-body">
        {/* ── Sidebar ──────────────────────────────────── */}
        <div className="app-sidebar">
          <div className="card-header">
            <div className="card-title" style={{ padding: 0, background: 'none', border: 'none', color: 'var(--bb-amber)' }}>
              WATCHLIST
            </div>
            <button className="btn btn-sm" onClick={() => {
              const ticker = window.prompt('ENTER TICKER (e.g. AAPL, BBCA.JK):');
              if (ticker?.trim()) addToWatchlist(ticker.trim().toUpperCase());
            }}>+</button>
          </div>
          {watchlist.length === 0 ? (
            <div className="empty">NO ITEMS</div>
          ) : (
            watchlist.map(ticker => {
              const q = quotes.get(ticker);
              const chg = q?.daily_change_pct;
              const cur = q?.currency || 'IDR';
              const priceIDR = q?.current_price != null
                ? (cur === 'IDR' ? q.current_price : q.current_price * liveForex)
                : null;
              const isPos = (chg ?? 0) >= 0;
              return (
                <div
                  key={ticker}
                  className={`watch-item ${selectedTicker === ticker ? 'selected' : ''}`}
                  onClick={() => handleTickerSelect(ticker)}
                >
                  <div>
                    <div className="watch-ticker">{ticker}</div>
                    <div className="watch-price">{priceIDR != null ? idr(priceIDR) : '—'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="watch-price">{q?.current_price?.toLocaleString('en-US') ?? '—'} {cur !== 'IDR' ? cur : ''}</div>
                      <div className={`watch-change ${chg != null ? (isPos ? 'pnl-pos' : 'pnl-neg') : ''}`}>{pct(chg)}</div>
                    </div>
                    <button className="btn btn-sm btn-red" onClick={e => { e.stopPropagation(); removeFromWatchlist(ticker); }} style={{ padding: '1px 5px', fontSize: '.6rem' }}>✕</button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Main Area ─────────────────────────────────── */}
        <div className="app-main">
          {/* Navbar */}
          <div className="bb-navbar">
            <div className="bb-navbar-search">
              <span className="search-icon">▸</span>
              <input
                placeholder="ENTER TICKER..."
                value={tickerSearch}
                onChange={e => setTickerSearch(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleSearchSubmit()}
              />
            </div>
            <div className="bb-navbar-actions">
              <button className="btn btn-green btn-sm" onClick={() => { setTradeDef({ action: 'BUY' }); setShowTrade(true); }}>BUY</button>
              <button className="btn btn-red btn-sm" onClick={() => { setTradeDef({ action: 'SELL' }); setShowTrade(true); }}>SELL</button>
              <button className="btn btn-sm" onClick={() => setShowPending(true)} title="Pending Orders">ORD</button>
              <button className="btn btn-sm" onClick={() => {
                const amtStr = window.prompt('Enter topup amount (IDR):');
                if (!amtStr) return;
                const amt = parseFloat(amtStr);
                if (isNaN(amt) || amt <= 0) { toast('INVALID AMOUNT', 'error'); return; }
                executeTrade({
                  date: todayWIB(), ticker: 'CASH', action: 'DEPOSIT', qty: 1, price: amt,
                  currency: 'IDR', sl_price: 0, tp_price: 0, trailing_stop_pct: 0,
                  reason: 'Manual topup', system_generated: false,
                });
              }} title="Top Up Cash">TOPUP</button>
              <button className="btn btn-sm" onClick={loadAll} disabled={loading} title="Refresh Data">
                {loading ? '...' : 'RLD'}
              </button>
            </div>
            <div className="bb-navbar-status">{lastUpdate || '—'}</div>
          </div>

          {/* F-key Tab Bar */}
          <div className="bb-fkey-bar">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`bb-fkey-btn ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                <span className="fkey-label">{t.fkey}</span>
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="bb-fkey-badge">{t.badge}</span>
                )}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button className="bb-fkey-btn" onClick={() => {
              const ticker = window.prompt('ADD TICKER (e.g. BBCA, AAPL):');
              if (ticker?.trim()) addToWatchlist(ticker.trim().toUpperCase());
            }}>
              + WATCHLIST
            </button>
          </div>

          {/* Content Area */}
          <div className="app-content">
            {/* Toasts */}
            <div className="toast-container">
              {toasts.map(t => <div key={t.id} className={`toast toast-${t.type} ${t.isClosing ? 'toast-exit' : ''}`}>{t.msg}</div>)}
            </div>

            {/* ══ PORTFOLIO TAB ═══════════════════════════ */}
            {activeTab === 'portfolio' && (
              <div className="portfolio-content">
                {/* Summary strip */}
                <div className="summary-grid" style={{ margin: 0 }}>
                  <div className="card summary-card fade-in">
                    <div className="icon icon-cash" style={{ marginBottom: 4 }}>CASH</div>
                    <div className="value">{ps ? idr(ps.cash_idr) : '—'}</div>
                    <div className="sub">LIQUID</div>
                  </div>
                  <div className="card summary-card fade-in">
                    <div className="icon icon-portfolio" style={{ marginBottom: 4 }}>PTFL</div>
                    <div className="value">{ps ? idr(ps.total_portfolio_value_idr) : '—'}</div>
                    <div className="sub">PORTFOLIO VALUE</div>
                  </div>
                  <div className="card summary-card fade-in">
                    <div className="icon icon-gains" style={{ marginBottom: 4 }}>RLZD</div>
                    <div className={`value ${ps && ps.total_realized_pnl_idr >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                      {ps ? idr(ps.total_realized_pnl_idr) : '—'}
                    </div>
                    <div className="sub">{ps ? `${ps.realized_trades.length} CLOSED TRADE(S)` : ''}</div>
                  </div>
                  <div className="card summary-card fade-in">
                    <div className="icon icon-forex" style={{ marginBottom: 4 }}>FX</div>
                    <div className="value">Rp {Math.round(liveForex).toLocaleString('id-ID')}</div>
                    <div className="sub">{ps ? 'NET: ' + idr(ps.net_worth_idr) : 'USD/IDR'}</div>
                  </div>
                </div>

                <div className="main-grid" style={{ margin: 0, flex: 1 }}>
                  <div className="main-col">
                    {/* Active Portfolio */}
                    <div className="card fade-in">
                      <div className="card-header">
                        <div className="card-title" style={{ padding: 0, background: 'none', border: 'none', color: 'var(--bb-amber)' }}>
                          ACTIVE POSITIONS
                        </div>
                        <button className="btn btn-red btn-sm" onClick={async () => {
                          if (window.confirm('CLEAR ALL HISTORY AND BALANCE?')) {
                            try {
                              await writeLocalFile('journal.json', []);
                              await writeLocalFile('pending_orders.json', []);
                              setJournal([]); setPendingOrders([]);
                              setPortfolio(computePortfolio([], quotes, liveForex));
                              toast('CLEARED');
                            } catch (e: unknown) { toast('FAILED: ' + (e instanceof Error ? e.message : String(e)), 'error'); }
                          }
                        }}>CLR</button>
                      </div>
                      {!ps || ps.positions.length === 0 ? (
                        <div className="empty">NO ACTIVE POSITIONS</div>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>TICKER</th><th>QTY</th><th>AVG BUY</th>
                                <th>CURRENT</th><th>VALUE (IDR)</th><th>P&L</th><th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {ps.positions.map(p => (
                                <tr key={p.ticker}>
                                  <td className="ticker-name">{p.ticker}</td>
                                  <td className="mono">{p.qty}</td>
                                  <td className="mono">
                                    {p.avg_buy_price_native?.toLocaleString('en-US')}
                                    <br /><span style={{ color: 'var(--bb-text3)', fontSize: '.6rem' }}>{idr(p.avg_buy_price_idr)}</span>
                                  </td>
                                  <td className="mono">
                                    {p.current_price_native?.toLocaleString('en-US') ?? '—'}
                                    <br /><span style={{ color: 'var(--bb-text3)', fontSize: '.6rem' }}>{idr(p.current_price_idr)}</span>
                                  </td>
                                  <td className="mono">{idr(p.total_value_idr)}</td>
                                  <td className={`mono ${p.unrealized_pnl_idr >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>
                                    {idr(p.unrealized_pnl_idr)}<br />
                                    <span className={`badge ${p.unrealized_pnl_pct >= 0 ? 'badge-green' : 'badge-red'}`}>{pct(p.unrealized_pnl_pct)}</span>
                                  </td>
                                  <td>
                                    <button className="btn btn-red btn-sm" onClick={() => { setTradeDef({ ticker: p.ticker, action: 'SELL' }); setShowTrade(true); }}>SELL</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Pending Orders */}
                    {activeOrders.length > 0 && (
                      <div className="card fade-in">
                        <div className="card-title">ACTIVE PENDING ORDERS</div>
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>TICKER</th><th>ACT</th><th>COND</th><th>TRIGGER</th><th>QTY</th><th>CREATED</th><th></th></tr>
                            </thead>
                            <tbody>
                              {activeOrders.map(o => (
                                <tr key={o.id}>
                                  <td className="ticker-name">{o.ticker}</td>
                                  <td><span className={`badge ${o.action === 'BUY' ? 'badge-green' : 'badge-red'}`}>{o.action}</span></td>
                                  <td className="mono" style={{ fontSize: '.62rem' }}>{o.condition === 'PRICE_AT_OR_BELOW' ? '≤ SUP' : '≥ BRK'}</td>
                                  <td className="mono">{o.trigger_price.toLocaleString('en-US')} {o.currency}</td>
                                  <td className="mono">{o.qty}</td>
                                  <td className="mono" style={{ fontSize: '.6rem' }}>{o.created_at}</td>
                                  <td><button className="btn btn-sm" onClick={() => cancelPendingOrder(o.id)}>✕</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Capital Gains */}
                    <div className="card fade-in">
                      <div className="card-title">REALIZED P&L — CLOSED TRADES</div>
                      {!ps || ps.realized_trades.length === 0 ? (
                        <div className="empty">NO CLOSED TRADES</div>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>DATE</th><th>TICKER</th><th>QTY</th><th>SELL Px</th><th>COST BASIS</th><th>P&L (IDR)</th></tr>
                            </thead>
                            <tbody>
                              {ps.realized_trades.map((t, i) => (
                                <tr key={i}>
                                  <td className="mono" style={{ fontSize: '.62rem' }}>{t.date}</td>
                                  <td className="ticker-name">{t.ticker}{t.system_generated && <span className="bot-tag">BOT</span>}</td>
                                  <td className="mono">{t.qty}</td>
                                  <td className="mono">{t.sell_price_native?.toLocaleString('en-US')} {t.currency}</td>
                                  <td className="mono">{idr(t.cost_basis_idr)}</td>
                                  <td className={`mono ${t.realized_pnl_idr >= 0 ? 'pnl-pos' : 'pnl-neg'}`}>{idr(t.realized_pnl_idr)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right column: Local watchlist + Order history */}
                  <div className="main-col">
                    <div className="card fade-in">
                      <div className="card-header">
                        <div className="card-title" style={{ padding: 0, background: 'none', border: 'none', color: 'var(--bb-amber)' }}>
                          LOCAL WATCHLIST
                        </div>
                        <button className="btn btn-sm" onClick={() => {
                          const ticker = window.prompt('ENTER TICKER (e.g. AAPL, BBCA.JK):');
                          if (ticker?.trim()) addToWatchlist(ticker.trim().toUpperCase());
                        }}>+</button>
                      </div>
                      {watchlist.length === 0 ? <div className="empty">EMPTY</div> : (
                        watchlist.map(ticker => {
                          const q = quotes.get(ticker);
                          const chg = q?.daily_change_pct;
                          const cur = q?.currency || 'IDR';
                          const priceIDR = q?.current_price != null
                            ? (cur === 'IDR' ? q.current_price : q.current_price * liveForex)
                            : null;
                          const isPos = (chg ?? 0) >= 0;
                          return (
                            <div className="watch-item" key={ticker} onClick={() => handleTickerSelect(ticker)}>
                              <div>
                                <div className="watch-ticker">{ticker}</div>
                                <div className="watch-price">{priceIDR != null ? idr(priceIDR) : '—'}</div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ textAlign: 'right' }}>
                                  <div className="watch-price">{q?.current_price?.toLocaleString('en-US') ?? '—'} {cur !== 'IDR' ? cur : ''}</div>
                                  <div className={`watch-change ${chg != null ? (isPos ? 'pnl-pos' : 'pnl-neg') : ''}`}>{pct(chg)}</div>
                                </div>
                                <button className="btn btn-sm btn-red" onClick={e => { e.stopPropagation(); removeFromWatchlist(ticker); }} style={{ padding: '1px 5px', fontSize: '.6rem' }}>✕</button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {filledOrders.length > 0 && (
                      <div className="card fade-in">
                        <div className="card-title">ORDER HISTORY</div>
                        {filledOrders.slice(-10).reverse().map(o => (
                          <div className="watch-item" key={o.id}>
                            <div>
                              <div className="ticker-name">{o.ticker}</div>
                              <div className="watch-price">{o.action} @ {o.trigger_price}</div>
                            </div>
                            <span className={`badge ${o.status === 'FILLED' ? 'badge-green' : 'badge-muted'}`}>{o.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ══ MARKET INTEL TAB ════════════════════════ */}
            {activeTab === 'market' && (
              <div className="market-content">
                {!selectedTicker ? (
                  <div className="card fade-in" style={{ textAlign: 'center', padding: 40, margin: 0 }}>
                    <div style={{ fontSize: '1.5rem', color: 'var(--bb-amber)', marginBottom: 10, letterSpacing: '0.2em' }}>▸▸▸</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--bb-text2)', marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' }}>
                      SELECT A TICKER FROM WATCHLIST OR ENTER IN SEARCH
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--bb-text3)', fontFamily: 'JetBrains Mono, monospace' }}>
                      BANDARMOLOGY · ORDERBOOK · TECH SIGNALS · ACTIVE TRADE
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Security Header (full-width) */}
                    <EmitenInfoCard emiten={selectedTicker} />

                    {/* Trading Chart with indicators */}
                    <TradingChart ticker={selectedTicker} />

                    {/* Liquidity Pressure Intensity (Orderbook-based) */}
                    <LPIChart ticker={selectedTicker} />

                    {/* Backtest & JCI Correlation */}
                    <BacktestCard emiten={selectedTicker} />
                  </>
                )}
              </div>
            )}

            {/* ══ FUNDAMENTALS TAB ════════════════════════ */}
            {activeTab === 'fundamentals' && (
              <>
                {!selectedTicker ? (
                  <div className="card fade-in" style={{ textAlign: 'center', padding: 40, margin: 0 }}>
                    <div style={{ fontSize: '1.5rem', color: 'var(--bb-amber)', marginBottom: 10, letterSpacing: '0.2em' }}>▸▸▸</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--bb-text2)', fontFamily: 'JetBrains Mono, monospace' }}>
                      SELECT A TICKER TO VIEW KEY STATS & FUNDAMENTALS
                    </div>
                  </div>
                ) : (
                  <>
                    <EmitenInfoCard emiten={selectedTicker} />
                    <KeyStatsCard emiten={selectedTicker} />
                  </>
                )}
              </>
            )}

            {/* ══ NEWS TAB ════════════════════════════════ */}
            {activeTab === 'news' && (
              <div className="content-grid" style={{ gap: 0, background: 'transparent' }}>
                <NewsCard emiten={selectedTicker || undefined} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals (PRESERVED) ─────────────────────────── */}
      {showTrade && (
        <TradeModal
          quotes={quotes} liveForex={liveForex}
          positions={ps?.positions.map(p => ({ ticker: p.ticker, qty: p.qty, native_currency: p.native_currency })) || []}
          onSubmit={executeTrade} onClose={() => setShowTrade(false)}
          defaultTicker={tradeDef.ticker} defaultAction={tradeDef.action}
        />
      )}
      {showPending && (
        <PendingOrderModal
          quotes={quotes} liveForex={liveForex}
          onSubmit={createPendingOrder} onClose={() => setShowPending(false)}
        />
      )}
    </div>
  );
}

export default App;
