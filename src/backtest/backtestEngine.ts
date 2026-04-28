import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config as appConfig, type AppConfig } from '../config/config';
import { CandleBuilder } from '../data/candleBuilder';
import type { Candle } from '../data/candleTypes';
import { readJsonlMarketData } from '../data/jsonlReader';
import { buildFeatureSnapshots } from '../strategy/featureEngine';
import { createCandle5mStrategyState, evaluateCandle5mStrategy } from '../strategy/candle5mStrategy';
import type {
  CandleFeatureSnapshot,
  Candle5mStrategyState,
  StrategyConfig,
} from '../strategy/strategyTypes';
import { roundTo } from '../utils/math';
import { createSessionId } from '../utils/time';
import { computeBacktestMetrics, type BacktestMetrics, type BacktestTrade } from './metrics';

interface OpenTrade {
  entryTimeMs: number;
  entryPrice: number;
  direction: 'LONG' | 'SHORT';
  barsHeld: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  bestPriceDuringHold: number;
  worstPriceDuringHold: number;
  touchedHalfTp: boolean;
  touchedHalfSl: boolean;
  breakEvenActivated: boolean;
  trailingActivated: boolean;
}

type TrendBias = 'UP' | 'DOWN' | 'NEUTRAL';
type SignalKind = 'waiting' | 'entry';

interface SignalCandidate {
  kind: SignalKind;
  direction: 'LONG' | 'SHORT';
}

interface TrendAggregationState {
  current: Candle | null;
  count: number;
  completed: Candle[];
}

export interface BacktestDiagnostics {
  totalClosedCandles: number;
  strategyEvaluations: number;
  candidateSignals: {
    waiting: number;
    entry: number;
    accepted: number;
    rejected: number;
  };
  directEntries: number;
  pullbackEntries: number;
  gapResets: number;
  filters: {
    sample: {
      passed: number;
      rejected: number;
    };
    trend: {
      up: number;
      down: number;
      neutral: number;
      passed: number;
      rejected: number;
    };
    edge: {
      passed: number;
      rejected: number;
      roundTripCostPct: number;
      requiredMovePct: number;
      takeProfitPct: number;
      minExpectedMovePct: number;
      blockedBy: 'min_edge_rejected' | null;
    };
    netRiskReward: {
      passed: number;
      rejected: number;
      roundTripCostPct: number;
      netRewardPct: number;
      netRiskPct: number;
      netRiskReward: number;
      minNetRiskReward: number;
      blockedBy: 'net_risk_reward_rejected' | null;
    };
  };
  trades: {
    opened: number;
    closedTp: number;
    closedSl: number;
    closedTimeout: number;
    closedBreakEven: number;
    closedTrailing: number;
  };
  exits: {
    closedTp: number;
    closedSl: number;
    closedTimeout: number;
    closedBreakEven: number;
    closedTrailing: number;
  };
}

export interface BacktestSummary extends BacktestMetrics {
  sessionId: string;
  inputFile: string;
  totalRows: number;
  skippedRows: number;
  rejectedOutOfOrderCount: number;
  outputDir: string;
  configSnapshot: {
    candleIntervalMs: number;
    takeProfitPct: number;
    stopLossPct: number;
    holdCandles: number;
    feeBps: number;
    slippageBps: number;
    initialEquity: number;
    positionNotional: number;
    enableTrendFilter: boolean;
    trendTimeframeMultiplier: number;
    trendLookbackCandles: number;
    trendMinReturnPct: number;
    allowNeutralTrend: boolean;
    enableMinEdgeFilter: boolean;
    minExpectedMovePct: number;
    enableNetRiskRewardFilter: boolean;
    minNetRiskReward: number;
    enableSampleCountFilter: boolean;
    minSamplesPerCandle: number;
    enableBreakEvenExit: boolean;
    breakEvenTriggerPct: number;
    breakEvenExitBufferPct: number;
    enableTrailingExit: boolean;
    trailingTriggerPct: number;
    trailingDropPct: number;
    enableDirectBreakoutEntry: boolean;
    maxCandleGapMultiplier: number;
  };
  diagnostics: BacktestDiagnostics;
}

export interface BacktestRunResult {
  sessionId: string;
  outputDir: string;
  trades: BacktestTrade[];
  summary: BacktestSummary;
}

function toStrategyConfig(config: AppConfig): StrategyConfig {
  return {
    lookbackCandles: config.lookbackCandles,
    breakoutLookbackCandles: config.breakoutLookbackCandles,
    minReturnPct: config.minReturnPct,
    minRangePct: config.minRangePct,
    minBodyPct: config.minBodyPct,
    maxWickToBodyRatio: config.maxWickToBodyRatio,
    holdCandles: config.holdCandles,
    enableDirectBreakoutEntry: config.enableDirectBreakoutEntry,
  };
}

function createDiagnostics(config: AppConfig): BacktestDiagnostics {
  const roundTripCostPct = computeRoundTripCostPct(config);
  const requiredMovePct = Math.max(config.minExpectedMovePct, roundTripCostPct);

  return {
    totalClosedCandles: 0,
    strategyEvaluations: 0,
    candidateSignals: {
      waiting: 0,
      entry: 0,
      accepted: 0,
      rejected: 0,
    },
    directEntries: 0,
    pullbackEntries: 0,
    gapResets: 0,
    filters: {
      sample: {
        passed: 0,
        rejected: 0,
      },
      trend: {
        up: 0,
        down: 0,
        neutral: 0,
        passed: 0,
        rejected: 0,
      },
      edge: {
        passed: 0,
        rejected: 0,
        roundTripCostPct,
        requiredMovePct,
        takeProfitPct: config.takeProfitPct,
        minExpectedMovePct: config.minExpectedMovePct,
        blockedBy: null,
      },
      netRiskReward: {
        passed: 0,
        rejected: 0,
        roundTripCostPct,
        netRewardPct: config.takeProfitPct - roundTripCostPct,
        netRiskPct: config.stopLossPct + roundTripCostPct,
        netRiskReward:
          (config.takeProfitPct - roundTripCostPct) /
          (config.stopLossPct + roundTripCostPct),
        minNetRiskReward: config.minNetRiskReward,
        blockedBy: null,
      },
    },
    trades: {
      opened: 0,
      closedTp: 0,
      closedSl: 0,
      closedTimeout: 0,
      closedBreakEven: 0,
      closedTrailing: 0,
    },
    exits: {
      closedTp: 0,
      closedSl: 0,
      closedTimeout: 0,
      closedBreakEven: 0,
      closedTrailing: 0,
    },
  };
}

function createConfigSnapshot(config: AppConfig) {
  return {
    candleIntervalMs: config.candleIntervalMs,
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
    holdCandles: config.holdCandles,
    feeBps: config.feeBps,
    slippageBps: config.slippageBps,
    initialEquity: config.initialEquity,
    positionNotional: config.positionNotional,
    enableTrendFilter: config.enableTrendFilter,
    trendTimeframeMultiplier: config.trendTimeframeMultiplier,
    trendLookbackCandles: config.trendLookbackCandles,
    trendMinReturnPct: config.trendMinReturnPct,
    allowNeutralTrend: config.allowNeutralTrend,
    enableMinEdgeFilter: config.enableMinEdgeFilter,
    minExpectedMovePct: config.minExpectedMovePct,
    enableNetRiskRewardFilter: config.enableNetRiskRewardFilter,
    minNetRiskReward: config.minNetRiskReward,
    enableSampleCountFilter: config.enableSampleCountFilter,
    minSamplesPerCandle: config.minSamplesPerCandle,
    enableBreakEvenExit: config.enableBreakEvenExit,
    breakEvenTriggerPct: config.breakEvenTriggerPct,
    breakEvenExitBufferPct: config.breakEvenExitBufferPct,
    enableTrailingExit: config.enableTrailingExit,
    trailingTriggerPct: config.trailingTriggerPct,
    trailingDropPct: config.trailingDropPct,
    enableDirectBreakoutEntry: config.enableDirectBreakoutEntry,
    maxCandleGapMultiplier: config.maxCandleGapMultiplier,
  };
}

function recordExitDiagnostics(
  diagnostics: BacktestDiagnostics,
  reason: 'TP' | 'SL' | 'TIMEOUT' | 'break_even_exit' | 'trailing_exit',
): void {
  if (reason === 'TP') {
    diagnostics.trades.closedTp += 1;
    diagnostics.exits.closedTp += 1;
    return;
  }

  if (reason === 'SL') {
    diagnostics.trades.closedSl += 1;
    diagnostics.exits.closedSl += 1;
    return;
  }

  if (reason === 'TIMEOUT') {
    diagnostics.trades.closedTimeout += 1;
    diagnostics.exits.closedTimeout += 1;
    return;
  }

  if (reason === 'break_even_exit') {
    diagnostics.trades.closedBreakEven += 1;
    diagnostics.exits.closedBreakEven += 1;
    return;
  }

  diagnostics.trades.closedTrailing += 1;
  diagnostics.exits.closedTrailing += 1;
}

function createTrendAggregationState(): TrendAggregationState {
  return {
    current: null,
    count: 0,
    completed: [],
  };
}

function updateTrendAggregation(
  state: TrendAggregationState,
  candle: Candle,
  multiplier: number,
): void {
  const effectiveMultiplier = Math.max(1, Math.floor(multiplier));

  if (state.current === null) {
    state.current = { ...candle };
    state.count = 1;
    if (effectiveMultiplier === 1) {
      state.completed.push(state.current);
      state.current = null;
      state.count = 0;
    }
    return;
  }

  state.current = {
    ...state.current,
    high: Math.max(state.current.high, candle.high),
    low: Math.min(state.current.low, candle.low),
    close: candle.close,
    endTimeMs: candle.endTimeMs,
    sampleCount: state.current.sampleCount + candle.sampleCount,
  };
  state.count += 1;

  if (state.count >= effectiveMultiplier) {
    state.completed.push(state.current);
    state.current = null;
    state.count = 0;
  }
}

function evaluateTrendBias(
  completedTrendCandles: Candle[],
  lookbackCandles: number,
  minReturnPct: number,
): TrendBias {
  const lookback = Math.max(1, Math.floor(lookbackCandles));
  if (completedTrendCandles.length < lookback) {
    return 'NEUTRAL';
  }

  const window = completedTrendCandles.slice(-lookback);
  const first = window[0];
  const last = window[window.length - 1];
  if (!first || !last) {
    return 'NEUTRAL';
  }
  const returnPct = (last.close - first.open) / first.open;

  if (returnPct >= minReturnPct) {
    return 'UP';
  }

  if (returnPct <= -minReturnPct) {
    return 'DOWN';
  }

  return 'NEUTRAL';
}

function getSignalCandidate(step: ReturnType<typeof evaluateCandle5mStrategy>): SignalCandidate | null {
  if (step.decision.shouldEnter && step.decision.direction) {
    return {
      kind: 'entry',
      direction: step.decision.direction,
    };
  }

  if (step.decision.reasonCodes.includes('waiting_pullback')) {
    const waiting = step.nextState.waitingForPullback;
    if (!waiting) {
      return null;
    }

    return {
      kind: 'waiting',
      direction: waiting.status === 'waiting_for_pullback_long' ? 'LONG' : 'SHORT',
    };
  }

  return null;
}

function classifyEntryType(reasonCodes: string[]): 'direct' | 'pullback' | null {
  if (
    reasonCodes.includes('direct_breakout_entry_long') ||
    reasonCodes.includes('direct_breakout_entry_short')
  ) {
    return 'direct';
  }

  if (
    reasonCodes.includes('pullback_entry_long') ||
    reasonCodes.includes('pullback_entry_short')
  ) {
    return 'pullback';
  }

  return null;
}

export function computeRoundTripCostPct(config: AppConfig): number {
  return ((config.feeBps * 2) + (config.slippageBps * 2)) / 10_000;
}

interface SignalFilterResult {
  accepted: boolean;
  samplePassed: boolean;
  trendPassed: boolean;
  edgePassed: boolean;
  netRiskRewardPassed: boolean;
  trendBias: TrendBias;
  blockedBy: 'min_edge_rejected' | null;
  netRiskRewardBlockedBy: 'net_risk_reward_rejected' | null;
}

function evaluateSignalFilters(
  snapshot: CandleFeatureSnapshot,
  candidate: SignalCandidate,
  config: AppConfig,
  trendBias: TrendBias,
): SignalFilterResult {
  const samplePassed =
    !config.enableSampleCountFilter || snapshot.candle.sampleCount >= config.minSamplesPerCandle;

  const trendPassed = !config.enableTrendFilter
    ? true
    : trendBias === 'NEUTRAL'
      ? config.allowNeutralTrend
      : candidate.direction === 'LONG'
        ? trendBias === 'UP'
        : trendBias === 'DOWN';

  const roundTripCostPct = computeRoundTripCostPct(config);
  const requiredMovePct = Math.max(config.minExpectedMovePct, roundTripCostPct);
  const edgePassed =
    !config.enableMinEdgeFilter || config.takeProfitPct >= requiredMovePct;
  const netRewardPct = config.takeProfitPct - roundTripCostPct;
  const netRiskPct = config.stopLossPct + roundTripCostPct;
  const netRiskReward = netRiskPct === 0 ? 0 : netRewardPct / netRiskPct;
  const netRiskRewardPassed = netRiskReward >= config.minNetRiskReward;

  return {
    accepted:
      samplePassed &&
      trendPassed &&
      edgePassed &&
      (!config.enableNetRiskRewardFilter || netRiskRewardPassed),
    samplePassed,
    trendPassed,
    edgePassed,
    netRiskRewardPassed,
    trendBias,
    blockedBy: edgePassed ? null : 'min_edge_rejected',
    netRiskRewardBlockedBy:
      config.enableNetRiskRewardFilter && !netRiskRewardPassed
        ? 'net_risk_reward_rejected'
        : null,
  };
}

function computeGrossPnlPct(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  exitPrice: number,
): number {
  if (direction === 'LONG') {
    return (exitPrice - entryPrice) / entryPrice;
  }

  return (entryPrice - exitPrice) / entryPrice;
}

function updateTradeExcursions(
  trade: OpenTrade,
  candle: Candle,
  config: AppConfig,
): void {
  const entryPrice = trade.entryPrice;
  const halfTpMultiplier = 1 + config.takeProfitPct / 2;
  const halfSlMultiplier = 1 - config.stopLossPct / 2;

  if (trade.direction === 'LONG') {
    trade.bestPriceDuringHold = Math.max(trade.bestPriceDuringHold, candle.high);
    trade.worstPriceDuringHold = Math.min(trade.worstPriceDuringHold, candle.low);
    trade.maxFavorableExcursionPct = Math.max(
      trade.maxFavorableExcursionPct,
      (trade.bestPriceDuringHold - entryPrice) / entryPrice,
    );
    trade.maxAdverseExcursionPct = Math.max(
      trade.maxAdverseExcursionPct,
      (entryPrice - trade.worstPriceDuringHold) / entryPrice,
    );
    if (candle.high >= entryPrice * halfTpMultiplier) {
      trade.touchedHalfTp = true;
    }
    if (candle.low <= entryPrice * halfSlMultiplier) {
      trade.touchedHalfSl = true;
    }
    if (
      config.enableBreakEvenExit &&
      !trade.breakEvenActivated &&
      trade.maxFavorableExcursionPct >= config.breakEvenTriggerPct
    ) {
      trade.breakEvenActivated = true;
    }
    if (
      config.enableTrailingExit &&
      !trade.trailingActivated &&
      trade.maxFavorableExcursionPct >= config.trailingTriggerPct
    ) {
      trade.trailingActivated = true;
    }
    return;
  }

  trade.bestPriceDuringHold = Math.min(trade.bestPriceDuringHold, candle.low);
  trade.worstPriceDuringHold = Math.max(trade.worstPriceDuringHold, candle.high);
  trade.maxFavorableExcursionPct = Math.max(
    trade.maxFavorableExcursionPct,
    (entryPrice - trade.bestPriceDuringHold) / entryPrice,
  );
  trade.maxAdverseExcursionPct = Math.max(
    trade.maxAdverseExcursionPct,
    (trade.worstPriceDuringHold - entryPrice) / entryPrice,
  );
  if (candle.low <= entryPrice * (1 - config.takeProfitPct / 2)) {
    trade.touchedHalfTp = true;
  }
  if (candle.high >= entryPrice * (1 + config.stopLossPct / 2)) {
    trade.touchedHalfSl = true;
  }
  if (
    config.enableBreakEvenExit &&
    !trade.breakEvenActivated &&
    trade.maxFavorableExcursionPct >= config.breakEvenTriggerPct
  ) {
    trade.breakEvenActivated = true;
  }
  if (
    config.enableTrailingExit &&
    !trade.trailingActivated &&
    trade.maxFavorableExcursionPct >= config.trailingTriggerPct
  ) {
    trade.trailingActivated = true;
  }
}

function applySlippage(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  exitPrice: number,
  slippageBps: number,
): number {
  const slip = slippageBps / 10_000;

  if (direction === 'LONG') {
    const effectiveEntry = entryPrice * (1 + slip);
    const effectiveExit = exitPrice * (1 - slip);
    return (effectiveExit - effectiveEntry) / effectiveEntry;
  }

  const effectiveEntry = entryPrice * (1 - slip);
  const effectiveExit = exitPrice * (1 + slip);
  return (effectiveEntry - effectiveExit) / effectiveEntry;
}

function closeOpenTrade(
  trade: OpenTrade,
  candle: Candle,
  reason: 'TP' | 'SL' | 'TIMEOUT' | 'break_even_exit' | 'trailing_exit',
  exitPrice: number,
  config: AppConfig,
): BacktestTrade {
  const grossPnlPct = computeGrossPnlPct(trade.direction, trade.entryPrice, exitPrice);
  const slippageAdjustedPnlPct = applySlippage(
    trade.direction,
    trade.entryPrice,
    exitPrice,
    config.slippageBps,
  );
  const feePct = (config.feeBps * 2) / 10_000;

  const takeProfitPrice =
    trade.direction === 'LONG'
      ? trade.entryPrice * (1 + config.takeProfitPct)
      : trade.entryPrice * (1 - config.takeProfitPct);
  const stopLossPrice =
    trade.direction === 'LONG'
      ? trade.entryPrice * (1 - config.stopLossPct)
      : trade.entryPrice * (1 + config.stopLossPct);

  return {
    entryTimeMs: trade.entryTimeMs,
    exitTimeMs: candle.endTimeMs,
    direction: trade.direction,
    entryPrice: roundTo(trade.entryPrice, 10),
    exitPrice: roundTo(exitPrice, 10),
    pnlPct: roundTo(grossPnlPct, 10),
    pnlNetPct: roundTo(slippageAdjustedPnlPct - feePct, 10),
    reason,
    closeReason: reason,
    maxFavorableExcursionPct: roundTo(trade.maxFavorableExcursionPct, 10),
    maxAdverseExcursionPct: roundTo(trade.maxAdverseExcursionPct, 10),
    bestPriceDuringHold: roundTo(trade.bestPriceDuringHold, 10),
    worstPriceDuringHold: roundTo(trade.worstPriceDuringHold, 10),
    exitDistanceFromTpPct: roundTo(Math.abs(exitPrice - takeProfitPrice) / trade.entryPrice, 10),
    exitDistanceFromSlPct: roundTo(Math.abs(exitPrice - stopLossPrice) / trade.entryPrice, 10),
    touchedHalfTp: trade.touchedHalfTp,
    touchedHalfSl: trade.touchedHalfSl,
    breakEvenActivated: trade.breakEvenActivated,
    trailingActivated: trade.trailingActivated,
  };
}

function evaluateExitForCandle(
  trade: OpenTrade,
  candle: Candle,
  config: AppConfig,
): { shouldExit: boolean; reason?: 'TP' | 'SL' | 'break_even_exit' | 'trailing_exit'; exitPrice?: number } {
  const takeProfitPct = config.takeProfitPct;
  const stopLossPct = config.stopLossPct;

  if (trade.direction === 'LONG') {
    const takeProfitPrice = trade.entryPrice * (1 + takeProfitPct);
    const stopLossPrice = trade.entryPrice * (1 - stopLossPct);
    const breakEvenStopPrice = config.enableBreakEvenExit && trade.breakEvenActivated
      ? trade.entryPrice * (1 + config.breakEvenExitBufferPct)
      : stopLossPrice;
    const trailingStopPrice = config.enableTrailingExit && trade.trailingActivated
      ? trade.bestPriceDuringHold * (1 - config.trailingDropPct)
      : stopLossPrice;

    if (candle.low <= stopLossPrice) {
      if (config.enableTrailingExit && trade.trailingActivated && candle.low <= trailingStopPrice) {
        return { shouldExit: true, reason: 'trailing_exit', exitPrice: trailingStopPrice };
      }

      if (config.enableBreakEvenExit && trade.breakEvenActivated && candle.low <= breakEvenStopPrice) {
        return { shouldExit: true, reason: 'break_even_exit', exitPrice: breakEvenStopPrice };
      }

      return { shouldExit: true, reason: 'SL', exitPrice: stopLossPrice };
    }

    if (candle.high >= takeProfitPrice) {
      return { shouldExit: true, reason: 'TP', exitPrice: takeProfitPrice };
    }

    if (config.enableTrailingExit && trade.trailingActivated && candle.low <= trailingStopPrice) {
      return { shouldExit: true, reason: 'trailing_exit', exitPrice: trailingStopPrice };
    }

    if (config.enableBreakEvenExit && trade.breakEvenActivated && candle.low <= breakEvenStopPrice) {
      return { shouldExit: true, reason: 'break_even_exit', exitPrice: breakEvenStopPrice };
    }

    return { shouldExit: false };
  }

  const takeProfitPrice = trade.entryPrice * (1 - takeProfitPct);
  const stopLossPrice = trade.entryPrice * (1 + stopLossPct);
  const breakEvenStopPrice = config.enableBreakEvenExit && trade.breakEvenActivated
    ? trade.entryPrice * (1 - config.breakEvenExitBufferPct)
    : stopLossPrice;
  const trailingStopPrice = config.enableTrailingExit && trade.trailingActivated
    ? trade.bestPriceDuringHold * (1 + config.trailingDropPct)
    : stopLossPrice;

  if (candle.high >= stopLossPrice) {
    if (config.enableTrailingExit && trade.trailingActivated && candle.high >= trailingStopPrice) {
      return { shouldExit: true, reason: 'trailing_exit', exitPrice: trailingStopPrice };
    }

    if (config.enableBreakEvenExit && trade.breakEvenActivated && candle.high >= breakEvenStopPrice) {
      return { shouldExit: true, reason: 'break_even_exit', exitPrice: breakEvenStopPrice };
    }

    return { shouldExit: true, reason: 'SL', exitPrice: stopLossPrice };
  }

  if (candle.low <= takeProfitPrice) {
    return { shouldExit: true, reason: 'TP', exitPrice: takeProfitPrice };
  }

  if (config.enableTrailingExit && trade.trailingActivated && candle.high >= trailingStopPrice) {
    return { shouldExit: true, reason: 'trailing_exit', exitPrice: trailingStopPrice };
  }

  if (config.enableBreakEvenExit && trade.breakEvenActivated && candle.high >= breakEvenStopPrice) {
    return { shouldExit: true, reason: 'break_even_exit', exitPrice: breakEvenStopPrice };
  }

  return { shouldExit: false };
}

function getLatestSnapshot(
  candles: Candle[],
  strategyConfig: StrategyConfig,
): CandleFeatureSnapshot | undefined {
  if (candles.length === 0) {
    return undefined;
  }

  const snapshots = buildFeatureSnapshots(candles, strategyConfig);
  return snapshots[snapshots.length - 1];
}

export async function runBacktest(
  config: AppConfig = appConfig,
): Promise<BacktestRunResult> {
  if (config.backtestInputFile.trim() === '') {
    throw new Error('BACKTEST_INPUT_FILE is required');
  }

  const strategyConfig = toStrategyConfig(config);
  const marketData = await readJsonlMarketData(config.backtestInputFile);
  const candleBuilder = new CandleBuilder(config.candleIntervalMs);
  const closedCandles: Candle[] = [];
  const trades: BacktestTrade[] = [];
  let openTrade: OpenTrade | undefined;
  let strategyState: Candle5mStrategyState = createCandle5mStrategyState();
  const diagnostics = createDiagnostics(config);
  const trendState = createTrendAggregationState();
  const sessionId = createSessionId(marketData.points[0]?.timestampMs ?? 0);
  const outputDir = join('output', 'backtests', sessionId);
  const configSnapshot = createConfigSnapshot(config);
  let previousClosedCandle: Candle | null = null;

  const processClosedCandle = (
    candle: Candle,
    allowEntry: boolean,
  ): void => {
    closedCandles.push(candle);
    diagnostics.totalClosedCandles += 1;

    if (previousClosedCandle) {
      const deltaMs = candle.startTimeMs - previousClosedCandle.endTimeMs;
      const expectedInterval = config.candleIntervalMs;
      if (deltaMs > expectedInterval * config.maxCandleGapMultiplier) {
        diagnostics.gapResets += 1;
        strategyState = createCandle5mStrategyState();
      }
    }

    previousClosedCandle = candle;

    updateTrendAggregation(trendState, candle, config.trendTimeframeMultiplier);
    const trendBias = evaluateTrendBias(
      trendState.completed,
      config.trendLookbackCandles,
      config.trendMinReturnPct,
    );

    if (trendBias === 'UP') {
      diagnostics.filters.trend.up += 1;
    } else if (trendBias === 'DOWN') {
      diagnostics.filters.trend.down += 1;
    } else {
      diagnostics.filters.trend.neutral += 1;
    }

    if (openTrade) {
      openTrade.barsHeld += 1;
      updateTradeExcursions(openTrade, candle, config);
      const exitDecision = evaluateExitForCandle(openTrade, candle, config);

      if (exitDecision.shouldExit && exitDecision.reason && exitDecision.exitPrice !== undefined) {
        trades.push(
          closeOpenTrade(openTrade, candle, exitDecision.reason, exitDecision.exitPrice, config),
        );
        recordExitDiagnostics(diagnostics, exitDecision.reason);
        openTrade = undefined;
      } else if (openTrade.barsHeld >= config.holdCandles) {
        trades.push(
          closeOpenTrade(openTrade, candle, 'TIMEOUT', candle.close, config),
        );
        recordExitDiagnostics(diagnostics, 'TIMEOUT');
        openTrade = undefined;
      }
    }

    if (openTrade) {
      strategyState = createCandle5mStrategyState();
      return;
    }

    if (!allowEntry) {
      return;
    }

    const requiredHistory = Math.max(
      strategyConfig.lookbackCandles,
      strategyConfig.breakoutLookbackCandles,
    );

    if (closedCandles.length <= requiredHistory) {
      return;
    }

    const snapshot = getLatestSnapshot(closedCandles, strategyConfig);
    if (!snapshot) {
      return;
    }

    diagnostics.strategyEvaluations += 1;
    const step = evaluateCandle5mStrategy(snapshot, strategyConfig, strategyState);
    const candidate = getSignalCandidate(step);

    if (!candidate) {
      strategyState = step.nextState;
      return;
    }

    diagnostics.candidateSignals[candidate.kind] += 1;

    const filterResult = evaluateSignalFilters(snapshot, candidate, config, trendBias);
    if (!filterResult.samplePassed) {
      diagnostics.filters.sample.rejected += 1;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }
    diagnostics.filters.sample.passed += 1;

    if (!filterResult.trendPassed) {
      diagnostics.filters.trend.rejected += 1;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }
    diagnostics.filters.trend.passed += 1;

    if (!filterResult.edgePassed) {
      diagnostics.filters.edge.rejected += 1;
      diagnostics.filters.edge.blockedBy = filterResult.blockedBy;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }
    diagnostics.filters.edge.passed += 1;

    if (filterResult.netRiskRewardPassed) {
      diagnostics.filters.netRiskReward.passed += 1;
    } else {
      diagnostics.filters.netRiskReward.rejected += 1;
      diagnostics.filters.netRiskReward.blockedBy = filterResult.netRiskRewardBlockedBy;
      if (config.enableNetRiskRewardFilter) {
        diagnostics.candidateSignals.rejected += 1;
        strategyState = createCandle5mStrategyState();
        return;
      }
    }

    diagnostics.candidateSignals.accepted += 1;
    strategyState = step.nextState;

    if (step.decision.shouldEnter && step.decision.direction !== null) {
      const entryType = classifyEntryType(step.decision.reasonCodes);
      if (entryType === 'direct') {
        diagnostics.directEntries += 1;
      } else if (entryType === 'pullback') {
        diagnostics.pullbackEntries += 1;
      }

      openTrade = {
        entryTimeMs: candle.endTimeMs,
        entryPrice: candle.close,
        direction: step.decision.direction,
        barsHeld: 0,
        maxFavorableExcursionPct: 0,
        maxAdverseExcursionPct: 0,
        bestPriceDuringHold: candle.close,
        worstPriceDuringHold: candle.close,
        touchedHalfTp: false,
        touchedHalfSl: false,
        breakEvenActivated: false,
        trailingActivated: false,
      };
      diagnostics.trades.opened += 1;
    }
  };

  for (const point of marketData.points) {
    const closed = candleBuilder.update(point.timestampMs, point.price);
    if (closed) {
      processClosedCandle(closed, true);
    }
  }

  const finalCandle = candleBuilder.flush();
  if (finalCandle) {
    processClosedCandle(finalCandle, false);
  }

    if (openTrade) {
      const fallbackCandle = finalCandle ?? closedCandles[closedCandles.length - 1];
      if (fallbackCandle) {
        trades.push(
          closeOpenTrade(openTrade, fallbackCandle, 'TIMEOUT', fallbackCandle.close, config),
        );
        recordExitDiagnostics(diagnostics, 'TIMEOUT');
        openTrade = undefined;
      }
    }

  const metrics = computeBacktestMetrics(trades);
  const summary: BacktestSummary = {
    sessionId,
    inputFile: config.backtestInputFile,
    totalRows: marketData.totalRows,
    skippedRows: marketData.skippedRows,
    rejectedOutOfOrderCount: candleBuilder.rejectedOutOfOrderCount,
    outputDir,
    configSnapshot,
    diagnostics,
    ...metrics,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'trades.jsonl'),
    `${trades.map((trade) => JSON.stringify(trade)).join('\n')}${trades.length > 0 ? '\n' : ''}`,
    'utf8',
  );
  await writeFile(
    join(outputDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  return {
    sessionId,
    outputDir,
    trades,
    summary,
  };
}
