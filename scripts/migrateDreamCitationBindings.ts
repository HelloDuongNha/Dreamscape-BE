import '../src/config/env';
import mongoose from 'mongoose';
import connectDB from '../src/config/db';
import Dream from '../src/modules/dream/models/Dream';
import {
  migrateLegacyDreamCitationAnalysis,
  migrateLegacyDreamCitationRecord,
} from '../src/modules/dream/services/analysis/grounding/dreamCitationMigration.service';
import {
  DREAM_CITATION_CONTRACT_VERSION,
} from '../src/shared/evidence/citationClaim';
import {
  restartDreamAnalysis,
} from '../src/modules/dream/services/analysis/execution/dreamAnalysisRetry.service';
import {
  abortDreamAnalysisExecution,
} from '../src/modules/dream/services/analysis/execution/dreamAnalysisRuntime.service';
import {
  rollbackDreamAnalysisRun,
} from '../src/modules/dream/services/analysis/execution/dreamAnalysisRollback.service';
import {
  recoverPendingDreamAnalysisQueue,
} from '../src/modules/dream/services/analysis/execution/dreamAnalysisRecovery.service';
import {
  runBackgroundAnalysis,
} from '../src/modules/dream/services/analysis/execution/dreamAnalysisRunner.service';
import {
  syncDreamEvidenceNeeds,
} from '../src/modules/dream/services/analysis/execution/dreamEvidenceSync.service';

interface MigrationTotals {
  scanned: number;
  changed: number;
  bindingsCreated: number;
  citationsRecovered: number;
  markersReopened: number;
  requiresReanalysis: number;
  reanalysisCandidates: number;
  reanalyzed: number;
  reanalysisFailed: number;
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const reanalyze = process.argv.includes('--reanalyze');
  if (reanalyze && !apply) {
    throw new Error('--reanalyze requires --apply so the operation cannot start accidentally.');
  }
  const limit = readLimit(process.argv);
  const timeoutMs = readTimeoutMs(process.argv);
  await connectDB();
  if (reanalyze) await recoverPendingDreamAnalysisQueue(runBackgroundAnalysis);
  const reanalysisIds: string[] = [];
  const totals: MigrationTotals = {
    scanned: 0,
    changed: 0,
    bindingsCreated: 0,
    citationsRecovered: 0,
    markersReopened: 0,
    requiresReanalysis: 0,
    reanalysisCandidates: 0,
    reanalyzed: 0,
    reanalysisFailed: 0,
  };
  const cursor = Dream.find({
    ai_status: 'completed',
    $or: [
      { 'ai_result.citation_contract_version': { $ne: DREAM_CITATION_CONTRACT_VERSION } },
      {
        $and: [
          { aiAnalysis: { $exists: true } },
          {
            'aiAnalysis.citation_contract_version': {
              $ne: DREAM_CITATION_CONTRACT_VERSION,
            },
          },
        ],
      },
      {
        edit_history: {
          $elemMatch: {
            ai_result: { $exists: true },
            'ai_result.citation_contract_version': {
              $ne: DREAM_CITATION_CONTRACT_VERSION,
            },
          },
        },
      },
    ],
  }).cursor();

  for await (const dream of cursor) {
    if (limit && totals.scanned >= limit) break;
    totals.scanned += 1;
    const currentNeedsReanalysis = migrateLegacyDreamCitationAnalysis(
      cloneAnalysis(dream.ai_result),
    ).requiresReanalysis > 0;
    const result = migrateLegacyDreamCitationRecord(dream);
    totals.requiresReanalysis += result.requiresReanalysis;
    if (currentNeedsReanalysis) {
      totals.reanalysisCandidates += 1;
      if (reanalyze) reanalysisIds.push(String(dream._id));
    }
    if (!result.changed) continue;
    totals.changed += 1;
    totals.bindingsCreated += result.bindingsCreated;
    totals.citationsRecovered += result.citationsRecovered;
    totals.markersReopened += result.markersReopened;
    if (!apply) continue;
    dream.markModified('ai_result');
    dream.markModified('aiAnalysis');
    dream.markModified('edit_history');
    await dream.save();
    await syncDreamEvidenceNeeds(dream);
  }

  for (const [index, dreamId] of reanalysisIds.entries()) {
    const succeeded = await reanalyzeLegacyDream(dreamId, timeoutMs);
    if (succeeded) totals.reanalyzed += 1;
    else totals.reanalysisFailed += 1;
    console.log(
      `Legacy Dream reanalysis ${index + 1}/${reanalysisIds.length}: `
      + `${succeeded ? 'completed' : 'failed'}`,
    );
  }

  console.log(JSON.stringify({
    mode: reanalyze ? 'apply-and-reanalyze' : apply ? 'apply' : 'dry-run',
    ...totals,
  }, null, 2));
}

function readLimit(args: string[]): number | undefined {
  const value = args.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function readTimeoutMs(args: string[]): number {
  const value = args.find((arg) => arg.startsWith('--timeout-minutes='))?.split('=')[1];
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0
    ? Math.round(minutes * 60_000)
    : 30 * 60_000;
}

function cloneAnalysis(value: unknown): any {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

// Reuses the normal retry pipeline and waits before starting the next legacy Dream.
async function reanalyzeLegacyDream(dreamId: string, timeoutMs: number): Promise<boolean> {
  const dream = await Dream.findById(dreamId);
  if (!dream || dream.ai_status !== 'completed' || dream.ai_analysis_enabled === false) {
    return false;
  }
  await restartDreamAnalysis(dream, dream.userId, { trigger: 'citation_migration' });
  const runId = String(dream.analysisRun?.runId || '');
  if (!runId) return false;

  const deadline = Date.now() + timeoutMs;
  let analysisCompleted = false;
  while (Date.now() < deadline) {
    const current = await Dream.findById(dreamId)
      .select('ai_status analysisRun analysisMetadata continuationMetadata')
      .lean();
    if (!current) return false;
    if (String(current.analysisRun?.runId || '') !== runId) {
      analysisCompleted = current.ai_status === 'completed'
        && !['failed', 'cancelled'].includes(
          String(current.analysisMetadata?.lastReplacementOutcome || ''),
        );
      break;
    }
    await delay(1_000);
  }
  if (analysisCompleted) {
    await waitForContinuation(dreamId, deadline);
    return true;
  }
  abortDreamAnalysisExecution(dreamId, runId);
  await rollbackDreamAnalysisRun(
    dreamId,
    runId,
    'failed',
    'Legacy citation reanalysis exceeded its maintenance timeout.',
  );
  return false;
}

async function waitForContinuation(dreamId: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const dream = await Dream.findById(dreamId)
      .select('continuationMetadata')
      .lean();
    const status = String(dream?.continuationMetadata?.status || '');
    if (!['queued', 'running'].includes(status)) return;
    await delay(1_000);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
