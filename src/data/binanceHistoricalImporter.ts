import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BINANCE_SPOT_API_BASE_URL = 'https://data-api.binance.vision';
const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_INTERVAL: BinanceInterval = '5m';
const DEFAULT_DAYS = 7;
const DEFAULT_OUTPUT_DIR = 'data/input';
const MAX_KLINES_PER_REQUEST = 1000;
const MS_PER_DAY = 86_400_000;

export type BinanceInterval = '1m' | '5m' | '15m';

export interface BinanceKlineRow {
  timestamp: number;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: 'binance';
  symbol: string;
  interval: BinanceInterval;
}

export interface BinanceImportConfig {
  symbol: string;
  interval: BinanceInterval;
  days: number;
  output: string;
}

export interface GapSummary {
  missingCandles: number;
  duplicateCandles: number;
}

export interface BinanceImportSummary extends GapSummary {
  totalRows: number;
  startTime: string | null;
  endTime: string | null;
  outputFile: string;
}

type RawBinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

function parseArgs(argv: string[]): BinanceImportConfig {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Invalid CLI args near ${key ?? '(end)'}`);
    }
    args.set(key.slice(2), value);
  }

  const interval = (args.get('interval') ?? DEFAULT_INTERVAL) as BinanceInterval;
  if (!isSupportedInterval(interval)) {
    throw new Error('Invalid --interval. Supported values: 1m, 5m, 15m');
  }

  const days = Number(args.get('days') ?? DEFAULT_DAYS);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('Invalid --days. It must be a positive number.');
  }

  return {
    symbol: (args.get('symbol') ?? DEFAULT_SYMBOL).toUpperCase(),
    interval,
    days,
    output: args.get('output') ?? DEFAULT_OUTPUT_DIR,
  };
}

function isSupportedInterval(value: string): value is BinanceInterval {
  return value === '1m' || value === '5m' || value === '15m';
}

function intervalToMs(interval: BinanceInterval): number {
  if (interval === '1m') {
    return 60_000;
  }
  if (interval === '5m') {
    return 300_000;
  }
  return 900_000;
}

function formatFileTime(timestampMs: number): string {
  return new Date(timestampMs).toISOString().replace(/[:.]/g, '-');
}

function getCompletedWindow(nowMs: number, intervalMs: number, days: number): {
  startTimeMs: number;
  endTimeMs: number;
} {
  const endExclusiveMs = Math.floor(nowMs / intervalMs) * intervalMs;
  return {
    startTimeMs: endExclusiveMs - Math.ceil(days * MS_PER_DAY),
    endTimeMs: endExclusiveMs - 1,
  };
}

function normalizeKline(
  raw: RawBinanceKline,
  symbol: string,
  interval: BinanceInterval,
): BinanceKlineRow {
  return {
    timestamp: raw[0],
    openTime: raw[0],
    closeTime: raw[6],
    open: Number(raw[1]),
    high: Number(raw[2]),
    low: Number(raw[3]),
    close: Number(raw[4]),
    volume: Number(raw[5]),
    source: 'binance',
    symbol,
    interval,
  };
}

function buildKlinesUrl(
  symbol: string,
  interval: BinanceInterval,
  startTimeMs: number,
  endTimeMs: number,
): string {
  const params = new URLSearchParams({
    symbol,
    interval,
    startTime: String(startTimeMs),
    endTime: String(endTimeMs),
    limit: String(MAX_KLINES_PER_REQUEST),
  });

  return `${BINANCE_SPOT_API_BASE_URL}/api/v3/klines?${params.toString()}`;
}

async function fetchKlinesPage(
  symbol: string,
  interval: BinanceInterval,
  startTimeMs: number,
  endTimeMs: number,
): Promise<BinanceKlineRow[]> {
  const response = await fetch(buildKlinesUrl(symbol, interval, startTimeMs, endTimeMs));
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Binance klines request failed: HTTP ${response.status} ${body}`);
  }

  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('Binance klines response was not an array.');
  }

  return payload.map((item) => normalizeKline(item as RawBinanceKline, symbol, interval));
}

export function detectKlineGaps(rows: BinanceKlineRow[], intervalMs: number): GapSummary {
  const seen = new Set<number>();
  let duplicateCandles = 0;
  let missingCandles = 0;
  let previousOpenTime: number | null = null;

  for (const row of rows) {
    if (seen.has(row.openTime)) {
      duplicateCandles += 1;
      continue;
    }
    seen.add(row.openTime);

    if (previousOpenTime !== null) {
      const delta = row.openTime - previousOpenTime;
      if (delta > intervalMs) {
        missingCandles += Math.floor(delta / intervalMs) - 1;
      }
    }

    previousOpenTime = row.openTime;
  }

  return {
    missingCandles,
    duplicateCandles,
  };
}

export async function downloadBinanceKlines(
  config: BinanceImportConfig,
  nowMs: number = Date.now(),
): Promise<BinanceImportSummary> {
  const intervalMs = intervalToMs(config.interval);
  const window = getCompletedWindow(nowMs, intervalMs, config.days);
  const rows: BinanceKlineRow[] = [];
  let nextStartTimeMs = window.startTimeMs;

  while (nextStartTimeMs <= window.endTimeMs) {
    const page = await fetchKlinesPage(
      config.symbol,
      config.interval,
      nextStartTimeMs,
      window.endTimeMs,
    );
    if (page.length === 0) {
      break;
    }

    rows.push(...page);
    const lastOpenTime = page[page.length - 1]?.openTime;
    if (lastOpenTime === undefined) {
      break;
    }
    nextStartTimeMs = lastOpenTime + intervalMs;
  }

  rows.sort((left, right) => left.openTime - right.openTime);
  const gapSummary = detectKlineGaps(rows, intervalMs);
  const startLabel = formatFileTime(window.startTimeMs);
  const endLabel = formatFileTime(window.endTimeMs);
  const outputFile = join(
    config.output,
    `binance-${config.symbol}-${config.interval}-${startLabel}-${endLabel}.jsonl`,
  );

  await mkdir(config.output, { recursive: true });
  await writeFile(
    outputFile,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length > 0 ? '\n' : ''}`,
    'utf8',
  );

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];

  return {
    totalRows: rows.length,
    startTime: firstRow ? new Date(firstRow.openTime).toISOString() : null,
    endTime: lastRow ? new Date(lastRow.closeTime).toISOString() : null,
    missingCandles: gapSummary.missingCandles,
    duplicateCandles: gapSummary.duplicateCandles,
    outputFile,
  };
}

async function runCli(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const summary = await downloadBinanceKlines(config);

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
