import React from 'react';
import { OverviewData } from '../types';

interface OverviewProps {
    data: OverviewData;
}

const Overview: React.FC<OverviewProps> = ({ data }) => {

    // Helper for Conclusion Color
    const getConclusionColor = (conc: string) => {
        if (conc.includes('BUY')) return 'var(--success)';
        if (conc.includes('SELL')) return 'var(--danger)';
        return 'var(--warning)';
    };

    // Helper for Trend Icon
    const getTrendIcon = (trend: string) => trend === 'BULLISH' ? '📈' : '📉';
    const getTrendColor = (trend: string) => trend === 'BULLISH' ? 'var(--success)' : 'var(--danger)';

    const renderIndicatorCard = (title: string, value: React.ReactNode, status: string, subtext?: string) => {
        let statusColor = 'var(--text-secondary)';
        let bg = 'var(--bg-tertiary)';

        if (['Overbought', 'Bearish', 'Death Cross'].some(k => status.includes(k))) {
            statusColor = 'var(--danger)';
            bg = 'rgba(239, 68, 68, 0.1)';
        } else if (['Oversold', 'Bullish', 'Golden Cross'].some(k => status.includes(k))) {
            statusColor = 'var(--success)';
            bg = 'rgba(16, 185, 129, 0.1)';
        }

        return (
            <div style={{
                background: 'var(--bg-tertiary)',
                padding: 'var(--spacing-md)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            }}>
                <div className="text-secondary" style={{ fontSize: '0.875rem' }}>{title}</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>{value}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                        fontSize: '0.75rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: bg,
                        color: statusColor,
                        fontWeight: '500'
                    }}>
                        {status}
                    </span>
                    {subtext && <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{subtext}</span>}
                </div>
            </div>
        );
    };

    return (
        <div className="card slide-in-up">
            {/* Conclusion Header */}
            <div style={{
                textAlign: 'center',
                padding: 'var(--spacing-xl)',
                marginBottom: 'var(--spacing-xl)',
                background: `linear-gradient(135deg, ${getConclusionColor(data.conclusion)}22, transparent)`,
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${getConclusionColor(data.conclusion)}44`
            }}>
                <h4 className="text-secondary mb-2">Technical Conclusion</h4>
                <h1 style={{
                    fontSize: '2.5rem',
                    color: getConclusionColor(data.conclusion),
                    margin: '0 0 var(--spacing-md) 0',
                    textShadow: '0 0 20px rgba(0,0,0,0.2)'
                }}>
                    {data.conclusion}
                </h1>
                {data.reasons.length > 0 && (
                    <div className="flex gap-2 justify-center flex-wrap">
                        {data.reasons.map((r, i) => (
                            <span key={i} className="badge badge-secondary" style={{ fontSize: '0.875rem' }}>
                                {r}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Indicators Grid */}
            <h3 className="mb-4">📊 Technical Indicators</h3>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--spacing-md)',
                marginBottom: 'var(--spacing-2xl)'
            }}>
                {renderIndicatorCard(
                    "MA 9 vs 21",
                    <span style={{ color: getTrendColor(data.ma9_vs_ma21.trend) }}>
                        {getTrendIcon(data.ma9_vs_ma21.trend)} {data.ma9_vs_ma21.trend}
                    </span>,
                    data.ma9_vs_ma21.cross !== 'None' ? data.ma9_vs_ma21.cross : 'No Cross',
                    `Gap: ${(data.ma9_vs_ma21.value_short - data.ma9_vs_ma21.value_long).toFixed(2)}`
                )}

                {renderIndicatorCard(
                    "MA 21 vs 50",
                    <span style={{ color: getTrendColor(data.ma21_vs_ma50.trend) }}>
                        {getTrendIcon(data.ma21_vs_ma50.trend)} {data.ma21_vs_ma50.trend}
                    </span>,
                    data.ma21_vs_ma50.cross !== 'None' ? data.ma21_vs_ma50.cross : 'No Cross',
                    `Gap: ${(data.ma21_vs_ma50.value_short - data.ma21_vs_ma50.value_long).toFixed(2)}`
                )}

                {renderIndicatorCard(
                    "RSI (14)",
                    data.rsi.value,
                    data.rsi.status
                )}

                {renderIndicatorCard(
                    "Stochastic (14,3,3)",
                    `K: ${data.stoch.k} | D: ${data.stoch.d}`,
                    data.stoch.status
                )}

                {renderIndicatorCard(
                    "MACD (12,26,9)",
                    <div style={{ fontSize: '1rem' }}>
                        H: <span style={{ color: data.macd.hist > 0 ? 'var(--success)' : 'var(--danger)' }}>{data.macd.hist}</span>
                    </div>,
                    data.macd.cross !== 'None' ? data.macd.cross : data.macd.status
                )}
            </div>

            {/* Forecasting Section */}
            <h3 className="mb-4">🔮 Future Forecasting</h3>
            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                {[
                    { name: "MA 9 vs 21", pred: data.prediction_ma9_21 },
                    { name: "MA 21 vs 50", pred: data.prediction_ma21_50 }
                ].map((item, idx) => (
                    <div key={idx} style={{
                        padding: 'var(--spacing-lg)',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${item.pred.status === 'Converging' ? 'var(--accent-primary)' : 'var(--border-color)'}`
                    }}>
                        <div className="flex justify-between items-center mb-2">
                            <h4 style={{ margin: 0 }}>{item.name}</h4>
                            <span className={`badge ${item.pred.status === 'Converging' ? 'badge-primary' : 'badge-secondary'}`}>
                                {item.pred.status}
                            </span>
                        </div>
                        {item.pred.days ? (
                            <p style={{ margin: 0 }} className="text-secondary">
                                Expected crossover in approximately <strong style={{ color: 'var(--accent-primary)' }}>{item.pred.days} days</strong>
                            </p>
                        ) : (
                            <p style={{ margin: 0 }} className="text-muted">
                                Lines are diverging, no immediate crossover expected.
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Overview;
