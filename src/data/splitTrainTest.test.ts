import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitTrainTest } from './splitTrainTest';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'candle-bot-split-'));
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(filePath, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('splitTrainTest', () => {
  it('splits JSONL rows by train ratio after sorting by timestamp', async () => {
    const dir = await makeTempDir();
    const input = join(dir, 'btc-sample.jsonl');
    const outputDir = join(dir, 'splits');

    await writeFile(
      input,
      [
        JSON.stringify({ timestamp: 3000, close: 103 }),
        JSON.stringify({ timestamp: 1000, close: 101 }),
        JSON.stringify({ timestamp: 2000, close: 102 }),
        JSON.stringify({ timestamp: 4000, close: 104 }),
        JSON.stringify({ timestamp: 5000, close: 105 }),
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await splitTrainTest({
      input,
      trainRatio: 0.6,
      outputDir,
    });

    expect(result).toMatchObject({
      totalRows: 5,
      trainRows: 3,
      testRows: 2,
      discardedRows: 1,
    });
    expect(result.trainFile).toBe(join(outputDir, 'btc-sample-train-60.jsonl'));
    expect(result.testFile).toBe(join(outputDir, 'btc-sample-test-40.jsonl'));

    await expect(readJsonl(result.trainFile)).resolves.toEqual([
      { timestamp: 1000, close: 101 },
      { timestamp: 2000, close: 102 },
      { timestamp: 3000, close: 103 },
    ]);
    await expect(readJsonl(result.testFile)).resolves.toEqual([
      { timestamp: 4000, close: 104 },
      { timestamp: 5000, close: 105 },
    ]);
  });

  it('uses openTime when splitting Binance candle rows', async () => {
    const dir = await makeTempDir();
    const input = join(dir, 'binance.jsonl');
    const outputDir = join(dir, 'splits');

    await writeFile(
      input,
      [
        JSON.stringify({ openTime: 0, close: 100 }),
        JSON.stringify({ openTime: 300_000, close: 101 }),
        JSON.stringify({ openTime: 600_000, close: 102 }),
      ].join('\n'),
      'utf8',
    );

    const result = await splitTrainTest({
      input,
      trainRatio: 0.7,
      outputDir,
    });

    expect(result.trainRows).toBe(2);
    expect(result.testRows).toBe(1);
    expect(result.trainStart).toBe(new Date(0).toISOString());
    expect(result.testStart).toBe(new Date(600_000).toISOString());
  });

  it('fails clearly on invalid JSON', async () => {
    const dir = await makeTempDir();
    const input = join(dir, 'invalid.jsonl');
    await writeFile(input, '{"timestamp":1}\nnot-json\n', 'utf8');

    await expect(
      splitTrainTest({
        input,
        trainRatio: 0.7,
        outputDir: join(dir, 'splits'),
      }),
    ).rejects.toThrow('Invalid JSON at line 2');
  });

  it('fails clearly when a timestamp is missing', async () => {
    const dir = await makeTempDir();
    const input = join(dir, 'missing-timestamp.jsonl');
    await writeFile(input, `${JSON.stringify({ close: 100 })}\n`, 'utf8');

    await expect(
      splitTrainTest({
        input,
        trainRatio: 0.7,
        outputDir: join(dir, 'splits'),
      }),
    ).rejects.toThrow('Timestamp not found at line 1');
  });
});
