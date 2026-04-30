import { stat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config as envConfig, type AppConfig } from '../config/config';
import { runBacktest, type BacktestSummary } from './backtestEngine';

const DEFAULT_INPUT_FILE = 'data/splits/btc-merged-train-70.jsonl';
const DEFAULT_OUTPUT_DIR = 'output/train-experiments';
const MIN_CANDIDATE_TRADES = 50;
const MIN_CANDIDATE_PROFIT_FACTOR = 1.05;
const MAX_REASONABLE_DRAWDOWN_PCT = 0.08;

const BASE_EXPERIMENT_NAMES = [
  'baseline_no_filters',
  'long_only',
  'short_only',
  'direct_breakout_only',
  'impulse_confirmation_only',
  'impulse_fade_only',
  'impulse_confirmation_hours_0_23',
  'direct_breakout_hours_0_23',
  'impulse_fade_hours_0_23',
] as const;

type BaseExperimentName = typeof BASE_EXPERIMENT_NAMES[number];
type EntryMode = 'direct' | 'impulse_confirmation' | 'impulse_fade';

interface TrainSuiteArgs {
  input: string;
  outputDir: string;
}

interface ExperimentDefinition {
  name: BaseExperimentName;
  mode: EntryMode;
  hourly: boolean;
  overrides?: Partial<AppConfig>;
}

interface RejectedReasonSummary {
  reason: string;
  count: number;
}

export interface TrainExperimentSummary {
  experimentName: string;
  totalTrades: number;
  winRate: number;
  totalNetPnlPct: number;
  avgNetPnlPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgMfePct: number;
  avgMaePct: number;
  tradesThatTouchedHalfTp: number;
  tradesThatTouchedHalfSl: number;
  bestDirection: string | null;
  bestHourBucket: string | null;
  bestImpulseBucket: string | null;
  worstExitReason: string | null;
  exitReasonBreakdown: Record<string, number>;
  topRejectedReasons: RejectedReasonSummary[];
  outputDir: string;
  selectedHourUtc?: number;
}

interface CandidateEdge {
  name: string;
  source: 'experiment' | 'hour_bucket';
  totalTrades: number;
  winRate: number;
  totalNetPnlPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  bestDirection: string | null;
  bestHourBucket: string | null;
  bestImpulseBucket: string | null;
  outputDir: string;
}

function parseArgs(argv: string[]): TrainSuiteArgs {
  let input = process.env.BACKTEST_INPUT_FILE ?? DEFAULT_INPUT_FILE;
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      input = argv[index + 1] ?? '';
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
    throw new Error('Missing input file. Pass --input <file> or set BACKTEST_INPUT_FILE.');
  }

  if (outputDir.trim() === '') {
    throw new Error('--output-dir cannot be empty');
  }

  return { input, outputDir };
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

function createTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function createBaseTrainConfig(source: AppConfig, input: string): AppConfig {
  return {
    ...source,
    backtestInputFile: input,
    candleIntervalMs: 300_000,
    feeBps: 1,
    slippageBps: 1,
    initialEquity: 1_000,
    positionNotional: 50,
    enableSampleCountFilter: true,
    minSamplesPerCandle: 20,
    maxCandleGapMultiplier: 3,
    takeProfitPct: 0.0020,
    stopLossPct: 0.0015,
    holdCandles: 3,
    maxHoldCandles: 3,
    enableTrendFilter: false,
    enableMinEdgeFilter: false,
    enableNetRiskRewardFilter: false,
    enableBreakEvenExit: false,
    enableTrailingExit: false,
    enableFollowThroughConfirmation: false,
    minVolatilityPct: 0,
    impulseMinReturnPct: 0.0012,
    impulseMaxReturnPct: 0.0035,
    impulseMinRangePct: 0.0025,
    impulseMinBodyToRangeRatio: 0.45,
    impulseMaxWickToBodyRatio: 2.5,
    confirmationMinReturnPct: 0.0002,
    confirmationMinBodyToImpulseBodyRatio: 0.25,
    confirmationMaxWickToBodyRatio: 2.5,
    recentRangeLookbackCandles: 6,
    minRecentRangeAvgPct: 0.0012,
    enableHourFilter: false,
    allowedEntryHoursUtc: [],
    enableLongEntries: true,
    enableShortEntries: true,
  };
}

function entryModeConfig(mode: EntryMode): Partial<AppConfig> {
  if (mode === 'direct') {
    return {
      enableDirectBreakoutEntry: true,
      enableImpulseConfirmationEntry: false,
      enableImpulseFadeEntry: false,
    };
  }

  if (mode === 'impulse_confirmation') {
    return {
      enableDirectBreakoutEntry: false,
      enableImpulseConfirmationEntry: true,
      enableImpulseFadeEntry: false,
    };
  }

  return {
    enableDirectBreakoutEntry: false,
    enableImpulseConfirmationEntry: false,
    enableImpulseFadeEntry: true,
  };
}

function createExperimentDefinitions(): ExperimentDefinition[] {
  return [
    { name: 'baseline_no_filters', mode: 'direct', hourly: false },
    {
      name: 'long_only',
      mode: 'direct',
      hourly: false,
      overrides: { enableShortEntries: false },
    },
    {
      name: 'short_only',
      mode: 'direct',
      hourly: false,
      overrides: { enableLongEntries: false },
    },
    { name: 'direct_breakout_only', mode: 'direct', hourly: false },
    { name: 'impulse_confirmation_only', mode: 'impulse_confirmation', hourly: false },
    { name: 'impulse_fade_only', mode: 'impulse_fade', hourly: false },
    { name: 'impulse_confirmation_hours_0_23', mode: 'impulse_confirmation', hourly: true },
    { name: 'direct_breakout_hours_0_23', mode: 'direct', hourly: true },
    { name: 'impulse_fade_hours_0_23', mode: 'impulse_fade', hourly: true },
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

function getTopRejectedReasons(summary: BacktestSummary): RejectedReasonSummary[] {
  return Object.entries(buildRejectedReasonBreakdown(summary))
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, 5);
}

function buildExitReasonBreakdown(summary: BacktestSummary): Record<string, number> {
  return Object.fromEntries(
    Object.entries(summary.tradeAnalysis.byExitReason).map(([reason, group]) => [
      reason,
      group.count,
    ]),
  );
}

function buildTrainExperimentSummary(
  experimentName: string,
  summary: BacktestSummary,
  selectedHourUtc?: number,
): TrainExperimentSummary {
  const compact = summary.tradeAnalysis.compactSummary;
  return {
    experimentName,
    totalTrades: summary.totalTrades,
    winRate: summary.winRate,
    totalNetPnlPct: summary.totalNetPnlPct,
    avgNetPnlPct: summary.avgNetPnlPct,
    maxDrawdownPct: summary.maxDrawdownPct,
    profitFactor: summary.profitFactor,
    avgMfePct: summary.avgMfePct,
    avgMaePct: summary.avgMaePct,
    tradesThatTouchedHalfTp: summary.tradesThatTouchedHalfTp,
    tradesThatTouchedHalfSl: summary.tradesThatTouchedHalfSl,
    bestDirection: compact.bestDirection,
    bestHourBucket: compact.bestHourBucket,
    bestImpulseBucket: compact.bestImpulseBucket,
    worstExitReason: compact.worstExitReason,
    exitReasonBreakdown: buildExitReasonBreakdown(summary),
    topRejectedReasons: getTopRejectedReasons(summary),
    outputDir: summary.outputDir,
    ...(selectedHourUtc === undefined ? {} : { selectedHourUtc }),
  };
}

export function sortByTrainExplorationRank<T extends {
  totalNetPnlPct: number;
  profitFactor: number;
  totalTrades: number;
}>(summaries: T[]): T[] {
  return [...summaries].sort((left, right) => (
    right.totalNetPnlPct - left.totalNetPnlPct ||
    right.profitFactor - left.profitFactor ||
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
  const entries = Object.entries(reasons).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    return '-';
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `${reason}: ${count}`)
    .join('<br>');
}

function formatTopRejectedReasons(reasons: RejectedReasonSummary[]): string {
  if (reasons.length === 0) {
    return '-';
  }

  return reasons.map((item) => `${item.reason}: ${item.count}`).join('<br>');
}

export function createComparisonMarkdown(summaries: TrainExperimentSummary[]): string {
  const rows = sortByTrainExplorationRank(summaries).map((summary) => [
    summary.experimentName,
    String(summary.totalTrades),
    formatPct(summary.winRate),
    formatPct(summary.totalNetPnlPct),
    formatPct(summary.avgNetPnlPct),
    formatPct(summary.maxDrawdownPct),
    formatNumber(summary.profitFactor),
    formatPct(summary.avgMfePct),
    formatPct(summary.avgMaePct),
    String(summary.tradesThatTouchedHalfTp),
    String(summary.tradesThatTouchedHalfSl),
    summary.bestDirection ?? '-',
    summary.bestHourBucket ?? '-',
    summary.bestImpulseBucket ?? '-',
    summary.worstExitReason ?? '-',
    formatReasonMap(summary.exitReasonBreakdown),
    formatTopRejectedReasons(summary.topRejectedReasons),
  ]);

  return [
    '# Train Exploration Comparison',
    '',
    '| experiment | trades | win rate | total net pnl | avg net pnl | max dd | profit factor | avg mfe | avg mae | half TP | half SL | best dir | best hour | best impulse | worst exit | exits | top rejected reasons |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

function createHourComparisonMarkdown(
  experimentName: string,
  summaries: TrainExperimentSummary[],
): string {
  const rows = sortByTrainExplorationRank(summaries).map((summary) => [
    String(summary.selectedHourUtc ?? '-').padStart(2, '0'),
    String(summary.totalTrades),
    formatPct(summary.winRate),
    formatPct(summary.totalNetPnlPct),
    formatPct(summary.avgNetPnlPct),
    formatPct(summary.maxDrawdownPct),
    formatNumber(summary.profitFactor),
    formatPct(summary.avgMfePct),
    formatPct(summary.avgMaePct),
    summary.bestDirection ?? '-',
    summary.bestImpulseBucket ?? '-',
    summary.worstExitReason ?? '-',
    formatReasonMap(summary.exitReasonBreakdown),
    formatTopRejectedReasons(summary.topRejectedReasons),
  ]);

  return [
    `# ${experimentName} Hour Comparison`,
    '',
    '| hour UTC | trades | win rate | total net pnl | avg net pnl | max dd | profit factor | avg mfe | avg mae | best dir | best impulse | worst exit | exits | top rejected reasons |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

export function selectCandidateEdges(
  summaries: TrainExperimentSummary[],
  hourlySummaries: TrainExperimentSummary[],
): CandidateEdge[] {
  const candidates: CandidateEdge[] = [];
  const addCandidate = (summary: TrainExperimentSummary, source: CandidateEdge['source']): void => {
    if (
      summary.totalTrades >= MIN_CANDIDATE_TRADES &&
      summary.profitFactor >= MIN_CANDIDATE_PROFIT_FACTOR &&
      summary.totalNetPnlPct > 0 &&
      summary.maxDrawdownPct <= MAX_REASONABLE_DRAWDOWN_PCT
    ) {
      candidates.push({
        name: source === 'hour_bucket'
          ? `${summary.experimentName}_h${String(summary.selectedHourUtc ?? 0).padStart(2, '0')}`
          : summary.experimentName,
        source,
        totalTrades: summary.totalTrades,
        winRate: summary.winRate,
        totalNetPnlPct: summary.totalNetPnlPct,
        maxDrawdownPct: summary.maxDrawdownPct,
        profitFactor: summary.profitFactor,
        bestDirection: summary.bestDirection,
        bestHourBucket: summary.bestHourBucket,
        bestImpulseBucket: summary.bestImpulseBucket,
        outputDir: summary.outputDir,
      });
    }
  };

  for (const summary of summaries) {
    addCandidate(summary, 'experiment');
  }
  for (const summary of hourlySummaries) {
    addCandidate(summary, 'hour_bucket');
  }

  return sortByTrainExplorationRank(candidates);
}

export function createCandidateEdgesMarkdown(candidates: CandidateEdge[]): string {
  const header = [
    '# Candidate Edges',
    '',
    `Criteria: totalTrades >= ${MIN_CANDIDATE_TRADES}, profitFactor >= ${MIN_CANDIDATE_PROFIT_FACTOR}, totalNetPnlPct > 0, maxDrawdownPct <= ${formatPct(MAX_REASONABLE_DRAWDOWN_PCT)}.`,
    '',
  ];

  if (candidates.length === 0) {
    return [...header, 'No candidate edges matched the criteria.', ''].join('\n');
  }

  const rows = candidates.map((candidate) => [
    candidate.name,
    candidate.source,
    String(candidate.totalTrades),
    formatPct(candidate.winRate),
    formatPct(candidate.totalNetPnlPct),
    formatPct(candidate.maxDrawdownPct),
    formatNumber(candidate.profitFactor),
    candidate.bestDirection ?? '-',
    candidate.bestHourBucket ?? '-',
    candidate.bestImpulseBucket ?? '-',
    candidate.outputDir,
  ]);

  return [
    ...header,
    '| name | source | trades | win rate | total net pnl | max dd | profit factor | best dir | best hour | best impulse | output |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

async function runSingleExperiment(
  baseConfig: AppConfig,
  definition: ExperimentDefinition,
  outputRoot: string,
): Promise<TrainExperimentSummary> {
  const experimentConfig: AppConfig = {
    ...baseConfig,
    ...entryModeConfig(definition.mode),
    ...definition.overrides,
  };
  const outputDir = join(outputRoot, definition.name);
  console.log(`Running ${definition.name} -> ${outputDir}`);
  const result = await runBacktest(experimentConfig, { outputDir });
  return buildTrainExperimentSummary(definition.name, result.summary);
}

async function runHourlyExperiment(
  baseConfig: AppConfig,
  definition: ExperimentDefinition,
  outputRoot: string,
): Promise<{
  selectedSummary: TrainExperimentSummary;
  hourlySummaries: TrainExperimentSummary[];
}> {
  const experimentDir = join(outputRoot, definition.name);
  const hourlySummaries: TrainExperimentSummary[] = [];

  await mkdir(experimentDir, { recursive: true });

  for (let hour = 0; hour < 24; hour += 1) {
    const outputDir = join(experimentDir, `hour-${String(hour).padStart(2, '0')}`);
    const experimentConfig: AppConfig = {
      ...baseConfig,
      ...entryModeConfig(definition.mode),
      enableHourFilter: true,
      allowedEntryHoursUtc: [hour],
    };
    console.log(`Running ${definition.name} hour ${hour} -> ${outputDir}`);
    const result = await runBacktest(experimentConfig, { outputDir });
    hourlySummaries.push(
      buildTrainExperimentSummary(definition.name, result.summary, hour),
    );
  }

  const sortedHours = sortByTrainExplorationRank(hourlySummaries);
  const selectedSummary = sortedHours[0];
  if (!selectedSummary) {
    throw new Error(`No hourly results produced for ${definition.name}`);
  }

  await writeFile(
    join(experimentDir, 'hour-comparison.json'),
    `${JSON.stringify(sortedHours, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(experimentDir, 'hour-comparison.md'),
    createHourComparisonMarkdown(definition.name, hourlySummaries),
    'utf8',
  );

  return {
    selectedSummary: {
      ...selectedSummary,
      experimentName: definition.name,
      outputDir: experimentDir,
    },
    hourlySummaries,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await assertInputFileExists(args.input);

  const timestamp = createTimestamp();
  const outputRoot = join(args.outputDir, timestamp);
  const baseConfig = createBaseTrainConfig(envConfig, args.input);
  const definitions = createExperimentDefinitions();
  const comparison: TrainExperimentSummary[] = [];
  const hourlyCandidates: TrainExperimentSummary[] = [];

  await mkdir(outputRoot, { recursive: true });

  for (const definition of definitions) {
    if (definition.hourly) {
      const result = await runHourlyExperiment(baseConfig, definition, outputRoot);
      comparison.push(result.selectedSummary);
      hourlyCandidates.push(...result.hourlySummaries);
    } else {
      comparison.push(await runSingleExperiment(baseConfig, definition, outputRoot));
    }
  }

  const sortedComparison = sortByTrainExplorationRank(comparison);
  const candidates = selectCandidateEdges(comparison, hourlyCandidates);

  await writeFile(
    join(outputRoot, 'comparison.json'),
    `${JSON.stringify(sortedComparison, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(outputRoot, 'comparison.md'),
    createComparisonMarkdown(comparison),
    'utf8',
  );
  await writeFile(
    join(outputRoot, 'candidate-edges.md'),
    createCandidateEdgesMarkdown(candidates),
    'utf8',
  );

  console.log(`Train exploration suite written to ${outputRoot}`);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
