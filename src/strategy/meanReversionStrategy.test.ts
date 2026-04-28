import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/candleTypes';
import { evaluateMeanReversionStrategy } from './meanReversionStrategy';
import type { CandleFeatureSnapshot, StrategyConfig } from './strategyTypes';

const config: StrategyConfig = {
  lookbackCandles: 2,
  breakoutLookbackCandles: 2,
  minReturnPct: 0.01,
  minRangePct: 0.02,
  minBodyPct: 0.005,
  maxWickToBodyRatio: 2,
  holdCandles: 3,
  enableDirectBreakoutEntry: true,
};

function makeSnapshot(
  candle: Candle,
  overrides: Partial<Omit<CandleFeatureSnapshot, 'candle'>> = {},
): CandleFeatureSnapshot {
  return {
    candle,
    returnPct: 0,
    rangePct: 0,
    bodyPct: 0,
    upperWickPct: 0,
    lowerWickPct: 0,
    wickToBodyRatio: 0,
    rollingReturnPct: 0,
    rollingRangePct: 0,
    breakoutUp: false,
    breakoutDown: false,
    direction: 'flat',
    momentumScore: 0.5,
    ...overrides,
  };
}

describe('evaluateMeanReversionStrategy', () => {
  it('enters LONG when there is a strong bearish move', () => {
    const snapshot = makeSnapshot({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 100,
      high: 101,
      low: 95,
      close: 96,
      sampleCount: 4,
    }, {
      returnPct: -0.04,
      rangePct: 0.06,
      direction: 'down',
    });

    const decision = evaluateMeanReversionStrategy(snapshot, config);

    expect(decision).toEqual({
      shouldEnter: true,
      direction: 'LONG',
      reasonCodes: ['mean_reversion_long'],
      strength: 0.5,
      expectedHoldCandles: 3,
    });
  });

  it('enters SHORT when there is a strong bullish move', () => {
    const snapshot = makeSnapshot({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 100,
      high: 106,
      low: 99,
      close: 104,
      sampleCount: 4,
    }, {
      returnPct: 0.04,
      rangePct: 0.07,
      direction: 'up',
    });

    const decision = evaluateMeanReversionStrategy(snapshot, config);

    expect(decision).toEqual({
      shouldEnter: true,
      direction: 'SHORT',
      reasonCodes: ['mean_reversion_short'],
      strength: 0.5,
      expectedHoldCandles: 3,
    });
  });

  it('returns NONE when the move is too small', () => {
    const snapshot = makeSnapshot({
      startTimeMs: 0,
      endTimeMs: 300_000,
      open: 100,
      high: 100.8,
      low: 99.7,
      close: 100.1,
      sampleCount: 4,
    });

    const decision = evaluateMeanReversionStrategy(snapshot, config);

    expect(decision.shouldEnter).toBe(false);
    expect(decision.direction).toBeNull();
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining(['RETURN_TOO_SMALL', 'RANGE_TOO_LOW']),
    );
  });
});
