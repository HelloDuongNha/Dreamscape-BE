import mongoose from 'mongoose';
import AcademicRuleExtractionRunV3 from '../../models/AcademicRuleExtractionRun';
import type { RuleV3GenerationProvider } from '../providers/ruleV3GenerationProvider.types';
import {
  isRuleV3MutationCommitted,
  rollbackRuleV3MutationJournal,
} from '../lifecycle/ruleV3ReplacementJournal.service';
import {
  RuleV3MutationContext,
  RuleV3RawExtractionPlan,
} from './ruleV3FullExtraction.types';
import { extractRuleV3Batches } from './ruleV3BatchExtraction.service';
import { persistRuleV3Candidates } from './ruleV3CandidatePersistence.service';
import {
  completeRuleV3Extraction,
  failRuleV3Extraction,
} from './ruleV3ExtractionCompletion.service';
import { prepareRuleV3ExtractionRun } from './ruleV3RunPreparation.service';
import { logger } from '../../../../infrastructure/logger';

const activeRuns = new Map<string, { task: Promise<void>; controller: AbortController }>();
const queuedRuns = new Map<string, QueuedRuleV3Run>();

interface QueuedRuleV3Run {
  activeKey: string;
  runId: string;
  attemptId: string;
  sourceId: string;
  sourceAliases: mongoose.Types.ObjectId[];
  raw: RuleV3RawExtractionPlan;
  provider: RuleV3GenerationProvider;
  replaceExisting: boolean;
}

export interface RuleV3FullRunStartResult {
  runId: string;
  reused: boolean;
  status: 'pending' | 'success';
}

export interface RuleV3FullRunOptions {
  replaceExisting?: boolean;
}

async function updateAttemptRun(runId: string, attemptId: string, update: Record<string, unknown>) {
  const run = await AcademicRuleExtractionRunV3.findOneAndUpdate(
    { _id: runId, attemptId, status: 'pending' },
    update,
    { new: true },
  );
  if (!run) throw new Error('attempt_superseded');
  return run;
}

export async function startRuleV3FullExtraction(
  inputId: string,
  provider: RuleV3GenerationProvider,
  options: RuleV3FullRunOptions = {}
): Promise<RuleV3FullRunStartResult> {
  const prepared = await prepareRuleV3ExtractionRun({
    inputId,
    provider,
    replaceExisting: options.replaceExisting === true,
    isAttemptActive: isAttemptScheduled,
  });
  if (prepared.kind === 'reused') {
    return { runId: prepared.runId, reused: true, status: prepared.status };
  }

  const activeKey = `${prepared.runId}:${prepared.attemptId}`;
  if (!isAttemptScheduled(prepared.runId, prepared.attemptId)) {
    queuedRuns.set(activeKey, {
      activeKey,
      runId: prepared.runId,
      attemptId: prepared.attemptId,
      sourceId: prepared.sourceId,
      sourceAliases: prepared.sourceAliases,
      raw: prepared.raw,
      provider,
      replaceExisting: options.replaceExisting === true,
    });
    await updateAttemptRun(prepared.runId, prepared.attemptId, {
      currentStage: 'queued',
    });
    drainRuleV3Queue();
  }
  return { runId: prepared.runId, reused: false, status: 'pending' };
}

function isAttemptScheduled(runId: string, attemptId: string): boolean {
  const activeKey = `${runId}:${attemptId}`;
  return activeRuns.has(activeKey) || queuedRuns.has(activeKey);
}

function drainRuleV3Queue(): void {
  if (activeRuns.size > 0) return;
  const next = queuedRuns.values().next().value as QueuedRuleV3Run | undefined;
  if (!next) return;
  queuedRuns.delete(next.activeKey);

  const controller = new AbortController();
  const task = executeRuleV3FullExtraction(
    next.runId,
    next.attemptId,
    next.sourceId,
    next.sourceAliases,
    next.raw,
    next.provider,
    next.replaceExisting,
    controller.signal,
  ).catch((error) => {
    logger.error('Rule V3 queued extraction terminated unexpectedly.', {
      runId: next.runId,
      error: String(error),
    });
  }).finally(() => {
    activeRuns.delete(next.activeKey);
    drainRuleV3Queue();
  });
  activeRuns.set(next.activeKey, { task, controller });
}

async function executeRuleV3FullExtraction(
  runId: string,
  attemptId: string,
  sourceId: string,
  sourceAliases: mongoose.Types.ObjectId[],
  raw: RuleV3RawExtractionPlan,
  provider: RuleV3GenerationProvider,
  replaceExisting: boolean,
  abortSignal: AbortSignal,
): Promise<void> {
  const mutation: RuleV3MutationContext = { journalId: null, rolledBack: false };
  try {
    await updateAttemptRun(runId, attemptId, {
      currentStage: 'extracting_candidates',
      processedBatches: 0,
      rawCandidateCount: 0,
      verifiedCandidateCount: 0,
      savedCandidateCount: 0,
      mergedCandidateCount: 0,
      rejectedCandidateCount: 0
    });

    const batchResult = await extractRuleV3Batches({
      runId,
      raw,
      provider,
      abortSignal,
      onProgress: progress => updateAttemptRun(runId, attemptId, { ...progress }),
    });
    const merged = batchResult.mergedCandidates;
    const persistence = await persistRuleV3Candidates({
      runId,
      attemptId,
      sourceId,
      sourceAliases,
      raw,
      mergedCandidates: merged,
      replaceExisting,
      abortSignal,
      mutation,
      rejectedCandidateCount: batchResult.rejectedCandidateCount,
      rejectionDiagnostics: batchResult.rejectionDiagnostics,
      onSavingStarted: () => updateAttemptRun(runId, attemptId, {
        currentStage: 'saving_candidates',
      }),
    });
    await completeRuleV3Extraction({
      runId,
      attemptId,
      raw,
      sourceAliases,
      verifiedCandidateCount: merged.size,
      persistence,
      mutation,
      abortSignal,
      updateRun: update => updateAttemptRun(runId, attemptId, update),
    });
  } catch (error: any) {
    await failRuleV3Extraction({
      runId,
      attemptId,
      mutation,
      abortSignal,
      error,
    });
  }
}

export async function cancelRuleV3FullExtraction(runId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(runId)) return false;
  const run = await AcademicRuleExtractionRunV3.findById(runId).select('status attemptId');
  if (!run || run.status !== 'pending') return false;
  const attemptId = String(run.attemptId || '');
  const activeKey = `${runId}:${attemptId}`;
  const active = activeRuns.get(activeKey);
  const wasQueued = queuedRuns.delete(activeKey);
  active?.controller.abort();
  if (active) {
    await active.task;
  } else if (!wasQueued && attemptId) {
    await rollbackRuleV3MutationJournal(attemptId, { markRunCancelled: true });
  }
  if (attemptId && await isRuleV3MutationCommitted(attemptId)) return false;
  let finalRun = await AcademicRuleExtractionRunV3.findOne({ _id: runId, attemptId }).select('status');
  if (finalRun?.status === 'success') return false;
  await AcademicRuleExtractionRunV3.updateOne(
    { _id: runId, attemptId, status: 'pending' },
    {
      $set: {
        status: 'cancelled',
        currentStage: 'cancelled',
        sanitizedErrorCode: 'user_cancelled',
        finishedAt: new Date(),
      },
    },
  );
  finalRun = await AcademicRuleExtractionRunV3.findOne({ _id: runId, attemptId }).select('status');
  return finalRun?.status === 'cancelled';
}

export async function getRuleV3FullRun(runId: string) {
  if (!mongoose.Types.ObjectId.isValid(runId)) return null;
  const run = await AcademicRuleExtractionRunV3.findById(runId).lean();
  if (!run) return null;
  const queuedKeys = [...queuedRuns.keys()];
  const queueIndex = queuedKeys.findIndex((key) => key.startsWith(`${runId}:`));
  return {
    ...run,
    queuePosition: queueIndex >= 0 ? queueIndex + 1 : 0,
  };
}
