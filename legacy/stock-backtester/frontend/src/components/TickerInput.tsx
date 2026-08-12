import React from 'react';

interface TickerInputProps {
    onSubmit: (ticker: string, period: string) => void;
    loading: boolean;
}

const TickerInput: React.FC<TickerInputProps> = ({ onSubmit, loading }) => {
    const [ticker, setTicker] = React.useState('');
    const [period, setPeriod] = React.useState('2y');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (ticker.trim()) {
            onSubmit(ticker.trim(), period);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="card fade-in">
            <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                <div style={{ flex: '1', minWidth: '200px' }}>
                    <label htmlFor="ticker" style={{ display: 'block', marginBottom: 'var(--spacing-sm)', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: '500' }}>
                        Ticker Symbol
                    </label>
                    <input
                        id="ticker"
                        type="text"
                        className="input"
                        placeholder="e.g., BBCA, BBRI, AAPL"
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value.toUpperCase())}
                        disabled={loading}
                        required
                    />
                </div>

                <div style={{ flex: '0 0 150px' }}>
                    <label htmlFor="period" style={{ display: 'block', marginBottom: 'var(--spacing-sm)', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: '500' }}>
                        Period
                    </label>
                    <select
                        id="period"
                        className="input select"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        disabled={loading}
                    >
                        <option value="1y">1 Year</option>
                        <option value="2y">2 Years</option>
                        <option value="5y">5 Years</option>
                        <option value="max">Max</option>
                    </select>
                </div>

                <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end' }}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? (
                            <>
                                <span className="spinner"></span>
                                Analyzing...
                            </>
                        ) : (
                            <>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                                </svg>
                                Analyze Stock
                            </>
                        )}
                    </button>
                </div>
            </div>
        </form>
    );
};

export default TickerInput;
