import { roundTo } from '../utils/math';
import type { CandleFeatureSnapshot, StrategyConfig, StrategyDecision } from './strategyTypes';

function computeStrength(snapshot: CandleFeatureSnapshot): number {
  return roundTo(Math.abs(snapshot.momentumScore), 6);
}

export function evaluateMeanReversionStrategy(
  snapshot: CandleFeatureSnapshot,
  config: StrategyConfig,
): StrategyDecision {
  const bearish = snapshot.candle.close < snapshot.candle.open;
  const bullish = snapshot.candle.close > snapshot.candle.open;

  const longSignal =
    snapshot.returnPct <= -config.minReturnPct &&
    snapshot.rangePct >= config.minRangePct &&
    bearish;

  if (longSignal) {
    return {
      shouldEnter: true,
      direction: 'LONG',
      reasonCodes: ['mean_reversion_long'],
      strength: computeStrength(snapshot),
      expectedHoldCandles: config.holdCandles,
    };
  }

  const shortSignal =
    snapshot.returnPct >= config.minReturnPct &&
    snapshot.rangePct >= config.minRangePct &&
    bullish;

  if (shortSignal) {
    return {
      shouldEnter: true,
      direction: 'SHORT',
      reasonCodes: ['mean_reversion_short'],
      strength: computeStrength(snapshot),
      expectedHoldCandles: config.holdCandles,
    };
  }

  const reasonCodes: string[] = [];
  if (!bearish) {
    reasonCodes.push('NO_BEARISH_MOMENTUM');
  }
  if (!bullish) {
    reasonCodes.push('NO_BULLISH_MOMENTUM');
  }
  if (Math.abs(snapshot.returnPct) < config.minReturnPct) {
    reasonCodes.push('RETURN_TOO_SMALL');
  }
  if (snapshot.rangePct < config.minRangePct) {
    reasonCodes.push('RANGE_TOO_LOW');
  }

  return {
    shouldEnter: false,
    direction: null,
    reasonCodes,
    strength: computeStrength(snapshot),
    expectedHoldCandles: config.holdCandles,
  };
}
