import crypto from 'crypto';
import type { Types } from 'mongoose';
import type { IDream } from '../../../models/Dream';
import { estimateDreamAnalysisSeconds } from './dreamAnalysisTiming.service';
import {
  composeDreamNarrative,
  dreamContentHash,
  mapDreamResponse,
} from '../../content/dreamNarrative.service';

export type MutableDreamAnalysisTrigger = 'content_edit' | 'addition_edit' | 'ai_enable';

export interface PreparedDreamReanalysis {
  dreamId: Types.ObjectId;
  userId: string;
  runId: string;
  narrative: string;
  sleepContext: Record<string, unknown>;
  response: unknown;
}

/**
 * Resets all analysis-derived state after a contextual edit and creates one
 * fenced, persistent run. The caller only has to enqueue the returned job.
 */
export async function prepareDreamReanalysis(
  dream: IDream,
  ownerId: Types.ObjectId,
  trigger: MutableDreamAnalysisTrigger,
): Promise<PreparedDreamReanalysis> {
  const narrative = composeDreamNarrative(dream.content, dream.additions || []);
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const estimatedDurationSeconds = await estimateDreamAnalysisSeconds(ownerId, narrative);

  for (const addition of dream.additions || []) {
    addition.analysisState = 'pending';
    addition.analysisRunId = runId;
    addition.analyzedAt = undefined;
  }

  dream.contentHash = dreamContentHash(narrative);
  dream.ai_status = 'pending';
  dream.ai_result = null;
  dream.retrievedContext = null;
  dream.realLifeHypothesesFeedback = [];
  dream.analysisMetadata = {
    currentStage: 'queued',
    progress: 0,
    statusMessage: trigger === 'content_edit'
      ? 'Đã thêm phiên bản mới vào hàng chờ phân tích.'
      : trigger === 'ai_enable'
        ? 'Đã bật AI và thêm bài viết vào hàng chờ phân tích.'
        : 'Đã thêm thay đổi chi tiết vào hàng chờ phân tích.',
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
    previousStatus: null,
    targetAdditionSequences: (dream.additions || []).map(item => item.sequence),
  };
  dream.analysisRollback = {
    runId,
    previousStatus: null,
    hadPreviousResult: false,
    previousAnalysisMetadata: null,
  };
  dream.markModified('additions');
  dream.markModified('analysisMetadata');
  dream.markModified('analysisRun');
  dream.markModified('analysisRollback');

  await dream.save();
  await dream.populate('userId', 'username display_name avatar');

  return {
    dreamId: dream._id as Types.ObjectId,
    userId: String(ownerId),
    runId,
    narrative,
    sleepContext: (dream.sleepContext || {}) as Record<string, unknown>,
    response: mapDreamResponse(dream),
  };
}
