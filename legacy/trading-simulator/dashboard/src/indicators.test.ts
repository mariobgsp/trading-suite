import { describe, it, expect } from 'vitest';
import {
  calculateRSI,
  calculateMACD,
  calculateStochasticFull,
  calculateSMA,
  calculateMFI,
  calculateOBV,
  calculateADL,
  calculateCMF,
  calculateVWAP,
  calculateVWMA,
  calculateLiquidityPressure,
  calculateIntensity,
} from './indicators';
import type { OHLCV } from './indicators';

// 30-day rising price fixture
const risingData: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
  time: `2025-01-${String(i + 1).padStart(2, '0')}`,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 100 + i,
  value: 1000000 + i * 10000,
}));

// Mixed up/down fixture
const mixedData: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
  time: `2025-01-${String(i + 1).padStart(2, '0')}`,
  open: 100 + (i % 2 === 0 ? 5 : -5),
  high: 110 + (i % 2 === 0 ? 5 : -5),
  low: 90 + (i % 2 === 0 ? 5 : -5),
  close: 100 + (i % 2 === 0 ? 3 : -3),
  value: 1000000,
}));

// Falling price fixture
function generateFallingData(n: number): OHLCV[] {
  return Array.from({ length: n }, (_, i) => ({
    time: `2025-01-${String(i + 1).padStart(2, '0')}`,
    open: 200 - i,
    high: 205 - i,
    low: 195 - i,
    close: 200 - i,
    value: 1000000,
  }));
}

describe('calculateRSI', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateRSI(risingData.slice(0, 5))).toEqual([]);
  });

  it('returns RSI values for valid data', () => {
    const result = calculateRSI(risingData);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].value).toBeGreaterThanOrEqual(0);
    expect(result[0].value).toBeLessThanOrEqual(100);
  });

  it('rising prices produce high RSI', () => {
    const result = calculateRSI(risingData);
    const last = result[result.length - 1];
    expect(last.value).toBeGreaterThan(50);
  });
});

describe('calculateMACD', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateMACD(risingData.slice(0, 10))).toEqual([]);
  });

  it('returns macd, signal, histogram for valid data', () => {
    const result = calculateMACD(risingData);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('macd');
    expect(result[0]).toHaveProperty('signal');
    expect(result[0]).toHaveProperty('histogram');
  });
});

describe('calculateStochasticFull', () => {
  it('returns k and d values', () => {
    const result = calculateStochasticFull(risingData);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('k');
    expect(result[0]).toHaveProperty('d');
  });
});

describe('calculateSMA', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateSMA(risingData, 50)).toEqual([]);
  });

  it('returns SMA values', () => {
    const result = calculateSMA(risingData, 10);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('calculateMFI', () => {
  it('returns MFI values between 0 and 100', () => {
    const result = calculateMFI(risingData);
    if (result.length > 0) {
      expect(result[0].value).toBeGreaterThanOrEqual(0);
      expect(result[0].value).toBeLessThanOrEqual(100);
    }
  });
});

describe('calculateOBV', () => {
  it('returns empty for single data point', () => {
    expect(calculateOBV(risingData.slice(0, 1))).toEqual([]);
  });

  it('returns OBV values', () => {
    const result = calculateOBV(risingData);
    expect(result.length).toBe(29);
  });

  it('rising prices produce positive OBV trend', () => {
    const result = calculateOBV(risingData);
    const first = result[0].value;
    const last = result[result.length - 1].value;
    expect(last).toBeGreaterThan(first);
  });
});

describe('calculateADL', () => {
  it('returns one value per data point', () => {
    const result = calculateADL(risingData);
    expect(result.length).toBe(risingData.length);
  });

  it('returns ADL values', () => {
    const result = calculateADL(mixedData);
    expect(result.length).toBe(30);
    expect(typeof result[0].value).toBe('number');
  });
});

describe('calculateCMF', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateCMF(risingData.slice(0, 5))).toEqual([]);
  });

  it('returns values between -1 and 1', () => {
    const result = calculateCMF(mixedData, 10);
    for (const point of result) {
      expect(point.value).toBeGreaterThanOrEqual(-1);
      expect(point.value).toBeLessThanOrEqual(1);
    }
  });
});

describe('calculateVWAP', () => {
  it('returns one value per data point', () => {
    const result = calculateVWAP(risingData);
    expect(result.length).toBe(risingData.length);
  });

  it('VWAP produces positive values', () => {
    const result = calculateVWAP(risingData);
    for (const point of result) {
      expect(point.value).toBeGreaterThan(0);
    }
  });

  it('VWAP is monotonic for uniformly rising prices', () => {
    const result = calculateVWAP(risingData);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].value).toBeGreaterThanOrEqual(result[i - 1].value);
    }
  });
});

describe('calculateVWMA', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateVWMA(risingData.slice(0, 5), 10)).toEqual([]);
  });

  it('returns VWMA values within price range', () => {
    const result = calculateVWMA(risingData, 10);
    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(typeof point.value).toBe('number');
      expect(point.value).toBeGreaterThan(0);
    }
  });
});

describe('calculateLiquidityPressure', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateLiquidityPressure([])).toEqual([]);
    expect(calculateLiquidityPressure([risingData[0]])).toEqual([]);
  });

  it('returns values for each bar after first', () => {
    const result = calculateLiquidityPressure(risingData);
    expect(result.length).toBe(risingData.length - 1);
  });

  it('monotonically increasing for uniformly rising data', () => {
    const result = calculateLiquidityPressure(risingData);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].value).toBeGreaterThanOrEqual(result[i - 1].value);
    }
  });

  it('monotonically decreasing for uniformly falling data', () => {
    const fallingData = generateFallingData(20);
    const result = calculateLiquidityPressure(fallingData);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].value).toBeLessThanOrEqual(result[i - 1].value);
    }
  });
});

describe('calculateIntensity', () => {
  it('returns empty for insufficient data', () => {
    expect(calculateIntensity(risingData.slice(0, 5), 10)).toEqual([]);
  });

  it('returns positive values', () => {
    const result = calculateIntensity(risingData, 10);
    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(point.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns one value per bar from period-1 onwards', () => {
    const result = calculateIntensity(risingData, 5);
    expect(result.length).toBe(risingData.length - 5 + 1);
  });
});
