import type { Candle } from '../data/candleTypes';

export type FeatureDirection = 'up' | 'down' | 'flat';

export interface StrategyFeatureConfig {
  lookbackCandles: number;
  breakoutLookbackCandles: number;
  minReturnPct: number;
  minRangePct: number;
  minBodyPct: number;
  maxWickToBodyRatio: number;
}

export interface StrategyConfig extends StrategyFeatureConfig {
  holdCandles: number;
  enableDirectBreakoutEntry: boolean;
  enableLongEntries: boolean;
  enableShortEntries: boolean;
}

export interface CandleFeatureSnapshot {
  candle: Candle;
  returnPct: number;
  rangePct: number;
  bodyPct: number;
  upperWickPct: number;
  lowerWickPct: number;
  wickToBodyRatio: number;
  rollingReturnPct: number;
  rollingRangePct: number;
  breakoutUp: boolean;
  breakoutDown: boolean;
  direction: FeatureDirection;
  momentumScore: number;
}

export type StrategyDirection = 'LONG' | 'SHORT' | null;

export interface StrategyDecision {
  shouldEnter: boolean;
  direction: StrategyDirection;
  reasonCodes: string[];
  strength: number;
  expectedHoldCandles: number;
}

export type Candle5mPullbackStatus =
  | 'waiting_for_pullback_long'
  | 'waiting_for_pullback_short';

export interface Candle5mStrategyState {
  waitingForPullback: {
    status: Candle5mPullbackStatus;
    breakoutCandle: Candle;
  } | null;
}

export interface Candle5mStrategyStep {
  decision: StrategyDecision;
  nextState: Candle5mStrategyState;
}
