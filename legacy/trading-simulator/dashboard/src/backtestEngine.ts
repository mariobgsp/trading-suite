import { calculateMACD, calculateRSI, calculateStochasticFull, calculateSMA, calculateATR } from './indicators';
import type { OHLCV } from './indicators';

export interface TestResult {
  name: string;
  trades: number;
  winRate: number;
  totalReturn: number;
  equityCurve: { time: string; value: number }[];
}

export function simulateBacktest(
  name: string,
  stockData: OHLCV[],
  getSignal: (i: number) => 'BUY' | 'SELL' | null
): TestResult {
  const STOP_LOSS_PCT = 0.05;
  const TRAILING_STOP_PCT = 0.10;

  let equity = 10000;
  let position = 0;
  let entryPrice = 0;
  let highestPrice = 0;
  let wins = 0;
  let losses = 0;

  const equityCurve: { time: string; value: number }[] = [];

  for (let i = 0; i < stockData.length; i++) {
    const current = stockData[i];

    if (position > 0) {
      // Update trailing high water mark
      if (current.high > highestPrice) highestPrice = current.high;

      let trigger: string | null = null;
      let sellPrice = current.close;

      // Fixed stop loss (5%)
      if (current.low <= entryPrice * (1 - STOP_LOSS_PCT)) {
        trigger = 'StopLoss';
        sellPrice = entryPrice * (1 - STOP_LOSS_PCT);
      }
      // Trailing stop (10%) — only once we're above entry
      else if (highestPrice > entryPrice && current.low <= highestPrice * (1 - TRAILING_STOP_PCT)) {
        trigger = 'TrailingStop';
        sellPrice = highestPrice * (1 - TRAILING_STOP_PCT);
      }
      // Sell signal
      else if (getSignal(i) === 'SELL') {
        trigger = 'Signal';
        sellPrice = current.close;
      }

      if (trigger) {
        equity = position * sellPrice;
        if (sellPrice > entryPrice) wins++; else losses++;
        position = 0;
        entryPrice = 0;
        highestPrice = 0;
      }
    } else {
      if (getSignal(i) === 'BUY') {
        position = equity / current.close;
        entryPrice = current.close;
        highestPrice = current.close;
      }
    }

    const currentEquity = position > 0 ? position * current.close : equity;
    equityCurve.push({ time: current.time, value: currentEquity });
  }

  // Close any open position at the end of the period
  if (position > 0) {
    const finalPrice = stockData[stockData.length - 1].close;
    equity = position * finalPrice;
    if (finalPrice > entryPrice) wins++; else losses++;
  }

  const totalTrades = wins + losses;
  return {
    name,
    trades: totalTrades,
    winRate: totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0,
    totalReturn: Math.round(((equity - 10000) / 10000) * 100),
    equityCurve,
  };
}

export function calculateJCIResilience(stockData: OHLCV[], jciData: OHLCV[]): number | null {
  if (jciData.length === 0 || stockData.length === 0) return null;

  let jciDownDays = 0;
  let stockHeldDays = 0;

  const jciMap = new Map(jciData.map((d) => [d.time, d]));

  for (let i = 1; i < stockData.length; i++) {
    const today = stockData[i];
    const yesterday = stockData[i - 1];
    const jciToday = jciMap.get(today.time);

    if (jciToday) {
      const jciIndex = jciData.findIndex((d) => d.time === today.time);
      if (jciIndex > 0) {
        const jciYesterday = jciData[jciIndex - 1];
        if (jciYesterday && jciToday.close < jciYesterday.close) {
          jciDownDays++;
          if (today.close >= yesterday.close) {
            stockHeldDays++;
          }
        }
      }
    }
  }

  if (jciDownDays === 0) return null;
  return Math.round((stockHeldDays / jciDownDays) * 100);
}

/**
 * MACD Crossover signal generator.
 * BUY:  MACD line crosses above Signal line (bullish crossover)
 * SELL: MACD line crosses below Signal line (bearish crossover)
 */
export function getMACDSignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const macdData = calculateMACD(stockData);
  return (i: number) => {
    if (i < 1 || i >= macdData.length) return null;
    const prev = macdData[i - 1];
    const curr = macdData[i];
    if (prev.macd <= prev.signal && curr.macd > curr.signal) return 'BUY';
    if (prev.macd >= prev.signal && curr.macd < curr.signal) return 'SELL';
    return null;
  };
}

/**
 * RSI 30/70 signal generator.
 * BUY:  RSI crosses above 30 (oversold recovery)
 * SELL: RSI crosses below 70 (overbought reversal)
 */
export function getRSISignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const rsiData = calculateRSI(stockData, 14);
  const rsiMap = new Map(rsiData.map(d => [d.time, d.value]));
  return (i: number) => {
    if (i < 1) return null;
    const prevRSI = rsiMap.get(stockData[i - 1].time) ?? null;
    const currRSI = rsiMap.get(stockData[i].time) ?? null;
    if (prevRSI === null || currRSI === null) return null;
    if (prevRSI <= 30 && currRSI > 30) return 'BUY';
    if (prevRSI >= 70 && currRSI < 70) return 'SELL';
    return null;
  };
}

/**
 * Stochastic %K/%D crossover signal generator.
 * BUY:  %K crosses above %D when both < 20 (oversold zone)
 * SELL: %K crosses below %D when both > 80 (overbought zone)
 */
export function getStochasticSignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const stochData = calculateStochasticFull(stockData, 14, 3, 3);
  const stochMap = new Map(stochData.map(d => [d.time, d]));
  return (i: number) => {
    if (i < 1) return null;
    const prev = stochMap.get(stockData[i - 1].time) ?? null;
    const curr = stochMap.get(stockData[i].time) ?? null;
    if (!prev || !curr) return null;
    if (prev.k <= prev.d && curr.k > curr.d && curr.d < 20) return 'BUY';
    if (prev.k >= prev.d && curr.k < curr.d && curr.d > 80) return 'SELL';
    return null;
  };
}

/**
 * Compute a Buy & Hold equity curve starting at 10000.
 * Represents simply owning the stock for the entire period.
 */
export function getBuyHoldCurve(stockData: OHLCV[]): { time: string; value: number }[] {
  if (stockData.length === 0) return [];
  const startPrice = stockData[0].close;
  if (startPrice === 0) return [];
  return stockData.map(d => ({
    time: d.time,
    value: 10000 * (d.close / startPrice),
  }));
}

/**
 * FVG (Fair Value Gap) signal generator.
 * Bullish FVG: gap forms between candle[i-2].high and candle[i-1].low.
 * BUY when price pulls back into the gap zone.
 * SELL on RSI > 70 crossdown.
 */
export function getFVGSignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const rsiData = calculateRSI(stockData, 14);
  const rsiMap = new Map(rsiData.map(d => [d.time, d.value]));

  return (i: number) => {
    if (i < 3) return null;

    // Bullish FVG existed one bar ago: gap between [i-2].high and [i-1].low
    const fvgZoneTop = stockData[i - 1].low;
    const fvgZoneBot = stockData[i - 2].high;
    const fvgExists = fvgZoneBot < fvgZoneTop;

    // Pullback: current candle dips into gap but close stays above gap bottom
    const inGap =
      fvgExists &&
      stockData[i].low <= fvgZoneTop &&
      stockData[i].close >= fvgZoneBot;

    if (inGap) return 'BUY';

    // Exit: RSI crosses below 70
    const prevRSI = rsiMap.get(stockData[i - 1].time) ?? null;
    const currRSI = rsiMap.get(stockData[i].time) ?? null;
    if (prevRSI !== null && currRSI !== null && prevRSI >= 70 && currRSI < 70) return 'SELL';

    return null;
  };
}

/**
 * Support Buy (Buy the Dip) signal generator.
 * BUY: price touches 20-bar low while 20-bar SMA is still rising.
 * SELL: trailing stop handles the exit (no explicit sell signal needed).
 */
export function getSupportBuySignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const LOOKBACK = 20;
  const smaData = calculateSMA(stockData, LOOKBACK);
  const smaMap = new Map(smaData.map(d => [d.time, d.value]));

  return (i: number) => {
    if (i < LOOKBACK + 5) return null;

    const window = stockData.slice(i - LOOKBACK, i);
    const lowestLow = Math.min(...window.map(d => d.low));

    const smaNow = smaMap.get(stockData[i].time) ?? null;
    const smaOld = smaMap.get(stockData[i - 5].time) ?? null;
    const smaRising = smaNow !== null && smaOld !== null && smaNow > smaOld;

    // Touch the 20-bar low with 0.5% tolerance, SMA must be rising
    if (stockData[i].close <= lowestLow * 1.005 && smaRising) return 'BUY';

    return null;
  };
}

/**
 * Breakout signal generator.
 * BUY: close breaks above 20-bar high with volume > 1.3× average and ATR margin.
 * SELL: close falls back 2% below the breakout level, or RSI < 75 crossdown.
 */
export function getBreakoutSignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const LOOKBACK = 20;
  const atrData = calculateATR(stockData, 14);
  const atrMap = new Map(atrData.map(d => [d.time, d.value]));
  const rsiData = calculateRSI(stockData, 14);
  const rsiMap = new Map(rsiData.map(d => [d.time, d.value]));

  let breakoutLevel = 0;

  return (i: number) => {
    if (i < LOOKBACK + 1) return null;

    const window = stockData.slice(i - LOOKBACK, i);
    const highestHigh = Math.max(...window.map(d => d.high));
    const avgVol = window.reduce((s, d) => s + d.value, 0) / LOOKBACK;
    const atr = atrMap.get(stockData[i].time) ?? null;

    if (
      atr !== null &&
      stockData[i].close > highestHigh + 0.3 * atr &&
      stockData[i].value > avgVol * 1.3
    ) {
      breakoutLevel = highestHigh;
      return 'BUY';
    }

    if (breakoutLevel > 0 && stockData[i].close < breakoutLevel * 0.98) {
      breakoutLevel = 0;
      return 'SELL';
    }

    const prevRSI = rsiMap.get(stockData[i - 1].time) ?? null;
    const currRSI = rsiMap.get(stockData[i].time) ?? null;
    if (prevRSI !== null && currRSI !== null && prevRSI >= 75 && currRSI < 75) return 'SELL';

    return null;
  };
}

/**
 * Pearson Correlation Coefficient between stock and JCI daily log-returns.
 * Returns r in [-1, 1], an interpretation string, and whether stock is under JCI pressure.
 */
export function calculatePearsonCorrelation(
  stockData: OHLCV[],
  jciData: OHLCV[]
): { r: number; interpretation: string; underPressure: boolean } | null {
  if (stockData.length < 30 || jciData.length < 30) return null;

  const jciMap = new Map(jciData.map(d => [d.time, d]));
  const stockReturns: number[] = [];
  const jciReturns: number[] = [];

  for (let i = 1; i < stockData.length; i++) {
    const jciToday = jciMap.get(stockData[i].time);
    const jciYest = jciMap.get(stockData[i - 1].time);
    if (!jciToday || !jciYest || jciYest.close === 0 || stockData[i - 1].close === 0) continue;
    stockReturns.push(Math.log(stockData[i].close / stockData[i - 1].close));
    jciReturns.push(Math.log(jciToday.close / jciYest.close));
  }

  const n = stockReturns.length;
  if (n < 20) return null;

  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const stockMean = mean(stockReturns);
  const jciMean = mean(jciReturns);

  let numerator = 0, stockVar = 0, jciVar = 0;
  for (let i = 0; i < n; i++) {
    const ds = stockReturns[i] - stockMean;
    const dj = jciReturns[i] - jciMean;
    numerator += ds * dj;
    stockVar += ds * ds;
    jciVar += dj * dj;
  }

  const denom = Math.sqrt(stockVar * jciVar);
  if (denom === 0) return null;

  const r = parseFloat((numerator / denom).toFixed(3));

  let interpretation: string;
  let underPressure: boolean;

  if (r >= 0.7) {
    interpretation = 'Strongly correlated — moves in lockstep with JCI';
    underPressure = true;
  } else if (r >= 0.4) {
    interpretation = 'Moderately correlated — partially follows JCI trends';
    underPressure = true;
  } else if (r >= 0.1) {
    interpretation = 'Weakly correlated — mostly independent of JCI';
    underPressure = false;
  } else if (r >= -0.1) {
    interpretation = 'Uncorrelated — moves independently from JCI';
    underPressure = false;
  } else if (r >= -0.4) {
    interpretation = 'Weakly inverse — slight tendency to move opposite JCI';
    underPressure = false;
  } else {
    interpretation = 'Strongly inverse — defensive stock, rises when JCI falls';
    underPressure = false;
  }

  return { r, interpretation, underPressure };
}

/**
 * Trend Following signal generator ("let profit run, cut loss fast").
 * BUY: 20-day SMA crosses above 50-day SMA AND volume > 1.3x average volume.
 * SELL: 20-day SMA crosses below 50-day SMA.
 * The engine's built-in 5% SL and 10% trailing stop will handle the "cut loss fast" and "let profit run" mechanics.
 */
export function getTrendFollowSignal(stockData: OHLCV[]): (i: number) => 'BUY' | 'SELL' | null {
  const SMA_FAST = 20;
  const SMA_SLOW = 50;
  const fastSmaData = calculateSMA(stockData, SMA_FAST);
  const slowSmaData = calculateSMA(stockData, SMA_SLOW);
  
  const fastMap = new Map(fastSmaData.map(d => [d.time, d.value]));
  const slowMap = new Map(slowSmaData.map(d => [d.time, d.value]));

  return (i: number) => {
    if (i < SMA_SLOW) return null;

    const fastToday = fastMap.get(stockData[i].time);
    const fastYest = fastMap.get(stockData[i - 1].time);
    const slowToday = slowMap.get(stockData[i].time);
    const slowYest = slowMap.get(stockData[i - 1].time);

    if (fastToday !== undefined && fastYest !== undefined && slowToday !== undefined && slowYest !== undefined) {
      if (fastYest <= slowYest && fastToday > slowToday) {
        // Check volume surge (1.3x 20-day average)
        const window = stockData.slice(i - SMA_FAST, i);
        const avgVol = window.reduce((s, d) => s + d.value, 0) / SMA_FAST;
        if (stockData[i].value > avgVol * 1.3) {
          return 'BUY'; // Cross over 50-SMA with volume
        }
      }
      if (fastYest >= slowYest && fastToday < slowToday) {
        return 'SELL'; // Cross under 50-SMA
      }
    }
    return null;
  };
}
