import { Request, Response } from 'express';
import Dream from '../models/Dream';
import { Types }         from 'mongoose';
import {
  buildFeedbackChangeSet,
  buildFeedbackConclusion,
  buildFeedbackRevision,
  enrichScientificNotesForResponse,
  reconcileAlternateQuestionAfterFeedback,
  resolveQuestionRuleIds,
} from '../services/analysis/grounding/dreamAnalysisGrounding.service';
import { setRuleValidationFeedback } from '../../rules_v3/services/ruleV3ValidationScore.service';
import { composeDreamNarrative } from '../services/content/dreamNarrative.service';
import { syncDreamSymbolObservations } from '../services/analysis/execution/dreamSymbolObservationSync.service';

// Applies an answer to its linked hypotheses and validation rules.
export const saveHypothesisFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const dreamId = String(req.params.id);
    const userId = String(req.user!._id);
    const { hypothesisIndex, verificationKey: requestedVerificationKey, answer } = req.body as {
      hypothesisIndex?: number;
      verificationKey?: string;
      answer: 'yes' | 'no' | 'unsure' | null;
    };

    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'ID giấc mơ không hợp lệ.' });
      return;
    }

    const hasValidIndex = typeof hypothesisIndex === 'number' && Number.isInteger(hypothesisIndex) && hypothesisIndex >= 0;
    const cleanRequestedKey = String(requestedVerificationKey || '').trim();
    if (!hasValidIndex && !cleanRequestedKey) {
      res.status(400).json({ success: false, message: 'Thiếu mã câu hỏi hợp lệ.' });
      return;
    }

    const isClearingAnswer = answer === null;
    if (!isClearingAnswer && !['yes', 'no', 'unsure'].includes(answer as string)) {
      res.status(400).json({ success: false, message: 'Câu trả lời không hợp lệ.' });
      return;
    }

    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Không tìm thấy giấc mơ.' });
      return;
    }

    if (dream.userId.toString() !== userId) {
      res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện hành động này.' });
      return;
    }

    const activeAnalysis = dream.ai_result || (dream as any).aiAnalysis || {};
    const completeNarrative = composeDreamNarrative(dream.content || '', dream.additions || []);
    const renderedAnalysis = enrichScientificNotesForResponse(
      activeAnalysis,
      dream.retrievedContext,
      completeNarrative,
    );
    const hypotheses = (renderedAnalysis as any).real_life_hypotheses;
    const matchedIndex = Array.isArray(hypotheses)
      ? (cleanRequestedKey
          ? hypotheses.findIndex((item: any) => String(item?.verificationKey || '') === cleanRequestedKey)
          : Number(hypothesisIndex))
      : -1;
    if (!Array.isArray(hypotheses) || matchedIndex < 0 || matchedIndex >= hypotheses.length) {
      res.status(400).json({ success: false, message: 'Không tìm thấy câu hỏi tương ứng.' });
      return;
    }

    const matchedHypothesis = hypotheses[matchedIndex];
    if (!matchedHypothesis || !matchedHypothesis.followUpQuestion) {
      res.status(400).json({ success: false, message: 'Không tìm thấy câu hỏi tương ứng cho giả thuyết này.' });
      return;
    }

    const questionText = matchedHypothesis.followUpQuestion;
    const linkedRuleIds = resolveQuestionRuleIds(matchedHypothesis);
    const ruleId = linkedRuleIds[0];
    if (!ruleId) {
      res.status(400).json({
        success: false,
        message: 'Câu hỏi này không gắn với một lập luận đã duyệt nên không thể dùng để xác minh.'
      });
      return;
    }
    const verificationKey = matchedHypothesis.verificationKey
      ? String(matchedHypothesis.verificationKey)
      : undefined;
    const declaredEffect = isClearingAnswer ? undefined : matchedHypothesis.answerSemantics?.[answer as 'yes' | 'no' | 'unsure'];
    const effect: 'supports' | 'weakens' | 'unresolved' = ['supports', 'weakens', 'unresolved'].includes(declaredEffect)
      ? declaredEffect
      : 'unresolved';

    if (!dream.realLifeHypothesesFeedback) {
      dream.realLifeHypothesesFeedback = [];
    }

    // Store one row per linked rule without asking the same question twice.
    for (const linkedRuleId of linkedRuleIds) {
      const existingIndex = dream.realLifeHypothesesFeedback.findIndex(
        (f: any) => (verificationKey
          ? f.verificationKey === verificationKey
          : f.hypothesisIndex === hypothesisIndex)
          && String(f.ruleId || '') === linkedRuleId
      );
      const feedbackEntry = {
        hypothesisIndex: matchedIndex,
        ruleId: linkedRuleId,
        ...(verificationKey ? { verificationKey } : {}),
        answer: answer as 'yes' | 'no' | 'unsure',
        effect,
        questionText,
        userId: new Types.ObjectId(userId),
        updatedAt: new Date()
      };
      if (isClearingAnswer && existingIndex !== -1) {
        dream.realLifeHypothesesFeedback.splice(existingIndex, 1);
      } else if (!isClearingAnswer && existingIndex !== -1) {
        dream.realLifeHypothesesFeedback[existingIndex] = feedbackEntry;
      } else if (!isClearingAnswer) {
        dream.realLifeHypothesesFeedback.push(feedbackEntry);
      }
    }

    if (String(matchedHypothesis?.questionDimension || '') === 'external_sound_at_wake') {
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

    // Rebuild the displayed analysis instead of treating feedback as a counter.
    hypotheses[matchedIndex].userFeedback = isClearingAnswer ? null : answer;
    const activeHypotheses = verificationKey
      ? reconcileAlternateQuestionAfterFeedback(hypotheses, verificationKey, answer)
      : hypotheses;
    const feedbackRevision = buildFeedbackRevision(
      activeHypotheses,
      dream.realLifeHypothesesFeedback || [],
    );
    const analysisWithFeedback = {
      ...renderedAnalysis,
      real_life_hypotheses: activeHypotheses,
      feedback_revision: feedbackRevision,
      feedback_conclusion: buildFeedbackConclusion(feedbackRevision),
    };
    const refreshedAnalysis = enrichScientificNotesForResponse(
      analysisWithFeedback,
      dream.retrievedContext,
      completeNarrative,
    );
    const feedbackChanges = buildFeedbackChangeSet(renderedAnalysis, refreshedAnalysis);
    refreshedAnalysis.feedback_changed_paths = feedbackChanges.paths;
    refreshedAnalysis.feedback_changed_fragments = feedbackChanges.fragments;
    dream.ai_result = refreshedAnalysis;
    dream.markModified('ai_result');
    if ((dream as any).aiAnalysis) {
      (dream as any).aiAnalysis = refreshedAnalysis;
      dream.markModified('aiAnalysis');
    }

    await dream.save();
    const ruleScoreUpdates = await setRuleValidationFeedback({
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
    const scoreByRule = new Map(ruleScoreUpdates.map((item: any) => [String(item.ruleId), item]));
    const updatedHypotheses = (refreshedAnalysis.real_life_hypotheses || []).map((item: any) => {
      const candidateRuleIds = [...new Set([
        item.ruleId,
        ...(Array.isArray(item.ruleIds) ? item.ruleIds : []),
      ].map(value => String(value || '').trim()).filter(Boolean))];
      const score = candidateRuleIds
        .map(candidateRuleId => scoreByRule.get(candidateRuleId))
        .find(Boolean);
      if (!score) return item;
      return {
        ...item,
        ruleScore: score.score,
        ruleScoreDelta: score.scoreDelta,
        ruleVoteDelta: score.voteDelta,
      };
    });
    refreshedAnalysis.real_life_hypotheses = updatedHypotheses;
    dream.ai_result = refreshedAnalysis;
    dream.markModified('ai_result');
    if ((dream as any).aiAnalysis) {
      (dream as any).aiAnalysis = refreshedAnalysis;
      dream.markModified('aiAnalysis');
    }
    await dream.save();
    await syncDreamSymbolObservations(dream);

    res.status(200).json({
      success: true,
      message: isClearingAnswer ? 'Đã bỏ lựa chọn.' : 'Đã ghi nhận phản hồi.',
      data: {
        feedback: dream.realLifeHypothesesFeedback,
        feedbackRevision: refreshedAnalysis?.feedback_revision || [],
        feedbackConclusion: refreshedAnalysis?.feedback_conclusion || null,
        analysis: refreshedAnalysis,
        ruleScoreUpdates,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Không thể lưu phản hồi.', error: err.message });
  }
};
