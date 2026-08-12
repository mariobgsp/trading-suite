import { useState, useEffect, useRef, useCallback, MouseEvent, ChangeEvent } from 'react';
import { ScreenerResult } from '../types';

interface MAScreenerModalProps {
    onSelectTicker: (ticker: string) => void;
}

type SortKey = 'squeeze_score' | 'ma_gap_pct' | 'rsi' | 'volume_ratio' | 'price';
type SortDir = 'asc' | 'desc';
type FilterLabel = 'ALL' | 'STRONG' | 'MODERATE' | 'WATCH';

const SIGNAL_CONFIG: Record<string, { color: string; bg: string; emoji: string }> = {
    STRONG: { color: '#10b981', bg: 'rgba(16,185,129,0.12)', emoji: '🚀' },
    MODERATE: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', emoji: '⚡' },
    WATCH: { color: '#6366f1', bg: 'rgba(99,102,241,0.12)', emoji: '👀' },
};

interface SortIconProps { col: SortKey; sortKey: SortKey; sortDir: SortDir; }
function SortIcon({ col, sortKey, sortDir }: SortIconProps) {
    return (
        <span style={{ marginLeft: 4, opacity: sortKey === col ? 1 : 0.3, fontSize: '0.75rem' }}>
            {sortKey === col ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}
        </span>
    );
}

export default function MAScreenerModal({ onSelectTicker }: MAScreenerModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [results, setResults] = useState<ScreenerResult[]>([]);
    const [scanned, setScanned] = useState(0);
    const [total, setTotal] = useState(0);
    const [found, setFound] = useState(0);
    const [scanDone, setScanDone] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('squeeze_score');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [filter, setFilter] = useState<FilterLabel>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const abortRef = useRef<AbortController | null>(null);

    // Close on Escape key
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const startScan = useCallback(async () => {
        setIsScanning(true);
        setResults([]);
        setScanned(0);
        setTotal(0);
        setFound(0);
        setScanDone(false);

        abortRef.current = new AbortController();

        try {
            const resp = await fetch('/api/screener/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ max_workers: 20 }),
                signal: abortRef.current.signal,
            });

            if (!resp.ok || !resp.body) throw new Error('Stream failed');

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(line.slice(6)) as {
                            type: string;
                            total?: number;
                            data?: ScreenerResult;
                            scanned?: number;
                            found?: number;
                            total_scanned?: number;
                            total_found?: number;
                            results?: ScreenerResult[];
                        };

                        if (event.type === 'info') {
                            setTotal(event.total ?? 0);
                        } else if (event.type === 'result' && event.data) {
                            setResults(prev => [...prev, event.data!]);
                            setFound(prev => prev + 1);
                        } else if (event.type === 'progress') {
                            setScanned(event.scanned ?? 0);
                            setTotal(event.total ?? 0);
                        } else if (event.type === 'done') {
                            setScanned(event.total_scanned ?? 0);
                            setResults(event.results ?? []);
                            setScanDone(true);
                        }
                    } catch { /* skip malformed */ }
                }
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name !== 'AbortError') {
                console.error('Screener stream error:', err);
            }
        } finally {
            setIsScanning(false);
        }
    }, []);

    const stopScan = () => {
        abortRef.current?.abort();
        setIsScanning(false);
    };

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir((d: SortDir) => d === 'desc' ? 'asc' : 'desc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const filteredAndSorted = results
        .filter((r: ScreenerResult) => filter === 'ALL' || r.signal_label === filter)
        .filter((r: ScreenerResult) => !searchTerm || r.ticker.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a: ScreenerResult, b: ScreenerResult) => {
            const valA = a[sortKey as keyof ScreenerResult] as number;
            const valB = b[sortKey as keyof ScreenerResult] as number;
            return sortDir === 'desc' ? valB - valA : valA - valB;
        });

    const progress = total > 0 ? Math.round((scanned / total) * 100) : 0;

    const handleSelectTicker = (ticker: string) => {
        setIsOpen(false);
        onSelectTicker(ticker);
    };

    return (
        <>
            {/* ── Floating Action Button ── */}
            <button
                className="screener-fab"
                onClick={() => setIsOpen(true)}
                title="Open MA Squeeze Screener"
            >
                <span className="screener-fab-pulse" />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                <span className="screener-fab-label">Screener</span>
            </button>

            {/* ── Modal Overlay ── */}
            {isOpen && (
                <div
                    className="modal-overlay"
                    onClick={(e: MouseEvent<HTMLDivElement>) => {
                        if (e.target === e.currentTarget) setIsOpen(false);
                    }}
                >
                    <div className="modal screener-modal fade-in">

                        {/* Header */}
                        <div className="screener-modal-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div className="screener-icon-wrap">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontWeight: 700 }}>⚡ MA Squeeze Screener</h3>
                                    <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                                        Auto-scans 900+ IHSG stocks for tightly squeezed MAs about to explode
                                    </p>
                                </div>
                            </div>
                            <button className="screener-close-btn" onClick={() => setIsOpen(false)}>✕</button>
                        </div>

                        {/* Controls */}
                        <div className="screener-controls">
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                {!isScanning ? (
                                    <button
                                        className="btn btn-primary screener-scan-btn"
                                        onClick={startScan}
                                    >
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                        {scanDone ? 'Re-scan Market' : 'Start Scan'}
                                    </button>
                                ) : (
                                    <button className="btn screener-stop-btn" onClick={stopScan}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12" rx="2" />
                                        </svg>
                                        Stop Scan
                                    </button>
                                )}

                                {/* Filter pills */}
                                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                                    {(['ALL', 'STRONG', 'MODERATE', 'WATCH'] as FilterLabel[]).map(f => {
                                        const cfg = f !== 'ALL' ? SIGNAL_CONFIG[f] : null;
                                        return (
                                            <button
                                                key={f}
                                                className={`screener-filter-pill ${filter === f ? 'active' : ''}`}
                                                style={filter === f && cfg ? {
                                                    background: cfg.bg,
                                                    color: cfg.color,
                                                    borderColor: cfg.color,
                                                } : {}}
                                                onClick={() => setFilter(f)}
                                            >
                                                {cfg ? `${cfg.emoji} ` : ''}{f}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Search */}
                                <input
                                    type="text"
                                    placeholder="Search ticker…"
                                    value={searchTerm}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                                    className="input screener-search"
                                />
                            </div>

                            {/* Progress bar */}
                            {(isScanning || scanDone) && (
                                <div style={{ marginTop: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        <span>
                                            {isScanning
                                                ? `Scanning… ${scanned} / ${total || '?'} stocks`
                                                : `✓ Complete — ${scanned} stocks scanned`
                                            }
                                        </span>
                                        <span style={{ color: '#10b981', fontWeight: 600 }}>
                                            {found || results.length} matches found
                                        </span>
                                    </div>
                                    <div className="screener-progress-track">
                                        <div
                                            className={`screener-progress-bar ${isScanning ? 'scanning' : 'done'}`}
                                            style={{ width: `${isScanning ? progress : 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Results area */}
                        <div className="screener-results">

                            {/* Empty: not yet started */}
                            {!scanDone && !isScanning && (
                                <div className="screener-empty-state">
                                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ marginBottom: 14, opacity: 0.25 }}>
                                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                    </svg>
                                    <p style={{ fontSize: '1rem', margin: 0, fontWeight: 600 }}>Ready to scan</p>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 6 }}>
                                        Click <strong>Start Scan</strong> to auto-scan 900+ IHSG stocks for daily MA squeeze setups
                                    </p>
                                </div>
                            )}

                            {/* Scanning — no results yet */}
                            {isScanning && results.length === 0 && (
                                <div className="screener-empty-state">
                                    <div className="screener-radar">
                                        <div className="screener-radar-ring" />
                                        <div className="screener-radar-ring delay1" />
                                        <div className="screener-radar-ring delay2" />
                                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
                                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                    </div>
                                    <p style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 18 }}>Scanning market…</p>
                                    <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                        Analysing MA squeeze conditions across {total} stocks
                                    </p>
                                </div>
                            )}

                            {/* Results table */}
                            {filteredAndSorted.length > 0 && (
                                <table className="table screener-table">
                                    <thead>
                                        <tr>
                                            <th>Ticker</th>
                                            <th>Signal</th>
                                            <th style={{ cursor: 'pointer' }} onClick={() => handleSort('squeeze_score')}>
                                                Score <SortIcon col="squeeze_score" sortKey={sortKey} sortDir={sortDir} />
                                            </th>
                                            <th style={{ cursor: 'pointer' }} onClick={() => handleSort('ma_gap_pct')}>
                                                MA Gap% <SortIcon col="ma_gap_pct" sortKey={sortKey} sortDir={sortDir} />
                                            </th>
                                            <th style={{ cursor: 'pointer' }} onClick={() => handleSort('price')}>
                                                Price <SortIcon col="price" sortKey={sortKey} sortDir={sortDir} />
                                            </th>
                                            <th style={{ cursor: 'pointer' }} onClick={() => handleSort('rsi')}>
                                                RSI <SortIcon col="rsi" sortKey={sortKey} sortDir={sortDir} />
                                            </th>
                                            <th style={{ cursor: 'pointer' }} onClick={() => handleSort('volume_ratio')}>
                                                Vol× <SortIcon col="volume_ratio" sortKey={sortKey} sortDir={sortDir} />
                                            </th>
                                            <th>MA9 / 21 / 50</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredAndSorted.map((r: ScreenerResult) => {
                                            const cfg = SIGNAL_CONFIG[r.signal_label] ?? SIGNAL_CONFIG['WATCH'];
                                            return (
                                                <tr key={r.ticker} className="screener-row">
                                                    <td>
                                                        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{r.ticker}</span>
                                                    </td>
                                                    <td>
                                                        <span
                                                            className="badge screener-signal-badge"
                                                            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
                                                        >
                                                            {cfg.emoji} {r.signal_label}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="screener-score-cell">
                                                            <span style={{ fontWeight: 700, color: cfg.color, minWidth: 30 }}>{r.squeeze_score}</span>
                                                            <div className="screener-score-bar-track">
                                                                <div
                                                                    className="screener-score-bar-fill"
                                                                    style={{ width: `${r.squeeze_score}%`, background: cfg.color }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span style={{
                                                            color: r.ma_gap_pct < 2 ? '#10b981' : r.ma_gap_pct < 3.5 ? '#f59e0b' : 'var(--text-secondary)'
                                                        }}>
                                                            {r.ma_gap_pct.toFixed(2)}%
                                                        </span>
                                                    </td>
                                                    <td style={{ fontWeight: 600 }}>
                                                        {r.price.toLocaleString('id-ID')}
                                                    </td>
                                                    <td>
                                                        <span style={{
                                                            color: r.rsi > 60 ? '#f59e0b' : r.rsi < 45 ? '#6366f1' : '#10b981'
                                                        }}>
                                                            {r.rsi.toFixed(1)}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span style={{
                                                            color: r.volume_ratio > 1.5 ? '#10b981' : r.volume_ratio > 1.1 ? '#f59e0b' : 'var(--text-muted)'
                                                        }}>
                                                            {r.volume_ratio.toFixed(2)}×
                                                        </span>
                                                    </td>
                                                    <td style={{ fontSize: '0.775rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                                        {r.ma9.toLocaleString('id-ID')}
                                                        {' / '}
                                                        {r.ma21.toLocaleString('id-ID')}
                                                        {' / '}
                                                        {r.ma50.toLocaleString('id-ID')}
                                                    </td>
                                                    <td>
                                                        <button
                                                            className="btn screener-analyze-btn"
                                                            onClick={() => handleSelectTicker(r.ticker)}
                                                        >
                                                            Analyze →
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}

                            {/* Scan done but nothing matches filter */}
                            {scanDone && filteredAndSorted.length === 0 && results.length > 0 && (
                                <div className="screener-empty-state">
                                    <p style={{ fontSize: '1rem', fontWeight: 600 }}>No matches for current filter</p>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 6 }}>
                                        Try selecting a different signal label or run a new scan.
                                    </p>
                                </div>
                            )}

                            {/* Scan done but no results at all */}
                            {scanDone && results.length === 0 && (
                                <div className="screener-empty-state">
                                    <p style={{ fontSize: '1rem', fontWeight: 600 }}>No squeeze setups found</p>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 6 }}>
                                        Market may be in a trending or high-volatility phase. Try again later.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="screener-footer">
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                                Criteria: MA9/21/50 gap &lt;5% · RSI 35–70 · Bullish slope · Liquid stocks only · Daily timeframe
                            </span>
                            {filteredAndSorted.length > 0 && (
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 600 }}>
                                    {filteredAndSorted.length} / {results.length} results
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
