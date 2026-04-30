import { describe, expect, it } from 'vitest';
import {
  createComparisonMarkdown,
  createDiffsVsBaseline,
  type ExperimentCompactSummary,
} from './runExperimentSuite';

function makeSummary(
  overrides: Partial<ExperimentCompactSummary> & Pick<ExperimentCompactSummary, 'experimentName'>,
): ExperimentCompactSummary {
  const { experimentName, ...rest } = overrides;

  return {
    experimentName,
    totalTrades: 10,
    winRate: 0.5,
    totalNetPnlPct: 0,
    avgNetPnlPct: 0,
    maxDrawdownPct: 0.01,
    profitFactor: 1,
    bestDirection: null,
    bestHourBucket: null,
    bestImpulseBucket: null,
    worstExitReason: null,
    candidateSignals: {
      waiting: 0,
      entry: 10,
      accepted: 10,
      rejected: 0,
    },
    rejectedReasons: {},
    exitReasonBreakdown: {
      tp: 5,
      sl: 5,
    },
    outputDir: 'output',
    ...rest,
  };
}

describe('experiment suite reporting', () => {
  it('renders comparison rows sorted by pnl, drawdown, then trades', () => {
    const markdown = createComparisonMarkdown([
      makeSummary({
        experimentName: 'baseline_direct_no_filters',
        totalNetPnlPct: 0.01,
        maxDrawdownPct: 0.03,
        totalTrades: 100,
      }),
      makeSummary({
        experimentName: 'costs_only',
        totalNetPnlPct: 0.02,
        maxDrawdownPct: 0.05,
        totalTrades: 20,
      }),
      makeSummary({
        experimentName: 'long_only',
        totalNetPnlPct: 0.01,
        maxDrawdownPct: 0.02,
        totalTrades: 80,
      }),
    ]);

    expect(markdown.indexOf('| costs_only |')).toBeLessThan(
      markdown.indexOf('| long_only |'),
    );
    expect(markdown.indexOf('| long_only |')).toBeLessThan(
      markdown.indexOf('| baseline_direct_no_filters |'),
    );
  });

  it('reports new or increased rejected reasons versus baseline', () => {
    const diffs = createDiffsVsBaseline([
      makeSummary({
        experimentName: 'baseline_direct_no_filters',
        totalTrades: 100,
        rejectedReasons: {
          hour_filter: 2,
        },
      }),
      makeSummary({
        experimentName: 'hour_22_only',
        totalTrades: 20,
        totalNetPnlPct: -0.01,
        rejectedReasons: {
          hour_filter: 10,
          trend_filter: 3,
        },
      }),
    ]);

    expect(diffs).toEqual([
      expect.objectContaining({
        experimentName: 'hour_22_only',
        tradeCountDiff: -80,
        newOrIncreasedRejectedReasons: {
          hour_filter: 8,
          trend_filter: 3,
        },
        comment: 'kills_too_many_trades',
      }),
    ]);
  });
});
