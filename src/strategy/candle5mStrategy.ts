import { roundTo } from '../utils/math';
import type { Candle } from '../data/candleTypes';
import type {
  Candle5mStrategyState,
  Candle5mStrategyStep,
  CandleFeatureSnapshot,
  StrategyConfig,
  StrategyDecision,
} from './strategyTypes';

function createEmptyState(): Candle5mStrategyState {
  return {
    waitingForPullback: null,
  };
}

export function createCandle5mStrategyState(): Candle5mStrategyState {
  return createEmptyState();
}

function evaluateLongSetup(snapshot: CandleFeatureSnapshot, config: StrategyConfig): boolean {
  return (
    snapshot.breakoutUp &&
    snapshot.returnPct >= config.minReturnPct &&
    snapshot.rangePct >= config.minRangePct &&
    snapshot.bodyPct >= config.minBodyPct &&
    snapshot.wickToBodyRatio <= config.maxWickToBodyRatio
  );
}

function evaluateShortSetup(snapshot: CandleFeatureSnapshot, config: StrategyConfig): boolean {
  return (
    snapshot.breakoutDown &&
    snapshot.returnPct <= -config.minReturnPct &&
    snapshot.rangePct >= config.minRangePct &&
    snapshot.bodyPct >= config.minBodyPct &&
    snapshot.wickToBodyRatio <= config.maxWickToBodyRatio
  );
}

function longSetupReasonCodes(snapshot: CandleFeatureSnapshot, config: StrategyConfig): string[] {
  const reasons: string[] = [];
  reasons.push(snapshot.breakoutUp ? 'BREAKOUT_UP' : 'NO_BREAKOUT_UP');
  reasons.push(snapshot.returnPct >= config.minReturnPct ? 'RETURN_OK' : 'RETURN_TOO_LOW');
  reasons.push(snapshot.rangePct >= config.minRangePct ? 'RANGE_OK' : 'RANGE_TOO_LOW');
  reasons.push(snapshot.bodyPct >= config.minBodyPct ? 'BODY_OK' : 'BODY_TOO_SMALL');
  reasons.push(snapshot.wickToBodyRatio <= config.maxWickToBodyRatio ? 'WICK_OK' : 'WICK_TOO_HIGH');
  return reasons;
}

function shortSetupReasonCodes(snapshot: CandleFeatureSnapshot, config: StrategyConfig): string[] {
  const reasons: string[] = [];
  reasons.push(snapshot.breakoutDown ? 'BREAKOUT_DOWN' : 'NO_BREAKOUT_DOWN');
  reasons.push(snapshot.returnPct <= -config.minReturnPct ? 'RETURN_OK' : 'RETURN_TOO_HIGH');
  reasons.push(snapshot.rangePct >= config.minRangePct ? 'RANGE_OK' : 'RANGE_TOO_LOW');
  reasons.push(snapshot.bodyPct >= config.minBodyPct ? 'BODY_OK' : 'BODY_TOO_SMALL');
  reasons.push(snapshot.wickToBodyRatio <= config.maxWickToBodyRatio ? 'WICK_OK' : 'WICK_TOO_HIGH');
  return reasons;
}

function computeStrength(snapshot: CandleFeatureSnapshot): number {
  return roundTo(snapshot.momentumScore, 6);
}

function midpointOfCandle(candle: Candle): number {
  return candle.low + (candle.high - candle.low) / 2;
}

function evaluatePullbackLong(
  snapshot: CandleFeatureSnapshot,
  breakoutCandle: Candle,
): boolean {
  return snapshot.candle.close <= breakoutCandle.close && snapshot.candle.close > midpointOfCandle(breakoutCandle);
}

function evaluatePullbackShort(
  snapshot: CandleFeatureSnapshot,
  breakoutCandle: Candle,
): boolean {
  return snapshot.candle.close >= breakoutCandle.close && snapshot.candle.close < midpointOfCandle(breakoutCandle);
}

function createDecision(
  shouldEnter: boolean,
  direction: StrategyDecision['direction'],
  reasonCodes: string[],
  strength: number,
  expectedHoldCandles: number,
): StrategyDecision {
  return {
    shouldEnter,
    direction,
    reasonCodes,
    strength,
    expectedHoldCandles,
  };
}

function directBreakoutLongReasonCodes(): string[] {
  return ['direct_breakout_entry_long'];
}

function directBreakoutShortReasonCodes(): string[] {
  return ['direct_breakout_entry_short'];
}

export function evaluateCandle5mStrategy(
  snapshot: CandleFeatureSnapshot,
  config: StrategyConfig,
  state: Candle5mStrategyState = createEmptyState(),
): Candle5mStrategyStep {
  const strength = computeStrength(snapshot);

  if (state.waitingForPullback) {
    const breakoutCandle = state.waitingForPullback.breakoutCandle;
    if (state.waitingForPullback.status === 'waiting_for_pullback_long') {
      if (evaluatePullbackLong(snapshot, breakoutCandle)) {
        if (!config.enableLongEntries) {
          return {
            decision: createDecision(
              false,
              'LONG',
              ['direction_long_disabled'],
              strength,
              config.holdCandles,
            ),
            nextState: createEmptyState(),
          };
        }

        return {
          decision: createDecision(
            true,
            'LONG',
            ['pullback_entry_long'],
            strength,
            config.holdCandles,
          ),
          nextState: createEmptyState(),
        };
      }
    } else if (evaluatePullbackShort(snapshot, breakoutCandle)) {
      if (!config.enableShortEntries) {
        return {
          decision: createDecision(
            false,
            'SHORT',
            ['direction_short_disabled'],
            strength,
            config.holdCandles,
          ),
          nextState: createEmptyState(),
        };
      }

      return {
        decision: createDecision(
          true,
          'SHORT',
          ['pullback_entry_short'],
          strength,
          config.holdCandles,
        ),
        nextState: createEmptyState(),
      };
    }

    return {
      decision: createDecision(
        false,
        null,
        ['pullback_failed'],
        strength,
        config.holdCandles,
      ),
      nextState: createEmptyState(),
    };
  }

  if (evaluateLongSetup(snapshot, config)) {
    if (!config.enableLongEntries) {
      return {
        decision: createDecision(
          false,
          'LONG',
          ['direction_long_disabled'],
          strength,
          config.holdCandles,
        ),
        nextState: createEmptyState(),
      };
    }

    if (config.enableDirectBreakoutEntry) {
      return {
        decision: createDecision(
          true,
          'LONG',
          directBreakoutLongReasonCodes(),
          strength,
          config.holdCandles,
        ),
        nextState: createEmptyState(),
      };
    }

    return {
      decision: createDecision(
        false,
        null,
        ['waiting_pullback'],
        strength,
        config.holdCandles,
      ),
      nextState: {
        waitingForPullback: {
          status: 'waiting_for_pullback_long',
          breakoutCandle: snapshot.candle,
        },
      },
    };
  }

  if (evaluateShortSetup(snapshot, config)) {
    if (!config.enableShortEntries) {
      return {
        decision: createDecision(
          false,
          'SHORT',
          ['direction_short_disabled'],
          strength,
          config.holdCandles,
        ),
        nextState: createEmptyState(),
      };
    }

    if (config.enableDirectBreakoutEntry) {
      return {
        decision: createDecision(
          true,
          'SHORT',
          directBreakoutShortReasonCodes(),
          strength,
          config.holdCandles,
        ),
        nextState: createEmptyState(),
      };
    }

    return {
      decision: createDecision(
        false,
        null,
        ['waiting_pullback'],
        strength,
        config.holdCandles,
      ),
      nextState: {
        waitingForPullback: {
          status: 'waiting_for_pullback_short',
          breakoutCandle: snapshot.candle,
        },
      },
    };
  }

  return {
    decision: createDecision(
      false,
      null,
      [...longSetupReasonCodes(snapshot, config), ...shortSetupReasonCodes(snapshot, config)],
      strength,
      config.holdCandles,
    ),
    nextState: createEmptyState(),
  };
}
