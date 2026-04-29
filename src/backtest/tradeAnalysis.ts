import { roundTo } from '../utils/math';
import type { BacktestTrade } from './metrics';

type ExitReasonBucket = 'tp' | 'sl' | 'timeout' | 'break_even' | 'trailing';

export interface TradeAnalysisGroup {
  count: number;
  winRate: number;
  totalNetPnlPct: number;
  avgNetPnlPct: number;
  avgMfePct: number;
  avgMaePct: number;
  avgHoldCandles: number;
}

export interface TradeAnalysis {
  byExitReason: Record<string, TradeAnalysisGroup>;
  byDirection: Record<string, TradeAnalysisGroup>;
  byEntryHourUtc: Record<string, TradeAnalysisGroup>;
  byImpulseStrengthBucket: Record<string, TradeAnalysisGroup>;
  compactSummary: {
    worstExitReason: string | null;
    bestDirection: string | null;
    bestHourBucket: string | null;
    bestImpulseBucket: string | null;
  };
}

const IMPULSE_BUCKETS = [
  { label: '0.12%-0.18%', min: 0.0012, max: 0.0018 },
  { label: '0.18%-0.25%', min: 0.0018, max: 0.0025 },
  { label: '0.25%-0.35%', min: 0.0025, max: 0.0035 },
  { label: '>0.35%', min: 0.0035, max: Number.POSITIVE_INFINITY },
] as const;

function normalizeExitReason(reason: BacktestTrade['closeReason']): ExitReasonBucket {
  if (reason === 'TP') {
    return 'tp';
  }
  if (reason === 'SL') {
    return 'sl';
  }
  if (reason === 'TIMEOUT') {
    return 'timeout';
  }
  if (reason === 'break_even_exit') {
    return 'break_even';
  }

  return 'trailing';
}

function getImpulseStrengthBucket(value: number): string {
  const bucket = IMPULSE_BUCKETS.find((item) => value >= item.min && value < item.max);
  return bucket?.label ?? '<0.12%';
}

function createGroup(trades: BacktestTrade[]): TradeAnalysisGroup {
  if (trades.length === 0) {
    return {
      count: 0,
      winRate: 0,
      totalNetPnlPct: 0,
      avgNetPnlPct: 0,
      avgMfePct: 0,
      avgMaePct: 0,
      avgHoldCandles: 0,
    };
  }

  const totalNetPnlPct = trades.reduce((sum, trade) => sum + trade.pnlNetPct, 0);
  const wins = trades.filter((trade) => trade.pnlNetPct > 0).length;
  const totalMfePct = trades.reduce((sum, trade) => sum + trade.maxFavorableExcursionPct, 0);
  const totalMaePct = trades.reduce((sum, trade) => sum + trade.maxAdverseExcursionPct, 0);
  const totalHoldCandles = trades.reduce((sum, trade) => sum + trade.holdCandles, 0);

  return {
    count: trades.length,
    winRate: roundTo(wins / trades.length, 8),
    totalNetPnlPct: roundTo(totalNetPnlPct, 8),
    avgNetPnlPct: roundTo(totalNetPnlPct / trades.length, 8),
    avgMfePct: roundTo(totalMfePct / trades.length, 8),
    avgMaePct: roundTo(totalMaePct / trades.length, 8),
    avgHoldCandles: roundTo(totalHoldCandles / trades.length, 8),
  };
}

function groupTrades(
  trades: BacktestTrade[],
  getKey: (trade: BacktestTrade) => string,
  initialKeys: string[] = [],
): Record<string, TradeAnalysisGroup> {
  const grouped = new Map<string, BacktestTrade[]>();
  for (const key of initialKeys) {
    grouped.set(key, []);
  }

  for (const trade of trades) {
    const key = getKey(trade);
    const bucket = grouped.get(key) ?? [];
    bucket.push(trade);
    grouped.set(key, bucket);
  }

  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [key, createGroup(bucket)]),
  );
}

function getBestGroup(groups: Record<string, TradeAnalysisGroup>): string | null {
  let bestKey: string | null = null;
  let bestAvgNetPnlPct = Number.NEGATIVE_INFINITY;

  for (const [key, group] of Object.entries(groups)) {
    if (group.count > 0 && group.avgNetPnlPct > bestAvgNetPnlPct) {
      bestKey = key;
      bestAvgNetPnlPct = group.avgNetPnlPct;
    }
  }

  return bestKey;
}

function getWorstGroup(groups: Record<string, TradeAnalysisGroup>): string | null {
  let worstKey: string | null = null;
  let worstAvgNetPnlPct = Number.POSITIVE_INFINITY;

  for (const [key, group] of Object.entries(groups)) {
    if (group.count > 0 && group.avgNetPnlPct < worstAvgNetPnlPct) {
      worstKey = key;
      worstAvgNetPnlPct = group.avgNetPnlPct;
    }
  }

  return worstKey;
}

export function buildTradeAnalysis(trades: BacktestTrade[]): TradeAnalysis {
  const byExitReason = groupTrades(
    trades,
    (trade) => normalizeExitReason(trade.closeReason),
    ['tp', 'sl', 'timeout', 'break_even', 'trailing'],
  );
  const byDirection = groupTrades(
    trades,
    (trade) => trade.direction.toLowerCase(),
    ['long', 'short'],
  );
  const byEntryHourUtc = groupTrades(trades, (trade) => {
    const hour = new Date(trade.entryTimeMs).getUTCHours();
    return `${String(hour).padStart(2, '0')}:00`;
  });
  const byImpulseStrengthBucket = groupTrades(
    trades,
    (trade) => getImpulseStrengthBucket(trade.entryStrengthPct),
    ['<0.12%', ...IMPULSE_BUCKETS.map((bucket) => bucket.label)],
  );

  return {
    byExitReason,
    byDirection,
    byEntryHourUtc,
    byImpulseStrengthBucket,
    compactSummary: {
      worstExitReason: getWorstGroup(byExitReason),
      bestDirection: getBestGroup(byDirection),
      bestHourBucket: getBestGroup(byEntryHourUtc),
      bestImpulseBucket: getBestGroup(byImpulseStrengthBucket),
    },
  };
}
