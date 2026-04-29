import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import type { Candle } from './candleTypes';
import type { NormalizedPricePoint } from '../market/marketTypes';

export interface JsonlReadResult {
  points: NormalizedPricePoint[];
  candles: Candle[];
  totalRows: number;
  skippedRows: number;
  startTimeMs: number | null;
  endTimeMs: number | null;
  interval: string | null;
  missingCandles: number | null;
  duplicateCandles: number;
}

type RawMarketRow = {
  timestampMs?: unknown;
  price?: unknown;
  midPrice?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
  timestamp?: unknown;
  openTime?: unknown;
  closeTime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
  source?: unknown;
  symbol?: unknown;
  interval?: unknown;
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

function normalizeCandleRow(row: RawMarketRow): Candle | undefined {
  if (
    !isFiniteNumber(row.openTime) ||
    !isFiniteNumber(row.closeTime) ||
    !isFiniteNumber(row.open) ||
    !isFiniteNumber(row.high) ||
    !isFiniteNumber(row.low) ||
    !isFiniteNumber(row.close)
  ) {
    return undefined;
  }

  return {
    startTimeMs: row.openTime,
    endTimeMs: row.closeTime + 1,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    sampleCount: isFiniteNumber(row.volume) ? Math.max(1, row.volume) : 1,
  };
}

function getIntervalMs(interval: string | null): number | null {
  if (interval === '1m') {
    return 60_000;
  }
  if (interval === '5m') {
    return 300_000;
  }
  if (interval === '15m') {
    return 900_000;
  }

  return null;
}

function detectCandleGaps(candles: Candle[], intervalMs: number): {
  missingCandles: number;
  duplicateCandles: number;
} {
  const seen = new Set<number>();
  let missingCandles = 0;
  let duplicateCandles = 0;
  let previousStartTimeMs: number | null = null;

  for (const candle of candles) {
    if (seen.has(candle.startTimeMs)) {
      duplicateCandles += 1;
      continue;
    }
    seen.add(candle.startTimeMs);

    if (previousStartTimeMs !== null) {
      const delta = candle.startTimeMs - previousStartTimeMs;
      if (delta > intervalMs) {
        missingCandles += Math.floor(delta / intervalMs) - 1;
      }
    }

    previousStartTimeMs = candle.startTimeMs;
  }

  return {
    missingCandles,
    duplicateCandles,
  };
}

export async function readJsonlMarketData(filePath: string): Promise<JsonlReadResult> {
  const points: NormalizedPricePoint[] = [];
  const candles: Candle[] = [];
  let totalRows = 0;
  let skippedRows = 0;
  let lastCandleStartTimeMs: number | undefined;
  let startTimeMs: number | null = null;
  let endTimeMs: number | null = null;
  let interval: string | null = null;

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

      const row = parsed as RawMarketRow;
      const candle = normalizeCandleRow(row);
      if (candle) {
        if (
          lastCandleStartTimeMs !== undefined &&
          candle.startTimeMs < lastCandleStartTimeMs
        ) {
          throw new Error('Input candles are not sorted by openTime/startTime.');
        }
        lastCandleStartTimeMs = candle.startTimeMs;
        candles.push(candle);
        startTimeMs = startTimeMs ?? candle.startTimeMs;
        endTimeMs = candle.endTimeMs - 1;
        if (typeof row.interval === 'string') {
          interval = interval ?? row.interval;
        }
        continue;
      }

      const normalized = normalizeRow(row);
      if (!normalized) {
        skippedRows += 1;
        continue;
      }

      points.push(normalized);
      startTimeMs = startTimeMs ?? normalized.timestampMs;
      endTimeMs = normalized.timestampMs;
    }
  } finally {
    reader.close();
    stream.close();
  }

  const intervalMs = getIntervalMs(interval);
  const gapSummary = intervalMs === null
    ? { missingCandles: null, duplicateCandles: 0 }
    : {
      ...detectCandleGaps(candles, intervalMs),
    };

  return {
    points,
    candles,
    totalRows,
    skippedRows,
    startTimeMs,
    endTimeMs,
    interval,
    missingCandles: gapSummary.missingCandles,
    duplicateCandles: gapSummary.duplicateCandles,
  };
}
