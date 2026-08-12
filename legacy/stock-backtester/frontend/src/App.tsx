import { useState } from 'react';
import axios from 'axios';
import TickerInput from './components/TickerInput';
import BacktestResults from './components/BacktestResults';
import Overview from './components/Overview';
import SmartMoneyPanel from './components/SmartMoneyPanel';
import StockChart from './components/StockChart';
import { AnalysisResponse, AnalysisError } from './types';
import { SentimentPanel } from './components/SentimentPanel';
import MAScreenerModal from './components/MAScreenerModal';
import './index.css';

function App() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const [results, setResults] = useState<AnalysisResponse | null>(null);

    const [interval, setInterval] = useState<'1d' | '1wk' | '1mo'>('1d');
    const [activeTab, setActiveTab] = useState<'overview' | 'chart' | 'smart_money' | 'analysis'>('overview');
    const [currentTicker, setCurrentTicker] = useState<string>('');

    const handleAnalyze = async (ticker: string, period?: string, newInterval?: string) => {
        setLoading(true);
        setError(null);
        setWarning(null);
        setResults(null);
        setCurrentTicker(ticker);

        try {
            const response = await axios.post<AnalysisResponse>('/api/analyze', {
                ticker,
                period: period || '2y',
                interval: newInterval || interval
            });

            setResults(response.data);
            if (response.data.warning) {
                setWarning(response.data.warning);
            }
        } catch (err) {
            if (axios.isAxiosError(err) && err.response) {
                const errorData = err.response.data as AnalysisError;
                setError(errorData.error || 'Failed to analyze stock. Please try again.');
            } else {
                setError('Network error. Please check your connection and try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleIntervalChange = (newInterval: '1d' | '1wk' | '1mo') => {
        setInterval(newInterval);
        if (currentTicker) {
            handleAnalyze(currentTicker, undefined, newInterval);
        }
    };

    return (
        <div style={{ minHeight: '100vh', paddingBottom: 'var(--spacing-2xl)' }}>
            {/* Header */}
            <header style={{
                padding: 'var(--spacing-xl) var(--spacing-md)',
                background: 'rgba(26, 32, 48, 0.3)',
                backdropFilter: 'blur(12px)',
                borderBottom: '1px solid var(--border-color)',
                marginBottom: 'var(--spacing-2xl)'
            }}>
                <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                    <div className="flex items-center gap-3 mb-2">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="url(#gradient)" strokeWidth="2">
                            <defs>
                                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#6366f1" />
                                    <stop offset="100%" stopColor="#8b5cf6" />
                                </linearGradient>
                            </defs>
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                        </svg>
                        <h1 style={{
                            margin: 0,
                            background: 'var(--accent-gradient)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text'
                        }}>
                            Stock Backtester
                        </h1>
                    </div>
                    <p className="text-secondary" style={{ margin: 0, fontSize: '1.125rem' }}>
                        Professional technical analysis and signal backtesting platform
                    </p>
                </div>
            </header>

            {/* Main Content */}
            <main style={{
                maxWidth: '1400px',
                margin: '0 auto',
                padding: '0 var(--spacing-md)'
            }}>
                <TickerInput onSubmit={(ticker) => handleAnalyze(ticker)} loading={loading} />

                {error && (
                    <div className="alert alert-error fade-in mt-4">
                        <strong>Error:</strong> {error}
                    </div>
                )}

                {warning && (
                    <div className="alert alert-warning fade-in mt-4">
                        <strong>⚠️ Warning:</strong> {warning}
                    </div>
                )}

                {results && (
                    <div style={{ marginTop: 'var(--spacing-2xl)' }}>
                        <div style={{
                            marginBottom: 'var(--spacing-xl)',
                            padding: 'var(--spacing-lg)',
                            background: 'var(--bg-card)',
                            backdropFilter: 'blur(12px)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-lg)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 'var(--spacing-md)'
                        }} className="fade-in">
                            <div>
                                <h2 style={{ margin: 0, marginBottom: 'var(--spacing-sm)' }}>
                                    Analysis Results for {results.ticker}
                                </h2>
                                <p className="text-secondary" style={{ margin: 0 }}>
                                    Comprehensive technical analysis with backtest validation
                                </p>
                            </div>

                            {/* Interval Toggles */}
                            <div style={{ display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '8px' }}>
                                {(['1d', '1wk', '1mo'] as const).map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => handleIntervalChange(t)}
                                        style={{
                                            padding: '6px 16px',
                                            borderRadius: '6px',
                                            border: 'none',
                                            background: interval === t ? 'var(--primary)' : 'transparent',
                                            color: interval === t ? '#fff' : 'var(--text-muted)',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        {t === '1d' ? 'Daily' : t === '1wk' ? 'Weekly' : 'Monthly'}
                                    </button>
                                ))}
                            </div>
                        </div>



                        {/* Tabs */}
                        <div style={{
                            display: 'flex',
                            borderBottom: '1px solid var(--border-color)',
                            marginBottom: 'var(--spacing-xl)',
                            gap: 'var(--spacing-xl)',
                            overflowX: 'auto'
                        }}>
                            <button
                                onClick={() => setActiveTab('overview')}
                                style={{
                                    padding: 'var(--spacing-md) 0',
                                    background: 'none',
                                    border: 'none',
                                    borderBottom: activeTab === 'overview' ? '2px solid var(--primary)' : '2px solid transparent',
                                    color: activeTab === 'overview' ? 'var(--primary)' : 'var(--text-muted)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Overview
                            </button>
                            <button
                                onClick={() => setActiveTab('chart')}
                                style={{
                                    padding: 'var(--spacing-md) 0',
                                    background: 'none',
                                    border: 'none',
                                    borderBottom: activeTab === 'chart' ? '2px solid var(--primary)' : '2px solid transparent',
                                    color: activeTab === 'chart' ? 'var(--primary)' : 'var(--text-muted)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Price Action
                            </button>
                            <button
                                onClick={() => setActiveTab('smart_money')}
                                style={{
                                    padding: 'var(--spacing-md) 0',
                                    background: 'none',
                                    border: 'none',
                                    borderBottom: activeTab === 'smart_money' ? '2px solid var(--primary)' : '2px solid transparent',
                                    color: activeTab === 'smart_money' ? 'var(--primary)' : 'var(--text-muted)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Smart Money
                            </button>
                            <button
                                onClick={() => setActiveTab('analysis')}
                                style={{
                                    padding: 'var(--spacing-md) 0',
                                    background: 'none',
                                    border: 'none',
                                    borderBottom: activeTab === 'analysis' ? '2px solid var(--primary)' : '2px solid transparent',
                                    color: activeTab === 'analysis' ? 'var(--primary)' : 'var(--text-muted)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Backtest
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div className="fade-in">
                            {activeTab === 'overview' && (
                                <Overview data={results.overview} />
                            )}

                            {activeTab === 'chart' && (
                                <StockChart data={results.historical_data} ticker={results.ticker} />
                            )}

                            {activeTab === 'smart_money' && (
                                <SmartMoneyPanel data={results.smart_money} />
                            )}

                            {activeTab === 'analysis' && (
                                <div style={{ display: 'grid', gap: 'var(--spacing-xl)' }}>
                                    <SentimentPanel data={results.news_sentiment} />
                                    <BacktestResults data={results.backtest_summary} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {!results && !loading && !error && (
                    <div style={{
                        marginTop: 'var(--spacing-2xl)',
                        textAlign: 'center',
                        padding: 'var(--spacing-2xl)',
                        color: 'var(--text-muted)'
                    }} className="fade-in">
                        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto var(--spacing-lg)' }}>
                            <path d="M3 3v18h18" />
                            <path d="M18 17V9" />
                            <path d="M13 17V5" />
                            <path d="M8 17v-3" />
                        </svg>
                        <h3 style={{ marginBottom: 'var(--spacing-sm)' }}>Ready to Analyze</h3>
                        <p style={{ maxWidth: '600px', margin: '0 auto', fontSize: '1.125rem' }}>
                            Enter a ticker symbol above to start analyzing historical signal performance and future trend predictions
                        </p>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer style={{
                marginTop: 'var(--spacing-2xl)',
                padding: 'var(--spacing-xl) var(--spacing-md)',
                textAlign: 'center',
                color: 'var(--text-muted)',
                borderTop: '1px solid var(--border-color)',
                fontSize: '0.875rem'
            }}>
                <p style={{ margin: 0 }}>
                    Built with React, TypeScript, and Recharts • Powered by yfinance
                </p>
            </footer>

            {/* MA Squeeze Screener — floating popup, always accessible */}
            <MAScreenerModal
                onSelectTicker={(ticker) => {
                    handleAnalyze(ticker);
                }}
            />
        </div>
    );
}

export default App;
