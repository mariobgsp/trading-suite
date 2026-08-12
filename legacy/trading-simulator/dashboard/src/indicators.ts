export interface OHLCV {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  value: number; // Volume
}

export interface Point {
  time: string;
  value: number;
}

/** 
 * Calculate RSI (Relative Strength Index)
 * 14-period Wilder's Smoothing by default 
 */
export function calculateRSI(data: OHLCV[], period: number = 14): Point[] {
  if (data.length <= period) return [];
  const result: Point[] = [];
  
  let sumGain = 0;
  let sumLoss = 0;

  // Initial SMA for first period
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) sumGain += change;
    else sumLoss -= change;
  }
  
  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;
  
  const rs = avgGain / (avgLoss === 0 ? 1e-10 : avgLoss);
  let rsi = 100 - (100 / (1 + rs));
  result.push({ time: data[period].time, value: rsi });

  // Smoothed Moving Average (Wilder's)
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    let gain = 0;
    let loss = 0;
    if (change > 0) gain = change;
    else loss = -change;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    const rs = avgGain / (avgLoss === 0 ? 1e-10 : avgLoss);
    rsi = 100 - (100 / (1 + rs));
    result.push({ time: data[i].time, value: rsi });
  }

  return result;
}

/** 
 * Calculate Stochastic Oscillator %K
 */
export function calculateStochastic(data: OHLCV[], period: number = 14): Point[] {
  if (data.length < period) return [];
  const result: Point[] = [];

  for (let i = period - 1; i < data.length; i++) {
    const window = data.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...window.map(d => d.high));
    const lowestLow = Math.min(...window.map(d => d.low));
    
    const currentClose = data[i].close;
    
    let k = 0;
    if (highestHigh !== lowestLow) {
      k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    } else {
      k = 50;
    }
    
    result.push({ time: data[i].time, value: k });
  }
  return result;
}

/** 
 * Calculate MFI (Money Flow Index)
 */
export function calculateMFI(data: OHLCV[], period: number = 14): Point[] {
  if (data.length <= period) return [];
  const result: Point[] = [];
  
  const typicalPrices = data.map(d => (d.high + d.low + d.close) / 3);
  const rawMoneyFlow = data.map((d, i) => typicalPrices[i] * d.value);
  
  for (let i = period; i < data.length; i++) {
    let positiveFlow = 0;
    let negativeFlow = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      if (typicalPrices[j] > typicalPrices[j - 1]) {
        positiveFlow += rawMoneyFlow[j];
      } else if (typicalPrices[j] < typicalPrices[j - 1]) {
        negativeFlow += rawMoneyFlow[j];
      }
    }
    
    const moneyFlowRatio = positiveFlow / (negativeFlow === 0 ? 1e-10 : negativeFlow);
    const mfi = 100 - (100 / (1 + moneyFlowRatio));
    
    result.push({ time: data[i].time, value: mfi });
  }
  
  return result;
}

/**
 * Calculate CFI (Cumulative Flow Indicator) or Cumulative Accumulation
 * Simply computes a running total of the daily net flow values.
 */
export function calculateCFI(dates: string[], dailyFlows: number[]): Point[] {
  if (dates.length !== dailyFlows.length || dates.length === 0) return [];
  
  const result: Point[] = [];
  let cumulative = 0;
  
  for (let i = 0; i < dates.length; i++) {
    cumulative += dailyFlows[i];
    result.push({ time: dates[i], value: cumulative });
  }
  
  return result;
}

/**
 * Align two arrays of Points by their time (filling gaps with previous values or 0)
 * Useful to merge charting datasets
 */
export function alignData<T extends {time: string}>(primary: T[], secondary: {time: string, value: number}[]): {time: string, value: number}[] {
  const result: {time: string, value: number}[] = [];
  const secMap = new Map(secondary.map(s => [s.time, s.value]));
  
  let lastVal = 0;
  for (const p of primary) {
    if (secMap.has(p.time)) {
      lastVal = secMap.get(p.time)!;
    }
    result.push({ time: p.time, value: lastVal });
  }
  return result;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(data: OHLCV[]): { time: string; macd: number; signal: number; histogram: number }[] {
  if (data.length < 26) return [];
  
  const calculateEMA = (values: number[], period: number) => {
    const k = 2 / (period + 1);
    const ema = [values[0]];
    for (let i = 1; i < values.length; i++) {
      ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  };

  const closes = data.map(d => d.close);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);
  
  return data.map((d, i) => ({
    time: d.time,
    macd: macdLine[i],
    signal: signalLine[i],
    histogram: macdLine[i] - signalLine[i]
  }));
}

/**
 * Calculate Full Stochastic Oscillator (%K and %D)
 */
export function calculateStochasticFull(data: OHLCV[], period: number = 14, smoothK: number = 3, smoothD: number = 3): { time: string; k: number; d: number }[] {
  const result: { time: string; k: number; d: number }[] = [];
  if (data.length < period) return result;

  const rawK: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const window = data.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...window.map(d => d.high));
    const lowestLow = Math.min(...window.map(d => d.low));
    const currentClose = data[i].close;
    
    let k = 50;
    if (highestHigh !== lowestLow) {
      k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    }
    rawK.push(k);
  }

  // Simple Moving Average for smoothing
  const sma = (values: number[], period: number, index: number) => {
    if (index < period - 1) return values[index];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[index - i];
    return sum / period;
  };

  const smoothKLine = rawK.map((_, i) => sma(rawK, smoothK, i));
  const smoothDLine = smoothKLine.map((_, i) => sma(smoothKLine, smoothD, i));

  for (let i = 0; i < rawK.length; i++) {
    result.push({
      time: data[i + period - 1].time,
      k: smoothKLine[i],
      d: smoothDLine[i]
    });
  }

  return result;
}

/**
 * Calculate Simple Moving Average of close prices
 */
export function calculateSMA(data: OHLCV[], period: number): Point[] {
  if (data.length < period) return [];
  const result: Point[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

/**
 * Calculate Average True Range (ATR) — Wilder smoothing
 */
export function calculateATR(data: OHLCV[], period: number = 14): Point[] {
  if (data.length <= period) return [];
  const trueRanges: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const hl = data[i].high - data[i].low;
    const hc = Math.abs(data[i].high - data[i - 1].close);
    const lc = Math.abs(data[i].low - data[i - 1].close);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const result: Point[] = [{ time: data[period].time, value: atr }];

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push({ time: data[i + 1].time, value: atr });
  }
  return result;
}

/**
 * Calculate On Balance Volume (OBV)
 * Cumulative volume flow: +volume on up days, -volume on down days
 */
export function calculateOBV(data: OHLCV[]): Point[] {
  if (data.length < 2) return [];
  const result: Point[] = [];
  let obv = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) {
      obv += data[i].value;
    } else if (data[i].close < data[i - 1].close) {
      obv -= data[i].value;
    }
    result.push({ time: data[i].time, value: obv });
  }
  return result;
}

/**
 * Calculate Accumulation/Distribution Line (ADL)
 * Money flow multiplier × volume
 */
export function calculateADL(data: OHLCV[]): Point[] {
  if (data.length === 0) return [];
  const result: Point[] = [];
  let adl = 0;

  for (let i = 0; i < data.length; i++) {
    const { high, low, close, value } = data[i];
    const hlRange = high - low;
    const mfMultiplier = hlRange === 0 ? 0 : ((close - low) - (high - close)) / hlRange;
    const mfVolume = mfMultiplier * value;
    adl += mfVolume;
    result.push({ time: data[i].time, value: adl });
  }
  return result;
}

/**
 * Calculate Chaikin Money Flow (CMF)
 * Sum of (MF Multiplier × Volume) / Sum of Volume over period
 */
export function calculateCMF(data: OHLCV[], period: number = 20): Point[] {
  if (data.length < period) return [];
  const result: Point[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let mfVolumeSum = 0;
    let volumeSum = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const { high, low, close, value } = data[j];
      const hlRange = high - low;
      const mfMultiplier = hlRange === 0 ? 0 : ((close - low) - (high - close)) / hlRange;
      mfVolumeSum += mfMultiplier * value;
      volumeSum += value;
    }

    const cmf = volumeSum === 0 ? 0 : mfVolumeSum / volumeSum;
    result.push({ time: data[i].time, value: cmf });
  }
  return result;
}

/**
 * Calculate Volume Weighted Average Price (VWAP)
 * Cumulative (Typical Price × Volume) / Cumulative Volume
 */
export function calculateVWAP(data: OHLCV[]): Point[] {
  if (data.length === 0) return [];
  const result: Point[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].value;
    cumulativeVolume += data[i].value;
    const vwap = cumulativeVolume === 0 ? data[i].close : cumulativeTPV / cumulativeVolume;
    result.push({ time: data[i].time, value: vwap });
  }
  return result;
}

/**
 * Calculate Volume Weighted Moving Average (VWMA)
 * Sum(Price × Volume) / Sum(Volume) over N periods
 */
export function calculateVWMA(data: OHLCV[], period: number = 20): Point[] {
  if (data.length < period) return [];
  const result: Point[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let pvSum = 0;
    let volSum = 0;

    for (let j = i - period + 1; j <= i; j++) {
      pvSum += data[j].close * data[j].value;
      volSum += data[j].value;
    }

    const vwma = volSum === 0 ? data[i].close : pvSum / volSum;
    result.push({ time: data[i].time, value: vwma });
  }
  return result;
}

/**
 * Calculate Liquidity Pressure Model
 * Measures net buying/selling pressure using typical price direction × volume
 * Positive = buying pressure, Negative = selling pressure
 */
export function calculateLiquidityPressure(data: OHLCV[]): Point[] {
  if (data.length < 2) return [];
  const result: Point[] = [];
  let cumulative = 0;

  for (let i = 1; i < data.length; i++) {
    const prevTypical = (data[i - 1].high + data[i - 1].low + data[i - 1].close) / 3;
    const currTypical = (data[i].high + data[i].low + data[i].close) / 3;
    const direction = currTypical - prevTypical;
    const pressure = direction * data[i].value;
    cumulative += pressure;
    result.push({ time: data[i].time, value: cumulative });
  }
  return result;
}

/**
 * Calculate Intensity Ratio
 * Measures price change per unit of volume — how much volume is needed to move price
 * High intensity = strong move on low volume (conviction)
 * Low intensity = weak move on high volume (churn)
 */
export function calculateIntensity(data: OHLCV[], period: number = 14): Point[] {
  if (data.length < period) return [];
  const result: Point[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let totalAbsChange = 0;
    let totalVolume = 0;

    for (let j = i - period + 1; j <= i; j++) {
      totalAbsChange += Math.abs(data[j].close - data[j].open);
      totalVolume += data[j].value;
    }

    const intensity = totalVolume === 0 ? 0 : totalAbsChange / totalVolume;
    result.push({ time: data[i].time, value: intensity });
  }
  return result;
}
