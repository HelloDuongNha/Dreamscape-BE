import crypto from 'crypto';
import type { Types } from 'mongoose';
import Dream, { type IDream } from '../../models/Dream';
import type { CreateDreamRequestDto } from '../../dto/dreamCreate.dto';
import { estimateDreamAnalysisSeconds } from '../analysis/execution/dreamAnalysisTiming.service';
import {
  dreamContentHash,
  normalizedDreamContent,
} from './dreamNarrative.service';

interface CreatePendingDreamInput extends CreateDreamRequestDto {
  userId: Types.ObjectId;
}

export interface PendingDreamCreation {
  dream: IDream;
  analysisRunId: string;
}

export async function createPendingDream(
  input: CreatePendingDreamInput,
): Promise<PendingDreamCreation> {
  const normalizedContent = normalizedDreamContent(input.content);
  const contentHash = dreamContentHash(normalizedContent);
  const analysisStartedAt = new Date();
  const analysisRunId = crypto.randomUUID();
  const estimatedDurationSeconds = await estimateDreamAnalysisSeconds(
    input.userId,
    normalizedContent,
  );

  const dream = await Dream.create({
    userId: input.userId,
    content: normalizedContent,
    contentHash,
    mood_tag: input.moodTag?.trim() ?? '',
    is_public: input.isPublic !== undefined ? input.isPublic : true,
    privacy: input.isPublic === false ? 'private' : 'public',
    analysisMetadata: {
      currentStage: 'queued',
      progress: 0,
      statusMessage: 'Đã thêm vào hàng chờ phân tích.',
      currentMiniStep: 'Tác vụ sẽ tự bắt đầu khi tới lượt.',
      queuePosition: 1,
      stageResults: {},
      enqueuedAt: analysisStartedAt,
      startedAt: analysisStartedAt,
      lastProgressAt: analysisStartedAt,
      estimatedDurationSeconds,
      trigger: 'initial',
      runId: analysisRunId,
    },
    analysisRun: {
      runId: analysisRunId,
      trigger: 'initial',
      startedAt: analysisStartedAt,
      previousStatus: null,
      targetAdditionSequences: [],
    },
    analysisRollback: {
      runId: analysisRunId,
      previousStatus: null,
      hadPreviousResult: false,
      previousAnalysisMetadata: null,
    },
    // ai_status and ai_result use schema defaults ('pending' and null).
  });

  return { dream, analysisRunId };
}
