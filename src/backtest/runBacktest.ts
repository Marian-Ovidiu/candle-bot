import { config } from '../config/config';
import { runBacktest } from './backtestEngine';

async function main(): Promise<void> {
  const result = await runBacktest(config);
  console.log(JSON.stringify(result.summary, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
