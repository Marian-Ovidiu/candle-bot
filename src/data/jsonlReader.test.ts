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
      totalRows: 3,
      skippedRows: 0,
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
      totalRows: 6,
      skippedRows: 5,
    });
  });
});
