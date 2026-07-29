import { randomUUID } from 'crypto';
import type { Types } from 'mongoose';
import Dream, { type IDream } from '../../../models/Dream';
import { logger } from '../../../../../infrastructure/logger';
import {
  abortDreamContinuationExecution,
  clearDreamContinuationController,
  generateDreamContinuation,
  registerDreamContinuationController,
  type DreamContinuation,
} from '../creation/dreamContinuation.service';
import { composeDreamNarrative } from '../../content/dreamNarrative.service';
import { enqueueDreamAnalysis } from './dreamAnalysisQueue.service';

const ESTIMATED_DURATION_SECONDS = 150;

function continuationVersions(dream: IDream): DreamContinuation[] {
  const analysis = (dream.ai_result || {}) as any;
  const history = Array.isArray(analysis.creative_continuation_history)
    ? analysis.creative_continuation_history as DreamContinuation[]
    : [];
  const current = analysis.creative_continuation as DreamContinuation | undefined;
  return [...history, ...(current ? [current] : [])].filter((item, index, rows) =>
    rows.findIndex(candidate => candidate.continuation === item.continuation) === index);
}

async function updateProgress(
  dreamId: string,
  runId: string,
  progress: number,
  statusMessage: string,
  extra: Record<string, unknown> = {},
) {
  await Dream.updateOne({
    _id: dreamId,
    'continuationMetadata.runId': runId,
    'continuationMetadata.status': { $in: ['queued', 'running'] },
  }, {
    $set: {
      'continuationMetadata.progress': progress,
      'continuationMetadata.statusMessage': statusMessage,
      'continuationMetadata.lastProgressAt': new Date(),
      ...extra,
    },
  });
}

async function runContinuation(dreamId: string, runId: string) {
  const startedAt = Date.now();
  const abortController = new AbortController();
  registerDreamContinuationController(runId, abortController);
  try {
    const dream = await Dream.findById(dreamId);
    if (!dream) throw new Error('Dream not found.');
    await updateProgress(dreamId, runId, 24, 'Đang nối lại cảnh cuối của giấc mơ...');
    const narrative = composeDreamNarrative(dream.content || '', dream.additions || []);
    const versions = continuationVersions(dream);
    await updateProgress(dreamId, runId, 48, 'Đang viết một diễn biến mới...');
    const continuation = await generateDreamContinuation(
      narrative,
      versions,
      abortController.signal,
    );
    await updateProgress(dreamId, runId, 88, 'Đang kiểm tra mạch truyện và đoạn tỉnh giấc...');

    const history = [...versions, continuation].slice(-12);
    const analysis = (dream.ai_result || {}) as any;
    dream.ai_result = {
      ...analysis,
      creative_continuation: continuation,
      creative_continuation_history: history,
      creative_continuation_index: history.length - 1,
    };
    dream.continuationMetadata = {
      runId,
      status: 'completed',
      progress: 100,
      statusMessage: 'Đã viết xong phần tiếp theo.',
      startedAt: new Date(startedAt),
      completedAt: new Date(),
      durationMs: Date.now() - startedAt,
      estimatedDurationSeconds: ESTIMATED_DURATION_SECONDS,
    };
    dream.markModified('ai_result');
    dream.markModified('continuationMetadata');
    await dream.save();
  } catch (error) {
    logger.error(`Dream continuation ${runId} failed`, error);
    await Dream.updateOne({ _id: dreamId, 'continuationMetadata.runId': runId }, {
      $set: {
        'continuationMetadata.status': abortController.signal.aborted ? 'cancelled' : 'failed',
        'continuationMetadata.progress': 0,
        'continuationMetadata.statusMessage': abortController.signal.aborted
          ? 'Đã dừng phần 2 để ưu tiên phân tích chính.'
          : 'Không thể viết phần tiếp theo. Bạn có thể thử lại.',
        'continuationMetadata.completedAt': new Date(),
        'continuationMetadata.durationMs': Date.now() - startedAt,
      },
    });
  } finally {
    clearDreamContinuationController(runId, abortController);
  }
}

// Queues continuation writing beside analysis so one account never runs both jobs at once.
export async function queueDreamContinuation(dream: IDream, userId: Types.ObjectId): Promise<boolean> {
  const currentStatus = String(dream.continuationMetadata?.status || '');
  if (currentStatus === 'queued' || currentStatus === 'running') return false;

  const runId = randomUUID();
  dream.continuationMetadata = {
    runId,
    status: 'queued',
    progress: 0,
    statusMessage: 'Đang chờ viết phần tiếp theo...',
    queuePosition: 1,
    enqueuedAt: new Date(),
    estimatedDurationSeconds: ESTIMATED_DURATION_SECONDS,
  };
  dream.markModified('continuationMetadata');
  await dream.save();

  return enqueueDreamContinuationRun(dream._id.toString(), userId.toString(), runId);
}

export function enqueueRecoveredDreamContinuation(
  dreamId: string,
  userId: string,
  runId: string,
): boolean {
  return enqueueDreamContinuationRun(dreamId, userId, runId);
}

export function cancelDreamContinuation(runId: string): void {
  abortDreamContinuationExecution(runId);
}

function enqueueDreamContinuationRun(
  dreamId: string,
  userId: string,
  runId: string,
): boolean {
  return enqueueDreamAnalysis({
    dreamId,
    userId,
    runId: `continuation:${runId}`,
    onQueued: async queuePosition => {
      await updateProgress(dreamId, runId, 0, `Đang chờ viết tiếp · vị trí ${queuePosition}`, {
        'continuationMetadata.queuePosition': queuePosition,
      });
    },
    onStart: async () => {
      const startedAt = new Date();
      const result = await Dream.updateOne({
        _id: dreamId,
        'continuationMetadata.runId': runId,
        'continuationMetadata.status': 'queued',
      }, {
        $set: {
          'continuationMetadata.status': 'running',
          'continuationMetadata.progress': 8,
          'continuationMetadata.statusMessage': 'Đang trở lại mạch giấc mơ...',
          'continuationMetadata.queuePosition': 0,
          'continuationMetadata.startedAt': startedAt,
          'continuationMetadata.lastProgressAt': startedAt,
        },
      });
      return result.matchedCount === 1;
    },
    execute: () => runContinuation(dreamId, runId),
  });
}
