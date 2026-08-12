import React from 'react';
import { BacktestSignal } from '../types';

interface BacktestResultsProps {
    data: BacktestSignal[];
}

const BacktestResults: React.FC<BacktestResultsProps> = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="card slide-in-up">
                <h3 className="mb-3">📊 Historical Signal Performance</h3>
                <p className="text-muted">No signals found in this period.</p>
            </div>
        );
    }

    const getPerformanceBadge = (avg: number) => {
        if (avg > 5) return <span className="badge badge-success">Strong</span>;
        if (avg > 0) return <span className="badge badge-success">Positive</span>;
        if (avg > -5) return <span className="badge badge-warning">Weak</span>;
        return <span className="badge badge-danger">Negative</span>;
    };

    const getWinRateBadge = (winRate: number) => {
        if (winRate >= 60) return <span className="badge badge-success">{winRate.toFixed(0)}%</span>;
        if (winRate >= 40) return <span className="badge badge-warning">{winRate.toFixed(0)}%</span>;
        return <span className="badge badge-danger">{winRate.toFixed(0)}%</span>;
    };

    return (
        <div className="card slide-in-up">
            <h3 className="mb-3">📊 Historical Signal Performance</h3>
            <p className="text-secondary mb-4">
                Analysis of historical signals and their forward returns over the selected period
            </p>

            <div style={{ overflowX: 'auto' }}>
                <table className="table">
                    <thead>
                        <tr>
                            <th>Signal Type</th>
                            <th style={{ textAlign: 'center' }}>Occurrences</th>
                            <th style={{ textAlign: 'right' }}>Avg 5-Day Return</th>
                            <th style={{ textAlign: 'right' }}>Avg 20-Day Return</th>
                            <th style={{ textAlign: 'center' }}>20-Day Win Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((signal, idx) => (
                            <tr key={idx} style={{ animationDelay: `${idx * 0.05}s` }}>
                                <td>
                                    <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                                        {signal.signal}
                                    </div>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '0.25rem 0.75rem',
                                        background: 'var(--bg-tertiary)',
                                        borderRadius: 'var(--radius-sm)',
                                        fontWeight: '500'
                                    }}>
                                        {signal.count}
                                    </span>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span style={{ fontWeight: '500', color: signal.avg_5d > 0 ? 'var(--success)' : 'var(--danger)' }}>
                                            {signal.avg_5d > 0 ? '+' : ''}{signal.avg_5d.toFixed(2)}%
                                        </span>
                                    </div>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span style={{ fontWeight: '500', color: signal.avg_20d > 0 ? 'var(--success)' : 'var(--danger)' }}>
                                            {signal.avg_20d > 0 ? '+' : ''}{signal.avg_20d.toFixed(2)}%
                                        </span>
                                        {getPerformanceBadge(signal.avg_20d)}
                                    </div>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    {getWinRateBadge(signal.win_rate_20d)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-4" style={{
                padding: 'var(--spacing-md)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.875rem',
                color: 'var(--text-secondary)'
            }}>
                <strong>Note:</strong> Past performance does not guarantee future results. Use these signals as part of a comprehensive analysis strategy.
            </div>
        </div>
    );
};

export default BacktestResults;
