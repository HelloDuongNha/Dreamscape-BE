import { Types } from 'mongoose';
import Dream from '../../models/Dream';
import type { UpdateDreamRequestDto } from '../../dto/dreamUpdate.dto';
import {
  prepareDreamReanalysis,
  type PreparedDreamReanalysis,
} from '../analysis/execution/dreamReanalysisPreparation.service';
import {
  composeDreamNarrative,
  dreamContentHash,
  mapDreamResponse,
  normalizedDreamContent,
} from './dreamNarrative.service';

export interface UpdateOwnedDreamInput extends UpdateDreamRequestDto {
  ownerId: Types.ObjectId;
}

export class DreamUpdateConflictError extends Error {
  constructor(
    message: string,
    public readonly status: 409 | 413 = 409,
  ) {
    super(message);
  }
}

export interface UpdatedDreamContext {
  response: unknown;
  prepared?: PreparedDreamReanalysis;
}

function plainValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

// Snapshot the visible version before applying and analyzing the new draft.
export async function updateOwnedDream(
  input: UpdateOwnedDreamInput,
): Promise<UpdatedDreamContext | null> {
  const dream = await Dream.findOne({
    _id: new Types.ObjectId(input.dreamId),
    userId: input.ownerId,
  });
  if (!dream) return null;
  if (dream.ai_status === 'pending') {
    throw new DreamUpdateConflictError('Hãy chờ lần phân tích hiện tại hoàn tất trước khi chỉnh sửa.');
  }
  const normalizedContent = normalizedDreamContent(input.content);
  const additionsChanged = input.additions
    ? input.additions.length !== dream.additions.length
      || input.additions.some((item, index) =>
        item.content !== normalizedDreamContent(dream.additions[index]?.content || ''),
      )
    : false;
  if (normalizedContent === dream.content && !additionsChanged) {
    throw new DreamUpdateConflictError('Nội dung chưa có thay đổi để lưu.');
  }
  const prospectiveNarrative = composeDreamNarrative(
    normalizedContent,
    input.additions || dream.additions || [],
  );
  if (prospectiveNarrative.length > 12000) {
    throw new DreamUpdateConflictError(
      'Tổng nội dung giấc mơ không được vượt quá 12.000 ký tự.',
      413,
    );
  }

  const additions = plainValue(
    (dream.additions || []).map(item =>
      typeof (item as any).toObject === 'function' ? (item as any).toObject() : item,
    ),
  );
  dream.edit_history.push({
    version: dream.edit_history.length + 1,
    content: dream.content,
    additions,
    ai_status: dream.ai_status,
    ai_result: plainValue(dream.ai_result),
    mood_tag: dream.mood_tag,
    retrievedContext: plainValue(dream.retrievedContext),
    analysisMetadata: plainValue(dream.analysisMetadata),
    realLifeHypothesesFeedback: plainValue(dream.realLifeHypothesesFeedback),
    editedAt: new Date(),
  });
  dream.content = normalizedContent;
  if (input.additions) {
    const existingBySequence = new Map(
      (dream.additions || []).map(item => [item.sequence, item]),
    );
    dream.set('additions', input.additions.map((item, index) => {
      const existing = item.sequence ? existingBySequence.get(item.sequence) : undefined;
      return {
        sequence: index + 1,
        content: item.content,
        addedAt: existing?.addedAt || new Date(),
        analysisState: 'pending',
      };
    }));
    dream.markModified('additions');
  }
  dream.markModified('edit_history');
  if (dream.ai_analysis_enabled === false) {
    dream.contentHash = dreamContentHash(prospectiveNarrative);
    dream.ai_status = 'disabled';
    dream.ai_result = null;
    dream.retrievedContext = null;
    dream.realLifeHypothesesFeedback = [];
    dream.analysisMetadata = {
      currentStage: 'disabled',
      progress: 0,
      statusMessage: 'Bài viết này đã tắt AI phân tích.',
      contextChangedAt: new Date(),
      retainedResult: false,
    };
    dream.markModified('analysisMetadata');
    await dream.save();
    await dream.populate('userId', 'username display_name avatar');
    return { response: mapDreamResponse(dream) };
  }
  const prepared = await prepareDreamReanalysis(dream, input.ownerId, 'content_edit');
  return { response: prepared.response, prepared };
}
