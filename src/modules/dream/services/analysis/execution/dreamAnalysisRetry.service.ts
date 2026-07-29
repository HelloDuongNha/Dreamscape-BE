import crypto from 'crypto';
import type { Types } from 'mongoose';
import type { IDream } from '../../../models/Dream';
import { mapDreamResponse, composeDreamNarrative } from '../../content/dreamNarrative.service';
import {
  discardQueuedDreamAnalysis,
  enqueueDreamAnalysis,
} from './dreamAnalysisQueue.service';
import { runBackgroundAnalysis } from './dreamAnalysisRunner.service';
import { estimateDreamAnalysisSeconds } from './dreamAnalysisTiming.service';
import { cancelDreamContinuation } from './dreamContinuationJob.service';

// Creates a fenced retry run while preserving enough state for cancellation rollback.
export async function restartDreamAnalysis(
  dream: IDream,
  ownerId: Types.ObjectId,
  options: { trigger?: 'citation_migration' } = {},
): Promise<unknown> {
  const continuationRunId = String(dream.continuationMetadata?.runId || '').trim();
  const continuationStatus = String(dream.continuationMetadata?.status || '');
  if (continuationRunId && ['queued', 'running'].includes(continuationStatus)) {
    cancelDreamContinuation(continuationRunId);
    discardQueuedDreamAnalysis({
      dreamId: String(dream._id),
      userId: String(ownerId),
      runId: `continuation:${continuationRunId}`,
    });
    dream.continuationMetadata = {
      ...(dream.continuationMetadata as any),
      status: 'cancelled',
      progress: 0,
      queuePosition: 0,
      statusMessage: 'Đã dừng phần 2 để ưu tiên phân tích chính.',
      completedAt: new Date(),
    };
    dream.markModified('continuationMetadata');
  }
  const narrative = composeDreamNarrative(dream.content, dream.additions || []);
  const startedAt = new Date();
  const runId = crypto.randomUUID();
  const targetAdditionSequences = (dream.additions || [])
    .filter(addition => addition.analysisState === 'unanalyzed' || addition.analysisState === 'pending')
    .map(addition => addition.sequence);
  const trigger = options.trigger
    || (targetAdditionSequences.length > 0 ? 'addition_retry' : 'retry');
  const previousStatus = dream.ai_status;
  const previousAnalysisMetadata = dream.analysisMetadata
    ? { ...(dream.analysisMetadata as Record<string, unknown>) }
    : null;
  const estimatedDurationSeconds = await estimateDreamAnalysisSeconds(ownerId, narrative);

  dream.ai_status = 'pending';
  for (const addition of dream.additions || []) {
    if (!targetAdditionSequences.includes(addition.sequence)) continue;
    addition.analysisState = 'pending';
    addition.analysisRunId = runId;
  }
  dream.analysisMetadata = {
    currentStage: 'queued',
    progress: 0,
    statusMessage: 'Đã thêm lần thử lại vào hàng chờ.',
    currentMiniStep: 'Tác vụ sẽ tự bắt đầu khi tới lượt.',
    queuePosition: 1,
    stageResults: {},
    enqueuedAt: startedAt,
    startedAt,
    lastProgressAt: startedAt,
    estimatedDurationSeconds,
    trigger,
    runId,
  };
  dream.analysisRun = {
    runId,
    trigger,
    startedAt,
    previousStatus,
    targetAdditionSequences,
  };
  dream.analysisRollback = {
    runId,
    previousStatus,
    hadPreviousResult: previousStatus === 'completed' && Boolean(dream.ai_result),
    previousAnalysisMetadata,
  };
  dream.markModified('analysisMetadata');
  dream.markModified('analysisRun');
  dream.markModified('analysisRollback');
  dream.markModified('additions');
  await dream.save();

  enqueueDreamAnalysis({
    dreamId: String(dream._id),
    userId: String(ownerId),
    runId,
    execute: () => runBackgroundAnalysis(
      dream._id as Types.ObjectId,
      String(ownerId),
      narrative,
      dream.sleepContext || {},
      runId,
    ),
  });

  return mapDreamResponse(dream);
}
