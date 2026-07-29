import { Types } from 'mongoose';
import Dream from '../../models/Dream';
import type { DreamAiPolicyDto } from '../../dto/dreamAiPolicy.dto';
import {
  prepareDreamReanalysis,
  type PreparedDreamReanalysis,
} from '../analysis/execution/dreamReanalysisPreparation.service';
import { mapDreamResponse } from './dreamNarrative.service';

export class DreamAiPolicyError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 409) {
    super(message);
  }
}

export interface DreamAiPolicyResult {
  response?: unknown;
  prepared?: PreparedDreamReanalysis;
  abortRunId?: string;
}

export async function setDreamAiPolicy(
  input: DreamAiPolicyDto & { ownerId: Types.ObjectId },
): Promise<DreamAiPolicyResult> {
  const dream = await Dream.findOne({
    _id: new Types.ObjectId(input.dreamId),
    userId: input.ownerId,
  }).select('+analysisRollback');
  if (!dream) {
    throw new DreamAiPolicyError('Not found or access denied.', 403);
  }

  if (input.enabled) {
    if (dream.ai_analysis_enabled && dream.ai_status !== 'disabled') {
      await dream.populate('userId', 'username display_name avatar');
      return { response: mapDreamResponse(dream) };
    }
    dream.ai_analysis_enabled = true;
    if (dream.ai_result) {
      dream.ai_status = 'completed';
      dream.analysisMetadata = {
        ...(dream.analysisMetadata || {}),
        currentStage: 'completed',
        statusMessage: 'Đã bật lại AI và sử dụng kết quả được giữ trước đó.',
        reenabledAt: new Date(),
      };
      dream.markModified('analysisMetadata');
      await dream.save();
      await dream.populate('userId', 'username display_name avatar');
      return { response: mapDreamResponse(dream) };
    }
    return {
      prepared: await prepareDreamReanalysis(dream, input.ownerId, 'ai_enable'),
    };
  }

  const hasResult = Boolean(dream.ai_result);
  if (hasResult && !input.resultPolicy) {
    throw new DreamAiPolicyError(
      'Choose whether to keep or delete the existing AI result.',
      400,
    );
  }
  const abortRunId = dream.ai_status === 'pending'
    ? String(dream.analysisRun?.runId || '')
    : '';
  dream.ai_analysis_enabled = false;
  dream.ai_status = 'disabled';
  dream.analysisRun = null;
  dream.analysisRollback = null;

  if (input.resultPolicy === 'delete') {
    dream.ai_result = null;
    dream.retrievedContext = null;
    dream.realLifeHypothesesFeedback = [];
    dream.set('analysisEmbedding', undefined);
  }
  dream.analysisMetadata = {
    ...(input.resultPolicy === 'keep' ? (dream.analysisMetadata || {}) : {}),
    currentStage: 'disabled',
    progress: 0,
    statusMessage: 'Bài viết này đã tắt AI phân tích.',
    disabledAt: new Date(),
    retainedResult: input.resultPolicy === 'keep' && hasResult,
  };
  dream.markModified('analysisMetadata');
  dream.markModified('analysisRun');
  dream.markModified('analysisRollback');
  await dream.save();
  await dream.populate('userId', 'username display_name avatar');
  return {
    response: mapDreamResponse(dream),
    ...(abortRunId ? { abortRunId } : {}),
  };
}
