import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import mongoose from 'mongoose';

interface RunRow {
  runId: string;
  model: string;
  mode: string;
  expectedMinMs: number;
  expectedMaxMs: number;
  durationMs: number;
  intervalErrorPercent: number;
  withinRange: boolean;
  completedAt: string;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.atlas) {
    const atlasUri = process.env.MONGODB_ATLAS_URI?.trim();
    if (!atlasUri) throw new Error('MONGODB_ATLAS_URI is required in BE/.env for --atlas.');
    process.env.MONGODB_URI = atlasUri;
  }

  const [{ default: connectDB }, { default: OracleRun }] = await Promise.all([
    import('../src/config/db'),
    import('../src/modules/oracle/models/OracleRun'),
  ]);
  await connectDB();

  const candidates = await OracleRun.find({
    status: 'completed',
    modelName: { $type: 'string', $ne: '' },
    mode: { $type: 'string', $ne: '' },
    expectedMinMs: { $type: 'number' },
    expectedMaxMs: { $type: 'number' },
    durationMs: { $type: 'number' },
  })
    .select('_id modelName mode expectedMinMs expectedMaxMs durationMs completedAt createdAt')
    .sort({ completedAt: -1, createdAt: -1 })
    .limit(500)
    .lean();

  const groups = new Map<string, typeof candidates>();
  for (const run of candidates) {
    const key = `${run.modelName}::${run.mode}`;
    const group = groups.get(key) || [];
    group.push(run);
    groups.set(key, group);
  }
  const selectedGroup = [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length)[0];
  if (!selectedGroup || selectedGroup[1].length < options.limit) {
    const maximum = selectedGroup?.[1].length || 0;
    const currentGroup = selectedGroup?.[0]?.replace('::', ' / ') || 'none';
    throw new Error(
      `Only ${maximum} completed Oracle runs share the same model and mode. `
      + `Current largest group: ${currentGroup}. `
      + `Create at least ${options.limit} matching runs first.`,
    );
  }

  const [groupKey, groupRuns] = selectedGroup;
  const [model, mode] = groupKey.split('::');
  const selected = groupRuns.slice(0, options.limit);
  const rows: RunRow[] = selected.map(run => {
    const expectedMinMs = Number(run.expectedMinMs);
    const expectedMaxMs = Number(run.expectedMaxMs);
    const durationMs = Number(run.durationMs);
    return {
      runId: String(run._id).slice(-8),
      model,
      mode,
      expectedMinMs,
      expectedMaxMs,
      durationMs,
      intervalErrorPercent: intervalError(expectedMinMs, expectedMaxMs, durationMs),
      withinRange: durationMs >= expectedMinMs && durationMs <= expectedMaxMs,
      completedAt: new Date(run.completedAt || run.createdAt).toISOString(),
    };
  });

  const earliest = selected
    .map(run => new Date(run.createdAt).getTime())
    .reduce((minimum, value) => Math.min(minimum, value));
  const statusCounts = await OracleRun.aggregate([
    {
      $match: {
        modelName: model,
        mode,
        createdAt: { $gte: new Date(earliest) },
        status: { $in: ['completed', 'failed', 'cancelled'] },
      },
    },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(
    statusCounts.map(item => [String(item._id), Number(item.count)]),
  );
  const terminalRuns = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const failedRuns = (counts.failed || 0) + (counts.cancelled || 0);

  const summary = {
    evidence: 'Figure C.29 - Oracle ETA Evidence',
    measuredAt: new Date().toISOString(),
    database: options.atlas ? 'MongoDB Atlas' : 'Configured MongoDB',
    model,
    mode,
    runCount: rows.length,
    intervalErrorFormula:
      '0 inside the displayed range; otherwise distance to the nearest range bound / actual duration * 100',
    withinRangeCount: rows.filter(row => row.withinRange).length,
    coveragePercent: round(
      rows.filter(row => row.withinRange).length / rows.length * 100,
    ),
    medianIntervalErrorPercent: median(
      rows.map(row => row.intervalErrorPercent),
    ),
    failedOrCancelledCount: failedRuns,
    failedOrCancelledRate: terminalRuns > 0 ? round(failedRuns / terminalRuns) : 0,
    rows,
  };

  console.table(rows.map(row => ({
    run: row.runId,
    expectedMinMs: row.expectedMinMs,
    expectedMaxMs: row.expectedMaxMs,
    durationMs: row.durationMs,
    errorPercent: row.intervalErrorPercent,
    withinRange: row.withinRange,
  })));
  process.stdout.write(`${JSON.stringify({
    model: summary.model,
    mode: summary.mode,
    runCount: summary.runCount,
    withinRangeCount: summary.withinRangeCount,
    coveragePercent: summary.coveragePercent,
    medianIntervalErrorPercent: summary.medianIntervalErrorPercent,
    failedOrCancelledCount: summary.failedOrCancelledCount,
    failedOrCancelledRate: summary.failedOrCancelledRate,
    output: options.output,
  }, null, 2)}\n`);

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await mongoose.disconnect();
}

function parseArguments(args: string[]) {
  const limitIndex = args.indexOf('--limit');
  const outputIndex = args.indexOf('--output');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 10;
  if (!Number.isInteger(limit) || limit < 10) {
    throw new Error('--limit must be an integer of at least 10.');
  }
  return {
    atlas: args.includes('--atlas'),
    limit,
    output: resolve(
      outputIndex >= 0
        ? args[outputIndex + 1]
        : '../docs/evidence/chapter6/oracle-eta-evidence.json',
    ),
  };
}

function intervalError(minimum: number, maximum: number, actual: number): number {
  if (actual >= minimum && actual <= maximum) return 0;
  const nearestBound = actual < minimum ? minimum : maximum;
  return round(Math.abs(actual - nearestBound) / Math.max(actual, 1) * 100);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return round((sorted[middle - 1] + sorted[middle]) / 2);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

main().catch(async error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
