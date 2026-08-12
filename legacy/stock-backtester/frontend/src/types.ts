export interface BacktestSignal {
    signal: string;
    count: number;
    avg_5d: number;
    avg_20d: number;
    win_rate_20d: number;
}

export interface PredictionCross {
    trend: 'BULLISH' | 'BEARISH';
    status: 'Converging' | 'Diverging';
    days: number | null;
}

export interface Predictions {
    ma9_vs_ma21: PredictionCross;
    ma21_vs_ma50: PredictionCross;
    current_rsi: number;
    current_price: number;
}

export interface MAStatus {
    value_short: number;
    value_long: number;
    trend: 'BULLISH' | 'BEARISH';
    cross: string;
}

export interface OscillatorStatus {
    value: number;
    status: string;
}

export interface StochStatus {
    k: number;
    d: number;
    status: string;
}

export interface MACDStatus {
    line: number;
    signal: number;
    hist: number;
    status: string;
    cross: string;
}

export interface OverviewData {
    ma9_vs_ma21: MAStatus;
    ma21_vs_ma50: MAStatus;
    rsi: OscillatorStatus;
    stoch: StochStatus;
    macd: MACDStatus;
    conclusion: string;
    reasons: string[];
    prediction_ma9_21: PredictionCross;
    prediction_ma21_50: PredictionCross;
    current_price: number;
}

export interface AnalysisResponse {
    ticker: string;
    backtest_summary: BacktestSignal[];
    overview: OverviewData;
    historical_data: HistoricalDataPoint[];
    smart_money: SmartMoneyData;
    news_sentiment: NewsItem[];
    warning?: string;
}

export interface AnalysisError {
    error: string;
}

export interface HistoricalDataPoint {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    ma9: number | null;
    ma21: number | null;
    ma50: number | null;
    ma200: number | null;
    rsi: number | null;
    macd: number | null;
    macd_signal: number | null;
    macd_hist: number | null;
    stoch_k: number | null;
    stoch_d: number | null;
    cmf: number | null;
    nvi: number | null;
    nvi_ema: number | null;
    pvi: number | null;
    wyckoff_spring: boolean;
    buy_on_dip: boolean;
    buy_on_weakness: boolean;
}

export interface SmartMoneyData {
    cmf: number;
    cmf_signal: string;
    nvi: number;
    nvi_ema: number;
    nvi_signal: string;
    pvi: number;
    wyckoff_spring: boolean;
    buy_on_dip: boolean;
    buy_on_weakness: boolean;
}

export interface NewsItem {
    title: string;
    link: string;
    publisher: string;
    publish_time: number;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; // Based on SentimentPanel usage
    score: number;
}

export interface ScreenerResult {
    ticker: string;
    price: number;
    squeeze_score: number;
    ma_gap_pct: number;
    rsi: number;
    volume_ratio: number;
    signal_label: 'STRONG' | 'MODERATE' | 'WATCH';
    ma9: number;
    ma21: number;
    ma50: number;
}
