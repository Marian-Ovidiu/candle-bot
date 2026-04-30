import { describe, expect, it } from 'vitest';
import {
  createCandidateEdgesMarkdown,
  createComparisonMarkdown,
  selectCandidateEdges,
  sortByTrainExplorationRank,
  type TrainExperimentSummary,
} from './runTrainExplorationSuite';

function makeSummary(
  overrides: Partial<TrainExperimentSummary> & Pick<TrainExperimentSummary, 'experimentName'>,
): TrainExperimentSummary {
  const { experimentName, ...rest } = overrides;

  return {
    experimentName,
    totalTrades: 100,
    winRate: 0.5,
    totalNetPnlPct: 0.01,
    avgNetPnlPct: 0.0001,
    maxDrawdownPct: 0.02,
    profitFactor: 1.1,
    avgMfePct: 0.003,
    avgMaePct: 0.001,
    tradesThatTouchedHalfTp: 40,
    tradesThatTouchedHalfSl: 20,
    bestDirection: 'long',
    bestHourBucket: '08:00',
    bestImpulseBucket: '0.12%-0.18%',
    worstExitReason: 'sl',
    exitReasonBreakdown: {
      tp: 50,
      sl: 30,
      timeout: 20,
    },
    topRejectedReasons: [],
    outputDir: 'output/example',
    ...rest,
  };
}

describe('train exploration suite reporting', () => {
  it('sorts by total pnl, then profit factor, then trade count', () => {
    const sorted = sortByTrainExplorationRank([
      makeSummary({
        experimentName: 'baseline_no_filters',
        totalNetPnlPct: 0.01,
        profitFactor: 1.1,
        totalTrades: 100,
      }),
      makeSummary({
        experimentName: 'long_only',
        totalNetPnlPct: 0.02,
        profitFactor: 1.0,
        totalTrades: 50,
      }),
      makeSummary({
        experimentName: 'short_only',
        totalNetPnlPct: 0.01,
        profitFactor: 1.2,
        totalTrades: 40,
      }),
    ]);

    expect(sorted.map((summary) => summary.experimentName)).toEqual([
      'long_only',
      'short_only',
      'baseline_no_filters',
    ]);
  });

  it('renders comparison with exits and top rejected reasons', () => {
    const markdown = createComparisonMarkdown([
      makeSummary({
        experimentName: 'baseline_no_filters',
        topRejectedReasons: [
          { reason: 'sample_filter', count: 12 },
          { reason: 'hour_filter', count: 4 },
        ],
      }),
    ]);

    expect(markdown).toContain('sample_filter: 12');
    expect(markdown).toContain('tp: 50');
  });

  it('selects candidate edges from experiments and hour buckets', () => {
    const candidates = selectCandidateEdges(
      [
        makeSummary({
          experimentName: 'baseline_no_filters',
          totalTrades: 49,
        }),
        makeSummary({
          experimentName: 'impulse_confirmation_only',
          totalTrades: 80,
          totalNetPnlPct: 0.02,
          profitFactor: 1.2,
          maxDrawdownPct: 0.03,
        }),
      ],
      [
        makeSummary({
          experimentName: 'direct_breakout_hours_0_23',
          selectedHourUtc: 9,
          totalTrades: 75,
          totalNetPnlPct: 0.015,
          profitFactor: 1.1,
          maxDrawdownPct: 0.02,
        }),
      ],
    );

    expect(candidates.map((candidate) => candidate.name)).toEqual([
      'impulse_confirmation_only',
      'direct_breakout_hours_0_23_h09',
    ]);

    expect(createCandidateEdgesMarkdown(candidates)).toContain('hour_bucket');
  });
});
