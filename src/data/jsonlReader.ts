import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import type { NormalizedPricePoint } from '../market/marketTypes';

export interface JsonlReadResult {
  points: NormalizedPricePoint[];
  totalRows: number;
  skippedRows: number;
}

type RawMarketRow = {
  timestampMs?: unknown;
  price?: unknown;
  midPrice?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRow(row: RawMarketRow): NormalizedPricePoint | undefined {
  if (!isFiniteNumber(row.timestampMs)) {
    return undefined;
  }

  const { timestampMs } = row;

  if (isFiniteNumber(row.bestBid) && isFiniteNumber(row.bestAsk)) {
    return {
      timestampMs,
      price: (row.bestBid + row.bestAsk) / 2,
    };
  }

  if (isFiniteNumber(row.price)) {
    return {
      timestampMs,
      price: row.price,
    };
  }

  if (isFiniteNumber(row.midPrice)) {
    return {
      timestampMs,
      price: row.midPrice,
    };
  }

  return undefined;
}

export async function readJsonlMarketData(filePath: string): Promise<JsonlReadResult> {
  const points: NormalizedPricePoint[] = [];
  let totalRows = 0;
  let skippedRows = 0;

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      totalRows += 1;
      const trimmed = line.trim();
      if (trimmed === '') {
        skippedRows += 1;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        skippedRows += 1;
        continue;
      }

      if (typeof parsed !== 'object' || parsed === null) {
        skippedRows += 1;
        continue;
      }

      const normalized = normalizeRow(parsed as RawMarketRow);
      if (!normalized) {
        skippedRows += 1;
        continue;
      }

      points.push(normalized);
    }
  } finally {
    reader.close();
    stream.close();
  }

  return {
    points,
    totalRows,
    skippedRows,
  };
}
