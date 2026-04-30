import { stat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

interface SplitArgs {
  input: string;
  trainRatio: number;
  outputDir: string;
}

interface ParsedJsonlRow {
  lineNumber: number;
  originalLine: string;
  timestampMs: number;
  originalIndex: number;
}

export interface SplitTrainTestResult {
  input: string;
  trainFile: string;
  testFile: string;
  totalRows: number;
  trainRows: number;
  testRows: number;
  trainStart: string | null;
  trainEnd: string | null;
  testStart: string | null;
  testEnd: string | null;
  discardedRows: number;
}

const DEFAULT_TRAIN_RATIO = 0.7;
const DEFAULT_OUTPUT_DIR = 'data/splits';

function parseArgs(argv: string[]): SplitArgs {
  let input = '';
  let trainRatio = DEFAULT_TRAIN_RATIO;
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      input = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--train-ratio') {
      const raw = argv[index + 1] ?? '';
      trainRatio = Number(raw);
      index += 1;
      continue;
    }

    if (arg === '--output-dir') {
      outputDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (input.trim() === '') {
    throw new Error('Missing required argument: --input <file>');
  }

  if (!Number.isFinite(trainRatio) || trainRatio <= 0 || trainRatio >= 1) {
    throw new Error('--train-ratio must be a number greater than 0 and less than 1');
  }

  if (outputDir.trim() === '') {
    throw new Error('--output-dir cannot be empty');
  }

  return {
    input,
    trainRatio,
    outputDir,
  };
}

async function assertInputFileExists(input: string): Promise<void> {
  try {
    const stats = await stat(input);
    if (!stats.isFile()) {
      throw new Error(`Input path is not a file: ${input}`);
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Input path is not a file:')) {
      throw error;
    }

    throw new Error(`Input file does not exist: ${input}`);
  }
}

function timestampFromValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }

  return null;
}

function getTimestampMs(row: unknown): number | null {
  if (typeof row !== 'object' || row === null) {
    return null;
  }

  const record = row as Record<string, unknown>;
  const fields = ['timestampMs', 'timestamp', 'startTime', 'startTimeMs', 'openTime'];
  for (const field of fields) {
    const timestamp = timestampFromValue(record[field]);
    if (timestamp !== null) {
      return timestamp;
    }
  }

  return null;
}

function parseJsonlRows(content: string): { rows: ParsedJsonlRow[]; discardedRows: number } {
  const rows: ParsedJsonlRow[] = [];
  let discardedRows = 0;
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed === '') {
      discardedRows += 1;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON at line ${lineNumber}: ${message}`);
    }

    const timestampMs = getTimestampMs(parsed);
    if (timestampMs === null) {
      throw new Error(
        `Timestamp not found at line ${lineNumber}. Expected one of: timestampMs, timestamp, startTime, startTimeMs, openTime`,
      );
    }

    rows.push({
      lineNumber,
      originalLine: trimmed,
      timestampMs,
      originalIndex: rows.length,
    });
  });

  return {
    rows,
    discardedRows,
  };
}

function getSplitFileNames(input: string, trainRatio: number, outputDir: string): {
  trainFile: string;
  testFile: string;
} {
  const extension = extname(input);
  const baseName = basename(input, extension);
  const trainPct = Math.round(trainRatio * 100);
  const testPct = 100 - trainPct;

  return {
    trainFile: join(outputDir, `${baseName}-train-${trainPct}.jsonl`),
    testFile: join(outputDir, `${baseName}-test-${testPct}.jsonl`),
  };
}

function toIso(timestampMs: number | undefined): string | null {
  return timestampMs === undefined ? null : new Date(timestampMs).toISOString();
}

export async function splitTrainTest(args: SplitArgs): Promise<SplitTrainTestResult> {
  await assertInputFileExists(args.input);
  const content = await readFile(args.input, 'utf8');
  const parsed = parseJsonlRows(content);
  if (parsed.rows.length === 0) {
    throw new Error('Input file has no valid JSONL rows to split');
  }

  const sortedRows = [...parsed.rows].sort((left, right) => (
    left.timestampMs - right.timestampMs ||
    left.originalIndex - right.originalIndex
  ));
  const splitIndex = Math.floor(sortedRows.length * args.trainRatio);
  const trainRows = sortedRows.slice(0, splitIndex);
  const testRows = sortedRows.slice(splitIndex);
  const { trainFile, testFile } = getSplitFileNames(
    args.input,
    args.trainRatio,
    args.outputDir,
  );

  await mkdir(args.outputDir, { recursive: true });
  await writeFile(
    trainFile,
    `${trainRows.map((row) => row.originalLine).join('\n')}${trainRows.length > 0 ? '\n' : ''}`,
    'utf8',
  );
  await writeFile(
    testFile,
    `${testRows.map((row) => row.originalLine).join('\n')}${testRows.length > 0 ? '\n' : ''}`,
    'utf8',
  );

  return {
    input: args.input,
    trainFile,
    testFile,
    totalRows: sortedRows.length,
    trainRows: trainRows.length,
    testRows: testRows.length,
    trainStart: toIso(trainRows[0]?.timestampMs),
    trainEnd: toIso(trainRows[trainRows.length - 1]?.timestampMs),
    testStart: toIso(testRows[0]?.timestampMs),
    testEnd: toIso(testRows[testRows.length - 1]?.timestampMs),
    discardedRows: parsed.discardedRows,
  };
}

function printResult(result: SplitTrainTestResult): void {
  console.log(`input: ${result.input}`);
  console.log(`train file: ${result.trainFile}`);
  console.log(`test file: ${result.testFile}`);
  console.log(`total rows: ${result.totalRows}`);
  console.log(`train rows: ${result.trainRows}`);
  console.log(`test rows: ${result.testRows}`);
  console.log(`train start/end: ${result.trainStart ?? '-'} -> ${result.trainEnd ?? '-'}`);
  console.log(`test start/end: ${result.testStart ?? '-'} -> ${result.testEnd ?? '-'}`);
  console.log(`discarded rows: ${result.discardedRows}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await splitTrainTest(args);
  printResult(result);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
