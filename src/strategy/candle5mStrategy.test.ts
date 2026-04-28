import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/candleTypes';
import {
  createCandle5mStrategyState,
  evaluateCandle5mStrategy,
} from './candle5mStrategy';
import type { CandleFeatureSnapshot, StrategyConfig } from './strategyTypes';

const config: StrategyConfig = {
  lookbackCandles: 2,
  breakoutLookbackCandles: 2,
  minReturnPct: 0.01,
  minRangePct: 0.02,
  minBodyPct: 0.005,
  maxWickToBodyRatio: 2,
  holdCandles: 3,
  enableDirectBreakoutEntry: false,
  enableLongEntries: true,
  enableShortEntries: true,
};

function makeCandle(
  startTimeMs: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return {
    startTimeMs,
    endTimeMs: startTimeMs + 300_000,
    open,
    high,
    low,
    close,
    sampleCount: 4,
  };
}

function makeSnapshot(
  candle: Candle,
  overrides: Partial<Omit<CandleFeatureSnapshot, 'candle'>> = {},
): CandleFeatureSnapshot {
  return {
    candle,
    returnPct: 0.02,
    rangePct: 0.1,
    bodyPct: 0.02,
    upperWickPct: 0.03,
    lowerWickPct: 0.05,
    wickToBodyRatio: 1,
    rollingReturnPct: 0,
    rollingRangePct: 0,
    breakoutUp: false,
    breakoutDown: false,
    direction: 'up',
    momentumScore: 1.5,
    ...overrides,
  };
}

describe('evaluateCandle5mStrategy', () => {
  it('enters directly on breakout when direct breakout mode is enabled', () => {
    const directConfig: StrategyConfig = {
      ...config,
      enableDirectBreakoutEntry: true,
    };

    const breakoutSnapshot = makeSnapshot(makeCandle(0, 100, 105, 95, 102), {
      breakoutUp: true,
      direction: 'up',
    });

    const step = evaluateCandle5mStrategy(
      breakoutSnapshot,
      directConfig,
      createCandle5mStrategyState(),
    );

    expect(step.decision).toEqual({
      shouldEnter: true,
      direction: 'LONG',
      reasonCodes: ['direct_breakout_entry_long'],
      strength: 1.5,
      expectedHoldCandles: 3,
    });
    expect(step.nextState.waitingForPullback).toBeNull();
  });

  it('waits after a breakoutUp and enters LONG on the next pullback candle', () => {
    const breakoutSnapshot = makeSnapshot(makeCandle(0, 100, 105, 95, 102), {
      breakoutUp: true,
      direction: 'up',
    });

    const waitingStep = evaluateCandle5mStrategy(
      breakoutSnapshot,
      config,
      createCandle5mStrategyState(),
    );

    expect(waitingStep.decision).toEqual({
      shouldEnter: false,
      direction: null,
      reasonCodes: ['waiting_pullback'],
      strength: 1.5,
      expectedHoldCandles: 3,
    });
    expect(waitingStep.nextState.waitingForPullback?.status).toBe(
      'waiting_for_pullback_long',
    );

    const pullbackSnapshot = makeSnapshot(makeCandle(300_000, 102, 103, 99, 101), {
      returnPct: -0.00980392156862745,
      rangePct: 0.0392156862745098,
      bodyPct: 0.00980392156862745,
      upperWickPct: 0.00980392156862745,
      lowerWickPct: 0.029411764705882353,
      wickToBodyRatio: 4,
      direction: 'down',
      momentumScore: 0.8,
    });

    const entryStep = evaluateCandle5mStrategy(
      pullbackSnapshot,
      config,
      waitingStep.nextState,
    );

    expect(entryStep.decision).toEqual({
      shouldEnter: true,
      direction: 'LONG',
      reasonCodes: ['pullback_entry_long'],
      strength: 0.8,
      expectedHoldCandles: 3,
    });
    expect(entryStep.nextState.waitingForPullback).toBeNull();
  });

  it('waits after a breakoutDown and enters SHORT on the next pullback candle', () => {
    const breakoutSnapshot = makeSnapshot(makeCandle(0, 100, 104, 96, 98), {
      returnPct: -0.02,
      breakoutDown: true,
      direction: 'down',
    });

    const waitingStep = evaluateCandle5mStrategy(
      breakoutSnapshot,
      config,
      createCandle5mStrategyState(),
    );

    expect(waitingStep.decision.reasonCodes).toContain('waiting_pullback');
    expect(waitingStep.nextState.waitingForPullback?.status).toBe(
      'waiting_for_pullback_short',
    );

    const pullbackSnapshot = makeSnapshot(makeCandle(300_000, 98, 100, 95, 99), {
      returnPct: 0.01020408163265306,
      rangePct: 0.05102040816326531,
      bodyPct: 0.01020408163265306,
      upperWickPct: 0.01020408163265306,
      lowerWickPct: 0.04081632653061224,
      wickToBodyRatio: 5,
      direction: 'up',
      momentumScore: 0.7,
    });

    const entryStep = evaluateCandle5mStrategy(
      pullbackSnapshot,
      config,
      waitingStep.nextState,
    );

    expect(entryStep.decision).toEqual({
      shouldEnter: true,
      direction: 'SHORT',
      reasonCodes: ['pullback_entry_short'],
      strength: 0.7,
      expectedHoldCandles: 3,
    });
  });

  it('fails the pullback when the next candle does not qualify', () => {
    const breakoutSnapshot = makeSnapshot(makeCandle(0, 100, 105, 95, 102), {
      breakoutUp: true,
      direction: 'up',
    });

    const waitingStep = evaluateCandle5mStrategy(
      breakoutSnapshot,
      config,
      createCandle5mStrategyState(),
    );

    const failedSnapshot = makeSnapshot(makeCandle(300_000, 102, 106, 100, 103), {
      returnPct: 0.00980392156862745,
      rangePct: 0.058823529411764705,
      bodyPct: 0.00980392156862745,
      upperWickPct: 0.029411764705882353,
      lowerWickPct: 0,
      wickToBodyRatio: 3,
      direction: 'up',
      momentumScore: 0.6,
    });

    const failedStep = evaluateCandle5mStrategy(
      failedSnapshot,
      config,
      waitingStep.nextState,
    );

    expect(failedStep.decision).toEqual({
      shouldEnter: false,
      direction: null,
      reasonCodes: ['pullback_failed'],
      strength: 0.6,
      expectedHoldCandles: 3,
    });
    expect(failedStep.nextState.waitingForPullback).toBeNull();
  });

  it('returns reason codes for weak setups', () => {
    const snapshot = makeSnapshot(makeCandle(0, 100, 100.4, 99.8, 100.1), {
      rangePct: 0.006,
      bodyPct: 0.001,
      wickToBodyRatio: 10,
      breakoutUp: false,
      breakoutDown: false,
      direction: 'flat',
      momentumScore: 0.2,
    });

    const step = evaluateCandle5mStrategy(snapshot, config, createCandle5mStrategyState());

    expect(step.decision.shouldEnter).toBe(false);
    expect(step.decision.reasonCodes).toEqual(
      expect.arrayContaining(['RANGE_TOO_LOW', 'BODY_TOO_SMALL', 'WICK_TOO_HIGH']),
    );
  });
});
