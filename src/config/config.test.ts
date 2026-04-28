import { describe, expect, it } from 'vitest';
import { readAppConfig } from './config';

describe('readAppConfig', () => {
  it('parses typed values from env strings', () => {
    const config = readAppConfig({
      CANDLE_INTERVAL_MS: '60000',
      LOOKBACK_CANDLES: '5',
      BREAKOUT_LOOKBACK_CANDLES: '8',
      MIN_RETURN_PCT: '0.01',
      MIN_RANGE_PCT: '0.02',
      MIN_BODY_PCT: '0.03',
      MAX_WICK_TO_BODY_RATIO: '1.5',
      TAKE_PROFIT_PCT: '0.04',
      STOP_LOSS_PCT: '0.05',
      HOLD_CANDLES: '2',
      FEE_BPS: '7',
      SLIPPAGE_BPS: '3',
      INITIAL_EQUITY: '2500',
      POSITION_NOTIONAL: '100',
      BACKTEST_INPUT_FILE: 'data/input.jsonl',
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      candleIntervalMs: 60000,
      lookbackCandles: 5,
      breakoutLookbackCandles: 8,
      minReturnPct: 0.01,
      minRangePct: 0.02,
      minBodyPct: 0.03,
      maxWickToBodyRatio: 1.5,
      takeProfitPct: 0.04,
      stopLossPct: 0.05,
      holdCandles: 2,
      feeBps: 7,
      slippageBps: 3,
      initialEquity: 2500,
      positionNotional: 100,
      backtestInputFile: 'data/input.jsonl',
    });
  });

  it('falls back to defaults when env values are missing', () => {
    const config = readAppConfig({} as NodeJS.ProcessEnv);

    expect(config).toMatchObject({
      candleIntervalMs: 300000,
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
      initialEquity: 1000,
      positionNotional: 50,
      backtestInputFile: '',
    });
  });
});
