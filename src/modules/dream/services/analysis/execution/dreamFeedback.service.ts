import { Types } from 'mongoose';
import { setRuleValidationFeedback } from '../../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import {
  resolveEvidenceQuestionRuleIds,
} from '../../../../../shared/evidence/evidenceQuestion';
import {
  buildFeedbackChangeSet,
  buildFeedbackConclusion,
  buildFeedbackRevision,
  enrichScientificNotesForResponse,
  reconcileAlternateQuestionAfterFeedback,
} from '../grounding/dreamAnalysisGrounding.service';
import { syncDreamSymbolObservations } from './dreamSymbolObservationSync.service';

type FeedbackAnswer = 'yes' | 'no' | 'unsure' | null;

interface ApplyDreamFeedbackInput {
  dream: any;
  userId: string;
  hypotheses: any[];
  matchedIndex: number;
  requestedIndex?: number;
  answer: FeedbackAnswer;
  renderedAnalysis: any;
  completeNarrative: string;
}

export class DreamFeedbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DreamFeedbackError';
  }
}

// Persists one answer, revises the analysis and updates every linked rule score.
export async function applyDreamHypothesisFeedback(input: ApplyDreamFeedbackInput): Promise<any> {
  const {
    dream,
    userId,
    hypotheses,
    matchedIndex,
    requestedIndex,
    answer,
    renderedAnalysis,
    completeNarrative,
  } = input;
  const matchedHypothesis = hypotheses[matchedIndex];
  if (!matchedHypothesis?.followUpQuestion) {
    throw new DreamFeedbackError('Không tìm thấy câu hỏi tương ứng cho giả thuyết này.');
  }

  const isClearingAnswer = answer === null;
  const questionText = matchedHypothesis.followUpQuestion;
  const linkedRuleIds = resolveEvidenceQuestionRuleIds(matchedHypothesis);
  const ruleId = linkedRuleIds[0];
  if (!ruleId) {
    throw new DreamFeedbackError(
      'Câu hỏi này không gắn với một lập luận đã duyệt nên không thể dùng để xác minh.',
    );
  }
  const verificationKey = matchedHypothesis.verificationKey
    ? String(matchedHypothesis.verificationKey)
    : undefined;
  const declaredEffect = isClearingAnswer
    ? undefined
    : matchedHypothesis.answerSemantics?.[answer as Exclude<FeedbackAnswer, null>];
  const effect: 'supports' | 'weakens' | 'unresolved' =
    ['supports', 'weakens', 'unresolved'].includes(declaredEffect)
      ? declaredEffect
      : 'unresolved';

  dream.realLifeHypothesesFeedback = dream.realLifeHypothesesFeedback || [];
  for (const linkedRuleId of linkedRuleIds) {
    const existingIndex = dream.realLifeHypothesesFeedback.findIndex(
      (feedback: any) => (verificationKey
        ? feedback.verificationKey === verificationKey
        : feedback.hypothesisIndex === requestedIndex)
        && String(feedback.ruleId || '') === linkedRuleId,
    );
    const feedbackEntry = {
      hypothesisIndex: matchedIndex,
      ruleId: linkedRuleId,
      ...(verificationKey ? { verificationKey } : {}),
      answer,
      effect,
      questionText,
      userId: new Types.ObjectId(userId),
      updatedAt: new Date(),
    };
    if (isClearingAnswer && existingIndex !== -1) {
      dream.realLifeHypothesesFeedback.splice(existingIndex, 1);
    } else if (!isClearingAnswer && existingIndex !== -1) {
      dream.realLifeHypothesesFeedback[existingIndex] = feedbackEntry;
    } else if (!isClearingAnswer) {
      dream.realLifeHypothesesFeedback.push(feedbackEntry);
    }
  }

  if (String(matchedHypothesis.questionDimension || '') === 'external_sound_at_wake') {
    const nextSleepContext = { ...(dream.sleepContext || {}) };
    if (isClearingAnswer || answer === 'unsure') delete nextSleepContext.externalSoundAtWake;
    else nextSleepContext.externalSoundAtWake = answer === 'yes';
    dream.sleepContext = nextSleepContext;
    dream.markModified('sleepContext');
    const retrievedContext = (dream.retrievedContext || {}) as any;
    retrievedContext.componentA = retrievedContext.componentA || {};
    retrievedContext.componentA.sleepContext = nextSleepContext;
    dream.retrievedContext = retrievedContext;
    dream.markModified('retrievedContext');
  }

  hypotheses[matchedIndex].userFeedback = isClearingAnswer ? null : answer;
  const activeHypotheses = verificationKey
    ? reconcileAlternateQuestionAfterFeedback(hypotheses, verificationKey, answer)
    : hypotheses;
  const feedbackRevision = buildFeedbackRevision(
    activeHypotheses,
    dream.realLifeHypothesesFeedback,
  );
  const refreshedAnalysis = enrichScientificNotesForResponse({
    ...renderedAnalysis,
    real_life_hypotheses: activeHypotheses,
    feedback_revision: feedbackRevision,
    feedback_conclusion: buildFeedbackConclusion(feedbackRevision),
  }, dream.retrievedContext, completeNarrative);
  const feedbackChanges = buildFeedbackChangeSet(renderedAnalysis, refreshedAnalysis);
  refreshedAnalysis.feedback_changed_paths = feedbackChanges.paths;
  refreshedAnalysis.feedback_changed_fragments = feedbackChanges.fragments;

  let ruleScoreUpdates;
  try {
    ruleScoreUpdates = await setRuleValidationFeedback({
      userId: new Types.ObjectId(userId),
      verificationKey: verificationKey || `${ruleId}:${matchedIndex}`,
      origin: 'dream_analysis',
      originId: dream._id as Types.ObjectId,
      questionText,
      answer,
      directRuleIds: linkedRuleIds,
      sourceId: String(matchedHypothesis.validationSourceId || '').trim() || undefined,
      exactQuote: String(matchedHypothesis.validationExactQuote || '').trim() || undefined,
    });
  } catch (error: any) {
    if (error?.message === 'validation_has_no_current_direct_argument') {
      throw new DreamFeedbackError(
        'Nguồn hoặc lập luận của câu hỏi này không còn hiệu lực. Hãy tải lại bài viết.',
      );
    }
    throw error;
  }
  const scoreByRule = new Map(ruleScoreUpdates.map((item: any) => [String(item.ruleId), item]));
  refreshedAnalysis.real_life_hypotheses = (refreshedAnalysis.real_life_hypotheses || [])
    .map((item: any) => {
      const candidateRuleIds = [...new Set([
        item.ruleId,
        ...(Array.isArray(item.ruleIds) ? item.ruleIds : []),
      ].map(value => String(value || '').trim()).filter(Boolean))];
      const score: any = candidateRuleIds
        .map(candidateRuleId => scoreByRule.get(candidateRuleId))
        .find(Boolean);
      return score ? {
        ...item,
        ruleScore: score.score,
        ruleScoreDelta: score.scoreDelta,
        ruleVoteDelta: score.voteDelta,
      } : item;
    });
  refreshedAnalysis.scientific_context_notes = (refreshedAnalysis.scientific_context_notes || [])
    .map((note: any) => {
      const score: any = scoreByRule.get(String(note.ruleId || '').trim());
      return score ? {
        ...note,
        academicEvidenceScore: score.score,
      } : note;
    });

  dream.ai_result = refreshedAnalysis;
  dream.markModified('ai_result');
  if (dream.aiAnalysis) {
    dream.aiAnalysis = refreshedAnalysis;
    dream.markModified('aiAnalysis');
  }
  await dream.save();
  await syncDreamSymbolObservations(dream);

  return {
    feedback: dream.realLifeHypothesesFeedback,
    feedbackRevision: refreshedAnalysis.feedback_revision || [],
    feedbackConclusion: refreshedAnalysis.feedback_conclusion || null,
    analysis: refreshedAnalysis,
    ruleScoreUpdates,
  };
}
