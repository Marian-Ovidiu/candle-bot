import { config } from '../config/config';
import { runBacktest } from './backtestEngine';

function getInputFileArg(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input' || arg === '--inputFile') {
      return argv[index + 1] ?? null;
    }
  }

  return null;
}

async function main(): Promise<void> {
  const inputFile = getInputFileArg(process.argv.slice(2));
  const result = await runBacktest({
    ...config,
    backtestInputFile: inputFile ?? config.backtestInputFile,
  });
  console.log(JSON.stringify(result.summary.tradeAnalysis.compactSummary, null, 2));
  console.log(JSON.stringify(result.summary, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
