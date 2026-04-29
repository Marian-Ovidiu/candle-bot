import { describe, expect, it } from 'vitest';
import type { BacktestTrade } from './metrics';
import { buildTradeAnalysis } from './tradeAnalysis';

function makeTrade(overrides: Partial<BacktestTrade>): BacktestTrade {
  return {
    entryTimeMs: Date.UTC(2026, 0, 1, 10, 0, 0),
    exitTimeMs: Date.UTC(2026, 0, 1, 10, 5, 0),
    direction: 'LONG',
    entryPrice: 100,
    exitPrice: 101,
    holdCandles: 1,
    entryStrengthPct: 0.0015,
    pnlPct: 0.01,
    pnlNetPct: 0.008,
    reason: 'TP',
    closeReason: 'TP',
    maxFavorableExcursionPct: 0.012,
    maxNetFavorableExcursionPct: 0.01,
    maxAdverseExcursionPct: 0.001,
    bestPriceDuringHold: 101.2,
    worstPriceDuringHold: 99.9,
    exitDistanceFromTpPct: 0,
    exitDistanceFromSlPct: 0.02,
    touchedHalfTp: true,
    touchedHalfSl: false,
    breakEvenActivated: false,
    trailingActivated: false,
    ...overrides,
  };
}

describe('buildTradeAnalysis', () => {
  it('aggregates trades by exit reason, direction, entry hour, and impulse bucket', () => {
    const analysis = buildTradeAnalysis([
      makeTrade({
        closeReason: 'TP',
        reason: 'TP',
        direction: 'LONG',
        pnlNetPct: 0.01,
        holdCandles: 2,
        entryStrengthPct: 0.0013,
        entryTimeMs: Date.UTC(2026, 0, 1, 10),
      }),
      makeTrade({
        closeReason: 'SL',
        reason: 'SL',
        direction: 'SHORT',
        pnlNetPct: -0.004,
        holdCandles: 1,
        entryStrengthPct: 0.002,
        entryTimeMs: Date.UTC(2026, 0, 1, 11),
      }),
      makeTrade({
        closeReason: 'TIMEOUT',
        reason: 'TIMEOUT',
        direction: 'LONG',
        pnlNetPct: 0.002,
        holdCandles: 4,
        entryStrengthPct: 0.004,
        entryTimeMs: Date.UTC(2026, 0, 1, 10),
      }),
    ]);

    expect(analysis.byExitReason.tp).toMatchObject({
      count: 1,
      winRate: 1,
      totalNetPnlPct: 0.01,
      avgHoldCandles: 2,
    });
    expect(analysis.byExitReason.sl).toMatchObject({
      count: 1,
      winRate: 0,
      totalNetPnlPct: -0.004,
    });
    expect(analysis.byDirection.long).toMatchObject({
      count: 2,
      winRate: 1,
      totalNetPnlPct: 0.012,
      avgNetPnlPct: 0.006,
      avgHoldCandles: 3,
    });
    expect(analysis.byEntryHourUtc['10:00']).toMatchObject({
      count: 2,
      totalNetPnlPct: 0.012,
    });
    expect(analysis.byImpulseStrengthBucket['0.12%-0.18%']?.count).toBe(1);
    expect(analysis.byImpulseStrengthBucket['0.18%-0.25%']?.count).toBe(1);
    expect(analysis.byImpulseStrengthBucket['>0.35%']?.count).toBe(1);
    expect(analysis.compactSummary).toEqual({
      worstExitReason: 'sl',
      bestDirection: 'long',
      bestHourBucket: '10:00',
      bestImpulseBucket: '0.12%-0.18%',
    });
  });
});
