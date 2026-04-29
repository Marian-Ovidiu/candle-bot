import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAppConfig } from '../config/config';
import { computeRoundTripCostPct, runBacktest } from './backtestEngine';
import type { AppConfig } from '../config/config';

interface CandleSpec {
  open: number;
  high: number;
  low: number;
  close: number;
}

function buildConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    ...readAppConfig({} as NodeJS.ProcessEnv),
    backtestInputFile: '',
    ...overrides,
  };
}

function buildScenario(startTimeMs: number): { rows: string[]; firstTimestampMs: number } {
  const candles: CandleSpec[] = [
    { open: 100, high: 101, low: 99, close: 100.5 },
    { open: 100.5, high: 100.8, low: 98.5, close: 99.2 },
    { open: 99.2, high: 104, low: 98.8, close: 103 },
    { open: 103, high: 104, low: 100, close: 102 },
  ];

  const rows: string[] = [];
  candles.forEach((candle, index) => {
    const bucketStart = startTimeMs + index * 300_000;
    rows.push(JSON.stringify({ timestampMs: bucketStart, price: candle.open }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 60_000, price: candle.high }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 120_000, price: candle.low }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 240_000, price: candle.close }));
  });

  return {
    rows,
    firstTimestampMs: startTimeMs,
  };
}

function buildPullbackTradeScenario(startTimeMs: number): { rows: string[] } {
  const candles: CandleSpec[] = [
    { open: 100, high: 100.5, low: 99.5, close: 100 },
    { open: 100, high: 105, low: 99, close: 104.5 },
    { open: 104.5, high: 105, low: 103.2, close: 104.2 },
    { open: 104.2, high: 106, low: 102.8, close: 103.5 },
  ];

  const rows: string[] = [];
  candles.forEach((candle, index) => {
    const bucketStart = startTimeMs + index * 300_000;
    rows.push(JSON.stringify({ timestampMs: bucketStart, price: candle.open }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 60_000, price: candle.high }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 120_000, price: candle.low }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 240_000, price: candle.close }));
  });

  return { rows };
}

function buildBreakEvenExitScenario(startTimeMs: number): { rows: string[] } {
  const candles: CandleSpec[] = [
    { open: 100, high: 100.5, low: 99.5, close: 100 },
    { open: 100, high: 105, low: 99, close: 104.5 },
    { open: 104.5, high: 105, low: 103.2, close: 104.2 },
    { open: 104.2, high: 104.8, low: 104.0, close: 104.3 },
  ];

  const rows: string[] = [];
  candles.forEach((candle, index) => {
    const bucketStart = startTimeMs + index * 300_000;
    rows.push(JSON.stringify({ timestampMs: bucketStart, price: candle.open }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 60_000, price: candle.high }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 120_000, price: candle.low }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 240_000, price: candle.close }));
  });

  return { rows };
}

function buildTrailingExitScenario(startTimeMs: number): { rows: string[] } {
  const candles: CandleSpec[] = [
    { open: 100, high: 100.5, low: 99.5, close: 100 },
    { open: 100, high: 105, low: 99, close: 104.5 },
    { open: 104.5, high: 105, low: 103.2, close: 104.2 },
    { open: 104.2, high: 104.8, low: 104.4, close: 104.55 },
  ];

  const rows: string[] = [];
  candles.forEach((candle, index) => {
    const bucketStart = startTimeMs + index * 300_000;
    rows.push(JSON.stringify({ timestampMs: bucketStart, price: candle.open }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 60_000, price: candle.high }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 120_000, price: candle.low }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 240_000, price: candle.close }));
  });

  return { rows };
}

function buildSoftExitTriggerWithSlScenario(startTimeMs: number): { rows: string[] } {
  const candles: CandleSpec[] = [
    { open: 100, high: 100.5, low: 99.5, close: 100 },
    { open: 100, high: 105, low: 99, close: 104.5 },
    { open: 104.5, high: 105, low: 102.0, close: 103.0 },
    { open: 103.0, high: 104.0, low: 102.8, close: 103.5 },
  ];

  const rows: string[] = [];
  candles.forEach((candle, index) => {
    const bucketStart = startTimeMs + index * 300_000;
    rows.push(JSON.stringify({ timestampMs: bucketStart, price: candle.open }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 60_000, price: candle.high }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 120_000, price: candle.low }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 240_000, price: candle.close }));
  });

  return { rows };
}

function buildGapScenario(startTimeMs: number): { rows: string[] } {
  const candles: Array<{ startOffsetMs: number; open: number; high: number; low: number; close: number }> = [
    { startOffsetMs: 0, open: 100, high: 101, low: 99, close: 100.5 },
    { startOffsetMs: 300_000, open: 100.5, high: 101.5, low: 100, close: 101 },
    { startOffsetMs: 2_100_000, open: 101, high: 102, low: 100.5, close: 101.5 },
    { startOffsetMs: 2_400_000, open: 101.5, high: 102.5, low: 101, close: 102 },
  ];

  const rows: string[] = [];
  candles.forEach((candle) => {
    const bucketStart = startTimeMs + candle.startOffsetMs;
    rows.push(JSON.stringify({ timestampMs: bucketStart, price: candle.open }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 60_000, price: candle.high }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 120_000, price: candle.low }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 240_000, price: candle.close }));
  });

  return { rows };
}

async function writeScenarioFile(rows: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'candle-bot-backtest-'));
  const filePath = join(dir, 'input.jsonl');
  await writeFile(filePath, rows.join('\n'), 'utf8');
  return filePath;
}

describe('runBacktest diagnostics and filters', () => {
  it('computes the round trip cost pct from fee and slippage', () => {
    const config = buildConfig({
      feeBps: 6,
      slippageBps: 2,
    });

    expect(computeRoundTripCostPct(config)).toBeCloseTo(0.0016, 10);
  });

  it('includes configSnapshot and edge debug fields when edge passes', async () => {
    const scenario = buildScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableMinEdgeFilter: true,
        stopLossPct: 0.0012,
        takeProfitPct: 0.0022,
        minExpectedMovePct: 0.0016,
        feeBps: 6,
        slippageBps: 2,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

      expect(result.summary.configSnapshot).toMatchObject({
        candleIntervalMs: 300000,
        takeProfitPct: 0.0022,
        stopLossPct: 0.0012,
        holdCandles: 1,
      feeBps: 6,
      slippageBps: 2,
      initialEquity: 1000,
      positionNotional: 50,
      enableTrendFilter: false,
      trendTimeframeMultiplier: 3,
      trendLookbackCandles: 3,
      trendMinReturnPct: 0.001,
      allowNeutralTrend: true,
      enableMinEdgeFilter: true,
      minExpectedMovePct: 0.0016,
      enableSampleCountFilter: false,
      minSamplesPerCandle: 1,
    });

    expect(result.summary.diagnostics.filters.edge).toMatchObject({
      roundTripCostPct: 0.0016,
      requiredMovePct: 0.0016,
      takeProfitPct: 0.0022,
      minExpectedMovePct: 0.0016,
      blockedBy: null,
    });
    expect(result.summary.diagnostics.filters.edge.passed).toBeGreaterThan(0);
    expect(result.summary.diagnostics.filters.netRiskReward.roundTripCostPct).toBeCloseTo(
      0.0016,
      10,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.netRewardPct).toBeCloseTo(
      0.0006,
      10,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.netRiskPct).toBeCloseTo(0.0028, 10);
    expect(result.summary.diagnostics.filters.netRiskReward.netRiskReward).toBeCloseTo(
      0.2142857143,
      8,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.minNetRiskReward).toBe(1);
    expect(result.summary.diagnostics.filters.netRiskReward.blockedBy).toBeNull();
  });

  it('marks edge rejection with blockedBy when TP is below required move', async () => {
    const scenario = buildScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableMinEdgeFilter: true,
        takeProfitPct: 0.0012,
        minExpectedMovePct: 0.0016,
        feeBps: 6,
        slippageBps: 2,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.filters.edge).toMatchObject({
      roundTripCostPct: 0.0016,
      requiredMovePct: 0.0016,
      takeProfitPct: 0.0012,
      minExpectedMovePct: 0.0016,
      blockedBy: 'min_edge_rejected',
    });
    expect(result.summary.diagnostics.filters.edge.rejected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it('computes net risk reward diagnostics for the current cost model', async () => {
    const scenario = buildPullbackTradeScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableMinEdgeFilter: true,
        enableNetRiskRewardFilter: false,
        stopLossPct: 0.0012,
        takeProfitPct: 0.0022,
        feeBps: 6,
        slippageBps: 2,
        minExpectedMovePct: 0.0016,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.filters.netRiskReward.roundTripCostPct).toBeCloseTo(
      0.0016,
      10,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.netRewardPct).toBeCloseTo(
      0.0006,
      10,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.netRiskPct).toBeCloseTo(0.0028, 10);
    expect(result.summary.diagnostics.filters.netRiskReward.minNetRiskReward).toBe(1);
    expect(result.summary.diagnostics.filters.netRiskReward.blockedBy).toBeNull();
    expect(result.summary.diagnostics.filters.netRiskReward.netRiskReward).toBeCloseTo(
      0.2142857143,
      8,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.rejected).toBeGreaterThan(0);
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it('rejects entries when net risk reward filter is enabled and below threshold', async () => {
    const scenario = buildPullbackTradeScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableMinEdgeFilter: true,
        enableNetRiskRewardFilter: true,
        minNetRiskReward: 1,
        stopLossPct: 0.0012,
        takeProfitPct: 0.0022,
        feeBps: 6,
        slippageBps: 2,
        minExpectedMovePct: 0.0016,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.filters.netRiskReward.roundTripCostPct).toBeCloseTo(
      0.0016,
      10,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.netRewardPct).toBeCloseTo(
      0.0006,
      10,
    );
    expect(result.summary.diagnostics.filters.netRiskReward.netRiskPct).toBeCloseTo(0.0028, 10);
    expect(result.summary.diagnostics.filters.netRiskReward.minNetRiskReward).toBe(1);
    expect(result.summary.diagnostics.filters.netRiskReward.blockedBy).toBe(
      'net_risk_reward_rejected',
    );
    expect(result.summary.diagnostics.filters.netRiskReward.rejected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it('tracks mfe and mae on executed trades', async () => {
    const scenario = buildPullbackTradeScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableSampleCountFilter: false,
      }),
    );

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade).toMatchObject({
      maxFavorableExcursionPct: expect.any(Number),
      maxAdverseExcursionPct: expect.any(Number),
      bestPriceDuringHold: expect.any(Number),
      worstPriceDuringHold: expect.any(Number),
      exitDistanceFromTpPct: expect.any(Number),
      exitDistanceFromSlPct: expect.any(Number),
      touchedHalfTp: expect.any(Boolean),
      touchedHalfSl: expect.any(Boolean),
    });
    expect(result.summary).toMatchObject({
      avgMfePct: expect.any(Number),
      avgMaePct: expect.any(Number),
      maxMfePct: expect.any(Number),
      maxMaePct: expect.any(Number),
      tradesThatTouchedHalfTp: expect.any(Number),
      tradesThatTouchedHalfSl: expect.any(Number),
    });
  });

  it('does not close a break even exit until the candle after activation', async () => {
    const startTimeMs = 0;
    const triggerCandleEndTimeMs = startTimeMs + 3 * 300_000;
    const executableCandleEndTimeMs = startTimeMs + 4 * 300_000;
    const scenario = buildBreakEvenExitScenario(startTimeMs);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableSampleCountFilter: false,
        holdCandles: 5,
        takeProfitPct: 0.02,
        stopLossPct: 0.02,
        enableBreakEvenExit: true,
        breakEvenTriggerPct: 0.001,
        breakEvenExitBufferPct: 0.0001,
      }),
    );

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades.find((item) => item.closeReason === 'break_even_exit');
    expect(trade).toBeDefined();
    expect(trade?.exitTimeMs).not.toBe(triggerCandleEndTimeMs);
    expect(trade?.exitTimeMs).toBe(executableCandleEndTimeMs);
    expect(result.summary.diagnostics.exits.closedBreakEven).toBeGreaterThan(0);
  });

  it('does not close a trailing exit until the candle after activation', async () => {
    const startTimeMs = 0;
    const triggerCandleEndTimeMs = startTimeMs + 3 * 300_000;
    const executableCandleEndTimeMs = startTimeMs + 4 * 300_000;
    const scenario = buildTrailingExitScenario(startTimeMs);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableSampleCountFilter: false,
        holdCandles: 5,
        takeProfitPct: 0.02,
        stopLossPct: 0.02,
        enableBreakEvenExit: false,
        enableTrailingExit: true,
        trailingTriggerPct: 0.002,
        trailingDropPct: 0.0006,
      }),
    );

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades.find((item) => item.closeReason === 'trailing_exit');
    expect(trade).toBeDefined();
    expect(trade?.exitTimeMs).not.toBe(triggerCandleEndTimeMs);
    expect(trade?.exitTimeMs).toBe(executableCandleEndTimeMs);
    expect(result.summary.diagnostics.exits.closedTrailing).toBeGreaterThan(0);
  });

  it('keeps stop loss executable on the same candle as a soft exit trigger', async () => {
    const startTimeMs = 0;
    const triggerCandleEndTimeMs = startTimeMs + 3 * 300_000;
    const scenario = buildSoftExitTriggerWithSlScenario(startTimeMs);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableSampleCountFilter: false,
        holdCandles: 5,
        takeProfitPct: 0.02,
        stopLossPct: 0.02,
        enableBreakEvenExit: true,
        breakEvenTriggerPct: 0.001,
        breakEvenExitBufferPct: 0.0001,
        enableTrailingExit: true,
        trailingTriggerPct: 0.002,
        trailingDropPct: 0.0006,
      }),
    );

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades[0]).toMatchObject({
      closeReason: 'SL',
      exitTimeMs: triggerCandleEndTimeMs,
    });
    expect(result.summary.diagnostics.exits.closedSl).toBeGreaterThan(0);
  });

  it('reports sample filter rejections', async () => {
    const scenario = buildScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableSampleCountFilter: true,
        minSamplesPerCandle: 5,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.filters.sample.rejected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it('reports trend filter rejections', async () => {
    const scenario = buildScenario(3_600_000);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableTrendFilter: true,
        trendTimeframeMultiplier: 2,
        trendLookbackCandles: 1,
        trendMinReturnPct: 0.01,
        allowNeutralTrend: false,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.filters.trend.rejected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.strategyEvaluations).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it('resets strategy state after a large candle gap', async () => {
    const scenario = buildGapScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        maxCandleGapMultiplier: 3,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        enableDirectBreakoutEntry: false,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.gapResets).toBeGreaterThan(0);
    expect(result.summary.totalTrades).toBeGreaterThanOrEqual(0);
  });
});
