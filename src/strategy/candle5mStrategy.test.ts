import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/candleTypes';
import { buildFeatureSnapshots } from './featureEngine';
import { evaluateCandle5mStrategy } from './candle5mStrategy';
import type { CandleFeatureSnapshot, StrategyConfig } from './strategyTypes';

const config: StrategyConfig = {
  lookbackCandles: 2,
  breakoutLookbackCandles: 2,
  minReturnPct: 0.01,
  minRangePct: 0.02,
  minBodyPct: 0.005,
  maxWickToBodyRatio: 2,
  holdCandles: 3,
};

function buildSnapshot(candle: Candle): CandleFeatureSnapshot {
  const [snapshot] = buildFeatureSnapshots([candle], config);
  if (!snapshot) {
    throw new Error('Expected snapshot');
  }
  return snapshot;
}

describe('evaluateCandle5mStrategy', () => {
  it('accepts a valid LONG setup', () => {
    const snapshot = {
      ...buildSnapshot({
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        sampleCount: 4,
      }),
      breakoutUp: true,
    };

    const decision = evaluateCandle5mStrategy(snapshot, config);

    expect(decision).toEqual({
      shouldEnter: true,
      direction: 'LONG',
      reasonCodes: ['BREAKOUT_UP', 'RETURN_OK', 'RANGE_OK', 'BODY_OK', 'WICK_OK'],
      strength: snapshot.momentumScore,
      expectedHoldCandles: 3,
    });
  });

  it('accepts a valid SHORT setup', () => {
    const snapshot = {
      ...buildSnapshot({
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 101,
        low: 96,
        close: 97,
        sampleCount: 4,
      }),
      breakoutDown: true,
    };

    const decision = evaluateCandle5mStrategy(snapshot, config);

    expect(decision).toEqual({
      shouldEnter: true,
      direction: 'SHORT',
      reasonCodes: ['BREAKOUT_DOWN', 'RETURN_OK', 'RANGE_OK', 'BODY_OK', 'WICK_OK'],
      strength: snapshot.momentumScore,
      expectedHoldCandles: 3,
    });
  });

  it('rejects setups with low range', () => {
    const snapshot = {
      ...buildSnapshot({
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 100.5,
        low: 99.8,
        close: 100.3,
        sampleCount: 4,
      }),
      breakoutUp: true,
    };

    const decision = evaluateCandle5mStrategy(snapshot, config);

    expect(decision.shouldEnter).toBe(false);
    expect(decision.direction).toBeNull();
    expect(decision.reasonCodes).toContain('RANGE_TOO_LOW');
  });

  it('rejects setups with small body', () => {
    const snapshot = {
      ...buildSnapshot({
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 105,
        low: 95,
        close: 100.2,
        sampleCount: 4,
      }),
      breakoutUp: true,
    };

    const decision = evaluateCandle5mStrategy(snapshot, config);

    expect(decision.shouldEnter).toBe(false);
    expect(decision.direction).toBeNull();
    expect(decision.reasonCodes).toContain('BODY_TOO_SMALL');
  });

  it('rejects setups with excessive wick to body ratio', () => {
    const snapshot = {
      ...buildSnapshot({
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 110,
        low: 90,
        close: 100.5,
        sampleCount: 4,
      }),
      breakoutUp: true,
    };

    const decision = evaluateCandle5mStrategy(snapshot, config);

    expect(decision.shouldEnter).toBe(false);
    expect(decision.direction).toBeNull();
    expect(decision.reasonCodes).toContain('WICK_TOO_HIGH');
  });

  it('always returns reason codes', () => {
    const snapshot = {
      ...buildSnapshot({
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        sampleCount: 4,
      }),
      breakoutUp: false,
      breakoutDown: false,
    };

    const decision = evaluateCandle5mStrategy(snapshot, config);

    expect(decision.reasonCodes.length).toBeGreaterThan(0);
  });
});
