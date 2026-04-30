import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config as envConfig, type AppConfig } from '../config/config';
import { roundTo } from '../utils/math';
import { runBacktest, type BacktestSummary } from './backtestEngine';

const BASELINE_NAME = 'baseline_direct_no_filters';

const EXPERIMENT_NAMES = [
  BASELINE_NAME,
  'costs_only',
  'hours_20_23_only',
  'hour_22_only',
  'long_only',
  'short_only',
  'impulse_only',
  'trend_only',
  'break_even_only',
  'trailing_only',
] as const;

type ExperimentName = typeof EXPERIMENT_NAMES[number];

interface ExperimentDefinition {
  name: ExperimentName;
  overrides: Partial<AppConfig>;
}

interface CandidateSignalCounts {
  waiting: number;
  entry: number;
  accepted: number;
  rejected: number;
}

export interface ExperimentCompactSummary {
  experimentName: ExperimentName;
  totalTrades: number;
  winRate: number;
  totalNetPnlPct: number;
  avgNetPnlPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  bestDirection: string | null;
  bestHourBucket: string | null;
  bestImpulseBucket: string | null;
  worstExitReason: string | null;
  candidateSignals: CandidateSignalCounts;
  rejectedReasons: Record<string, number>;
  exitReasonBreakdown: Record<string, number>;
  outputDir: string;
}

interface ExperimentDiff {
  experimentName: ExperimentName;
  tradeCountDiff: number;
  winRateDiff: number;
  pnlDiff: number;
  drawdownDiff: number;
  profitFactorDiff: number;
  newOrIncreasedRejectedReasons: Record<string, number>;
  comment: 'improves_quality' | 'kills_too_many_trades' | 'worsens_results' | 'neutral';
}

function getInputFileArg(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input' || arg === '--inputFile') {
      return argv[index + 1] ?? null;
    }
  }

  return null;
}

function createExperimentTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createBaseExperimentConfig(source: AppConfig, inputFile: string): AppConfig {
  return {
    ...source,
    backtestInputFile: inputFile,
    lookbackCandles: 1,
    breakoutLookbackCandles: 1,
    minReturnPct: 0,
    minRangePct: 0,
    minBodyPct: 0,
    maxWickToBodyRatio: Number.POSITIVE_INFINITY,
    takeProfitPct: 0.0020,
    stopLossPct: 0.0015,
    holdCandles: 3,
    maxHoldCandles: 3,
    feeBps: 0,
    slippageBps: 0,
    enableHourFilter: false,
    allowedEntryHoursUtc: [],
    enableTrendFilter: false,
    allowNeutralTrend: true,
    enableMinEdgeFilter: false,
    enableNetRiskRewardFilter: false,
    enableSampleCountFilter: false,
    enableBreakEvenExit: false,
    enableTrailingExit: false,
    enableDirectBreakoutEntry: true,
    enableImpulseConfirmationEntry: false,
    enableImpulseFadeEntry: false,
    enableFollowThroughConfirmation: false,
    minVolatilityPct: 0,
    impulseMaxReturnPct: Number.POSITIVE_INFINITY,
    enableLongEntries: true,
    enableShortEntries: true,
  };
}

function createExperimentDefinitions(source: AppConfig): ExperimentDefinition[] {
  return [
    { name: BASELINE_NAME, overrides: {} },
    {
      name: 'costs_only',
      overrides: {
        feeBps: source.feeBps,
        slippageBps: source.slippageBps,
      },
    },
    {
      name: 'hours_20_23_only',
      overrides: {
        enableHourFilter: true,
        allowedEntryHoursUtc: [20, 21, 22, 23],
      },
    },
    {
      name: 'hour_22_only',
      overrides: {
        enableHourFilter: true,
        allowedEntryHoursUtc: [22],
      },
    },
    {
      name: 'long_only',
      overrides: {
        enableShortEntries: false,
      },
    },
    {
      name: 'short_only',
      overrides: {
        enableLongEntries: false,
      },
    },
    {
      name: 'impulse_only',
      overrides: {
        enableDirectBreakoutEntry: false,
        enableImpulseConfirmationEntry: true,
      },
    },
    {
      name: 'trend_only',
      overrides: {
        enableTrendFilter: true,
        allowNeutralTrend: false,
      },
    },
    {
      name: 'break_even_only',
      overrides: {
        enableBreakEvenExit: true,
      },
    },
    {
      name: 'trailing_only',
      overrides: {
        enableTrailingExit: true,
      },
    },
  ];
}

function addReason(
  reasons: Record<string, number>,
  key: string,
  value: number,
): void {
  if (value > 0) {
    reasons[key] = value;
  }
}

function buildRejectedReasonBreakdown(summary: BacktestSummary): Record<string, number> {
  const diagnostics = summary.diagnostics;
  const reasons: Record<string, number> = {};
  addReason(reasons, 'hour_filter', diagnostics.rejectedByHour);
  addReason(reasons, 'direction_long_disabled', diagnostics.rejectedByDirectionLongDisabled);
  addReason(reasons, 'direction_short_disabled', diagnostics.rejectedByDirectionShortDisabled);
  addReason(reasons, 'impulse_too_strong', diagnostics.rejectedByImpulseTooStrong);
  addReason(reasons, 'low_volatility', diagnostics.rejectedByLowVolatility);
  addReason(reasons, 'no_follow_through', diagnostics.rejectedByNoFollowThrough);
  addReason(reasons, 'sample_filter', diagnostics.filters.sample.rejected);
  addReason(reasons, 'trend_filter', diagnostics.filters.trend.rejected);
  addReason(reasons, 'min_edge_filter', diagnostics.filters.edge.rejected);
  if (summary.configSnapshot.enableNetRiskRewardFilter) {
    addReason(reasons, 'net_risk_reward_filter', diagnostics.filters.netRiskReward.rejected);
  }
  return reasons;
}

function buildExitReasonBreakdown(summary: BacktestSummary): Record<string, number> {
  return Object.fromEntries(
    Object.entries(summary.tradeAnalysis.byExitReason).map(([reason, group]) => [
      reason,
      group.count,
    ]),
  );
}

export function buildExperimentCompactSummary(
  experimentName: ExperimentName,
  summary: BacktestSummary,
): ExperimentCompactSummary {
  const compact = summary.tradeAnalysis.compactSummary;
  return {
    experimentName,
    totalTrades: summary.totalTrades,
    winRate: summary.winRate,
    totalNetPnlPct: summary.totalNetPnlPct,
    avgNetPnlPct: summary.avgNetPnlPct,
    maxDrawdownPct: summary.maxDrawdownPct,
    profitFactor: summary.profitFactor,
    bestDirection: compact.bestDirection,
    bestHourBucket: compact.bestHourBucket,
    bestImpulseBucket: compact.bestImpulseBucket,
    worstExitReason: compact.worstExitReason,
    candidateSignals: summary.diagnostics.candidateSignals,
    rejectedReasons: buildRejectedReasonBreakdown(summary),
    exitReasonBreakdown: buildExitReasonBreakdown(summary),
    outputDir: summary.outputDir,
  };
}

export function sortExperimentSummaries(
  summaries: ExperimentCompactSummary[],
): ExperimentCompactSummary[] {
  return [...summaries].sort((left, right) => (
    right.totalNetPnlPct - left.totalNetPnlPct ||
    left.maxDrawdownPct - right.maxDrawdownPct ||
    right.totalTrades - left.totalTrades
  ));
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number): string {
  if (value > 1_000_000_000) {
    return 'inf';
  }

  return value.toFixed(4);
}

function formatReasonMap(reasons: Record<string, number>): string {
  const entries = Object.entries(reasons);
  if (entries.length === 0) {
    return '-';
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}: ${count}`)
    .join('<br>');
}

export function createComparisonMarkdown(summaries: ExperimentCompactSummary[]): string {
  const rows = sortExperimentSummaries(summaries).map((summary) => [
    summary.experimentName,
    String(summary.totalTrades),
    formatPct(summary.winRate),
    formatPct(summary.totalNetPnlPct),
    formatPct(summary.avgNetPnlPct),
    formatPct(summary.maxDrawdownPct),
    formatNumber(summary.profitFactor),
    summary.bestDirection ?? '-',
    summary.bestHourBucket ?? '-',
    summary.bestImpulseBucket ?? '-',
    summary.worstExitReason ?? '-',
    String(summary.candidateSignals.accepted),
    String(summary.candidateSignals.rejected),
    formatReasonMap(summary.exitReasonBreakdown),
  ]);

  return [
    '# Experiment Comparison',
    '',
    '| experiment | trades | win rate | total net pnl | avg net pnl | max dd | profit factor | best dir | best hour | best impulse | worst exit | accepted | rejected | exits |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

function diffRejectedReasons(
  current: Record<string, number>,
  baseline: Record<string, number>,
): Record<string, number> {
  const diff: Record<string, number> = {};
  for (const [reason, count] of Object.entries(current)) {
    const baselineCount = baseline[reason] ?? 0;
    if (count > baselineCount) {
      diff[reason] = count - baselineCount;
    }
  }

  return diff;
}

function classifyDiff(
  current: ExperimentCompactSummary,
  baseline: ExperimentCompactSummary,
): ExperimentDiff['comment'] {
  const tradeRetention = baseline.totalTrades === 0
    ? 1
    : current.totalTrades / baseline.totalTrades;
  const pnlDiff = current.totalNetPnlPct - baseline.totalNetPnlPct;
  const drawdownDiff = current.maxDrawdownPct - baseline.maxDrawdownPct;
  const profitFactorDiff = current.profitFactor - baseline.profitFactor;
  const winRateDiff = current.winRate - baseline.winRate;

  if (tradeRetention < 0.35 && pnlDiff <= 0) {
    return 'kills_too_many_trades';
  }

  if (pnlDiff < 0 && (drawdownDiff > 0 || profitFactorDiff < 0)) {
    return 'worsens_results';
  }

  if (
    pnlDiff >= 0 &&
    drawdownDiff <= 0 &&
    tradeRetention >= 0.35 &&
    (profitFactorDiff > 0 || winRateDiff > 0)
  ) {
    return 'improves_quality';
  }

  return 'neutral';
}

export function createDiffsVsBaseline(
  summaries: ExperimentCompactSummary[],
): ExperimentDiff[] {
  const baseline = summaries.find((summary) => summary.experimentName === BASELINE_NAME);
  if (!baseline) {
    throw new Error(`${BASELINE_NAME} result is required`);
  }

  return summaries
    .filter((summary) => summary.experimentName !== BASELINE_NAME)
    .map((summary) => ({
      experimentName: summary.experimentName,
      tradeCountDiff: summary.totalTrades - baseline.totalTrades,
      winRateDiff: roundTo(summary.winRate - baseline.winRate, 8),
      pnlDiff: roundTo(summary.totalNetPnlPct - baseline.totalNetPnlPct, 8),
      drawdownDiff: roundTo(summary.maxDrawdownPct - baseline.maxDrawdownPct, 8),
      profitFactorDiff: roundTo(summary.profitFactor - baseline.profitFactor, 8),
      newOrIncreasedRejectedReasons: diffRejectedReasons(
        summary.rejectedReasons,
        baseline.rejectedReasons,
      ),
      comment: classifyDiff(summary, baseline),
    }));
}

export function createDiffMarkdown(diffs: ExperimentDiff[]): string {
  const rows = diffs.map((diff) => [
    diff.experimentName,
    String(diff.tradeCountDiff),
    formatPct(diff.winRateDiff),
    formatPct(diff.pnlDiff),
    formatPct(diff.drawdownDiff),
    formatNumber(diff.profitFactorDiff),
    formatReasonMap(diff.newOrIncreasedRejectedReasons),
    diff.comment,
  ]);

  return [
    '# Diff vs Baseline',
    '',
    `Baseline: ${BASELINE_NAME}`,
    '',
    '| experiment | trades diff | winrate diff | pnl diff | drawdown diff | profit factor diff | new/increased rejections | comment |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const inputFile = getInputFileArg(process.argv.slice(2)) ?? envConfig.backtestInputFile;
  if (inputFile.trim() === '') {
    throw new Error('BACKTEST_INPUT_FILE is required, or pass --input <file>');
  }

  const timestamp = createExperimentTimestamp();
  const outputRoot = join('output', 'experiments', timestamp);
  const baseConfig = createBaseExperimentConfig(envConfig, inputFile);
  const definitions = createExperimentDefinitions(envConfig);
  const comparison: ExperimentCompactSummary[] = [];

  await mkdir(outputRoot, { recursive: true });

  for (const definition of definitions) {
    const experimentConfig: AppConfig = {
      ...baseConfig,
      ...definition.overrides,
      backtestInputFile: inputFile,
    };
    const experimentOutputDir = join(outputRoot, definition.name);
    console.log(`Running ${definition.name} -> ${experimentOutputDir}`);
    const result = await runBacktest(experimentConfig, { outputDir: experimentOutputDir });
    comparison.push(buildExperimentCompactSummary(definition.name, result.summary));
  }

  const diffs = createDiffsVsBaseline(comparison);
  await writeFile(
    join(outputRoot, 'comparison.json'),
    `${JSON.stringify(sortExperimentSummaries(comparison), null, 2)}\n`,
    'utf8',
  );
  await writeFile(join(outputRoot, 'comparison.md'), createComparisonMarkdown(comparison), 'utf8');
  await writeFile(join(outputRoot, 'diff-vs-baseline.md'), createDiffMarkdown(diffs), 'utf8');

  console.log(`Experiment suite written to ${outputRoot}`);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
