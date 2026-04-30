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
import { roundTo, safeDiv } from '../utils/math';
import { createSessionId } from '../utils/time';
import { computeBacktestMetrics, type BacktestMetrics, type BacktestTrade } from './metrics';
import { buildTradeAnalysis, type TradeAnalysis } from './tradeAnalysis';

interface OpenTrade {
  entryTimeMs: number;
  entryPrice: number;
  direction: 'LONG' | 'SHORT';
  barsHeld: number;
  entryStrengthPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  bestPriceDuringHold: number;
  worstPriceDuringHold: number;
  touchedHalfTp: boolean;
  touchedHalfSl: boolean;
  breakEvenActivated: boolean;
  trailingActivated: boolean;
  breakEvenArmed: boolean;
  breakEvenArmedFromTimeMs: number | null;
  trailingArmed: boolean;
  trailingArmedFromTimeMs: number | null;
}

type TrendBias = 'UP' | 'DOWN' | 'NEUTRAL';
type SignalKind = 'waiting' | 'entry';
type ImpulseDirection = 'LONG' | 'SHORT';

interface SignalCandidate {
  kind: SignalKind;
  direction: 'LONG' | 'SHORT';
  reasonCodes: string[];
  strengthPct: number;
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
  impulseDetected: number;
  impulseLong: number;
  impulseShort: number;
  impulseRejectedReturn: number;
  impulseRejectedRange: number;
  impulseRejectedBodyToRange: number;
  impulseRejectedWick: number;
  confirmationPassed: number;
  confirmationRejectedDirection: number;
  confirmationRejectedReturn: number;
  volatilityPassed: number;
  volatilityRejected: number;
  impulseConfirmationEntries: number;
  impulseFadeEntries: number;
  fadePassed: number;
  fadeRejectedDirection: number;
  fadeRejectedReturn: number;
  fadeLong: number;
  fadeShort: number;
  rejectedByHour: number;
  rejectedByDirectionLongDisabled: number;
  rejectedByDirectionShortDisabled: number;
  rejectedByImpulseTooStrong: number;
  rejectedByLowVolatility: number;
  rejectedByNoFollowThrough: number;
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
  startTime: string | null;
  endTime: string | null;
  interval: string | null;
  missingCandles: number | null;
  duplicateCandles: number;
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
    enableHourFilter: boolean;
    allowedEntryHoursUtc: number[];
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
    enableImpulseConfirmationEntry: boolean;
    enableImpulseFadeEntry: boolean;
    enableFollowThroughConfirmation: boolean;
    impulseMinReturnPct: number;
    impulseMinRangePct: number;
    impulseMinBodyToRangeRatio: number;
    impulseMaxWickToBodyRatio: number;
    impulseMaxReturnPct: number;
    confirmationMinReturnPct: number;
    confirmationMinBodyToImpulseBodyRatio: number;
    confirmationMaxWickToBodyRatio: number;
    recentRangeLookbackCandles: number;
    minRecentRangeAvgPct: number;
    minVolatilityPct: number;
    maxCandleGapMultiplier: number;
    maxHoldCandles: number;
    enableLongEntries: boolean;
    enableShortEntries: boolean;
  };
  diagnostics: BacktestDiagnostics;
  tradeAnalysis: TradeAnalysis;
}

export interface BacktestRunResult {
  sessionId: string;
  outputDir: string;
  trades: BacktestTrade[];
  summary: BacktestSummary;
}

export interface BacktestRunOptions {
  outputDir?: string;
}

function toStrategyConfig(config: AppConfig): StrategyConfig {
  const effectiveHoldCandles = getEffectiveHoldCandles(config);
  return {
    lookbackCandles: config.lookbackCandles,
    breakoutLookbackCandles: config.breakoutLookbackCandles,
    minReturnPct: config.minReturnPct,
    minRangePct: config.minRangePct,
    minBodyPct: config.minBodyPct,
    maxWickToBodyRatio: config.maxWickToBodyRatio,
    holdCandles: effectiveHoldCandles,
    enableDirectBreakoutEntry: config.enableDirectBreakoutEntry,
    enableLongEntries: config.enableLongEntries,
    enableShortEntries: config.enableShortEntries,
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
    impulseDetected: 0,
    impulseLong: 0,
    impulseShort: 0,
    impulseRejectedReturn: 0,
    impulseRejectedRange: 0,
    impulseRejectedBodyToRange: 0,
    impulseRejectedWick: 0,
    confirmationPassed: 0,
    confirmationRejectedDirection: 0,
    confirmationRejectedReturn: 0,
    volatilityPassed: 0,
    volatilityRejected: 0,
    impulseConfirmationEntries: 0,
    impulseFadeEntries: 0,
    fadePassed: 0,
    fadeRejectedDirection: 0,
    fadeRejectedReturn: 0,
    fadeLong: 0,
    fadeShort: 0,
    rejectedByHour: 0,
    rejectedByDirectionLongDisabled: 0,
    rejectedByDirectionShortDisabled: 0,
    rejectedByImpulseTooStrong: 0,
    rejectedByLowVolatility: 0,
    rejectedByNoFollowThrough: 0,
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
    enableHourFilter: config.enableHourFilter,
    allowedEntryHoursUtc: config.allowedEntryHoursUtc,
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
    enableImpulseConfirmationEntry: config.enableImpulseConfirmationEntry,
    enableImpulseFadeEntry: config.enableImpulseFadeEntry,
    enableFollowThroughConfirmation: config.enableFollowThroughConfirmation,
    impulseMinReturnPct: config.impulseMinReturnPct,
    impulseMinRangePct: config.impulseMinRangePct,
    impulseMinBodyToRangeRatio: config.impulseMinBodyToRangeRatio,
    impulseMaxWickToBodyRatio: config.impulseMaxWickToBodyRatio,
    impulseMaxReturnPct: config.impulseMaxReturnPct,
    confirmationMinReturnPct: config.confirmationMinReturnPct,
    confirmationMinBodyToImpulseBodyRatio: config.confirmationMinBodyToImpulseBodyRatio,
    confirmationMaxWickToBodyRatio: config.confirmationMaxWickToBodyRatio,
    recentRangeLookbackCandles: config.recentRangeLookbackCandles,
    minRecentRangeAvgPct: config.minRecentRangeAvgPct,
    minVolatilityPct: config.minVolatilityPct,
    maxCandleGapMultiplier: config.maxCandleGapMultiplier,
    maxHoldCandles: config.maxHoldCandles,
    enableLongEntries: config.enableLongEntries,
    enableShortEntries: config.enableShortEntries,
  };
}

function getEffectiveHoldCandles(config: AppConfig): number {
  return Math.max(1, Math.floor(Math.min(config.holdCandles, config.maxHoldCandles)));
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

function getSignalCandidate(
  step: ReturnType<typeof evaluateCandle5mStrategy>,
  snapshot: CandleFeatureSnapshot,
): SignalCandidate | null {
  if (step.decision.shouldEnter && step.decision.direction) {
    return {
      kind: 'entry',
      direction: step.decision.direction,
      reasonCodes: step.decision.reasonCodes,
      strengthPct: Math.abs(snapshot.returnPct),
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
      reasonCodes: step.decision.reasonCodes,
      strengthPct: Math.abs(snapshot.returnPct),
    };
  }

  return null;
}

function classifyEntryType(reasonCodes: string[]): 'direct' | 'pullback' | 'impulse_confirmation' | 'impulse_fade' | null {
  if (reasonCodes.includes('impulse_fade_entry')) {
    return 'impulse_fade';
  }

  if (reasonCodes.includes('impulse_confirmation_entry')) {
    return 'impulse_confirmation';
  }

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

function normalizePositiveWindowSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function computeCandleRangePct(candle: Candle): number {
  return safeDiv(candle.high - candle.low, candle.open);
}

function computeAverageRecentRangePct(candles: Candle[], lookbackCandles: number): number {
  const lookback = normalizePositiveWindowSize(lookbackCandles);
  const recentCandles = candles.slice(-lookback);
  if (recentCandles.length === 0) {
    return 0;
  }

  return recentCandles.reduce(
    (sum, candle) => sum + computeCandleRangePct(candle),
    0,
  ) / recentCandles.length;
}

function passesVolatilityRegimeFilter(
  candles: Candle[],
  lookbackCandles: number,
  minVolatilityPct: number,
): boolean {
  if (minVolatilityPct <= 0) {
    return true;
  }

  return computeAverageRecentRangePct(candles, lookbackCandles) >= minVolatilityPct;
}

interface ValidImpulse {
  candle: Candle;
  direction: ImpulseDirection;
  returnPct: number;
  body: number;
}

function getImpulseDirection(candle: Candle): ImpulseDirection | null {
  if (candle.close > candle.open) {
    return 'LONG';
  }

  if (candle.close < candle.open) {
    return 'SHORT';
  }

  return null;
}

interface ImpulseMetrics {
  body: number;
  range: number;
  returnPct: number;
  rangePct: number;
  bodyToRangeRatio: number;
  wickToBodyRatio: number;
  direction: ImpulseDirection | null;
}

interface PendingFollowThroughEntry {
  impulseCandle: Candle;
  impulseMetrics: ImpulseMetrics;
  candidate: SignalCandidate;
  nextState: Candle5mStrategyState | null;
}

function computeImpulseMetrics(candle: Candle): ImpulseMetrics {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;

  return {
    body,
    range,
    returnPct: safeDiv(body, candle.open),
    rangePct: safeDiv(range, candle.open),
    bodyToRangeRatio: safeDiv(body, range),
    wickToBodyRatio: safeDiv(range - body, body),
    direction: getImpulseDirection(candle),
  };
}

function evaluateImpulseMetricThresholds(
  metrics: ImpulseMetrics,
  config: AppConfig,
): {
  returnPassed: boolean;
  rangePassed: boolean;
  bodyToRangePassed: boolean;
  wickPassed: boolean;
} {
  return {
    returnPassed: metrics.returnPct >= config.impulseMinReturnPct,
    rangePassed: metrics.rangePct >= config.impulseMinRangePct,
    bodyToRangePassed:
      metrics.bodyToRangeRatio >= config.impulseMinBodyToRangeRatio,
    wickPassed: metrics.wickToBodyRatio <= config.impulseMaxWickToBodyRatio,
  };
}

function isValidImpulseForFollowThrough(
  metrics: ImpulseMetrics,
  config: AppConfig,
): boolean {
  const thresholds = evaluateImpulseMetricThresholds(metrics, config);
  return Boolean(
    metrics.direction &&
    thresholds.returnPassed &&
    thresholds.rangePassed &&
    thresholds.bodyToRangePassed &&
    thresholds.wickPassed,
  );
}

function confirmationWickToBodyRatio(candle: Candle): number {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  return safeDiv(range - body, body);
}

function passesFollowThroughConfirmation(
  pending: PendingFollowThroughEntry,
  confirmation: Candle,
  config: AppConfig,
): boolean {
  const directionPassed = pending.candidate.direction === 'LONG'
    ? confirmation.close > pending.impulseCandle.close
    : confirmation.close < pending.impulseCandle.close;
  const confirmationBody = Math.abs(confirmation.close - confirmation.open);
  const confirmationReturnPct = safeDiv(confirmationBody, confirmation.open);
  const returnPassed =
    confirmationReturnPct >= config.confirmationMinReturnPct;
  const bodyQualityPassed =
    safeDiv(confirmationBody, pending.impulseMetrics.body) >=
    config.confirmationMinBodyToImpulseBodyRatio;
  const wickQualityPassed =
    confirmationWickToBodyRatio(confirmation) <=
    config.confirmationMaxWickToBodyRatio;

  return (
    directionPassed &&
    returnPassed &&
    bodyQualityPassed &&
    wickQualityPassed
  );
}

function evaluateValidImpulse(
  impulse: Candle,
  config: AppConfig,
  diagnostics: BacktestDiagnostics,
): ValidImpulse | null {
  const metrics = computeImpulseMetrics(impulse);
  const {
    returnPassed,
    rangePassed,
    bodyToRangePassed,
    wickPassed,
  } = evaluateImpulseMetricThresholds(metrics, config);

  if (!returnPassed) {
    diagnostics.impulseRejectedReturn += 1;
  }
  if (!rangePassed) {
    diagnostics.impulseRejectedRange += 1;
  }
  if (!bodyToRangePassed) {
    diagnostics.impulseRejectedBodyToRange += 1;
  }
  if (!wickPassed) {
    diagnostics.impulseRejectedWick += 1;
  }

  if (!returnPassed || !rangePassed || !bodyToRangePassed || !wickPassed) {
    return null;
  }

  const direction = metrics.direction;
  if (!direction) {
    return null;
  }

  diagnostics.impulseDetected += 1;
  if (direction === 'LONG') {
    diagnostics.impulseLong += 1;
  } else {
    diagnostics.impulseShort += 1;
  }

  return {
    candle: impulse,
    direction,
    returnPct: metrics.returnPct,
    body: metrics.body,
  };
}

function evaluateImpulseConfirmationCandidate(
  closedCandles: Candle[],
  config: AppConfig,
  diagnostics: BacktestDiagnostics,
): SignalCandidate | null {
  if (closedCandles.length < 2) {
    return null;
  }

  const impulse = closedCandles[closedCandles.length - 2];
  const confirmation = closedCandles[closedCandles.length - 1];
  if (!impulse || !confirmation) {
    return null;
  }

  const validImpulse = evaluateValidImpulse(impulse, config, diagnostics);
  if (!validImpulse) {
    return null;
  }

  const confirmationDirectionPassed = validImpulse.direction === 'LONG'
    ? confirmation.close > impulse.close
    : confirmation.close < impulse.close;
  const confirmationReturnPct = safeDiv(
    Math.abs(confirmation.close - confirmation.open),
    confirmation.open,
  );
  const confirmationReturnPassed =
    confirmationReturnPct >= config.confirmationMinReturnPct;

  if (!confirmationDirectionPassed) {
    diagnostics.confirmationRejectedDirection += 1;
  }
  if (!confirmationReturnPassed) {
    diagnostics.confirmationRejectedReturn += 1;
  }
  if (!confirmationDirectionPassed || !confirmationReturnPassed) {
    return null;
  }

  diagnostics.confirmationPassed += 1;

  const averageRecentRangePct = computeAverageRecentRangePct(
    closedCandles,
    config.recentRangeLookbackCandles,
  );
  if (averageRecentRangePct < config.minRecentRangeAvgPct) {
    diagnostics.volatilityRejected += 1;
    return null;
  }

  diagnostics.volatilityPassed += 1;

  if (
    (validImpulse.direction === 'LONG' && !config.enableLongEntries) ||
    (validImpulse.direction === 'SHORT' && !config.enableShortEntries)
  ) {
    return null;
  }

  return {
    kind: 'entry',
    direction: validImpulse.direction,
    reasonCodes: ['impulse_confirmation_entry'],
    strengthPct: validImpulse.returnPct,
  };
}

function evaluateImpulseFadeCandidate(
  closedCandles: Candle[],
  config: AppConfig,
  diagnostics: BacktestDiagnostics,
): SignalCandidate | null {
  if (closedCandles.length < 2) {
    return null;
  }

  const impulse = closedCandles[closedCandles.length - 2];
  const confirmation = closedCandles[closedCandles.length - 1];
  if (!impulse || !confirmation) {
    return null;
  }

  const validImpulse = evaluateValidImpulse(impulse, config, diagnostics);
  if (!validImpulse) {
    return null;
  }

  const fadeDirection: ImpulseDirection = validImpulse.direction === 'LONG' ? 'SHORT' : 'LONG';
  const fadeDirectionPassed = validImpulse.direction === 'LONG'
    ? confirmation.close < impulse.close
    : confirmation.close > impulse.close;
  const confirmationReturnPct = safeDiv(
    Math.abs(confirmation.close - confirmation.open),
    confirmation.open,
  );
  const fadeReturnPassed = confirmationReturnPct >= config.confirmationMinReturnPct;

  if (!fadeDirectionPassed) {
    diagnostics.fadeRejectedDirection += 1;
  }
  if (!fadeReturnPassed) {
    diagnostics.fadeRejectedReturn += 1;
  }
  if (!fadeDirectionPassed || !fadeReturnPassed) {
    return null;
  }

  diagnostics.fadePassed += 1;
  if (fadeDirection === 'LONG') {
    diagnostics.fadeLong += 1;
  } else {
    diagnostics.fadeShort += 1;
  }

  if (
    (fadeDirection === 'LONG' && !config.enableLongEntries) ||
    (fadeDirection === 'SHORT' && !config.enableShortEntries)
  ) {
    return null;
  }

  return {
    kind: 'entry',
    direction: fadeDirection,
    reasonCodes: ['impulse_fade_entry'],
    strengthPct: validImpulse.returnPct,
  };
}

export function computeRoundTripCostPct(config: AppConfig): number {
  return ((config.feeBps * 2) + (config.slippageBps * 2)) / 10_000;
}

interface SignalFilterResult {
  accepted: boolean;
  hourPassed: boolean;
  impulseStrengthPassed: boolean;
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
  const entryHourUtc = new Date(snapshot.candle.endTimeMs).getUTCHours();
  const hourPassed =
    !config.enableHourFilter || config.allowedEntryHoursUtc.includes(entryHourUtc);
  const impulseStrengthPassed =
    candidate.strengthPct <= config.impulseMaxReturnPct;
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
      hourPassed &&
      impulseStrengthPassed &&
      samplePassed &&
      trendPassed &&
      edgePassed &&
      (!config.enableNetRiskRewardFilter || netRiskRewardPassed),
    hourPassed,
    impulseStrengthPassed,
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
}

function armSoftExitsForNextCandle(
  trade: OpenTrade,
  candle: Candle,
  config: AppConfig,
): void {
  if (
    config.enableBreakEvenExit &&
    !trade.breakEvenArmed &&
    trade.maxFavorableExcursionPct >= config.breakEvenTriggerPct
  ) {
    trade.breakEvenActivated = true;
    trade.breakEvenArmed = true;
    trade.breakEvenArmedFromTimeMs = candle.endTimeMs;
  }

  if (
    config.enableTrailingExit &&
    !trade.trailingArmed &&
    trade.maxFavorableExcursionPct >= config.trailingTriggerPct
  ) {
    trade.trailingActivated = true;
    trade.trailingArmed = true;
    trade.trailingArmedFromTimeMs = candle.endTimeMs;
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

function computeNetExcursionPct(
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  grossExcursionPct: number,
  config: AppConfig,
): number {
  const favorableExitPrice =
    direction === 'LONG'
      ? entryPrice * (1 + grossExcursionPct)
      : entryPrice * (1 - grossExcursionPct);
  const slippageAdjustedPct = applySlippage(
    direction,
    entryPrice,
    favorableExitPrice,
    config.slippageBps,
  );
  const feePct = (config.feeBps * 2) / 10_000;

  return slippageAdjustedPct - feePct;
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
  const exitFavorableExcursionPct = Math.max(0, grossPnlPct);
  const maxGrossFavorableExcursionPct = Math.max(
    trade.maxFavorableExcursionPct,
    exitFavorableExcursionPct,
  );
  const maxNetFavorableExcursionPct = computeNetExcursionPct(
    trade.direction,
    trade.entryPrice,
    maxGrossFavorableExcursionPct,
    config,
  );
  const bestPriceDuringHold =
    exitFavorableExcursionPct > 0
      ? trade.direction === 'LONG'
        ? Math.max(trade.bestPriceDuringHold, exitPrice)
        : Math.min(trade.bestPriceDuringHold, exitPrice)
      : trade.bestPriceDuringHold;

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
    holdCandles: trade.barsHeld,
    entryStrengthPct: roundTo(trade.entryStrengthPct, 10),
    pnlPct: roundTo(grossPnlPct, 10),
    pnlNetPct: roundTo(slippageAdjustedPnlPct - feePct, 10),
    reason,
    closeReason: reason,
    maxFavorableExcursionPct: roundTo(maxGrossFavorableExcursionPct, 10),
    maxNetFavorableExcursionPct: roundTo(maxNetFavorableExcursionPct, 10),
    maxAdverseExcursionPct: roundTo(trade.maxAdverseExcursionPct, 10),
    bestPriceDuringHold: roundTo(bestPriceDuringHold, 10),
    worstPriceDuringHold: roundTo(trade.worstPriceDuringHold, 10),
    exitDistanceFromTpPct: roundTo(Math.abs(exitPrice - takeProfitPrice) / trade.entryPrice, 10),
    exitDistanceFromSlPct: roundTo(Math.abs(exitPrice - stopLossPrice) / trade.entryPrice, 10),
    touchedHalfTp: trade.touchedHalfTp,
    touchedHalfSl: trade.touchedHalfSl,
    breakEvenActivated: trade.breakEvenActivated,
    trailingActivated: trade.trailingActivated,
  };
}

function evaluateHardExitForCandle(
  trade: OpenTrade,
  candle: Candle,
  config: AppConfig,
): { shouldExit: boolean; reason?: 'TP' | 'SL'; exitPrice?: number } {
  const takeProfitPct = config.takeProfitPct;
  const stopLossPct = config.stopLossPct;

  if (trade.direction === 'LONG') {
    const takeProfitPrice = trade.entryPrice * (1 + takeProfitPct);
    const stopLossPrice = trade.entryPrice * (1 - stopLossPct);

    if (candle.low <= stopLossPrice) {
      return { shouldExit: true, reason: 'SL', exitPrice: stopLossPrice };
    }

    if (candle.high >= takeProfitPrice) {
      return { shouldExit: true, reason: 'TP', exitPrice: takeProfitPrice };
    }

    return { shouldExit: false };
  }

  const takeProfitPrice = trade.entryPrice * (1 - takeProfitPct);
  const stopLossPrice = trade.entryPrice * (1 + stopLossPct);

  if (candle.high >= stopLossPrice) {
    return { shouldExit: true, reason: 'SL', exitPrice: stopLossPrice };
  }

  if (candle.low <= takeProfitPrice) {
    return { shouldExit: true, reason: 'TP', exitPrice: takeProfitPrice };
  }

  return { shouldExit: false };
}

function evaluateArmedSoftExitForCandle(
  trade: OpenTrade,
  candle: Candle,
  config: AppConfig,
): { shouldExit: boolean; reason?: 'break_even_exit' | 'trailing_exit'; exitPrice?: number } {
  if (trade.direction === 'LONG') {
    const breakEvenStopPrice = trade.entryPrice * (1 + config.breakEvenExitBufferPct);
    const trailingStopPrice = trade.bestPriceDuringHold * (1 - config.trailingDropPct);
    const canExecuteBreakEven =
      config.enableBreakEvenExit &&
      trade.breakEvenArmed &&
      trade.breakEvenArmedFromTimeMs !== null &&
      trade.breakEvenArmedFromTimeMs < candle.endTimeMs;
    const canExecuteTrailing =
      config.enableTrailingExit &&
      trade.trailingArmed &&
      trade.trailingArmedFromTimeMs !== null &&
      trade.trailingArmedFromTimeMs < candle.endTimeMs;

    if (canExecuteTrailing && candle.low <= trailingStopPrice) {
      return { shouldExit: true, reason: 'trailing_exit', exitPrice: trailingStopPrice };
    }

    if (canExecuteBreakEven && candle.low <= breakEvenStopPrice) {
      return { shouldExit: true, reason: 'break_even_exit', exitPrice: breakEvenStopPrice };
    }

    return { shouldExit: false };
  }

  const breakEvenStopPrice = trade.entryPrice * (1 - config.breakEvenExitBufferPct);
  const trailingStopPrice = trade.bestPriceDuringHold * (1 + config.trailingDropPct);
  const canExecuteBreakEven =
    config.enableBreakEvenExit &&
    trade.breakEvenArmed &&
    trade.breakEvenArmedFromTimeMs !== null &&
    trade.breakEvenArmedFromTimeMs < candle.endTimeMs;
  const canExecuteTrailing =
    config.enableTrailingExit &&
    trade.trailingArmed &&
    trade.trailingArmedFromTimeMs !== null &&
    trade.trailingArmedFromTimeMs < candle.endTimeMs;

  if (canExecuteTrailing && candle.high >= trailingStopPrice) {
    return { shouldExit: true, reason: 'trailing_exit', exitPrice: trailingStopPrice };
  }

  if (canExecuteBreakEven && candle.high >= breakEvenStopPrice) {
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
  options: BacktestRunOptions = {},
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
  const sessionId = createSessionId(marketData.startTimeMs ?? 0);
  const outputDir = options.outputDir ?? join('output', 'backtests', sessionId);
  const configSnapshot = createConfigSnapshot(config);
  let previousClosedCandle: Candle | null = null;
  let pendingFollowThroughEntry: PendingFollowThroughEntry | null = null;

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
        pendingFollowThroughEntry = null;
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
      let exitDecision:
        | ReturnType<typeof evaluateHardExitForCandle>
        | ReturnType<typeof evaluateArmedSoftExitForCandle> =
        evaluateHardExitForCandle(openTrade, candle, config);

      if (!exitDecision.shouldExit) {
        exitDecision = evaluateArmedSoftExitForCandle(openTrade, candle, config);
      }

      if (exitDecision.shouldExit && exitDecision.reason && exitDecision.exitPrice !== undefined) {
        trades.push(
          closeOpenTrade(openTrade, candle, exitDecision.reason, exitDecision.exitPrice, config),
        );
        recordExitDiagnostics(diagnostics, exitDecision.reason);
        openTrade = undefined;
      } else if (openTrade.barsHeld >= getEffectiveHoldCandles(config)) {
        trades.push(
          closeOpenTrade(openTrade, candle, 'TIMEOUT', candle.close, config),
        );
        recordExitDiagnostics(diagnostics, 'TIMEOUT');
        openTrade = undefined;
      } else {
        updateTradeExcursions(openTrade, candle, config);
        armSoftExitsForNextCandle(openTrade, candle, config);
      }
    }

    if (openTrade) {
      strategyState = createCandle5mStrategyState();
      return;
    }

    if (!allowEntry) {
      return;
    }

    const impulseDetectorEnabled =
      config.enableImpulseConfirmationEntry || config.enableImpulseFadeEntry;
    const requiredHistory = impulseDetectorEnabled
      ? config.enableImpulseConfirmationEntry
        ? Math.max(2, normalizePositiveWindowSize(config.recentRangeLookbackCandles)) - 1
        : 1
      : Math.max(
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
    let step: ReturnType<typeof evaluateCandle5mStrategy> | null = null;
    let candidate: SignalCandidate | null = null;
    let candidateNextState: Candle5mStrategyState | null = null;
    let candidateConfirmedByFollowThrough = false;

    if (pendingFollowThroughEntry) {
      if (!passesFollowThroughConfirmation(pendingFollowThroughEntry, candle, config)) {
        diagnostics.rejectedByNoFollowThrough += 1;
        diagnostics.candidateSignals.rejected += 1;
        pendingFollowThroughEntry = null;
        strategyState = createCandle5mStrategyState();
        return;
      }

      candidate = pendingFollowThroughEntry.candidate;
      candidateNextState = pendingFollowThroughEntry.nextState;
      pendingFollowThroughEntry = null;
      candidateConfirmedByFollowThrough = true;
    } else {
      step = impulseDetectorEnabled
        ? null
        : evaluateCandle5mStrategy(snapshot, strategyConfig, strategyState);
      candidate = impulseDetectorEnabled
        ? (
          config.enableImpulseConfirmationEntry
            ? evaluateImpulseConfirmationCandidate(closedCandles, config, diagnostics)
            : null
        ) ?? (
          config.enableImpulseFadeEntry
            ? evaluateImpulseFadeCandidate(closedCandles, config, diagnostics)
            : null
        )
        : step
          ? getSignalCandidate(step, snapshot)
          : null;
      candidateNextState = step ? step.nextState : null;
    }

    if (!candidate && step?.decision.direction === 'LONG' && step.decision.reasonCodes.includes('direction_long_disabled')) {
      diagnostics.rejectedByDirectionLongDisabled += 1;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }

    if (!candidate && step?.decision.direction === 'SHORT' && step.decision.reasonCodes.includes('direction_short_disabled')) {
      diagnostics.rejectedByDirectionShortDisabled += 1;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }

    if (!candidate) {
      if (step) {
        strategyState = step.nextState;
      }
      return;
    }

    const entryTypeForFollowThrough = classifyEntryType(candidate.reasonCodes);
    const impulseMetrics = computeImpulseMetrics(candle);
    const shouldWaitForFollowThrough =
      config.enableFollowThroughConfirmation &&
      !candidateConfirmedByFollowThrough &&
      candidate.kind === 'entry' &&
      (entryTypeForFollowThrough === 'direct' ||
        entryTypeForFollowThrough === 'pullback') &&
      isValidImpulseForFollowThrough(impulseMetrics, config);

    if (shouldWaitForFollowThrough) {
      pendingFollowThroughEntry = {
        impulseCandle: candle,
        impulseMetrics,
        candidate,
        nextState: candidateNextState,
      };
      strategyState = candidateNextState ?? createCandle5mStrategyState();
      return;
    }

    diagnostics.candidateSignals[candidate.kind] += 1;

    const filterResult = evaluateSignalFilters(snapshot, candidate, config, trendBias);
    if (!filterResult.hourPassed) {
      diagnostics.rejectedByHour += 1;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }

    if (!filterResult.impulseStrengthPassed) {
      diagnostics.rejectedByImpulseTooStrong += 1;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }

    if (
      !passesVolatilityRegimeFilter(
        closedCandles,
        config.recentRangeLookbackCandles,
        config.minVolatilityPct,
      )
    ) {
      diagnostics.rejectedByLowVolatility += 1;
      diagnostics.candidateSignals.rejected += 1;
      strategyState = createCandle5mStrategyState();
      return;
    }

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
    strategyState = candidateNextState ?? createCandle5mStrategyState();

    if (candidate.kind === 'entry') {
      const entryType = classifyEntryType(candidate.reasonCodes);
      if (entryType === 'direct') {
        diagnostics.directEntries += 1;
      } else if (entryType === 'pullback') {
        diagnostics.pullbackEntries += 1;
      } else if (entryType === 'impulse_confirmation') {
        diagnostics.impulseConfirmationEntries += 1;
      } else if (entryType === 'impulse_fade') {
        diagnostics.impulseFadeEntries += 1;
      }

      openTrade = {
        entryTimeMs: candle.endTimeMs,
        entryPrice: candle.close,
        direction: candidate.direction,
        barsHeld: 0,
        entryStrengthPct: candidate.strengthPct,
        maxFavorableExcursionPct: 0,
        maxAdverseExcursionPct: 0,
        bestPriceDuringHold: candle.close,
        worstPriceDuringHold: candle.close,
        touchedHalfTp: false,
        touchedHalfSl: false,
        breakEvenActivated: false,
        trailingActivated: false,
        breakEvenArmed: false,
        breakEvenArmedFromTimeMs: null,
        trailingArmed: false,
        trailingArmedFromTimeMs: null,
      };
      diagnostics.trades.opened += 1;
    }
  };

  if (marketData.candles.length > 0) {
    marketData.candles.forEach((candle, index) => {
      processClosedCandle(candle, index < marketData.candles.length - 1);
    });
  } else {
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
  }

  const finalCandle = closedCandles[closedCandles.length - 1];

    if (openTrade) {
      const fallbackCandle = finalCandle;
      if (fallbackCandle) {
        trades.push(
          closeOpenTrade(openTrade, fallbackCandle, 'TIMEOUT', fallbackCandle.close, config),
        );
        recordExitDiagnostics(diagnostics, 'TIMEOUT');
        openTrade = undefined;
      }
    }

  const metrics = computeBacktestMetrics(trades);
  const tradeAnalysis = buildTradeAnalysis(trades);
  const summary: BacktestSummary = {
    sessionId,
    inputFile: config.backtestInputFile,
    totalRows: marketData.totalRows,
    skippedRows: marketData.skippedRows,
    rejectedOutOfOrderCount: candleBuilder.rejectedOutOfOrderCount,
    startTime: marketData.startTimeMs === null ? null : new Date(marketData.startTimeMs).toISOString(),
    endTime: marketData.endTimeMs === null ? null : new Date(marketData.endTimeMs).toISOString(),
    interval: marketData.interval,
    missingCandles: marketData.missingCandles,
    duplicateCandles: marketData.duplicateCandles,
    outputDir,
    configSnapshot,
    diagnostics,
    tradeAnalysis,
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
  await writeFile(
    join(outputDir, 'trade-analysis.json'),
    `${JSON.stringify(tradeAnalysis, null, 2)}\n`,
    'utf8',
  );

  return {
    sessionId,
    outputDir,
    trades,
    summary,
  };
}
