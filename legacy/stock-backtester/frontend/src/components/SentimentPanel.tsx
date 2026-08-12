import React from 'react';
import { NewsItem } from '../types';

interface SentimentPanelProps {
    data: NewsItem[];
}

export const SentimentPanel: React.FC<SentimentPanelProps> = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div style={{
                padding: 'var(--spacing-xl)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
                color: 'var(--text-muted)',
                textAlign: 'center'
            }} className="fade-in">
                No recent news found for sentiment analysis.
            </div>
        );
    }

    const bullishCount = data.filter(n => n.sentiment === 'BULLISH').length;
    const bearishCount = data.filter(n => n.sentiment === 'BEARISH').length;
    const neutralCount = data.filter(n => n.sentiment === 'NEUTRAL').length;

    let overallSentiment = 'Neutral';
    let sentimentColor = '#9ca3af';

    if (bullishCount > bearishCount) {
        overallSentiment = 'Bullish';
        sentimentColor = '#10b981';
    } else if (bearishCount > bullishCount) {
        overallSentiment = 'Bearish';
        sentimentColor = '#ef4444';
    }

    return (
        <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--spacing-xl)',
            marginBottom: 'var(--spacing-xl)'
        }} className="fade-in">
            <h3 style={{ margin: '0 0 var(--spacing-lg) 0' }}>News Sentiment Analysis <span style={{ fontSize: '0.8em', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Dictionary)</span></h3>

            {/* Summary */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--spacing-md)',
                marginBottom: 'var(--spacing-xl)'
            }}>
                <div style={{
                    padding: 'var(--spacing-md)',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${sentimentColor}`
                }}>
                    <div className="text-secondary" style={{ fontSize: '0.85rem' }}>Overall Sentiment</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: sentimentColor }}>
                        {overallSentiment}
                    </div>
                </div>
                <div style={{
                    padding: 'var(--spacing-md)',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 'var(--radius-md)'
                }}>
                    <div className="text-secondary" style={{ fontSize: '0.85rem' }}>News Breakdown</div>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '0.9rem' }}>
                        <span style={{ color: '#10b981' }}>{bullishCount} Bullish</span>
                        <span style={{ color: '#ef4444' }}>{bearishCount} Bearish</span>
                        <span style={{ color: '#9ca3af' }}>{neutralCount} Neutral</span>
                    </div>
                </div>
            </div>

            {/* News List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                {data.map((item, idx) => (
                    <a
                        key={idx}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            textDecoration: 'none',
                            color: 'inherit',
                            display: 'block',
                            padding: 'var(--spacing-md)',
                            background: 'rgba(255,255,255,0.02)',
                            borderRadius: 'var(--radius-md)',
                            borderLeft: `4px solid ${item.sentiment === 'BULLISH' ? '#10b981' :
                                item.sentiment === 'BEARISH' ? '#ef4444' : '#9ca3af'
                                }`,
                            transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{
                                fontSize: '0.75rem',
                                color: item.sentiment === 'BULLISH' ? '#10b981' :
                                    item.sentiment === 'BEARISH' ? '#ef4444' : '#9ca3af',
                                fontWeight: 600,
                                textTransform: 'uppercase'
                            }}>
                                {item.sentiment} ({item.score > 0 ? '+' : ''}{item.score})
                            </span>
                            <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                                {new Date(item.publish_time * 1000).toLocaleDateString()}
                            </span>
                        </div>
                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>{item.title}</div>
                        <div className="text-secondary" style={{ fontSize: '0.8rem' }}>{item.publisher}</div>
                    </a>
                ))}
            </div>
        </div>
    );
};
