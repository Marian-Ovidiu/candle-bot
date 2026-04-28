import { roundTo } from '../utils/math';
import type { CandleFeatureSnapshot, StrategyConfig, StrategyDecision } from './strategyTypes';

function evaluateLong(snapshot: CandleFeatureSnapshot, config: StrategyConfig): string[] {
  const reasons: string[] = [];

  if (snapshot.breakoutUp) {
    reasons.push('BREAKOUT_UP');
  } else {
    reasons.push('NO_BREAKOUT_UP');
  }

  if (snapshot.returnPct >= config.minReturnPct) {
    reasons.push('RETURN_OK');
  } else {
    reasons.push('RETURN_TOO_LOW');
  }

  if (snapshot.rangePct >= config.minRangePct) {
    reasons.push('RANGE_OK');
  } else {
    reasons.push('RANGE_TOO_LOW');
  }

  if (snapshot.bodyPct >= config.minBodyPct) {
    reasons.push('BODY_OK');
  } else {
    reasons.push('BODY_TOO_SMALL');
  }

  if (snapshot.wickToBodyRatio <= config.maxWickToBodyRatio) {
    reasons.push('WICK_OK');
  } else {
    reasons.push('WICK_TOO_HIGH');
  }

  return reasons;
}

function evaluateShort(snapshot: CandleFeatureSnapshot, config: StrategyConfig): string[] {
  const reasons: string[] = [];

  if (snapshot.breakoutDown) {
    reasons.push('BREAKOUT_DOWN');
  } else {
    reasons.push('NO_BREAKOUT_DOWN');
  }

  if (snapshot.returnPct <= -config.minReturnPct) {
    reasons.push('RETURN_OK');
  } else {
    reasons.push('RETURN_TOO_HIGH');
  }

  if (snapshot.rangePct >= config.minRangePct) {
    reasons.push('RANGE_OK');
  } else {
    reasons.push('RANGE_TOO_LOW');
  }

  if (snapshot.bodyPct >= config.minBodyPct) {
    reasons.push('BODY_OK');
  } else {
    reasons.push('BODY_TOO_SMALL');
  }

  if (snapshot.wickToBodyRatio <= config.maxWickToBodyRatio) {
    reasons.push('WICK_OK');
  } else {
    reasons.push('WICK_TOO_HIGH');
  }

  return reasons;
}

function longSatisfied(snapshot: CandleFeatureSnapshot, config: StrategyConfig): boolean {
  return (
    snapshot.breakoutUp &&
    snapshot.returnPct >= config.minReturnPct &&
    snapshot.rangePct >= config.minRangePct &&
    snapshot.bodyPct >= config.minBodyPct &&
    snapshot.wickToBodyRatio <= config.maxWickToBodyRatio
  );
}

function shortSatisfied(snapshot: CandleFeatureSnapshot, config: StrategyConfig): boolean {
  return (
    snapshot.breakoutDown &&
    snapshot.returnPct <= -config.minReturnPct &&
    snapshot.rangePct >= config.minRangePct &&
    snapshot.bodyPct >= config.minBodyPct &&
    snapshot.wickToBodyRatio <= config.maxWickToBodyRatio
  );
}

function computeStrength(snapshot: CandleFeatureSnapshot): number {
  return roundTo(snapshot.momentumScore, 6);
}

export function evaluateCandle5mStrategy(
  snapshot: CandleFeatureSnapshot,
  config: StrategyConfig,
): StrategyDecision {
  if (longSatisfied(snapshot, config)) {
    return {
      shouldEnter: true,
      direction: 'LONG',
      reasonCodes: evaluateLong(snapshot, config),
      strength: computeStrength(snapshot),
      expectedHoldCandles: config.holdCandles,
    };
  }

  if (shortSatisfied(snapshot, config)) {
    return {
      shouldEnter: true,
      direction: 'SHORT',
      reasonCodes: evaluateShort(snapshot, config),
      strength: computeStrength(snapshot),
      expectedHoldCandles: config.holdCandles,
    };
  }

  const longReasons = evaluateLong(snapshot, config);
  const shortReasons = evaluateShort(snapshot, config);

  return {
    shouldEnter: false,
    direction: null,
    reasonCodes: [...longReasons, ...shortReasons],
    strength: computeStrength(snapshot),
    expectedHoldCandles: config.holdCandles,
  };
}
