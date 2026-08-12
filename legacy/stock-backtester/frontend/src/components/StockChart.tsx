import { useEffect, useRef, useState } from 'react';
import {
    createChart,
    ColorType,
    CrosshairMode,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    createSeriesMarkers,
} from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import { HistoricalDataPoint } from '../types';

interface StockChartProps {
    data: HistoricalDataPoint[];
    ticker: string;
}

const StockChart: React.FC<StockChartProps> = ({ data, ticker }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [visibleSeries, setVisibleSeries] = useState({
        ma9: true,
        ma21: true,
        ma50: true,
        ma200: true,
        volume: true,
        cmf: true,
        nvi: true,
        signals: true,
    });
    const [showLegend, setShowLegend] = useState(true);
    const [showLabels, setShowLabels] = useState(true);

    useEffect(() => {
        if (!chartContainerRef.current || !data || data.length === 0) return;

        // Clean up old chart
        if (chartRef.current) {
            chartRef.current.remove();
            chartRef.current = null;
        }

        const container = chartContainerRef.current;

        const chart = createChart(container, {
            width: container.clientWidth,
            height: 820,
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#9ca3af',
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                fontSize: 12,
            },
            grid: {
                vertLines: { color: 'rgba(99, 102, 241, 0.06)' },
                horzLines: { color: 'rgba(99, 102, 241, 0.06)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: 'rgba(99, 102, 241, 0.4)',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: '#6366f1',
                },
                horzLine: {
                    color: 'rgba(99, 102, 241, 0.4)',
                    width: 1,
                    style: 2,
                    labelBackgroundColor: '#6366f1',
                },
            },
            rightPriceScale: {
                borderColor: 'rgba(99, 102, 241, 0.1)',
                scaleMargins: {
                    top: 0.05,
                    bottom: 0.50, // Main chart takes top ~45%
                },
            },
            timeScale: {
                borderColor: 'rgba(99, 102, 241, 0.1)',
                timeVisible: false,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            handleScroll: { vertTouchDrag: false },
        });

        chartRef.current = chart;

        // --- Candlestick Series ---
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#10b981',
            wickDownColor: '#ef4444',
            wickUpColor: '#10b981',
        });

        const candleData = data.map(d => ({
            time: d.date,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        }));
        candlestickSeries.setData(candleData as any);

        // --- Signal Markers (Wyckoff Spring, Buy on Dip, Buy on Weakness) ---
        if (visibleSeries.signals) {
            const markers: any[] = [];
            data.forEach(d => {
                if (d.wyckoff_spring) {
                    markers.push({
                        time: d.date,
                        position: 'belowBar',
                        color: '#10b981',
                        shape: 'arrowUp',
                        text: '🔩 Spring',
                        size: 1,
                    });
                } else if (d.buy_on_dip) {
                    markers.push({
                        time: d.date,
                        position: 'belowBar',
                        color: '#6366f1',
                        shape: 'arrowUp',
                        text: '🎯 Dip',
                        size: 1,
                    });
                } else if (d.buy_on_weakness) {
                    markers.push({
                        time: d.date,
                        position: 'belowBar',
                        color: '#a855f7',
                        shape: 'arrowUp',
                        text: '🧠 Weak',
                        size: 1,
                    });
                }
            });
            if (markers.length > 0) {
                createSeriesMarkers(candlestickSeries as any, markers);
            }
        }

        // --- Volume Series ---
        if (visibleSeries.volume) {
            const volumeSeries = chart.addSeries(HistogramSeries, {
                priceScaleId: 'volume',
                priceFormat: { type: 'volume' },
                priceLineVisible: false,
                lastValueVisible: false,
            });
            chart.priceScale('volume').applyOptions({
                scaleMargins: { top: 0.47, bottom: 0.50 },
            });
            const volumeData = data.map(d => ({
                time: d.date,
                value: d.volume,
                color: d.close >= d.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
            }));
            volumeSeries.setData(volumeData as any);
        }

        // --- MA Line Series ---
        const addMaSeries = (field: 'ma9' | 'ma21' | 'ma50' | 'ma200', color: string, title: string) => {
            if (!visibleSeries[field]) return null;
            const series = chart.addSeries(LineSeries, {
                color,
                lineWidth: 1,
                title,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            const maData = data
                .filter(d => d[field] !== null)
                .map(d => ({ time: d.date, value: d[field] as number }));
            series.setData(maData as any);
            return series;
        };

        addMaSeries('ma9', '#10b981', 'EMA 9');
        addMaSeries('ma21', '#f59e0b', 'EMA 21');
        addMaSeries('ma50', '#ef4444', 'EMA 50');
        addMaSeries('ma200', '#3b82f6', 'EMA 200');

        // --- RSI Panel (0.53 to 0.64) ---
        const rsiSeries = chart.addSeries(LineSeries, {
            color: '#818cf8', lineWidth: 1, priceScaleId: 'rsi', title: 'RSI'
        });
        chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.53, bottom: 0.36 }
        });
        rsiSeries.setData(data.filter(d => d.rsi !== null).map(d => ({ time: d.date, value: d.rsi! })) as any);

        const staticTimeData = data.map(d => ({ time: d.date }));
        const rsiUpper = chart.addSeries(LineSeries, {
            color: 'rgba(239, 68, 68, 0.5)', lineWidth: 1, lineStyle: 2, priceScaleId: 'rsi', title: '70'
        });
        const rsiLower = chart.addSeries(LineSeries, {
            color: 'rgba(16, 185, 129, 0.5)', lineWidth: 1, lineStyle: 2, priceScaleId: 'rsi', title: '30'
        });
        rsiUpper.setData(staticTimeData.map(d => ({ ...d, value: 70 })) as any);
        rsiLower.setData(staticTimeData.map(d => ({ ...d, value: 30 })) as any);

        // --- MACD Panel (0.65 to 0.76) ---
        const macdLine = chart.addSeries(LineSeries, {
            color: '#3b82f6', lineWidth: 1, priceScaleId: 'macd', title: 'MACD'
        });
        const macdSignal = chart.addSeries(LineSeries, {
            color: '#f59e0b', lineWidth: 1, priceScaleId: 'macd', title: 'Signal'
        });
        const macdHist = chart.addSeries(HistogramSeries, {
            priceScaleId: 'macd', title: 'Hist'
        });
        chart.priceScale('macd').applyOptions({
            scaleMargins: { top: 0.65, bottom: 0.24 }
        });
        macdLine.setData(data.filter(d => d.macd !== null).map(d => ({ time: d.date, value: d.macd! })) as any);
        macdSignal.setData(data.filter(d => d.macd_signal !== null).map(d => ({ time: d.date, value: d.macd_signal! })) as any);
        macdHist.setData(data.filter(d => d.macd_hist !== null).map(d => ({
            time: d.date, value: d.macd_hist!,
            color: d.macd_hist! >= 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
        })) as any);

        // --- Stochastic Panel (0.77 to 0.86) ---
        const stochK = chart.addSeries(LineSeries, {
            color: '#3b82f6', lineWidth: 1, priceScaleId: 'stoch', title: '%K'
        });
        const stochD = chart.addSeries(LineSeries, {
            color: '#f59e0b', lineWidth: 1, priceScaleId: 'stoch', title: '%D'
        });
        chart.priceScale('stoch').applyOptions({
            scaleMargins: { top: 0.77, bottom: 0.14 }
        });
        stochK.setData(data.filter(d => d.stoch_k !== null).map(d => ({ time: d.date, value: d.stoch_k! })) as any);
        stochD.setData(data.filter(d => d.stoch_d !== null).map(d => ({ time: d.date, value: d.stoch_d! })) as any);
        const stochUpper = chart.addSeries(LineSeries, {
            color: 'rgba(239, 68, 68, 0.4)', lineWidth: 1, lineStyle: 2, priceScaleId: 'stoch', title: '80'
        });
        const stochLower = chart.addSeries(LineSeries, {
            color: 'rgba(16, 185, 129, 0.4)', lineWidth: 1, lineStyle: 2, priceScaleId: 'stoch', title: '20'
        });
        stochUpper.setData(staticTimeData.map(d => ({ ...d, value: 80 })) as any);
        stochLower.setData(staticTimeData.map(d => ({ ...d, value: 20 })) as any);

        // --- CMF Panel (0.87 to 0.93) ---
        let cmfSeries: any = null;
        if (visibleSeries.cmf) {
            cmfSeries = chart.addSeries(HistogramSeries, {
                priceScaleId: 'cmf',
                priceLineVisible: false,
                lastValueVisible: false,
                title: 'CMF',
            });
            chart.priceScale('cmf').applyOptions({
                scaleMargins: { top: 0.87, bottom: 0.07 }
            });
            const cmfData = data
                .filter(d => d.cmf !== null)
                .map(d => ({
                    time: d.date,
                    value: d.cmf!,
                    color: d.cmf! > 0.05
                        ? 'rgba(16, 185, 129, 0.7)'
                        : d.cmf! < -0.05
                            ? 'rgba(239, 68, 68, 0.7)'
                            : 'rgba(156, 163, 175, 0.5)',
                }));
            cmfSeries.setData(cmfData as any);

            // CMF zero line
            const cmfZero = chart.addSeries(LineSeries, {
                color: 'rgba(156, 163, 175, 0.3)', lineWidth: 1, lineStyle: 2,
                priceScaleId: 'cmf', lastValueVisible: false, priceLineVisible: false,
            });
            cmfZero.setData(staticTimeData.map(d => ({ ...d, value: 0 })) as any);
        }

        // --- NVI Panel (0.93 to 1.00) ---
        let nviLineSeries: any = null;
        if (visibleSeries.nvi) {
            nviLineSeries = chart.addSeries(LineSeries, {
                color: '#a855f7', lineWidth: 1, priceScaleId: 'nvi', title: 'NVI',
                priceLineVisible: false, lastValueVisible: false,
            });
            const nviEmaSeries = chart.addSeries(LineSeries, {
                color: 'rgba(168, 85, 247, 0.4)', lineWidth: 1, lineStyle: 2,
                priceScaleId: 'nvi', title: 'NVI EMA',
                priceLineVisible: false, lastValueVisible: false,
            });
            chart.priceScale('nvi').applyOptions({
                scaleMargins: { top: 0.93, bottom: 0 }
            });
            nviLineSeries.setData(
                data.filter(d => d.nvi !== null).map(d => ({ time: d.date, value: d.nvi! })) as any
            );
            nviEmaSeries.setData(
                data.filter(d => d.nvi_ema !== null).map(d => ({ time: d.date, value: d.nvi_ema! })) as any
            );
        }

        // --- Crosshair Tooltip ---
        const tooltip = tooltipRef.current;
        if (tooltip) {
            chart.subscribeCrosshairMove((param) => {
                if (!showLabels || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
                    tooltip.style.display = 'none';
                    return;
                }

                const candlePrice = param.seriesData.get(candlestickSeries) as any;
                const volumeVal = visibleSeries.volume
                    ? data.find(d => d.date === param.time)?.volume
                    : undefined;

                const rsiVal = param.seriesData.get(rsiSeries) as any;
                const macdVal = param.seriesData.get(macdLine) as any;
                const stochKVal = param.seriesData.get(stochK) as any;
                const cmfVal = cmfSeries ? param.seriesData.get(cmfSeries) as any : null;

                if (!candlePrice) {
                    tooltip.style.display = 'none';
                    return;
                }

                // Check for active signals on hovered bar
                const barData = data.find(d => d.date === param.time);
                let signalBadge = '';
                if (barData?.wyckoff_spring) signalBadge = '<span style="color:#10b981;font-size:11px;">🔩 Wyckoff Spring</span>';
                else if (barData?.buy_on_dip) signalBadge = '<span style="color:#6366f1;font-size:11px;">🎯 Buy on Dip</span>';
                else if (barData?.buy_on_weakness) signalBadge = '<span style="color:#a855f7;font-size:11px;">🧠 Buy on Weakness</span>';

                tooltip.style.display = 'block';

                const changePercent = ((candlePrice.close - candlePrice.open) / candlePrice.open * 100).toFixed(2);
                const changeSign = candlePrice.close >= candlePrice.open ? '+' : '';
                const changeColor = candlePrice.close >= candlePrice.open ? '#10b981' : '#ef4444';

                const cmfColor = cmfVal
                    ? cmfVal.value > 0.05 ? '#10b981' : cmfVal.value < -0.05 ? '#ef4444' : '#9ca3af'
                    : '#9ca3af';

                tooltip.innerHTML = `
                    <div style="font-weight:600;margin-bottom:4px;color:#e8eaf0;">${param.time}</div>
                    ${signalBadge ? `<div style="margin-bottom:4px;">${signalBadge}</div>` : ''}
                    <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12px;">
                        <span style="color:#9ca3af;">O</span><span style="color:#e8eaf0;">${candlePrice.open.toLocaleString()}</span>
                        <span style="color:#9ca3af;">H</span><span style="color:#e8eaf0;">${candlePrice.high.toLocaleString()}</span>
                        <span style="color:#9ca3af;">L</span><span style="color:#e8eaf0;">${candlePrice.low.toLocaleString()}</span>
                        <span style="color:#9ca3af;">C</span><span style="color:${changeColor};">${candlePrice.close.toLocaleString()}</span>
                        <span style="color:#9ca3af;">Chg</span><span style="color:${changeColor};">${changeSign}${changePercent}%</span>
                        ${volumeVal ? `<span style="color:#9ca3af;">Vol</span><span style="color:#e8eaf0;">${Math.round(volumeVal).toLocaleString()}</span>` : ''}
                        ${rsiVal ? `<span style="color:#818cf8;">RSI</span><span style="color:#e8eaf0;">${rsiVal.value.toFixed(1)}</span>` : ''}
                        ${macdVal ? `<span style="color:#3b82f6;">MACD</span><span style="color:#e8eaf0;">${macdVal.value.toFixed(2)}</span>` : ''}
                        ${stochKVal ? `<span style="color:#f59e0b;">Stoch</span><span style="color:#e8eaf0;">${stochKVal.value.toFixed(1)}</span>` : ''}
                        ${cmfVal ? `<span style="color:${cmfColor};">CMF</span><span style="color:${cmfColor};">${cmfVal.value.toFixed(3)}</span>` : ''}
                    </div>
                `;
            });
        }

        chart.timeScale().fitContent();

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width } = entry.contentRect;
                chart.applyOptions({ width });
            }
        });
        resizeObserver.observe(container);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
        };
    }, [data, visibleSeries, showLabels]);

    if (!data || data.length === 0) return null;

    const lastPoint = data[data.length - 1];
    const prevPoint = data.length > 1 ? data[data.length - 2] : lastPoint;
    const priceChange = lastPoint.close - prevPoint.close;
    const priceChangePercent = (priceChange / prevPoint.close) * 100;
    const isPositive = priceChange >= 0;

    // Count active signals in the full dataset
    const signalCounts = data.reduce((acc, d) => {
        if (d.wyckoff_spring) acc.wyckoff++;
        if (d.buy_on_dip) acc.dip++;
        if (d.buy_on_weakness) acc.weakness++;
        return acc;
    }, { wyckoff: 0, dip: 0, weakness: 0 });

    const hasAnySignal = signalCounts.wyckoff > 0 || signalCounts.dip > 0 || signalCounts.weakness > 0;

    // Last CMF reading
    const lastCmf = [...data].reverse().find(d => d.cmf !== null)?.cmf ?? null;
    const cmfSignal = lastCmf !== null
        ? lastCmf > 0.05 ? 'Accumulation' : lastCmf < -0.05 ? 'Distribution' : 'Neutral'
        : null;

    return (
        <div className="card slide-in-up" style={{ animationDelay: '0.1s', padding: 0, overflow: 'hidden' }}>
            {/* Chart Header */}
            <div style={{
                padding: 'var(--spacing-lg) var(--spacing-xl)',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 'var(--spacing-md)',
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: '4px' }}>
                        <h3 style={{ margin: 0 }}>{ticker}</h3>
                        <span style={{
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: isPositive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isPositive ? '#10b981' : '#ef4444',
                        }}>
                            {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
                        </span>
                        {/* CMF live badge */}
                        {cmfSignal && (
                            <span style={{
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                background: cmfSignal === 'Accumulation'
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : cmfSignal === 'Distribution'
                                        ? 'rgba(239, 68, 68, 0.15)'
                                        : 'rgba(156, 163, 175, 0.15)',
                                color: cmfSignal === 'Accumulation'
                                    ? '#10b981'
                                    : cmfSignal === 'Distribution'
                                        ? '#ef4444'
                                        : '#9ca3af',
                            }}>
                                CMF: {cmfSignal}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {lastPoint.close.toLocaleString()}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', fontSize: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        onClick={() => {
                            const allVisible = visibleSeries.ma9 && visibleSeries.ma21 && visibleSeries.ma50 && visibleSeries.ma200;
                            setVisibleSeries(prev => ({
                                ...prev,
                                ma9: !allVisible, ma21: !allVisible, ma50: !allVisible, ma200: !allVisible
                            }));
                        }}
                        style={{
                            background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)',
                            color: 'var(--text-muted)', padding: '4px 8px', borderRadius: '4px',
                            cursor: 'pointer', fontSize: '0.75rem',
                        }}
                    >
                        {visibleSeries.ma9 || visibleSeries.ma21 || visibleSeries.ma50 || visibleSeries.ma200 ? 'Hide EMAs' : 'Show EMAs'}
                    </button>
                    <button
                        onClick={() => setShowLegend(!showLegend)}
                        style={{
                            background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)',
                            color: 'var(--text-muted)', padding: '4px 8px', borderRadius: '4px',
                            cursor: 'pointer', fontSize: '0.75rem',
                        }}
                    >
                        {showLegend ? 'Hide Legend' : 'Show Legend'}
                    </button>
                    <button
                        onClick={() => setShowLabels(!showLabels)}
                        style={{
                            background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)',
                            color: 'var(--text-muted)', padding: '4px 8px', borderRadius: '4px',
                            cursor: 'pointer', fontSize: '0.75rem',
                        }}
                    >
                        {showLabels ? 'Hide Labels' : 'Show Labels'}
                    </button>
                </div>
            </div>

            {/* SMC Signal Summary Bar */}
            {hasAnySignal && (
                <div style={{
                    padding: '8px var(--spacing-xl)',
                    background: 'rgba(99, 102, 241, 0.05)',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-lg)',
                    flexWrap: 'wrap',
                    fontSize: '0.8rem',
                }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>🏦 SMC Signals in Period:</span>
                    {signalCounts.wyckoff > 0 && (
                        <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            🔩 Wyckoff Spring <strong>×{signalCounts.wyckoff}</strong>
                        </span>
                    )}
                    {signalCounts.dip > 0 && (
                        <span style={{ color: '#6366f1', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            🎯 Buy on Dip <strong>×{signalCounts.dip}</strong>
                        </span>
                    )}
                    {signalCounts.weakness > 0 && (
                        <span style={{ color: '#a855f7', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            🧠 Buy on Weakness <strong>×{signalCounts.weakness}</strong>
                        </span>
                    )}
                </div>
            )}

            {/* Chart Body */}
            <div style={{ position: 'relative', padding: 'var(--spacing-sm) 0' }}>
                {/* Floating Tooltip */}
                <div
                    ref={tooltipRef}
                    style={{
                        display: 'none',
                        position: 'absolute',
                        top: '12px',
                        left: '12px',
                        zIndex: 10,
                        background: 'rgba(19, 24, 36, 0.92)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(99, 102, 241, 0.2)',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        fontSize: '13px',
                        pointerEvents: 'none',
                        lineHeight: 1.5,
                    }}
                />

                {/* Panel Labels overlay */}
                <div style={{
                    position: 'absolute',
                    right: '68px',
                    top: 0,
                    bottom: 0,
                    pointerEvents: 'none',
                    zIndex: 5,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%' }}>
                        <div style={{ flex: '0 0 53%' }} /> {/* main chart space */}
                        <div style={{ flex: '0 0 11%', display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.65rem', color: 'rgba(129, 140, 248, 0.6)', fontWeight: 600 }}>RSI</span>
                        </div>
                        <div style={{ flex: '0 0 11%', display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.65rem', color: 'rgba(59, 130, 246, 0.6)', fontWeight: 600 }}>MACD</span>
                        </div>
                        <div style={{ flex: '0 0 9%', display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.65rem', color: 'rgba(245, 158, 11, 0.6)', fontWeight: 600 }}>STOCH</span>
                        </div>
                        <div style={{ flex: '0 0 6%', display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.65rem', color: 'rgba(16, 185, 129, 0.6)', fontWeight: 600 }}>CMF</span>
                        </div>
                        <div style={{ flex: '0 0 7%', display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.65rem', color: 'rgba(168, 85, 247, 0.6)', fontWeight: 600 }}>NVI</span>
                        </div>
                    </div>
                </div>

                <div ref={chartContainerRef} style={{ width: '100%' }} />
            </div>

            {/* Legend */}
            {showLegend && (
                <div style={{
                    padding: 'var(--spacing-sm) var(--spacing-xl) var(--spacing-lg)',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    gap: 'var(--spacing-md)',
                    flexWrap: 'wrap',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    alignItems: 'center',
                }}>
                    {/* Candles */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 14, height: 14, borderRadius: 2, background: 'linear-gradient(135deg, #10b981 50%, #ef4444 50%)' }} />
                        <span>Candle</span>
                    </div>

                    {/* EMA Toggles */}
                    {(['ma9', 'ma21', 'ma50', 'ma200'] as const).map((ma, idx) => {
                        const colors = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6'];
                        const labels = ['EMA 9', 'EMA 21', 'EMA 50', 'EMA 200'];
                        return (
                            <div
                                key={ma}
                                onClick={() => setVisibleSeries(prev => ({ ...prev, [ma]: !prev[ma] }))}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                                    opacity: visibleSeries[ma] ? 1 : 0.4, transition: 'opacity 0.2s', userSelect: 'none'
                                }}
                                title={`Toggle ${labels[idx]}`}
                            >
                                <div style={{ width: 18, height: 2, background: colors[idx], borderRadius: 2 }} />
                                <span>{labels[idx]}</span>
                            </div>
                        );
                    })}

                    {/* Volume */}
                    <div
                        onClick={() => setVisibleSeries(prev => ({ ...prev, volume: !prev.volume }))}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                            opacity: visibleSeries.volume ? 1 : 0.4, transition: 'opacity 0.2s', userSelect: 'none'
                        }}
                        title="Toggle Volume"
                    >
                        <div style={{ width: 18, height: 2, background: '#9ca3af', borderRadius: 2 }} />
                        <span>Volume</span>
                    </div>

                    {/* Separator */}
                    <div style={{ width: '1px', height: '14px', background: 'var(--border-color)' }} />

                    {/* CMF Toggle */}
                    <div
                        onClick={() => setVisibleSeries(prev => ({ ...prev, cmf: !prev.cmf }))}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                            opacity: visibleSeries.cmf ? 1 : 0.4, transition: 'opacity 0.2s', userSelect: 'none'
                        }}
                        title="Toggle CMF Panel"
                    >
                        <div style={{
                            width: 14, height: 10, borderRadius: 2,
                            background: 'linear-gradient(90deg, rgba(239,68,68,0.7), rgba(16,185,129,0.7))'
                        }} />
                        <span>CMF</span>
                    </div>

                    {/* NVI Toggle */}
                    <div
                        onClick={() => setVisibleSeries(prev => ({ ...prev, nvi: !prev.nvi }))}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                            opacity: visibleSeries.nvi ? 1 : 0.4, transition: 'opacity 0.2s', userSelect: 'none'
                        }}
                        title="Toggle NVI Panel"
                    >
                        <div style={{ width: 18, height: 2, background: '#a855f7', borderRadius: 2 }} />
                        <span>NVI</span>
                    </div>

                    {/* Signal Markers Toggle */}
                    <div
                        onClick={() => setVisibleSeries(prev => ({ ...prev, signals: !prev.signals }))}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                            opacity: visibleSeries.signals ? 1 : 0.4, transition: 'opacity 0.2s', userSelect: 'none'
                        }}
                        title="Toggle SMC Signal Markers"
                    >
                        <span style={{ fontSize: '0.8rem' }}>▲</span>
                        <span>SMC Signals</span>
                    </div>

                    {/* Signal legend key */}
                    {visibleSeries.signals && (
                        <>
                            <span style={{ color: '#10b981', fontSize: '0.75rem' }}>🔩 Spring</span>
                            <span style={{ color: '#6366f1', fontSize: '0.75rem' }}>🎯 Dip</span>
                            <span style={{ color: '#a855f7', fontSize: '0.75rem' }}>🧠 Weakness</span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default StockChart;
