import { roundTo, safeDiv } from '../utils/math';
import type { Candle } from '../data/candleTypes';
import type {
  CandleFeatureSnapshot,
  FeatureDirection,
  StrategyFeatureConfig,
} from './strategyTypes';

function normalizeWindowSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function getDirection(returnPct: number): FeatureDirection {
  if (returnPct > 0) {
    return 'up';
  }

  if (returnPct < 0) {
    return 'down';
  }

  return 'flat';
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeMomentumScore(
  snapshot: Omit<CandleFeatureSnapshot, 'momentumScore'>,
  config: StrategyFeatureConfig,
): number {
  const normalizedReturn = safeDiv(snapshot.returnPct, config.minReturnPct);
  const normalizedRange = safeDiv(snapshot.rangePct, config.minRangePct);
  const normalizedBody = safeDiv(snapshot.bodyPct, config.minBodyPct);
  const wickPenalty = snapshot.wickToBodyRatio > config.maxWickToBodyRatio ? snapshot.wickToBodyRatio : 0;
  const breakoutBonus = snapshot.breakoutUp ? 1 : snapshot.breakoutDown ? -1 : 0;
  const directionBias = snapshot.direction === 'up' ? 0.25 : snapshot.direction === 'down' ? -0.25 : 0;

  return roundTo(
    normalizedReturn * 0.5 +
      normalizedRange * 0.25 +
      normalizedBody * 0.25 +
      snapshot.rollingReturnPct * 10 +
      snapshot.rollingRangePct * 5 +
      breakoutBonus * 2 +
      directionBias -
      wickPenalty * 0.5,
    6,
  );
}

function buildSnapshot(
  candle: Candle,
  previousCandles: Candle[],
  config: StrategyFeatureConfig,
): CandleFeatureSnapshot {
  const open = candle.open;
  const close = candle.close;
  const high = candle.high;
  const low = candle.low;

  const range = high - low;
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  const returnPct = safeDiv(close - open, open);
  const rangePct = safeDiv(range, open);
  const bodyPct = safeDiv(body, open);
  const upperWickPct = safeDiv(upperWick, open);
  const lowerWickPct = safeDiv(lowerWick, open);
  const wickToBodyRatio = safeDiv(upperWickPct + lowerWickPct, bodyPct);

  const lookbackWindowSize = normalizeWindowSize(config.lookbackCandles);
  const breakoutWindowSize = normalizeWindowSize(config.breakoutLookbackCandles);

  const rollingSource = lookbackWindowSize === 0
    ? []
    : previousCandles.slice(-lookbackWindowSize);

  const rollingReturnPct = average(
    rollingSource.map((previousCandle) => safeDiv(previousCandle.close - previousCandle.open, previousCandle.open)),
  );
  const rollingRangePct = average(
    rollingSource.map((previousCandle) => safeDiv(previousCandle.high - previousCandle.low, previousCandle.open)),
  );

  const breakoutSource = breakoutWindowSize === 0
    ? []
    : previousCandles.slice(-breakoutWindowSize);

  const previousHighs = breakoutSource.map((previousCandle) => previousCandle.high);
  const previousLows = breakoutSource.map((previousCandle) => previousCandle.low);

  const breakoutUp =
    breakoutSource.length > 0 &&
    close > Math.max(...previousHighs);
  const breakoutDown =
    breakoutSource.length > 0 &&
    close < Math.min(...previousLows);

  const direction = getDirection(returnPct);
  const partialSnapshot: Omit<CandleFeatureSnapshot, 'momentumScore'> = {
    candle,
    returnPct,
    rangePct,
    bodyPct,
    upperWickPct,
    lowerWickPct,
    wickToBodyRatio,
    rollingReturnPct,
    rollingRangePct,
    breakoutUp,
    breakoutDown,
    direction,
  };

  return {
    ...partialSnapshot,
    momentumScore: computeMomentumScore(partialSnapshot, config),
  };
}

export function buildFeatureSnapshots(
  candles: Candle[],
  config: StrategyFeatureConfig,
): CandleFeatureSnapshot[] {
  const snapshots: CandleFeatureSnapshot[] = [];
  const previousCandles: Candle[] = [];

  for (const candle of candles) {
    snapshots.push(buildSnapshot(candle, previousCandles, config));
    previousCandles.push(candle);
  }

  return snapshots;
}
