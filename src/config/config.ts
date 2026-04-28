export interface AppConfig {
  candleIntervalMs: number;
  lookbackCandles: number;
  breakoutLookbackCandles: number;
  minReturnPct: number;
  minRangePct: number;
  minBodyPct: number;
  maxWickToBodyRatio: number;
  takeProfitPct: number;
  stopLossPct: number;
  holdCandles: number;
  feeBps: number;
  slippageBps: number;
  initialEquity: number;
  positionNotional: number;
  backtestInputFile: string;
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
  enableLongEntries: boolean;
  enableShortEntries: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  candleIntervalMs: 300_000,
  lookbackCandles: 3,
  breakoutLookbackCandles: 3,
  minReturnPct: 0.001,
  minRangePct: 0.0008,
  minBodyPct: 0.0005,
  maxWickToBodyRatio: 2.5,
  takeProfitPct: 0.002,
  stopLossPct: 0.0015,
  holdCandles: 1,
  feeBps: 6,
  slippageBps: 2,
  initialEquity: 1_000,
  positionNotional: 50,
  backtestInputFile: '',
  enableTrendFilter: false,
  trendTimeframeMultiplier: 3,
  trendLookbackCandles: 3,
  trendMinReturnPct: 0.001,
  allowNeutralTrend: true,
  enableMinEdgeFilter: false,
  minExpectedMovePct: 0.001,
  enableNetRiskRewardFilter: false,
  minNetRiskReward: 1,
  enableSampleCountFilter: false,
  minSamplesPerCandle: 1,
  enableBreakEvenExit: false,
  breakEvenTriggerPct: 0.0016,
  breakEvenExitBufferPct: 0.0001,
  enableTrailingExit: false,
  trailingTriggerPct: 0.002,
  trailingDropPct: 0.0006,
  enableDirectBreakoutEntry: true,
  maxCandleGapMultiplier: 3,
  enableLongEntries: true,
  enableShortEntries: true,
};

function readNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric config value for ${key}: ${raw}`);
  }

  return parsed;
}

function readString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  const raw = env[key];
  return raw === undefined ? fallback : raw;
}

function readBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(`Invalid boolean config value for ${key}: ${raw}`);
}

export function readAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    candleIntervalMs: readNumber(env, 'CANDLE_INTERVAL_MS', DEFAULT_CONFIG.candleIntervalMs),
    lookbackCandles: readNumber(env, 'LOOKBACK_CANDLES', DEFAULT_CONFIG.lookbackCandles),
    breakoutLookbackCandles: readNumber(
      env,
      'BREAKOUT_LOOKBACK_CANDLES',
      DEFAULT_CONFIG.breakoutLookbackCandles,
    ),
    minReturnPct: readNumber(env, 'MIN_RETURN_PCT', DEFAULT_CONFIG.minReturnPct),
    minRangePct: readNumber(env, 'MIN_RANGE_PCT', DEFAULT_CONFIG.minRangePct),
    minBodyPct: readNumber(env, 'MIN_BODY_PCT', DEFAULT_CONFIG.minBodyPct),
    maxWickToBodyRatio: readNumber(
      env,
      'MAX_WICK_TO_BODY_RATIO',
      DEFAULT_CONFIG.maxWickToBodyRatio,
    ),
    takeProfitPct: readNumber(env, 'TAKE_PROFIT_PCT', DEFAULT_CONFIG.takeProfitPct),
    stopLossPct: readNumber(env, 'STOP_LOSS_PCT', DEFAULT_CONFIG.stopLossPct),
    holdCandles: readNumber(env, 'HOLD_CANDLES', DEFAULT_CONFIG.holdCandles),
    feeBps: readNumber(env, 'FEE_BPS', DEFAULT_CONFIG.feeBps),
    slippageBps: readNumber(env, 'SLIPPAGE_BPS', DEFAULT_CONFIG.slippageBps),
    initialEquity: readNumber(env, 'INITIAL_EQUITY', DEFAULT_CONFIG.initialEquity),
    positionNotional: readNumber(
      env,
      'POSITION_NOTIONAL',
      DEFAULT_CONFIG.positionNotional,
    ),
    backtestInputFile: readString(
      env,
      'BACKTEST_INPUT_FILE',
      DEFAULT_CONFIG.backtestInputFile,
    ),
    enableTrendFilter: readBoolean(
      env,
      'ENABLE_TREND_FILTER',
      DEFAULT_CONFIG.enableTrendFilter,
    ),
    trendTimeframeMultiplier: readNumber(
      env,
      'TREND_TIMEFRAME_MULTIPLIER',
      DEFAULT_CONFIG.trendTimeframeMultiplier,
    ),
    trendLookbackCandles: readNumber(
      env,
      'TREND_LOOKBACK_CANDLES',
      DEFAULT_CONFIG.trendLookbackCandles,
    ),
    trendMinReturnPct: readNumber(
      env,
      'TREND_MIN_RETURN_PCT',
      DEFAULT_CONFIG.trendMinReturnPct,
    ),
    allowNeutralTrend: readBoolean(
      env,
      'ALLOW_NEUTRAL_TREND',
      DEFAULT_CONFIG.allowNeutralTrend,
    ),
    enableMinEdgeFilter: readBoolean(
      env,
      'ENABLE_MIN_EDGE_FILTER',
      DEFAULT_CONFIG.enableMinEdgeFilter,
    ),
    minExpectedMovePct: readNumber(
      env,
      'MIN_EXPECTED_MOVE_PCT',
      DEFAULT_CONFIG.minExpectedMovePct,
    ),
    enableNetRiskRewardFilter: readBoolean(
      env,
      'ENABLE_NET_RISK_REWARD_FILTER',
      DEFAULT_CONFIG.enableNetRiskRewardFilter,
    ),
    minNetRiskReward: readNumber(
      env,
      'MIN_NET_RISK_REWARD',
      DEFAULT_CONFIG.minNetRiskReward,
    ),
    enableSampleCountFilter: readBoolean(
      env,
      'ENABLE_SAMPLE_COUNT_FILTER',
      DEFAULT_CONFIG.enableSampleCountFilter,
    ),
    minSamplesPerCandle: readNumber(
      env,
      'MIN_SAMPLES_PER_CANDLE',
      DEFAULT_CONFIG.minSamplesPerCandle,
    ),
    enableBreakEvenExit: readBoolean(
      env,
      'ENABLE_BREAK_EVEN_EXIT',
      DEFAULT_CONFIG.enableBreakEvenExit,
    ),
    breakEvenTriggerPct: readNumber(
      env,
      'BREAK_EVEN_TRIGGER_PCT',
      DEFAULT_CONFIG.breakEvenTriggerPct,
    ),
    breakEvenExitBufferPct: readNumber(
      env,
      'BREAK_EVEN_EXIT_BUFFER_PCT',
      DEFAULT_CONFIG.breakEvenExitBufferPct,
    ),
    enableTrailingExit: readBoolean(
      env,
      'ENABLE_TRAILING_EXIT',
      DEFAULT_CONFIG.enableTrailingExit,
    ),
    trailingTriggerPct: readNumber(
      env,
      'TRAILING_TRIGGER_PCT',
      DEFAULT_CONFIG.trailingTriggerPct,
    ),
    trailingDropPct: readNumber(
      env,
      'TRAILING_DROP_PCT',
      DEFAULT_CONFIG.trailingDropPct,
    ),
    enableDirectBreakoutEntry: readBoolean(
      env,
      'ENABLE_DIRECT_BREAKOUT_ENTRY',
      DEFAULT_CONFIG.enableDirectBreakoutEntry,
    ),
    maxCandleGapMultiplier: readNumber(
      env,
      'MAX_CANDLE_GAP_MULTIPLIER',
      DEFAULT_CONFIG.maxCandleGapMultiplier,
    ),
    enableLongEntries: readBoolean(
      env,
      'ENABLE_LONG_ENTRIES',
      DEFAULT_CONFIG.enableLongEntries,
    ),
    enableShortEntries: readBoolean(
      env,
      'ENABLE_SHORT_ENTRIES',
      DEFAULT_CONFIG.enableShortEntries,
    ),
  };
}

export const config: AppConfig = readAppConfig();
