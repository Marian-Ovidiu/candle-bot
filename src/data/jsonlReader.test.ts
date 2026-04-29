import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonlMarketData } from './jsonlReader';

describe('readJsonlMarketData', () => {
  it('reads and normalizes supported market row shapes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'candle-bot-jsonl-'));
    const filePath = join(dir, 'input.jsonl');

    await writeFile(
      filePath,
      [
        JSON.stringify({ timestampMs: 1, price: 100 }),
        JSON.stringify({ timestampMs: 2, midPrice: 101.5 }),
        JSON.stringify({ timestampMs: 3, bestBid: 99, bestAsk: 101 }),
      ].join('\n'),
      'utf8',
    );

    await expect(readJsonlMarketData(filePath)).resolves.toEqual({
      points: [
        { timestampMs: 1, price: 100 },
        { timestampMs: 2, price: 101.5 },
        { timestampMs: 3, price: 100 },
      ],
      candles: [],
      totalRows: 3,
      skippedRows: 0,
      startTimeMs: 1,
      endTimeMs: 3,
      interval: null,
      missingCandles: null,
      duplicateCandles: 0,
    });
  });

  it('skips invalid rows while counting them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'candle-bot-jsonl-'));
    const filePath = join(dir, 'invalid.jsonl');

    await writeFile(
      filePath,
      [
        '',
        'not json',
        JSON.stringify({ timestampMs: 1 }),
        JSON.stringify({ timestampMs: 'bad', price: 100 }),
        JSON.stringify({ timestampMs: 4, bestBid: 10 }),
        JSON.stringify({ timestampMs: 5, price: 200 }),
      ].join('\n'),
      'utf8',
    );

    const result = await readJsonlMarketData(filePath);

    expect(result).toEqual({
      points: [{ timestampMs: 5, price: 200 }],
      candles: [],
      totalRows: 6,
      skippedRows: 5,
      startTimeMs: 5,
      endTimeMs: 5,
      interval: null,
      missingCandles: null,
      duplicateCandles: 0,
    });
  });

  it('parses imported Binance kline rows as candles with gap diagnostics', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'candle-bot-jsonl-'));
    const filePath = join(dir, 'binance.jsonl');

    await writeFile(
      filePath,
      [
        JSON.stringify({
          timestamp: 0,
          openTime: 0,
          closeTime: 299_999,
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 12,
          source: 'binance',
          symbol: 'BTCUSDT',
          interval: '5m',
        }),
        JSON.stringify({
          timestamp: 600_000,
          openTime: 600_000,
          closeTime: 899_999,
          open: 100.5,
          high: 102,
          low: 100,
          close: 101.5,
          volume: 10,
          source: 'binance',
          symbol: 'BTCUSDT',
          interval: '5m',
        }),
      ].join('\n'),
      'utf8',
    );

    const result = await readJsonlMarketData(filePath);

    expect(result).toMatchObject({
      points: [],
      candles: [
        {
          startTimeMs: 0,
          endTimeMs: 300_000,
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
        },
        {
          startTimeMs: 600_000,
          endTimeMs: 900_000,
          open: 100.5,
          high: 102,
          low: 100,
          close: 101.5,
        },
      ],
      totalRows: 2,
      skippedRows: 0,
      startTimeMs: 0,
      endTimeMs: 899_999,
      interval: '5m',
      missingCandles: 1,
      duplicateCandles: 0,
    });
  });

  it('fails fast when imported candle rows are not sorted by openTime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'candle-bot-jsonl-'));
    const filePath = join(dir, 'unsorted-binance.jsonl');

    const baseRow = {
      closeTime: 299_999,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 12,
      source: 'binance',
      symbol: 'BTCUSDT',
      interval: '5m',
    };

    await writeFile(
      filePath,
      [
        JSON.stringify({ ...baseRow, timestamp: 300_000, openTime: 300_000 }),
        JSON.stringify({ ...baseRow, timestamp: 0, openTime: 0 }),
      ].join('\n'),
      'utf8',
    );

    await expect(readJsonlMarketData(filePath)).rejects.toThrow(
      'Input candles are not sorted by openTime/startTime.',
    );
  });
});
