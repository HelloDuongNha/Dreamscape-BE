import type { ClientSession } from 'mongoose';
import Dream from '../../../dream/models/Dream';
import RuleValidationFeedback from '../../../rules_v3/models/RuleValidationFeedback';
import type {
  OracleSourceInvalidationPlan,
} from './oracleSourceInvalidationPlan.service';
import {
  filterDreamFeedbackAfterSourceInvalidation,
} from './oracleDreamFeedbackInvalidation.service';
import {
  invalidateStoredDreamAnalysis,
  pruneDreamRetrievedContext,
} from './oracleDreamAnalysisInvalidation.service';

export {
  invalidateDreamAnalysis,
} from './oracleDreamAnalysisInvalidation.service';

// Reverts Dream citations, questions and stored version context in one transaction.
export async function invalidateDreamCitations(
  plan: OracleSourceInvalidationPlan,
  session?: ClientSession,
): Promise<void> {
  for (const dreamId of plan.dreamIds) {
    const dream = await Dream.findById(dreamId).session(session || null);
    if (!dream) continue;
    const { changed, invalidVerificationKeys } =
      invalidateDreamRecordCitationState(dream, plan);
    if (!changed) continue;

    dream.realLifeHypothesesFeedback = filterDreamFeedbackAfterSourceInvalidation(
      dream.realLifeHypothesesFeedback || [],
      invalidVerificationKeys,
      plan,
    );
    if (invalidVerificationKeys.size) {
      await RuleValidationFeedback.deleteMany({
        origin: 'dream_analysis',
        originId: dream._id,
        verificationKey: { $in: [...invalidVerificationKeys] },
      }, session ? { session } : {});
    }
    dream.markModified('ai_result');
    dream.markModified('edit_history');
    dream.markModified('realLifeHypothesesFeedback');
    await dream.save(session ? { session } : {});
  }
}

// Applies source invalidation to the current analysis and every stored post version.
export function invalidateDreamRecordCitationState(
  dream: any,
  plan: OracleSourceInvalidationPlan,
): { changed: boolean; invalidVerificationKeys: Set<string> } {
  const invalidVerificationKeys = new Set<string>();
  const invalidRuleIds = new Set(plan.ruleIds);
  const currentAnalysis = dream.ai_result as any;
  let changed = invalidateStoredDreamAnalysis(
    currentAnalysis,
    plan,
    invalidVerificationKeys,
  );
  const legacyAnalysis = dream.aiAnalysis;
  if (legacyAnalysis && legacyAnalysis !== currentAnalysis) {
    const legacyChanged = invalidateStoredDreamAnalysis(
      legacyAnalysis,
      plan,
      invalidVerificationKeys,
    );
    changed = legacyChanged || changed;
    if (legacyChanged) dream.markModified?.('aiAnalysis');
  }
  for (const history of dream.edit_history || []) {
    changed = invalidateHistoricalDreamVersion(
      history,
      plan,
      invalidRuleIds,
      invalidVerificationKeys,
    ) || changed;
  }
  const currentContextChanged = pruneDreamRetrievedContext(
    dream.retrievedContext,
    invalidRuleIds,
    plan,
  );
  if (currentContextChanged) dream.markModified?.('retrievedContext');
  return {
    changed: currentContextChanged || changed,
    invalidVerificationKeys,
  };
}

// Keeps a stored Dream version internally consistent after one source disappears.
function invalidateHistoricalDreamVersion(
  history: any,
  plan: OracleSourceInvalidationPlan,
  invalidRuleIds: Set<string>,
  invalidVerificationKeys: Set<string>,
): boolean {
  const historyVerificationKeys = new Set<string>();
  const analysisChanged = invalidateStoredDreamAnalysis(
    history.ai_result,
    plan,
    historyVerificationKeys,
  );
  for (const key of historyVerificationKeys) invalidVerificationKeys.add(key);

  const previousFeedback = Array.isArray(history.realLifeHypothesesFeedback)
    ? history.realLifeHypothesesFeedback
    : [];
  const nextFeedback = filterDreamFeedbackAfterSourceInvalidation(
    previousFeedback,
    historyVerificationKeys,
    plan,
  );
  const feedbackChanged = nextFeedback.length !== previousFeedback.length;
  if (feedbackChanged) history.realLifeHypothesesFeedback = nextFeedback;

  const contextChanged = pruneDreamRetrievedContext(
    history.retrievedContext,
    invalidRuleIds,
    plan,
  );
  return analysisChanged || feedbackChanged || contextChanged;
}
