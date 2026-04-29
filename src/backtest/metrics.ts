import { roundTo } from '../utils/math';

export interface BacktestTrade {
  entryTimeMs: number;
  exitTimeMs: number;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  holdCandles: number;
  entryStrengthPct: number;
  pnlPct: number;
  pnlNetPct: number;
  reason: 'TP' | 'SL' | 'TIMEOUT' | 'break_even_exit' | 'trailing_exit';
  closeReason: 'TP' | 'SL' | 'TIMEOUT' | 'break_even_exit' | 'trailing_exit';
  maxFavorableExcursionPct: number;
  maxNetFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  bestPriceDuringHold: number;
  worstPriceDuringHold: number;
  exitDistanceFromTpPct: number;
  exitDistanceFromSlPct: number;
  touchedHalfTp: boolean;
  touchedHalfSl: boolean;
  breakEvenActivated: boolean;
  trailingActivated: boolean;
}

export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  totalNetPnlPct: number;
  avgNetPnlPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  avgMfePct: number;
  avgGrossMfePct: number;
  avgNetMfePct: number;
  avgMaePct: number;
  maxMfePct: number;
  maxGrossMfePct: number;
  maxNetMfePct: number;
  maxMaePct: number;
  tradesThatTouchedHalfTp: number;
  tradesThatTouchedHalfSl: number;
}

export function computeBacktestMetrics(trades: BacktestTrade[]): BacktestMetrics {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      totalNetPnlPct: 0,
      avgNetPnlPct: 0,
      maxDrawdownPct: 0,
      profitFactor: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      avgMfePct: 0,
      avgGrossMfePct: 0,
      avgNetMfePct: 0,
      avgMaePct: 0,
      maxMfePct: 0,
      maxGrossMfePct: 0,
      maxNetMfePct: 0,
      maxMaePct: 0,
      tradesThatTouchedHalfTp: 0,
      tradesThatTouchedHalfSl: 0,
    };
  }

  const netReturns = trades.map((trade) => trade.pnlNetPct);
  const wins = netReturns.filter((pnl) => pnl > 0);
  const losses = netReturns.filter((pnl) => pnl < 0);
  const totalNetPnlPct = netReturns.reduce((sum, pnl) => sum + pnl, 0);
  const avgNetPnlPct = totalNetPnlPct / totalTrades;
  const winRate = wins.length / totalTrades;
  const avgWinPct = wins.length === 0 ? 0 : wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length;
  const avgLossPct = losses.length === 0 ? 0 : losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length;

  const totalWinPct = wins.reduce((sum, pnl) => sum + pnl, 0);
  const totalLossPct = losses.reduce((sum, pnl) => sum + pnl, 0);
  const profitFactor =
    totalLossPct === 0
      ? totalWinPct > 0
        ? Number.MAX_SAFE_INTEGER
        : 0
      : totalWinPct / Math.abs(totalLossPct);

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  const grossMfeValues = trades.map((trade) => trade.maxFavorableExcursionPct);
  const netMfeValues = trades.map((trade) => trade.maxNetFavorableExcursionPct);
  const maeValues = trades.map((trade) => trade.maxAdverseExcursionPct);
  const avgGrossMfePct = grossMfeValues.reduce((sum, value) => sum + value, 0) / totalTrades;
  const avgNetMfePct = netMfeValues.reduce((sum, value) => sum + value, 0) / totalTrades;
  const avgMaePct = maeValues.reduce((sum, value) => sum + value, 0) / totalTrades;
  const maxGrossMfePct = Math.max(...grossMfeValues);
  const maxNetMfePct = Math.max(...netMfeValues);
  const maxMaePct = Math.max(...maeValues);
  const tradesThatTouchedHalfTp = trades.filter((trade) => trade.touchedHalfTp).length;
  const tradesThatTouchedHalfSl = trades.filter((trade) => trade.touchedHalfSl).length;

  for (const pnl of netReturns) {
    equity *= 1 + pnl;
    if (equity > peak) {
      peak = equity;
    }

    const drawdown = peak === 0 ? 0 : (peak - equity) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return {
    totalTrades,
    winRate: roundTo(winRate, 8),
    totalNetPnlPct: roundTo(totalNetPnlPct, 8),
    avgNetPnlPct: roundTo(avgNetPnlPct, 8),
    maxDrawdownPct: roundTo(maxDrawdown, 8),
    profitFactor: roundTo(profitFactor, 8),
    avgWinPct: roundTo(avgWinPct, 8),
    avgLossPct: roundTo(avgLossPct, 8),
    avgMfePct: roundTo(avgGrossMfePct, 8),
    avgGrossMfePct: roundTo(avgGrossMfePct, 8),
    avgNetMfePct: roundTo(avgNetMfePct, 8),
    avgMaePct: roundTo(avgMaePct, 8),
    maxMfePct: roundTo(maxGrossMfePct, 8),
    maxGrossMfePct: roundTo(maxGrossMfePct, 8),
    maxNetMfePct: roundTo(maxNetMfePct, 8),
    maxMaePct: roundTo(maxMaePct, 8),
    tradesThatTouchedHalfTp,
    tradesThatTouchedHalfSl,
  };
}
