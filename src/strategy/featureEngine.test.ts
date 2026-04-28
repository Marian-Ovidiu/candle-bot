import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/candleTypes';
import { buildFeatureSnapshots } from './featureEngine';

const config = {
  lookbackCandles: 2,
  breakoutLookbackCandles: 2,
  minReturnPct: 0.01,
  minRangePct: 0.02,
  minBodyPct: 0.005,
  maxWickToBodyRatio: 2,
};

describe('buildFeatureSnapshots', () => {
  it('computes the raw candle features', () => {
    const candles: Candle[] = [
      {
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        sampleCount: 4,
      },
    ];

    const [snapshot] = buildFeatureSnapshots(candles, config);

    expect(snapshot).toBeDefined();
    if (!snapshot) {
      throw new Error('Expected a snapshot');
    }

    expect(snapshot).toMatchObject({
      candle: candles[0],
      returnPct: 0.02,
      rangePct: 0.1,
      bodyPct: 0.02,
      upperWickPct: 0.03,
      lowerWickPct: 0.05,
      wickToBodyRatio: 4,
      rollingReturnPct: 0,
      rollingRangePct: 0,
      breakoutUp: false,
      breakoutDown: false,
      direction: 'up',
    });
    expect(snapshot.momentumScore).toBeCloseTo(1.5, 6);
  });

  it('computes rolling metrics from the previous candles', () => {
    const candles: Candle[] = [
      {
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        sampleCount: 2,
      },
      {
        startTimeMs: 300_000,
        endTimeMs: 600_000,
        open: 103,
        high: 106,
        low: 101,
        close: 104,
        sampleCount: 2,
      },
      {
        startTimeMs: 600_000,
        endTimeMs: 900_000,
        open: 104,
        high: 109,
        low: 103,
        close: 108,
        sampleCount: 2,
      },
    ];

    const snapshots = buildFeatureSnapshots(candles, config);
    const third = snapshots[2];

    expect(third).toBeDefined();
    if (!third) {
      throw new Error('Expected third snapshot');
    }

    expect(third).toMatchObject({
      rollingReturnPct: (0.03 + 0.009708737864077669) / 2,
      rollingRangePct: (0.05 + 0.04854368932038835) / 2,
    });
  });

  it('detects breakouts against the previous N candles', () => {
    const candles: Candle[] = [
      {
        startTimeMs: 0,
        endTimeMs: 300_000,
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        sampleCount: 1,
      },
      {
        startTimeMs: 300_000,
        endTimeMs: 600_000,
        open: 103,
        high: 106,
        low: 101,
        close: 104,
        sampleCount: 1,
      },
      {
        startTimeMs: 600_000,
        endTimeMs: 900_000,
        open: 104,
        high: 110,
        low: 103,
        close: 107,
        sampleCount: 1,
      },
      {
        startTimeMs: 900_000,
        endTimeMs: 1_200_000,
        open: 107,
        high: 108,
        low: 96,
        close: 98,
        sampleCount: 1,
      },
    ];

    const snapshots = buildFeatureSnapshots(candles, config);
    const breakoutUpSnapshot = snapshots[2];
    const breakoutDownSnapshot = snapshots[3];

    expect(breakoutUpSnapshot).toBeDefined();
    expect(breakoutDownSnapshot).toBeDefined();
    if (!breakoutUpSnapshot || !breakoutDownSnapshot) {
      throw new Error('Expected breakout snapshots');
    }

    expect(breakoutUpSnapshot.breakoutUp).toBe(true);
    expect(breakoutUpSnapshot.breakoutDown).toBe(false);
    expect(breakoutDownSnapshot.breakoutDown).toBe(true);
    expect(breakoutDownSnapshot.breakoutUp).toBe(false);
  });
});
