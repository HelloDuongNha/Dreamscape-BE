import type { Types } from 'mongoose';
import Comment from '../../../social/models/Comment';
import Notification from '../../../social/models/Notification';
import { removeEvidenceOccurrences } from '../../../oracle/services/evidence/oracleEvidenceLifecycle.service';
import { removeRuleValidationFeedbackForOrigins } from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import Dream from '../../models/Dream';
import { discardQueuedDreamAnalysis } from '../analysis/execution/dreamAnalysisQueue.service';
import { abortDreamAnalysisExecution } from '../analysis/execution/dreamAnalysisRuntime.service';

export type DeleteOwnedDreamInput = {
  dreamId: Types.ObjectId;
  ownerId: Types.ObjectId;
};

// Cancels the current run before deleting the dream and its dependent records.
export async function deleteOwnedDream(input: DeleteOwnedDreamInput): Promise<boolean> {
  const dream = await Dream.findOne({
    _id: input.dreamId,
    userId: input.ownerId,
  }).select('analysisRun').lean();
  if (!dream) return false;

  const dreamId = input.dreamId.toString();
  const ownerId = input.ownerId.toString();
  const runId = dream.analysisRun?.runId;
  if (runId) abortDreamAnalysisExecution(dreamId, runId);
  discardQueuedDreamAnalysis({ dreamId, userId: ownerId, runId });

  const deletedDream = await Dream.deleteOne({
    _id: input.dreamId,
    userId: input.ownerId,
  });
  if (deletedDream.deletedCount !== 1) return false;

  await Promise.all([
    Comment.deleteMany({ dreamId: input.dreamId }),
    Notification.deleteMany({ postId: input.dreamId }),
    removeEvidenceOccurrences({ dreamIds: [input.dreamId] }),
    removeRuleValidationFeedbackForOrigins({
      origin: 'dream_analysis',
      originIds: [input.dreamId],
    }),
  ]);
  return true;
}
