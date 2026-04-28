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
  };
}

export const config: AppConfig = readAppConfig();
