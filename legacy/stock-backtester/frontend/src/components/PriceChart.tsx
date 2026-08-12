import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { HistoricalDataPoint } from '../types';

interface PriceChartProps {
    data: HistoricalDataPoint[];
    ticker: string;
}

const PriceChart: React.FC<PriceChartProps> = ({ data, ticker }) => {
    if (!data || data.length === 0) {
        return null;
    }

    // Custom tooltip
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    background: 'var(--bg-card)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--spacing-md)',
                    boxShadow: 'var(--shadow-lg)'
                }}>
                    <p style={{ margin: 0, marginBottom: 'var(--spacing-sm)', fontWeight: '600' }}>
                        {payload[0].payload.date}
                    </p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} style={{
                            color: entry.color,
                            fontSize: '0.875rem',
                            marginBottom: '0.25rem'
                        }}>
                            <strong>{entry.name}:</strong> {entry.value?.toFixed(2)}
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="card slide-in-up" style={{ animationDelay: '0.2s' }}>
            <h3 className="mb-3">📈 {ticker} — Price & Moving Averages</h3>
            <p className="text-secondary mb-4">
                Historical price action with technical indicators (Last 60 days)
            </p>

            <ResponsiveContainer width="100%" height={400}>
                <LineChart
                    data={data}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                    <defs>
                        <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(99, 102, 241, 0.1)" />
                    <XAxis
                        dataKey="date"
                        stroke="var(--text-muted)"
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        tickFormatter={(value) => {
                            const date = new Date(value);
                            return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                    />
                    <YAxis
                        stroke="var(--text-muted)"
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        domain={['auto', 'auto']}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                        wrapperStyle={{
                            paddingTop: '20px',
                            fontSize: '14px'
                        }}
                        iconType="line"
                    />

                    <Line
                        type="monotone"
                        dataKey="close"
                        stroke="#6366f1"
                        strokeWidth={2.5}
                        name="Close"
                        dot={false}
                        activeDot={{ r: 6, fill: '#6366f1' }}
                    />
                    <Line
                        type="monotone"
                        dataKey="ma9"
                        stroke="#10b981"
                        strokeWidth={2}
                        name="MA 9"
                        dot={false}
                        strokeDasharray="5 5"
                    />
                    <Line
                        type="monotone"
                        dataKey="ma21"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        name="MA 21"
                        dot={false}
                        strokeDasharray="5 5"
                    />
                    <Line
                        type="monotone"
                        dataKey="ma50"
                        stroke="#ef4444"
                        strokeWidth={2}
                        name="MA 50"
                        dot={false}
                        strokeDasharray="5 5"
                    />
                </LineChart>
            </ResponsiveContainer>

            <div className="mt-3 flex gap-3 flex-wrap" style={{ fontSize: '0.875rem' }}>
                <div className="flex items-center gap-2">
                    <div style={{ width: '20px', height: '3px', background: '#6366f1', borderRadius: '2px' }}></div>
                    <span className="text-secondary">Closing Price</span>
                </div>
                <div className="flex items-center gap-2">
                    <div style={{ width: '20px', height: '2px', background: '#10b981', borderRadius: '2px', backgroundImage: 'linear-gradient(to right, #10b981 50%, transparent 50%)', backgroundSize: '8px 2px' }}></div>
                    <span className="text-secondary">9-Day EMA</span>
                </div>
                <div className="flex items-center gap-2">
                    <div style={{ width: '20px', height: '2px', background: '#f59e0b', borderRadius: '2px', backgroundImage: 'linear-gradient(to right, #f59e0b 50%, transparent 50%)', backgroundSize: '8px 2px' }}></div>
                    <span className="text-secondary">21-Day EMA</span>
                </div>
                <div className="flex items-center gap-2">
                    <div style={{ width: '20px', height: '2px', background: '#ef4444', borderRadius: '2px', backgroundImage: 'linear-gradient(to right, #ef4444 50%, transparent 50%)', backgroundSize: '8px 2px' }}></div>
                    <span className="text-secondary">50-Day EMA</span>
                </div>
            </div>
        </div>
    );
};

export default PriceChart;
