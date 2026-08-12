import { describe, it, expect } from 'vitest';
import {
  simulateBacktest,
  getFVGSignal,
  getSupportBuySignal,
  getBreakoutSignal,
  getTrendFollowSignal,
  calculatePearsonCorrelation,
} from './backtestEngine';
import type { OHLCV } from './indicators';

describe('simulateBacktest', () => {
  it('should trigger buy on BUY signal and sell on SELL signal, returning correct win rate and trades', () => {
    const stockData: OHLCV[] = [
      { time: '2023-01-01', open: 100, high: 100, low: 100, close: 100, value: 0 },
      { time: '2023-01-02', open: 100, high: 100, low: 100, close: 110, value: 0 },
      { time: '2023-01-03', open: 110, high: 110, low: 110, close: 120, value: 0 },
      { time: '2023-01-04', open: 120, high: 120, low: 120, close: 90, value: 0 }, // -25% drop
    ];

    const getSignal = (i: number): 'BUY' | 'SELL' | null => {
      if (i === 1) return 'BUY';
      if (i === 3) return 'SELL';
      return null;
    };

    const result = simulateBacktest('TestStrategy', stockData, getSignal);

    expect(result.name).toBe('TestStrategy');
    expect(result.trades).toBe(1); // 1 buy and sell cycle
    expect(result.winRate).toBe(0); // Entry at 110, sell at 90 (or stop loss). Loss!
    expect(result.totalReturn).toBeLessThan(0);
  });
});

import { calculateJCIResilience } from './backtestEngine';

describe('calculateJCIResilience', () => {
  it('should return null if JCI data is empty', () => {
    expect(calculateJCIResilience([{ time: '2023-01-01', open: 1, high: 1, low: 1, close: 1, value: 0 }], [])).toBeNull();
  });

  it('should return 100 if stock goes up/flat whenever JCI goes down', () => {
    const stock: OHLCV[] = [
      { time: 'T1', open: 100, high: 100, low: 100, close: 100, value: 0 },
      { time: 'T2', open: 100, high: 100, low: 100, close: 110, value: 0 }, // Stock UP
      { time: 'T3', open: 110, high: 110, low: 110, close: 110, value: 0 }, // Stock FLAT
    ];
    const jci: OHLCV[] = [
      { time: 'T1', open: 1000, high: 1000, low: 1000, close: 1000, value: 0 },
      { time: 'T2', open: 1000, high: 1000, low: 1000, close: 900, value: 0 },  // JCI DOWN
      { time: 'T3', open: 900, high: 900, low: 900, close: 800, value: 0 },    // JCI DOWN
    ];
    // Stock is resilient 2/2 times
    expect(calculateJCIResilience(stock, jci)).toBe(100);
  });

  it('should return 50 if stock goes down half the times JCI goes down', () => {
    const stock: OHLCV[] = [
      { time: 'T1', open: 100, high: 100, low: 100, close: 100, value: 0 },
      { time: 'T2', open: 100, high: 100, low: 100, close: 110, value: 0 }, // Stock UP
      { time: 'T3', open: 110, high: 110, low: 110, close: 90, value: 0 },  // Stock DOWN
    ];
    const jci: OHLCV[] = [
      { time: 'T1', open: 1000, high: 1000, low: 1000, close: 1000, value: 0 },
      { time: 'T2', open: 1000, high: 1000, low: 1000, close: 900, value: 0 },  // JCI DOWN
      { time: 'T3', open: 900, high: 900, low: 900, close: 800, value: 0 },    // JCI DOWN
    ];
    // Resilient on T2, not on T3 -> 1/2 = 50%
    expect(calculateJCIResilience(stock, jci)).toBe(50);
  });
});

describe('getFVGSignal', () => {
  it('returns null for first 3 bars', () => {
    const data: OHLCV[] = Array.from({ length: 10 }, (_, i) => ({
      time: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100, high: 105, low: 95, close: 100, value: 1000,
    }));
    const signal = getFVGSignal(data);
    expect(signal(0)).toBeNull();
    expect(signal(1)).toBeNull();
    expect(signal(2)).toBeNull();
  });
});

describe('getSupportBuySignal', () => {
  it('returns null for first 25 bars (LOOKBACK + 5)', () => {
    const data: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
      time: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100, high: 105, low: 95, close: 100, value: 1000,
    }));
    const signal = getSupportBuySignal(data);
    for (let i = 0; i <= 24; i++) {
      expect(signal(i)).toBeNull();
    }
  });
});

describe('getBreakoutSignal', () => {
  it('returns null for first 21 bars', () => {
    const data: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
      time: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100, high: 105, low: 95, close: 100, value: 1000,
    }));
    const signal = getBreakoutSignal(data);
    for (let i = 0; i <= 21; i++) {
      expect(signal(i)).toBeNull();
    }
  });
});

describe('calculatePearsonCorrelation', () => {
  it('returns null when insufficient data', () => {
    const tiny: OHLCV[] = Array.from({ length: 5 }, (_, i) => ({
      time: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100, high: 105, low: 95, close: 100 + i, value: 1000,
    }));
    expect(calculatePearsonCorrelation(tiny, tiny)).toBeNull();
  });

  it('returns r ≈ 1.0 for identical series', () => {
    const bars: OHLCV[] = Array.from({ length: 60 }, (_, i) => ({
      time: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, value: 10000,
    }));
    const result = calculatePearsonCorrelation(bars, bars);
    expect(result).not.toBeNull();
    expect(result!.r).toBeCloseTo(1.0, 1);
    expect(result!.underPressure).toBe(true);
    expect(result!.interpretation).toContain('lockstep');
  });

  it('returns a non-empty interpretation string', () => {
    const bars: OHLCV[] = Array.from({ length: 60 }, (_, i) => ({
      time: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, value: 10000,
    }));
    const result = calculatePearsonCorrelation(bars, bars);
    expect(typeof result!.interpretation).toBe('string');
    expect(result!.interpretation.length).toBeGreaterThan(5);
  });
});

describe('getTrendFollowSignal', () => {
  it('returns null for first 50 bars', () => {
    const data: OHLCV[] = Array.from({ length: 60 }, (_, i) => ({
      time: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: 100, high: 105, low: 95, close: 100, value: 1000,
    }));
    const signal = getTrendFollowSignal(data);
    for (let i = 0; i < 50; i++) {
      expect(signal(i)).toBeNull();
    }
  });
});
