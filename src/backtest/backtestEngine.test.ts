import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

function buildRowsFromCandles(startTimeMs: number, candles: CandleSpec[]): string[] {
  const rows: string[] = [];
  candles.forEach((candle, index) => {
    const bucketStart = startTimeMs + index * 300_000;
    rows.push(JSON.stringify({ timestampMs: bucketStart, price: candle.open }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 60_000, price: candle.high }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 120_000, price: candle.low }));
    rows.push(JSON.stringify({ timestampMs: bucketStart + 240_000, price: candle.close }));
  });

  return rows;
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
      avgGrossMfePct: expect.any(Number),
      avgNetMfePct: expect.any(Number),
      avgMaePct: expect.any(Number),
      maxMfePct: expect.any(Number),
      maxGrossMfePct: expect.any(Number),
      maxNetMfePct: expect.any(Number),
      maxMaePct: expect.any(Number),
      tradesThatTouchedHalfTp: expect.any(Number),
      tradesThatTouchedHalfSl: expect.any(Number),
    });

    const tradeAnalysis = JSON.parse(
      await readFile(join(result.outputDir, 'trade-analysis.json'), 'utf8'),
    ) as unknown;
    expect(tradeAnalysis).toMatchObject({
      byExitReason: expect.any(Object),
      byDirection: expect.any(Object),
      byEntryHourUtc: expect.any(Object),
      byImpulseStrengthBucket: expect.any(Object),
      compactSummary: expect.any(Object),
    });
  });

  it('reports gross MFE at least TP for trades closed by take profit', async () => {
    const takeProfitPct = 0.0016;
    const rows = buildRowsFromCandles(0, [
      { open: 100, high: 100.2, low: 99.8, close: 100 },
      { open: 100, high: 101, low: 99.9, close: 100.5 },
      { open: 100.5, high: 100.7, low: 100.45, close: 100.6 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableDirectBreakoutEntry: true,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        takeProfitPct,
        stopLossPct: 0.01,
        holdCandles: 5,
      }),
    );

    const tpTrades = result.trades.filter((trade) => trade.closeReason === 'TP');
    expect(tpTrades.length).toBeGreaterThan(0);
    for (const trade of tpTrades) {
      expect(trade.maxFavorableExcursionPct).toBeGreaterThanOrEqual(takeProfitPct);
      expect(trade.maxNetFavorableExcursionPct).toBeLessThanOrEqual(
        trade.maxFavorableExcursionPct,
      );
    }
    expect(result.summary.diagnostics.exits.closedTp).toBeGreaterThan(0);
    expect(result.summary.maxGrossMfePct).toBeGreaterThanOrEqual(takeProfitPct);
    expect(result.summary.maxMfePct).toBe(result.summary.maxGrossMfePct);
    expect(result.summary.avgMfePct).toBe(result.summary.avgGrossMfePct);
    expect(result.summary.maxNetMfePct).toBeLessThanOrEqual(result.summary.maxGrossMfePct);
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

  it('rejects entries outside allowed UTC hours', async () => {
    const scenario = buildScenario(Date.UTC(2026, 0, 1, 0, 0, 0));
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableHourFilter: true,
        allowedEntryHoursUtc: [7],
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.rejectedByHour).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it('rejects entries when impulse strength is above the configured max', async () => {
    const scenario = buildScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        impulseMaxReturnPct: 0.001,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.rejectedByImpulseTooStrong).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it('rejects entries when recent volatility is below threshold', async () => {
    const scenario = buildScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        minVolatilityPct: 0.2,
        recentRangeLookbackCandles: 2,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.rejectedByLowVolatility).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it('waits for follow-through confirmation after a valid impulse entry', async () => {
    const startTimeMs = 0;
    const impulseEndTimeMs = startTimeMs + 2 * 300_000;
    const confirmationEndTimeMs = startTimeMs + 3 * 300_000;
    const rows = buildRowsFromCandles(startTimeMs, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 105.2, low: 103.8, close: 105 },
      { open: 105, high: 105.4, low: 104.8, close: 105.1 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableFollowThroughConfirmation: true,
        confirmationMinReturnPct: 0.001,
        confirmationMinBodyToImpulseBodyRatio: 0.2,
        confirmationMaxWickToBodyRatio: 0.5,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        takeProfitPct: 0.1,
        stopLossPct: 0.1,
        holdCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.rejectedByNoFollowThrough).toBe(0);
    expect(result.summary.diagnostics.candidateSignals.entry).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: 'LONG',
      entryTimeMs: confirmationEndTimeMs,
    });
    expect(result.trades[0]?.entryTimeMs).not.toBe(impulseEndTimeMs);
  });

  it('rejects follow-through confirmation when the next candle does not continue direction', async () => {
    const rows = buildRowsFromCandles(0, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 104.2, low: 103.2, close: 103.5 },
      { open: 103.5, high: 104, low: 103, close: 103.7 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableFollowThroughConfirmation: true,
        confirmationMinReturnPct: 0.001,
        confirmationMinBodyToImpulseBodyRatio: 0.01,
        confirmationMaxWickToBodyRatio: 2,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
      }),
    );

    expect(result.summary.diagnostics.rejectedByNoFollowThrough).toBe(1);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.entry).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it('rejects follow-through confirmation when momentum quality is too weak', async () => {
    const rows = buildRowsFromCandles(0, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 105.2, low: 103.8, close: 104.2 },
      { open: 104.2, high: 104.5, low: 103.9, close: 104.3 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableFollowThroughConfirmation: true,
        confirmationMinReturnPct: 0.001,
        confirmationMinBodyToImpulseBodyRatio: 0.2,
        confirmationMaxWickToBodyRatio: 0.5,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
      }),
    );

    expect(result.summary.diagnostics.rejectedByNoFollowThrough).toBe(1);
    expect(result.summary.diagnostics.candidateSignals.rejected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.entry).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it('uses max hold candles when it is lower than hold candles', async () => {
    const scenario = buildPullbackTradeScenario(0);
    const filePath = await writeScenarioFile(scenario.rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        lookbackCandles: 1,
        breakoutLookbackCandles: 1,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        takeProfitPct: 0.2,
        stopLossPct: 0.2,
        holdCandles: 5,
        maxHoldCandles: 1,
      }),
    );

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades[0]?.holdCandles).toBe(1);
    expect(result.summary.configSnapshot.holdCandles).toBe(5);
    expect(result.summary.configSnapshot.maxHoldCandles).toBe(1);
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

  it('creates a LONG entry after a valid long impulse and long confirmation', async () => {
    const startTimeMs = 0;
    const rows = buildRowsFromCandles(startTimeMs, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 105.2, low: 103.8, close: 105 },
      { open: 105, high: 105.5, low: 104.5, close: 105.2 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableImpulseConfirmationEntry: true,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        impulseMinReturnPct: 0.01,
        impulseMinRangePct: 0.01,
        impulseMinBodyToRangeRatio: 0.5,
        impulseMaxWickToBodyRatio: 1,
        confirmationMinReturnPct: 0.001,
        recentRangeLookbackCandles: 3,
        minRecentRangeAvgPct: 0.005,
        takeProfitPct: 0.1,
        stopLossPct: 0.1,
        holdCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.candidateSignals.entry).toBe(1);
    expect(result.summary.diagnostics.impulseConfirmationEntries).toBe(1);
    expect(result.summary.diagnostics.impulseLong).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: 'LONG',
      entryTimeMs: startTimeMs + 3 * 300_000,
      entryPrice: 105,
    });
    expect(result.trades[0]?.entryTimeMs).not.toBe(startTimeMs + 2 * 300_000);
  });

  it('does not create an entry when a valid impulse has opposite confirmation', async () => {
    const rows = buildRowsFromCandles(0, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 104.2, low: 103.3, close: 103.5 },
      { open: 103.5, high: 104, low: 103, close: 103.7 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableImpulseConfirmationEntry: true,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        impulseMinReturnPct: 0.01,
        impulseMinRangePct: 0.01,
        impulseMinBodyToRangeRatio: 0.5,
        impulseMaxWickToBodyRatio: 1,
        confirmationMinReturnPct: 0.001,
        recentRangeLookbackCandles: 3,
        minRecentRangeAvgPct: 0.005,
      }),
    );

    expect(result.summary.diagnostics.impulseDetected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.confirmationRejectedDirection).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.entry).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it('does not create an entry when impulse and confirmation pass but recent volatility is too low', async () => {
    const rows = buildRowsFromCandles(0, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 105.2, low: 103.8, close: 105 },
      { open: 105, high: 105.5, low: 104.5, close: 105.2 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableImpulseConfirmationEntry: true,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        impulseMinReturnPct: 0.01,
        impulseMinRangePct: 0.01,
        impulseMinBodyToRangeRatio: 0.5,
        impulseMaxWickToBodyRatio: 1,
        confirmationMinReturnPct: 0.001,
        recentRangeLookbackCandles: 3,
        minRecentRangeAvgPct: 0.05,
      }),
    );

    expect(result.summary.diagnostics.confirmationPassed).toBeGreaterThan(0);
    expect(result.summary.diagnostics.volatilityRejected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.entry).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it('creates a SHORT fade entry after a bullish impulse and bearish retrace candle', async () => {
    const startTimeMs = 0;
    const rows = buildRowsFromCandles(startTimeMs, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 104.2, low: 102.8, close: 103.5 },
      { open: 103.5, high: 104, low: 103, close: 103.7 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableImpulseConfirmationEntry: false,
        enableImpulseFadeEntry: true,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        impulseMinReturnPct: 0.01,
        impulseMinRangePct: 0.01,
        impulseMinBodyToRangeRatio: 0.5,
        impulseMaxWickToBodyRatio: 1,
        confirmationMinReturnPct: 0.001,
        takeProfitPct: 0.1,
        stopLossPct: 0.1,
        holdCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.candidateSignals.entry).toBe(1);
    expect(result.summary.diagnostics.impulseFadeEntries).toBe(1);
    expect(result.summary.diagnostics.fadePassed).toBe(1);
    expect(result.summary.diagnostics.fadeShort).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: 'SHORT',
      entryTimeMs: startTimeMs + 3 * 300_000,
      entryPrice: 103.5,
    });
    expect(result.trades[0]?.entryTimeMs).not.toBe(startTimeMs + 2 * 300_000);
  });

  it('creates a LONG fade entry after a bearish impulse and bullish retrace candle', async () => {
    const startTimeMs = 0;
    const rows = buildRowsFromCandles(startTimeMs, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 100.2, low: 95.8, close: 96 },
      { open: 96, high: 97.2, low: 95.8, close: 97 },
      { open: 97, high: 97.4, low: 96.6, close: 97.2 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableImpulseConfirmationEntry: false,
        enableImpulseFadeEntry: true,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        impulseMinReturnPct: 0.01,
        impulseMinRangePct: 0.01,
        impulseMinBodyToRangeRatio: 0.5,
        impulseMaxWickToBodyRatio: 1,
        confirmationMinReturnPct: 0.001,
        takeProfitPct: 0.1,
        stopLossPct: 0.1,
        holdCandles: 1,
      }),
    );

    expect(result.summary.diagnostics.candidateSignals.entry).toBe(1);
    expect(result.summary.diagnostics.impulseFadeEntries).toBe(1);
    expect(result.summary.diagnostics.fadePassed).toBe(1);
    expect(result.summary.diagnostics.fadeLong).toBe(1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: 'LONG',
      entryTimeMs: startTimeMs + 3 * 300_000,
      entryPrice: 97,
    });
    expect(result.trades[0]?.entryTimeMs).not.toBe(startTimeMs + 2 * 300_000);
  });

  it('does not create a fade entry when the next candle continues the impulse direction', async () => {
    const rows = buildRowsFromCandles(0, [
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 100, high: 104.2, low: 99.8, close: 104 },
      { open: 104, high: 105.2, low: 103.8, close: 105 },
      { open: 105, high: 105.5, low: 104.5, close: 105.2 },
    ]);
    const filePath = await writeScenarioFile(rows);
    const result = await runBacktest(
      buildConfig({
        backtestInputFile: filePath,
        enableImpulseConfirmationEntry: false,
        enableImpulseFadeEntry: true,
        enableTrendFilter: false,
        enableMinEdgeFilter: false,
        enableNetRiskRewardFilter: false,
        enableSampleCountFilter: false,
        impulseMinReturnPct: 0.01,
        impulseMinRangePct: 0.01,
        impulseMinBodyToRangeRatio: 0.5,
        impulseMaxWickToBodyRatio: 1,
        confirmationMinReturnPct: 0.001,
      }),
    );

    expect(result.summary.diagnostics.impulseDetected).toBeGreaterThan(0);
    expect(result.summary.diagnostics.fadeRejectedDirection).toBeGreaterThan(0);
    expect(result.summary.diagnostics.candidateSignals.entry).toBe(0);
    expect(result.trades).toHaveLength(0);
  });
});
