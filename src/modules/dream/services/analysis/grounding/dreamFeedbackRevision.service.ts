import { normalizeGroundingText } from './dreamGroundingText.service';

// Updates only the selected precomputed question.
export function reconcileAlternateQuestionAfterFeedback(
  hypotheses: any[],
  verificationKey: string,
  answer: 'yes' | 'no' | 'unsure' | null,
): any[] {
  const items = Array.isArray(hypotheses) ? hypotheses.map(item => ({ ...item })) : [];
  const parentIndex = items.findIndex(item => String(item?.verificationKey || '') === verificationKey);
  if (parentIndex < 0) return items;
  items[parentIndex].userFeedback = answer;
  return items;
}

export function buildFeedbackRevision(hypotheses: any[], feedbackRows: any[]): any[] {
  const feedbackByRuleOrIndex = new Map((feedbackRows || []).map((entry: any) => [
    entry.verificationKey
      ? `verification:${entry.verificationKey}`
      : entry.ruleId ? `rule:${entry.ruleId}` : `index:${entry.hypothesisIndex}`,
    entry,
  ]));
  return (hypotheses || []).flatMap((hypothesis: any, index: number) => {
    const key = hypothesis.verificationKey
      ? `verification:${hypothesis.verificationKey}`
      : hypothesis.ruleId ? `rule:${hypothesis.ruleId}` : `index:${index}`;
    const feedback: any = feedbackByRuleOrIndex.get(key);
    if (!feedback) return [];
    const effect = ['supports', 'weakens', 'unresolved'].includes(feedback.effect)
      ? feedback.effect
      : 'unresolved';
    const status = effect === 'supports'
      ? 'supported'
      : effect === 'weakens' ? 'weakened' : 'unresolved';
    const interpretation = effect === 'supports'
      ? hypothesis.ifYesMeaning
      : effect === 'weakens'
        ? hypothesis.ifNoMeaning
        : 'Chưa dùng giả thuyết này làm cơ sở chính cho đến khi có thêm thông tin.';
    return [{
      hypothesis: String(hypothesis.hypothesis || '').trim(),
      status,
      interpretation: String(interpretation || '').trim(),
      ...(hypothesis.ruleId ? { ruleId: String(hypothesis.ruleId) } : {}),
    }];
  });
}

function feedbackSentences(value: unknown): string[] {
  const text = String(value || '').trim();
  if (!text) return [];
  return (text.match(/[^.!?…]+(?:[.!?…]+|$)/gu) || [text])
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

export function buildFeedbackChangeSet(before: any, after: any): {
  paths: string[];
  fragments: Record<string, string[]>;
} {
  const fragments: Record<string, string[]> = {};
  const compare = (path: string, left: unknown, right: unknown) => {
    const beforeText = String(left || '').trim();
    const afterText = String(right || '').trim();
    if (beforeText === afterText) return;
    const beforeSet = new Set(feedbackSentences(beforeText));
    const changedSentences = feedbackSentences(afterText)
      .filter(sentence => !beforeSet.has(sentence));
    fragments[path] = changedSentences.length > 0 ? changedSentences : [afterText];
  };

  compare('core_analysis', before?.core_analysis, after?.core_analysis);
  compare('case_conclusion.conclusion', before?.case_conclusion?.conclusion, after?.case_conclusion?.conclusion);
  compare('case_conclusion.reasoning', before?.case_conclusion?.reasoning, after?.case_conclusion?.reasoning);
  compare('case_conclusion.confidenceLabel', before?.case_conclusion?.confidenceLabel, after?.case_conclusion?.confidenceLabel);
  compare('case_conclusion.recommendedNextStep', before?.case_conclusion?.recommendedNextStep, after?.case_conclusion?.recommendedNextStep);
  compare('feedback_analysis.interpretation', before?.feedback_analysis?.interpretation, after?.feedback_analysis?.interpretation);
  const maxFeedbackFacts = Math.max(before?.feedback_analysis?.confirmedFacts?.length || 0, after?.feedback_analysis?.confirmedFacts?.length || 0);
  for (let index = 0; index < maxFeedbackFacts; index += 1) {
    compare(`feedback_analysis.confirmedFacts.${index}`, before?.feedback_analysis?.confirmedFacts?.[index], after?.feedback_analysis?.confirmedFacts?.[index]);
  }
  const maxEvidenceBasis = Math.max(before?.case_conclusion?.evidenceBasis?.length || 0, after?.case_conclusion?.evidenceBasis?.length || 0);
  for (let index = 0; index < maxEvidenceBasis; index += 1) {
    compare(`case_conclusion.evidenceBasis.${index}.detail`, before?.case_conclusion?.evidenceBasis?.[index]?.detail, after?.case_conclusion?.evidenceBasis?.[index]?.detail);
  }
  const maxConfirmedFindings = Math.max(before?.case_conclusion?.confirmedFindings?.length || 0, after?.case_conclusion?.confirmedFindings?.length || 0);
  for (let index = 0; index < maxConfirmedFindings; index += 1) {
    compare(`case_conclusion.confirmedFindings.${index}`, before?.case_conclusion?.confirmedFindings?.[index], after?.case_conclusion?.confirmedFindings?.[index]);
  }
  const maxRuledOut = Math.max(before?.case_conclusion?.ruledOut?.length || 0, after?.case_conclusion?.ruledOut?.length || 0);
  for (let index = 0; index < maxRuledOut; index += 1) {
    compare(`case_conclusion.ruledOut.${index}`, before?.case_conclusion?.ruledOut?.[index], after?.case_conclusion?.ruledOut?.[index]);
  }
  const maxThreads = Math.max(before?.interpretive_threads?.length || 0, after?.interpretive_threads?.length || 0);
  for (let index = 0; index < maxThreads; index += 1) {
    compare(`interpretive_threads.${index}.reasoning`, before?.interpretive_threads?.[index]?.reasoning, after?.interpretive_threads?.[index]?.reasoning);
    compare(`interpretive_threads.${index}.alternativeExplanation`, before?.interpretive_threads?.[index]?.alternativeExplanation, after?.interpretive_threads?.[index]?.alternativeExplanation);
  }
  const maxNotes = Math.max(before?.scientific_context_notes?.length || 0, after?.scientific_context_notes?.length || 0);
  for (let index = 0; index < maxNotes; index += 1) {
    compare(`scientific_context_notes.${index}.note`, before?.scientific_context_notes?.[index]?.note, after?.scientific_context_notes?.[index]?.note);
  }
  const maxReflections = Math.max(before?.practical_reflections?.length || 0, after?.practical_reflections?.length || 0);
  for (let index = 0; index < maxReflections; index += 1) {
    compare(`practical_reflections.${index}.suggestion`, before?.practical_reflections?.[index]?.suggestion, after?.practical_reflections?.[index]?.suggestion);
    compare(`practical_reflections.${index}.rationale`, before?.practical_reflections?.[index]?.rationale, after?.practical_reflections?.[index]?.rationale);
  }
  const maxMotifs = Math.max(before?.symbolic_notes?.length || 0, after?.symbolic_notes?.length || 0);
  for (let index = 0; index < maxMotifs; index += 1) {
    compare(`symbolic_notes.${index}.meaning`, before?.symbolic_notes?.[index]?.meaning, after?.symbolic_notes?.[index]?.meaning);
  }
  return { paths: Object.keys(fragments), fragments };
}

export function polishGeneratedDreamProse(value: unknown): string {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (!text) return text;
  const unique = new Map<string, string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/u).map(item => item.trim()).filter(Boolean)) {
    const key = normalizeGroundingText(sentence);
    if (!unique.has(key)) unique.set(key, sentence);
  }
  return [...unique.values()].join(' ');
}
