import Dream, { IDream } from '../../../models/Dream';
import { Types } from 'mongoose';

export async function rollbackDreamAnalysisRun(
  dreamId: Types.ObjectId | string,
  runId: string,
  outcome: 'cancelled' | 'failed',
  errorMessage?: string,
): Promise<IDream | null> {
  const dream = await Dream.findOne({
    _id: dreamId,
    ai_status: 'pending',
    'analysisRun.runId': runId,
  }).select('+analysisRollback');
  if (!dream) return null;

  const run = (dream.analysisRun || {}) as NonNullable<IDream['analysisRun']>;
  const rollback = (dream.analysisRollback || {}) as NonNullable<IDream['analysisRollback']>;
  const now = new Date();
  const startedAt = run.startedAt ? new Date(run.startedAt) : now;
  const targetSequences = Array.isArray(run.targetAdditionSequences)
    ? run.targetAdditionSequences.filter(Number.isInteger)
    : [];
  const isAdditionRun = run.trigger === 'dream_addition'
    || run.trigger === 'addition_retry'
    || run.trigger === 'content_edit'
    || run.trigger === 'addition_edit';
  const hasPreviousAnalysis = rollback.runId === runId && rollback.hadPreviousResult;
  const previousMetadata = rollback.runId === runId && rollback.previousAnalysisMetadata
    ? { ...rollback.previousAnalysisMetadata }
    : {};
  const failedAtStage = String((dream.analysisMetadata as any)?.currentStage || 'preparing');

  const update: Record<string, any> = {
    $set: {
      ai_status: hasPreviousAnalysis ? 'completed' : outcome,
      analysisMetadata: hasPreviousAnalysis
        ? {
            ...previousMetadata,
            lastReplacementOutcome: outcome,
            lastReplacementTrigger: run.trigger,
            replacementEndedAt: now,
            replacementDurationMs: Math.max(0, now.getTime() - startedAt.getTime()),
            hasUnanalyzedAdditions: isAdditionRun || Boolean(previousMetadata.hasUnanalyzedAdditions),
          }
        : {
            ...(dream.analysisMetadata || {}),
            currentStage: outcome,
            ...(outcome === 'failed' ? { failedAtStage } : {}),
            statusMessage: outcome === 'cancelled'
              ? 'Đã hủy phân tích theo yêu cầu.'
              : 'Phân tích chưa hoàn tất. Bạn có thể thử lại.',
            currentMiniStep: '',
            progress: Math.max(0, Number((dream.analysisMetadata as any)?.progress) || 0),
            endedAt: now,
            durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
            lastReplacementOutcome: outcome,
            lastReplacementTrigger: run.trigger,
            hasUnanalyzedAdditions: isAdditionRun,
          },
    },
    $unset: {
      analysisRun: 1,
      analysisRollback: 1,
    },
  };

  if (!hasPreviousAnalysis && outcome === 'failed') {
    update.$set.ai_result = {
      errorSummary: errorMessage || 'An unexpected internal error occurred during dream analysis.',
      title: 'Không thể phân tích',
      summary: 'Oracle chưa thể phân tích giấc mơ này. Vui lòng thử lại sau.',
      emotional_tone: 'Unknown',
      scientific_context_notes: [],
      symbolic_notes: [],
      cultural_symbolic_notes: [],
      real_life_hypotheses: [],
      confidence: 0,
      core_analysis: 'Đã xảy ra lỗi trong quá trình phân tích giấc mơ. Vui lòng thử lại.',
      disclaimer: 'Phân tích không thành công do lỗi hệ thống.',
    };
  }

  const options: Record<string, any> = { new: true };
  if (targetSequences.length > 0) {
    update.$set['additions.$[target].analysisState'] = 'unanalyzed';
    update.$unset['additions.$[target].analysisRunId'] = 1;
    options.arrayFilters = [{ 'target.sequence': { $in: targetSequences } }];
  }

  return Dream.findOneAndUpdate(
    { _id: dreamId, ai_status: 'pending', 'analysisRun.runId': runId },
    update,
    options,
  ).select('+analysisRollback');
}
