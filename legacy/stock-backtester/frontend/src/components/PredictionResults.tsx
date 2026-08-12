import React from 'react';
import { Predictions } from '../types';

interface PredictionResultsProps {
    data: Predictions;
}

const PredictionResults: React.FC<PredictionResultsProps> = ({ data }) => {
    const renderPrediction = (name: string, prediction: { trend: string; status: string; days: number | null }) => {
        const trendColor = prediction.trend === 'BULLISH' ? 'var(--success)' : 'var(--danger)';
        const trendIcon = prediction.trend === 'BULLISH' ? '📈' : '📉';

        return (
            <div style={{
                padding: 'var(--spacing-lg)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${prediction.status === 'Converging' ? 'var(--border-color-hover)' : 'var(--border-color)'}`,
                transition: 'all 0.3s ease'
            }}>
                <div className="flex items-center gap-2 mb-2">
                    <span style={{ fontSize: '1.5rem' }}>{trendIcon}</span>
                    <h4 style={{ margin: 0 }}>{name}</h4>
                </div>

                <div className="flex items-center gap-3 mb-2">
                    <span style={{
                        fontWeight: '600',
                        color: trendColor,
                        fontSize: '1.125rem'
                    }}>
                        {prediction.trend}
                    </span>
                    <span style={{
                        padding: '0.25rem 0.75rem',
                        background: prediction.status === 'Converging' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-secondary)',
                        color: prediction.status === 'Converging' ? 'var(--accent-primary)' : 'var(--text-muted)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.875rem',
                        fontWeight: '500'
                    }}>
                        {prediction.status}
                    </span>
                </div>

                {prediction.days !== null && (
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        Expected crossover in approximately <strong style={{ color: 'var(--accent-primary)' }}>{prediction.days.toFixed(1)} days</strong>
                    </p>
                )}

                {prediction.status === 'Diverging' && (
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        Moving averages are diverging - no crossover expected in near term
                    </p>
                )}
            </div>
        );
    };

    const getRsiStatus = (rsi: number) => {
        if (rsi >= 70) return { text: 'Overbought', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.1)' };
        if (rsi <= 30) return { text: 'Oversold', color: 'var(--success)', bg: 'rgba(16, 185, 129, 0.1)' };
        return { text: 'Neutral', color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' };
    };

    const rsiStatus = getRsiStatus(data.current_rsi);

    return (
        <div className="card slide-in-up" style={{ animationDelay: '0.1s' }}>
            <h3 className="mb-3">🔮 Future Predictions</h3>
            <p className="text-secondary mb-4">
                Based on current trend velocity and moving average convergence analysis
            </p>

            <div style={{ display: 'grid', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-lg)' }}>
                {renderPrediction('MA 9 vs MA 21', data.ma9_vs_ma21)}
                {renderPrediction('MA 21 vs MA 50', data.ma21_vs_ma50)}
            </div>

            <div style={{
                padding: 'var(--spacing-lg)',
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)'
            }}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <div className="text-secondary" style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                            Current Price
                        </div>
                        <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                            {new Intl.NumberFormat('id-ID').format(data.current_price)}
                        </div>
                    </div>

                    <div>
                        <div className="text-secondary" style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                            RSI (14)
                        </div>
                        <div className="flex items-center gap-2">
                            <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                                {data.current_rsi.toFixed(1)}
                            </div>
                            <span style={{
                                padding: '0.25rem 0.75rem',
                                background: rsiStatus.bg,
                                color: rsiStatus.color,
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.875rem',
                                fontWeight: '500'
                            }}>
                                {rsiStatus.text}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PredictionResults;
