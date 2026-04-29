import { describe, expect, it } from 'vitest';
import { detectKlineGaps, type BinanceKlineRow } from './binanceHistoricalImporter';

function makeRow(openTime: number): BinanceKlineRow {
  return {
    timestamp: openTime,
    openTime,
    closeTime: openTime + 299_999,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
    source: 'binance',
    symbol: 'BTCUSDT',
    interval: '5m',
  };
}

describe('binanceHistoricalImporter', () => {
  it('detects missing and duplicate candles from normalized kline rows', () => {
    const rows = [
      makeRow(0),
      makeRow(300_000),
      makeRow(300_000),
      makeRow(1_200_000),
    ];

    expect(detectKlineGaps(rows, 300_000)).toEqual({
      missingCandles: 2,
      duplicateCandles: 1,
    });
  });
});
