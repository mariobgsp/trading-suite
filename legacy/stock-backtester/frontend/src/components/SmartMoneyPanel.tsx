import React from 'react';
import { SmartMoneyData } from '../types';

interface SmartMoneyPanelProps {
    data: SmartMoneyData;
}

const SmartMoneyPanel: React.FC<SmartMoneyPanelProps> = ({ data }) => {
    const getCmfColor = () => {
        if (data.cmf_signal === 'Accumulation') return 'var(--success)';
        if (data.cmf_signal === 'Distribution') return 'var(--danger)';
        return 'var(--text-secondary)';
    };

    const getCmfBg = () => {
        if (data.cmf_signal === 'Accumulation') return 'rgba(16, 185, 129, 0.1)';
        if (data.cmf_signal === 'Distribution') return 'rgba(239, 68, 68, 0.1)';
        return 'var(--bg-tertiary)';
    };

    const getNviColor = () => {
        return data.nvi_signal === 'Smart Money Bullish' ? 'var(--success)' : 'var(--danger)';
    };

    const getNviBg = () => {
        return data.nvi_signal === 'Smart Money Bullish' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    };

    // CMF bar width: map -1..+1 range to 0..100%
    const cmfBarPercent = Math.min(100, Math.max(0, (data.cmf + 1) / 2 * 100));

    const activeAlerts = [];
    if (data.wyckoff_spring) activeAlerts.push({ label: 'Wyckoff Spring Detected', icon: '🔩', desc: 'Price broke below support and snapped back with strong volume — classic smart money accumulation pattern.' });
    if (data.buy_on_dip) activeAlerts.push({ label: 'Buy on Dip Signal', icon: '🎯', desc: 'RSI oversold + positive money flow + price near MA50 support — potential dip-buying opportunity.' });
    if (data.buy_on_weakness) activeAlerts.push({ label: 'Buy on Weakness Signal', icon: '🧠', desc: 'Smart money accumulating (NVI rising) while price declines — institutional buying on quiet days.' });

    return (
        <div className="card slide-in-up" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: '1.5rem' }}>🏦</span>
                <h3 style={{ margin: 0 }}>Smart Money Analysis</h3>
            </div>
            <p className="text-secondary mb-4">
                Bandarmology indicators tracking institutional flow and accumulation/distribution patterns
            </p>

            {/* Active Alerts */}
            {activeAlerts.length > 0 && (
                <div style={{ marginBottom: 'var(--spacing-lg)' }}>
                    {activeAlerts.map((alert, idx) => (
                        <div key={idx} style={{
                            padding: 'var(--spacing-md)',
                            background: 'rgba(16, 185, 129, 0.08)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: idx < activeAlerts.length - 1 ? 'var(--spacing-sm)' : 0,
                            animation: 'fadeIn 0.5s ease-out',
                            animationDelay: `${idx * 0.1}s`,
                            animationFillMode: 'both'
                        }}>
                            <div className="flex items-center gap-2 mb-1">
                                <span style={{ fontSize: '1.25rem' }}>{alert.icon}</span>
                                <strong style={{ color: 'var(--success)', fontSize: '0.95rem' }}>
                                    {alert.label}
                                </strong>
                            </div>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                                {alert.desc}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {/* Indicator Cards Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 'var(--spacing-md)'
            }}>
                {/* CMF Card */}
                <div style={{
                    padding: 'var(--spacing-lg)',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div className="flex items-center justify-between mb-2">
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>
                            Chaikin Money Flow (20)
                        </h4>
                        <span style={{
                            padding: '0.2rem 0.6rem',
                            background: getCmfBg(),
                            color: getCmfColor(),
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8rem',
                            fontWeight: '600'
                        }}>
                            {data.cmf_signal}
                        </span>
                    </div>
                    <div style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: getCmfColor(),
                        marginBottom: 'var(--spacing-sm)'
                    }}>
                        {data.cmf > 0 ? '+' : ''}{data.cmf.toFixed(2)}
                    </div>
                    {/* CMF Bar */}
                    <div style={{
                        position: 'relative',
                        height: '6px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '3px',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: `${cmfBarPercent}%`,
                            background: data.cmf > 0
                                ? 'linear-gradient(90deg, var(--bg-tertiary), var(--success))'
                                : 'linear-gradient(90deg, var(--danger), var(--bg-tertiary))',
                            borderRadius: '3px',
                            transition: 'width 0.5s ease'
                        }} />
                        {/* Center marker */}
                        <div style={{
                            position: 'absolute',
                            left: '50%',
                            top: '-1px',
                            width: '2px',
                            height: '8px',
                            background: 'var(--text-muted)',
                            transform: 'translateX(-50%)'
                        }} />
                    </div>
                    <div className="flex justify-between" style={{ marginTop: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span>Distribution</span>
                        <span>Accumulation</span>
                    </div>
                </div>

                {/* NVI Card */}
                <div style={{
                    padding: 'var(--spacing-lg)',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div className="flex items-center justify-between mb-2">
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>
                            Negative Volume Index
                        </h4>
                        <span style={{
                            padding: '0.2rem 0.6rem',
                            background: getNviBg(),
                            color: getNviColor(),
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8rem',
                            fontWeight: '600'
                        }}>
                            {data.nvi_signal}
                        </span>
                    </div>
                    <div style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: 'var(--text-primary)',
                        marginBottom: '2px'
                    }}>
                        {data.nvi.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        EMA(255): {data.nvi_ema.toFixed(2)}
                    </div>
                    <p style={{
                        margin: 'var(--spacing-sm) 0 0',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        lineHeight: '1.4'
                    }}>
                        {data.nvi > data.nvi_ema
                            ? 'NVI above EMA — smart money is in bullish positioning on low-volume days.'
                            : 'NVI below EMA — smart money may be exiting or cautious.'}
                    </p>
                </div>

                {/* PVI Card */}
                <div style={{
                    padding: 'var(--spacing-lg)',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div className="flex items-center justify-between mb-2">
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>
                            Positive Volume Index
                        </h4>
                    </div>
                    <div style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: 'var(--text-primary)',
                        marginBottom: '2px'
                    }}>
                        {data.pvi.toFixed(2)}
                    </div>
                    <p style={{
                        margin: 'var(--spacing-sm) 0 0',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        lineHeight: '1.4'
                    }}>
                        Tracks retail/crowd behavior on high-volume days. Compare with NVI to gauge smart money divergence.
                    </p>
                </div>
            </div>

            {/* No Alerts State */}
            {activeAlerts.length === 0 && (
                <div style={{
                    marginTop: 'var(--spacing-lg)',
                    padding: 'var(--spacing-md)',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)',
                    textAlign: 'center'
                }}>
                    No active buy signals detected. Indicators are in a neutral state — continue monitoring for accumulation patterns.
                </div>
            )}

            {/* Footer Note */}
            <div style={{
                marginTop: 'var(--spacing-lg)',
                padding: 'var(--spacing-md)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.85rem',
                color: 'var(--text-muted)'
            }}>
                <strong>Note:</strong> Bandarmology signals are probabilistic. Wyckoff Spring, Buy-on-Dip, and Buy-on-Weakness
                patterns should be confirmed with additional due diligence before executing trades.
            </div>
        </div>
    );
};

export default SmartMoneyPanel;
