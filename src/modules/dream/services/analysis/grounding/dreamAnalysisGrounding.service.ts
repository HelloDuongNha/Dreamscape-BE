import {
  canExplainPsychology,
  canGenerateContextQuestion,
} from '../../../../rules_v3/services/ruleV3DreamApplication.service';
import { sanitizePracticalReflections } from '../assembly/practicalReflection.service';
import {
  exactNarrativeExcerptExists,
  isHypothesisAnsweredByKnownContext,
  isStructurallyInvalidFollowUpQuestion,
  normalizeAnalysisText,
  validateGeneratedHypotheses,
  validateInterpretiveThreads,
} from '../contracts/dreamAnalysis.contract';

export const normalizeGroundingText = normalizeAnalysisText;
export const isHypothesisAlreadyAnswered = isHypothesisAnsweredByKnownContext;
export const exactExcerptExists = exactNarrativeExcerptExists;
export const isVagueFollowUpQuestion = isStructurallyInvalidFollowUpQuestion;
export const sanitizeInterpretiveThreads = validateInterpretiveThreads;
export const sanitizeGeneratedHypotheses = validateGeneratedHypotheses;

export function resolveQuestionRuleIds(hypothesis: any): string[] {
  return [...new Set<string>((hypothesis?.ruleIds || [hypothesis?.ruleId])
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean))];
}

export type DreamEmotionToneKey =
  | 'urgent_conflicted'
  | 'anxious'
  | 'fearful'
  | 'sad'
  | 'calm'
  | 'mixed'
  | 'neutral';

export function deriveDreamEmotionTone(_narrative: string): {
  key: DreamEmotionToneKey;
  label: string;
} {
  return { key: 'neutral', label: 'Chưa xác định rõ' };
}

export function removeInternalAnalysisVocabulary(value: unknown): string {
  return String(value || '')
    .replace(/\brule\s+v3\b/giu, 'kết quả nghiên cứu')
    .replace(/\brule\s+(?:đã\s+duyệt\s+)?về\s+/giu, 'nghiên cứu về ')
    .replace(/\brule\s+(?:đã\s+duyệt\s+)?/giu, 'kết quả nghiên cứu ')
    .replace(/(?:quy luật|lập luận)\s+(?:đã\s+duyệt\s+)?/giu, 'kết quả nghiên cứu ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function significantTokens(value: unknown): string[] {
  return normalizeGroundingText(value).split(' ').filter(token => token.length >= 3);
}

function containsGroundedPhrase(value: unknown, phrases: string[]): boolean {
  const haystack = ` ${normalizeGroundingText(value)} `;
  return phrases.some(phrase => haystack.includes(` ${normalizeGroundingText(phrase)} `));
}

export function findNarrativeSentenceForSymbol(symbol: unknown, narrative: string): string | null {
  const normalizedSymbol = normalizeGroundingText(symbol);
  if (normalizedSymbol.length < 2) return null;
  const sentences = narrative
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  return sentences.find(sentence => normalizeGroundingText(sentence).includes(normalizedSymbol)) || null;
}

export type ContextualTone = 'threatening' | 'reassuring' | 'ambivalent' | 'neutral';

export function inferContextualTone(_evidence: unknown): ContextualTone {
  return 'neutral';
}

export function buildGroundedMotifExplanation(note: any, _rules: any[]): string {
  return String(note?.meaning || '').trim();
}

export function sanitizeUnsupportedDreamClaims(value: unknown): string {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

export function isGroundedDreamTitle(title: unknown, narrative: string): boolean {
  const titleText = String(title || '').trim();
  if (titleText.length < 4 || titleText.length > 100) return false;
  const narrativeTokens = new Set(significantTokens(narrative));
  const titleTokens = significantTokens(titleText);
  if (titleTokens.length === 0) return false;
  const matched = titleTokens.filter(token => narrativeTokens.has(token)).length;
  return matched > 0 && matched / titleTokens.length >= 0.6;
}

function displayMotif(value: string): string {
  return value
    .split(' ')
    .map(word => word ? `${word[0].toLocaleUpperCase('vi')}${word.slice(1)}` : word)
    .join(' ');
}

export function buildGroundedDreamTitle(narrative: string, motifs: unknown[] = []): string {
  const groundedMotifs = motifs
    .map(value => String(value || '').trim())
    .filter(value => value && exactExcerptExists(value, narrative));
  const preferred = groundedMotifs.length >= 2
    ? groundedMotifs
    : extractContextualMotifHints(narrative, 6);
  const unique = [...new Map(preferred.map(item => [normalizeGroundingText(item), item])).values()];
  if (unique.length >= 2) return `${displayMotif(unique[0])} và ${displayMotif(unique[1])}`;
  if (unique.length === 1) return `Giấc Mơ Về ${displayMotif(unique[0])}`;
  return 'Một Giấc Mơ Đáng Suy Ngẫm';
}

export function attachRuleQuestionContext(hypotheses: any[], rules: any[]): any[] {
  const ruleMap = new Map((rules || []).map(rule => [String(rule?.ruleId || rule?._id || ''), rule]));
  return (hypotheses || []).map(item => {
    const verificationKey = String(item?.verificationKey || `${item?.ruleId || 'unlinked'}:${normalizeGroundingText(item?.followUpQuestion || '').replace(/\s+/g, '_').slice(0, 120)}`);
    const answerSemantics = item?.answerSemantics || { yes: 'supports', no: 'weakens', unsure: 'unresolved' };
    const rule = ruleMap.get(String(item?.ruleId || '')) as any;
    const ruleContext = rule ? {
      ruleStatement: String(rule?.ruleStatement || rule?.statement || '').trim(),
      ruleCode: String(rule?.ruleCode || '').trim() || undefined,
    } : {};
    if (item?.reasonForAsking) return { ...item, ...ruleContext, verificationKey, answerSemantics };
    return {
      ...item,
      ...ruleContext,
      verificationKey,
      answerSemantics,
      reasonForAsking: 'Câu hỏi này kiểm tra một hoàn cảnh chưa được kể rõ. Chỉ khi hoàn cảnh đó có thật, hệ thống mới giữ cách hiểu tương ứng trong kết quả phân tích.',
      ifYesMeaning: 'Câu trả lời Có làm giả thuyết này phù hợp hơn với trường hợp hiện tại, nhưng không biến nó thành một kết luận chắc chắn.',
      ifNoMeaning: 'Câu trả lời Không làm giảm ưu tiên của giả thuyết này và hệ thống không nên dùng nó làm trục diễn giải chính.',
    };
  });
}

/** Questions are precomputed before display. Feedback must never generate,
 * remove, or rewrite a later question; it only updates the selected answer. */
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
    const effect = ['supports', 'weakens', 'unresolved'].includes(feedback.effect) ? feedback.effect : 'unresolved';
    const status = effect === 'supports' ? 'supported' : effect === 'weakens' ? 'weakened' : 'unresolved';
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
    const changedSentences = feedbackSentences(afterText).filter(sentence => !beforeSet.has(sentence));
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

export interface ExploratoryCaseAssessment {
  status: 'strong_match' | 'partial_match' | 'mixed' | 'weakened' | 'unresolved';
  answeredCount: number;
  totalCount: number;
  confirmedCount: number;
  weakenedCount: number;
  unresolvedCount: number;
  conclusion: string;
}

export interface DreamCaseConclusion {
  status: 'preliminary' | 'clarified';
  headline: string;
  conclusion: string;
  reasoning: string;
  confidenceLabel: string;
  confirmedFindings: string[];
  ruledOut: string[];
  recommendedNextStep: string;
  concern: {
    level: 'no_clear_warning';
    label: string;
    explanation: string;
    watchFor: string[];
    helpSource: { title: string; url: string };
  };
  evidenceBasis: Array<{
    kind: 'confirmed_context' | 'academic_context' | 'boundary';
    title: string;
    detail: string;
    sources?: Array<{ sourceId: string; title: string; year?: number; doi?: string }>;
  }>;
}

function ruleAndComponentIds(rule: any): Set<string> {
  return new Set([
    String(rule?.ruleId || rule?._id || '').trim(),
    ...(Array.isArray(rule?.compositeComponents)
      ? rule.compositeComponents.map((component: any) => String(component?.sourceRuleId || '').trim())
      : []),
  ].filter(Boolean));
}

/**
 * Summarises answers at case level for narrative rematerialisation. Score
 * changes are applied separately by the deterministic validation pipeline;
 * one person's answer still does not create a new independent study.
 */
export function buildExploratoryCaseAssessment(
  hypotheses: any[],
  rule?: any,
): ExploratoryCaseAssessment | null {
  const allowedRuleIds = rule ? ruleAndComponentIds(rule) : null;
  const candidates = (Array.isArray(hypotheses) ? hypotheses : []).filter(item => {
    if (!allowedRuleIds?.size) return true;
    const itemIds = [item?.ruleId, ...(Array.isArray(item?.ruleIds) ? item.ruleIds : [])]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    return itemIds.some(id => allowedRuleIds.has(id));
  });
  if (candidates.length === 0) return null;

  const unique = new Map<string, any>();
  for (const item of candidates) {
    const key = normalizeGroundingText(item?.followUpQuestion || item?.hypothesis || '');
    if (key && !unique.has(key)) unique.set(key, item);
  }
  const values = [...unique.values()];
  const answers = values
    .map(item => item?.userFeedback)
    .filter(value => ['yes', 'no', 'unsure'].includes(value));
  const confirmedCount = answers.filter(value => value === 'yes').length;
  const weakenedCount = answers.filter(value => value === 'no').length;
  const unresolvedCount = answers.filter(value => value === 'unsure').length;
  const answeredCount = answers.length;
  const totalCount = values.length;
  const status: ExploratoryCaseAssessment['status'] = answeredCount === 0 || unresolvedCount === answeredCount
    ? 'unresolved'
    : weakenedCount === 0 && unresolvedCount === 0 && confirmedCount === totalCount
      ? 'strong_match'
      : confirmedCount > weakenedCount
        ? 'partial_match'
        : weakenedCount > confirmedCount
          ? 'weakened'
          : 'mixed';

  return {
    status,
    answeredCount,
    totalCount,
    confirmedCount,
    weakenedCount,
    unresolvedCount,
    conclusion: answeredCount > 0
      ? `Đã đối chiếu ${answeredCount}/${totalCount} câu hỏi bối cảnh: ${confirmedCount} phù hợp, ${weakenedCount} không phù hợp và ${unresolvedCount} chưa chắc.`
      : `Chưa có câu trả lời cho ${totalCount} câu hỏi bối cảnh đã chuẩn bị.`,
  };
}

export function buildDreamCaseConclusion(
  _narrative: string,
  hypotheses: any[],
  scientificNotes: any[] = [],
  centralAnalysis?: unknown,
): DreamCaseConclusion {
  const assessment = buildExploratoryCaseAssessment(hypotheses);
  const feedback = buildFeedbackAppliedAnalysis(hypotheses);
  const clarified = Boolean(assessment?.answeredCount);
  const academicSources = [...new Map((scientificNotes || [])
    .flatMap(note => note?.sources || [])
    .map((source: any) => [String(source?.sourceId || source?.doi || source?.title || ''), {
      sourceId: String(source?.sourceId || ''),
      title: String(source?.title || 'Tài liệu học thuật'),
      ...(source?.year ? { year: Number(source.year) } : {}),
      ...(source?.doi ? { doi: String(source.doi) } : {}),
    }]))
    .values()].filter(source => source.sourceId || source.doi || source.title);
  const centralSentences = polishGeneratedDreamProse(centralAnalysis)
    .split(/(?<=[.!?])\s+/u)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const preliminaryConclusion = centralSentences.slice(0, 2).join(' ');

  const evidenceBasis: DreamCaseConclusion['evidenceBasis'] = [{
    kind: 'confirmed_context',
    title: clarified ? 'Dữ kiện do bạn xác nhận' : 'Dữ kiện còn cần xác nhận',
    detail: assessment?.conclusion || 'Chưa có câu hỏi bối cảnh đủ điều kiện để đối chiếu.',
  }];
  if (academicSources.length > 0) evidenceBasis.push({
    kind: 'academic_context',
    title: 'Nguồn học thuật được liên kết',
    detail: 'Nguồn chỉ hỗ trợ lập luận được trích dẫn; nguồn không tự quyết định ý nghĩa của trường hợp cá nhân.',
    sources: academicSources,
  });
  evidenceBasis.push({
    kind: 'boundary',
    title: 'Giới hạn của kết luận',
    detail: 'Câu trả lời cá nhân giúp kiểm tra độ phù hợp của lập luận, nhưng không tạo thêm bằng chứng nghiên cứu, dự báo tương lai hay chẩn đoán tâm lý.',
  });

  return {
    status: clarified ? 'clarified' : 'preliminary',
    headline: clarified ? 'Kết luận sau khi đối chiếu câu trả lời' : 'Kết luận ban đầu',
    conclusion: feedback?.interpretation
      || preliminaryConclusion
      || 'Các chi tiết trong lời kể tạo thành một hướng diễn giải ban đầu; hoàn cảnh ngoài đời vẫn do bạn xác nhận.',
    reasoning: assessment?.conclusion
      || 'Chưa có đủ câu trả lời để phân biệt dữ kiện đời thực với phần chỉ tồn tại trong câu chuyện của giấc mơ.',
    confidenceLabel: clarified
      ? 'Đã có dữ kiện trường hợp; vẫn giữ giới hạn của bằng chứng học thuật.'
      : 'Diễn giải phản tư dựa trên lời kể, không phải kết luận về hoàn cảnh ngoài đời.',
    confirmedFindings: feedback?.confirmedFacts || [],
    ruledOut: feedback?.rejectedDirections || [],
    recommendedNextStep: feedback?.unresolvedQuestions?.length
      ? 'Trả lời các câu hỏi còn mở bằng dữ kiện đời thực.'
      : 'Xem phần phản tư thực tế do mô hình đề xuất và chỉ chọn điều phù hợp với hoàn cảnh của bạn.',
    concern: {
      level: 'no_clear_warning',
      label: 'Chưa thể kết luận có dấu hiệu đáng lo chỉ từ nội dung giấc mơ',
      explanation: 'Mức độ ảnh hưởng tới giấc ngủ và sinh hoạt quan trọng hơn bản thân một hình ảnh phi thực tế trong mơ.',
      watchFor: [
        'Giấc mơ lặp lại thường xuyên và gây sợ hãi hoặc mất ngủ.',
        'Khó chịu sau khi tỉnh kéo dài hoặc cản trở sinh hoạt.',
        'Nội dung liên quan đến một sự kiện gây tổn thương và tiếp tục gây khó chịu rõ rệt.',
      ],
      helpSource: {
        title: 'Hướng dẫn NHS về ác mộng và khi nào nên tìm hỗ trợ',
        url: 'https://www.nhs.uk/conditions/night-terrors/',
      },
    },
    evidenceBasis,
  };
}


export function buildCaseGroundedSynthesis(
  _narrative: string,
  _hypotheses: any[],
  fallback: unknown,
): string {
  return polishGeneratedDreamProse(sanitizeUnsupportedDreamClaims(fallback));
}

/**
 * Interpretation threads are authored by the analysis model. This boundary
 * validates and limits them; it never invents narrative-specific content.
 */
export function buildCaseGroundedThreads(_narrative: string, fallback: any[]): any[] {
  return Array.isArray(fallback) ? fallback.slice(0, 3) : [];
}

export function ensureInterpretiveThreadCoverage(_narrative: string, threads: any[]): any[] {
  return Array.isArray(threads) ? threads.slice(0, 3) : [];
}

export function buildFeedbackConclusion(revisions: any[]): string | null {
  const supported = (revisions || []).filter(item => item?.status === 'supported');
  const weakened = (revisions || []).filter(item => item?.status === 'weakened');
  const unresolved = (revisions || []).filter(item => item?.status === 'unresolved');
  if (supported.length === 0 && weakened.length === 0 && unresolved.length === 0) return null;

  const parts: string[] = [];
  if (supported.length > 0) {
    const confirmed = supported.map(item => removeInternalAnalysisVocabulary(item.interpretation)
      .replace(/^Câu trả lời Có\s+/iu, '')
      .replace(/^hỗ trợ giả thuyết rằng\s+/iu, '')
      .replace(/^làm\s+/iu, ''));
    parts.push(`Thông tin bạn vừa cung cấp củng cố khả năng sau: ${confirmed.join(' ')}`);
  }
  if (weakened.length > 0) {
    const rejected = weakened.map(item => removeInternalAnalysisVocabulary(item.interpretation)
      .replace(/^Câu trả lời Không\s+/iu, '')
      .replace(/^làm\s+/iu, ''));
    parts.push(`Thông tin bạn vừa cung cấp làm hướng này kém phù hợp hơn: ${rejected.join(' ')}`);
  }
  if (unresolved.length > 0) {
    parts.push('Phần chưa chắc vẫn được để mở và chưa được dùng làm kết luận chính.');
  }
  return parts.join(' ');
}

export interface FeedbackAppliedAnalysis {
  confirmedFacts: string[];
  rejectedDirections: string[];
  unresolvedQuestions: string[];
  interpretation: string;
  nextSteps: string[];
}

export function buildFeedbackAppliedAnalysis(hypotheses: any[]): FeedbackAppliedAnalysis | null {
  const answered = (hypotheses || []).filter(item =>
    ['yes', 'no', 'unsure'].includes(item?.userFeedback));
  if (answered.length === 0) return null;

  const confirmedFacts: string[] = [];
  const rejectedDirections: string[] = [];
  const unresolvedQuestions: string[] = [];

  for (const item of answered) {
    if (item.userFeedback === 'yes') {
      const meaning = String(item.ifYesMeaning || item.hypothesis || '').trim();
      if (meaning) confirmedFacts.push(removeInternalAnalysisVocabulary(meaning));
    } else if (item.userFeedback === 'no') {
      const meaning = String(item.ifNoMeaning || item.hypothesis || '').trim();
      if (meaning) rejectedDirections.push(removeInternalAnalysisVocabulary(meaning));
    } else {
      const question = String(item.followUpQuestion || item.hypothesis || '').trim();
      if (question) unresolvedQuestions.push(question);
    }
  }

  const interpretation = confirmedFacts.length > 0
    ? 'Các câu trả lời xác nhận được giữ riêng như dữ kiện của trường hợp này.'
    : rejectedDirections.length > 0
      ? 'Các hướng không phù hợp đã được hạ khỏi trọng tâm phân tích.'
      : 'Các câu hỏi chưa chắc vẫn được để mở và chưa dùng làm kết luận.';

  return {
    confirmedFacts: [...new Set(confirmedFacts)],
    rejectedDirections: [...new Set(rejectedDirections)],
    unresolvedQuestions: [...new Set(unresolvedQuestions)],
    interpretation,
    nextSteps: [],
  };
}
export function applyFeedbackToThreads(threads: any[], _hypotheses: any[]): any[] {
  return (threads || []).map((thread: any) => ({
    ...thread,
    reasoning: polishGeneratedDreamProse(thread?.reasoning),
    alternativeExplanation: polishGeneratedDreamProse(thread?.alternativeExplanation),
  }));
}
function applyFeedbackToSymbolicNotes(notes: any[], _hypotheses: any[]): any[] {
  return notes || [];
}
export function structureScientificNoteText(note: unknown): {
  explanation: string;
  boundary?: string;
} {
  const text = String(note || '').trim();
  const uniqueSentences = new Map<string, string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/).map(item => item.trim()).filter(Boolean)) {
    const key = normalizeGroundingText(sentence);
    if (!uniqueSentences.has(key)) uniqueSentences.set(key, sentence);
  }
  return { explanation: [...uniqueSentences.values()].join(' ').trim() };
}

export function buildScientificInsightTitle(rule: any): string {
  const preferred = String(
    rule?.displayTitle
    || rule?.localizedStatement
    || rule?.ruleStatement
    || rule?.statement
    || '',
  ).replace(/\s+/gu, ' ').trim();
  if (!preferred) return 'Liên hệ từ tài liệu';
  return preferred.length <= 140 ? preferred : `${preferred.slice(0, 139).trimEnd()}…`;
}

export function collectScientificDreamEvidence(
  note: any,
  narrative: string,
  linkedEvidence: unknown[] = [],
): string[] {
  const quoted = String(note?.note || '').match(/[“"]([^”"]{4,220})[”"]/gu) || [];
  const candidates = [
    ...(Array.isArray(note?.dreamEvidence) ? note.dreamEvidence : []),
    ...quoted.map(value => value.slice(1, -1)),
    ...linkedEvidence,
  ];
  const exact = new Map<string, string>();
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!exactExcerptExists(value, narrative)) continue;
    const key = normalizeGroundingText(value);
    if (!exact.has(key)) exact.set(key, value);
  }
  return [...exact.values()].slice(0, 3);
}

export function buildVerifiedScientificNote(input: {
  rule: any;
  noteText: string;
  narrative: string;
  dreamEvidence?: unknown[];
  sources: any[];
  evidenceQuotes: Array<{ sourceId: string; chunkId: string; quote: string }>;
  confidence: number;
}): any | null {
  const sources = deduplicateAcademicSources(input.sources || []);
  const allowedSourceIds = new Set(sources.map(source => String(source.sourceId)));
  const evidenceByAnchor = new Map<string, { sourceId: string; chunkId: string; quote: string }>();
  for (const item of input.evidenceQuotes || []) {
    const sourceId = String(item?.sourceId || '').trim();
    const chunkId = String(item?.chunkId || '').trim();
    const quote = String(item?.quote || '').trim();
    if (!sourceId || !chunkId || !quote || !allowedSourceIds.has(sourceId)) continue;
    const key = `${sourceId}:${chunkId}:${normalizeGroundingText(quote)}`;
    if (!evidenceByAnchor.has(key)) evidenceByAnchor.set(key, { sourceId, chunkId, quote });
  }
  // A scientific card without an exact verified citation is merely generated
  // prose. Do not present it as a sourced interpretation.
  if (sources.length === 0 || evidenceByAnchor.size === 0) return null;

  const structured = structureScientificNoteText(input.noteText);
  if (structured.explanation.length < 40) return null;
  const ruleId = String(input.rule?.ruleId || input.rule?._id || '').trim();
  if (!ruleId) return null;
  return {
    ruleId,
    ruleCode: String(input.rule?.ruleCode || '').trim(),
    ruleStatement: String(input.rule?.ruleStatement || '').trim(),
    insightTitle: buildScientificInsightTitle(input.rule),
    note: structured.explanation,
    ...(structured.boundary ? { boundary: structured.boundary } : {}),
    matchedDreamDetails: collectScientificDreamEvidence(
      { note: input.noteText, dreamEvidence: input.dreamEvidence },
      input.narrative,
    ),
    evidenceQuotes: [...evidenceByAnchor.values()].slice(0, 2),
    confidence: Math.min(1, Math.max(0, Number(input.confidence) || 0)),
    sources,
  };
}

export function deduplicateScientificNotes(notes: any[]): any[] {
  const unique = new Map<string, any>();
  for (const note of notes || []) {
    const key = String(note?.ruleId || normalizeGroundingText(note?.note)).trim();
    if (key && !unique.has(key)) unique.set(key, note);
  }
  return [...unique.values()].slice(0, 4);
}

export function enrichScientificNotesForResponse(
  analysis: any,
  retrievedContext: any,
  narrative: string,
): any {
  if (!analysis) return analysis;
  const appliedRules = retrievedContext?.componentD?.appliedRules || [];
  const usedDictionarySymbols = retrievedContext?.componentA?.usedSymbols || [];
  const personalSymbolPatterns = retrievedContext?.componentC?.personalSymbolPatterns || [];
  const observedSymbolPatterns = retrievedContext?.componentC?.observedSymbolPatterns || [];
  const similarDreams = retrievedContext?.componentC?.similarDreams || [];
  const evidenceLinks = retrievedContext?.componentD?.evidenceLinks || [];
  const ruleMap = new Map(appliedRules.map((rule: any) => [String(rule?.ruleId || rule?._id || ''), rule]));
  const sourceByRule = new Map<string, any[]>(
    (Array.isArray(analysis.scientific_context_notes) ? analysis.scientific_context_notes : [])
      .filter((note: any) => String(note?.ruleId || '').trim() && Array.isArray(note?.sources))
      .map((note: any) => [String(note.ruleId).trim(), note.sources]),
  );
  for (const link of evidenceLinks) {
    const ruleId = String(link?.ruleId || '').trim();
    const sourceId = String(link?.sourceId || '').trim();
    if (!ruleId || !sourceId) continue;
    const existing = sourceByRule.get(ruleId) || [];
    if (existing.some(source => String(source?.sourceId || '') === sourceId)) continue;
    sourceByRule.set(ruleId, [...existing, {
      sourceId,
      title: String(link?.sourceTitle || 'Tài liệu học thuật'),
      authors: [],
      ...(link?.sourceYear ? { year: Number(link.sourceYear) } : {}),
      ...(link?.doi ? { doi: String(link.doi) } : {}),
      chunkIds: (link?.chunkIds || []).map((id: unknown) => String(id)),
    }]);
  }
  const storedHypotheses = Array.isArray(analysis.real_life_hypotheses)
    ? analysis.real_life_hypotheses
    : [];
  const baseResponseHypotheses = attachRuleQuestionContext(
    storedHypotheses.flatMap((item: any) => {
      const linkedRuleIds = [...new Set<string>(
        (item?.ruleIds || [item?.ruleId])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean),
      )];
      const linkedRules = linkedRuleIds
        .map(ruleId => ruleMap.get(ruleId))
        .filter(Boolean) as any[];
      if (linkedRules.length === 0 || !linkedRules.some(canGenerateContextQuestion)) return [];

      const sources = [...new Map([
        ...(item?.sources || []),
        ...linkedRuleIds.flatMap(ruleId => sourceByRule.get(ruleId) || []),
      ].map((source: any) => [
        String(source?.sourceId || source?.doi || source?.title || ''),
        source,
      ])).values()];
      if (sources.length === 0) return [];

      return [{
        ...item,
        ruleId: linkedRuleIds[0],
        ruleIds: linkedRuleIds,
        sources,
      }];
    }),
    appliedRules,
  ).map((item: any) => ({
    ...item,
    hypothesis: removeInternalAnalysisVocabulary(item.hypothesis),
    followUpQuestion: removeInternalAnalysisVocabulary(item.followUpQuestion),
    reasonForAsking: removeInternalAnalysisVocabulary(item.reasonForAsking),
    ifYesMeaning: removeInternalAnalysisVocabulary(item.ifYesMeaning),
    ifNoMeaning: removeInternalAnalysisVocabulary(item.ifNoMeaning),
  }));
  const responseHypotheses = baseResponseHypotheses;
  const fallbackEmotion = deriveDreamEmotionTone(narrative);
  const emotion = {
    key: (analysis?.emotional_tone_key || fallbackEmotion.key) as DreamEmotionToneKey,
    label: String(analysis?.emotional_tone || fallbackEmotion.label),
  };
  const feedbackConclusion = buildFeedbackConclusion(analysis.feedback_revision || []);
  const responseThreads = applyFeedbackToThreads(ensureInterpretiveThreadCoverage(
    narrative,
    Array.isArray(analysis.interpretive_threads) ? analysis.interpretive_threads : [],
  ), responseHypotheses).map((thread: any) => ({
    ...thread,
    title: removeInternalAnalysisVocabulary(thread.title),
    reasoning: removeInternalAnalysisVocabulary(thread.reasoning),
    alternativeExplanation: removeInternalAnalysisVocabulary(thread.alternativeExplanation),
  }));
  const publicAnalysis = { ...analysis };
  delete publicAnalysis.dreamValenceScore;
  delete publicAnalysis.score_breakdown;
  const baseResponseSymbolicNotes = deduplicateOverlappingMotifNotes(mergeContextualMotifNotes(
    Array.isArray(analysis.symbolic_notes)
      ? analysis.symbolic_notes.filter((note: any) =>
        note?.origin !== 'contextual_observation'
        || exactExcerptExists(note?.dreamEvidence, narrative))
      : [],
    buildContextualMotifNotes(narrative, appliedRules),
  ).map((note: any) => {
    const noteKey = normalizeGroundingText(note?.symbol);
    const dictionaryMatch = usedDictionarySymbols.find((item: any) => {
      if (!Array.isArray(item?.retrievalMethods) || !item.retrievalMethods.includes('exact_match')) return false;
      const alias = normalizeGroundingText(item?.matchedTextVariant || item?.canonicalSymbol || item?.symbol);
      if (!alias || !(containsGroundedPhrase(noteKey, [alias]) || containsGroundedPhrase(alias, [noteKey]))) return false;
      return true;
    });
    const personalPattern = personalSymbolPatterns.find((item: any) => {
      const patternKey = normalizeGroundingText(item?.symbol);
      return patternKey && (containsGroundedPhrase(noteKey, [patternKey]) || containsGroundedPhrase(patternKey, [noteKey]));
    });
    const observedPattern = observedSymbolPatterns.find((item: any) =>
      (item?.matchedLabels || []).some((label: unknown) => {
        const labelKey = normalizeGroundingText(label);
        return labelKey && (containsGroundedPhrase(noteKey, [labelKey]) || containsGroundedPhrase(labelKey, [noteKey]));
      }));
    const similarOccurrences = similarDreams.filter((item: any) => {
      const excerpt = normalizeGroundingText(item?.excerpt);
      return noteKey && excerpt && containsGroundedPhrase(excerpt, [noteKey]);
    });
    const sameSequenceCount = similarOccurrences.filter((item: any) =>
      (item?.matchedOn || []).includes('Cùng nội dung')).length;
    const confirmedContextCount = similarOccurrences.filter((item: any) =>
      (item?.confirmedContext || []).some((entry: any) => entry?.answer === 'yes')).length;
    return {
      ...note,
      origin: dictionaryMatch ? 'dictionary' : 'contextual_observation',
      knowledgeStatus: dictionaryMatch ? 'dictionary' : 'observed',
      ...(dictionaryMatch ? { dictionarySymbol: String(dictionaryMatch?.canonicalSymbol || dictionaryMatch?.symbol || '') } : {}),
      meaning: removeInternalAnalysisVocabulary(buildGroundedMotifExplanation(note, appliedRules)),
      contextualTone: note?.contextualTone || 'neutral',
      motifStats: {
        previousPersonalDreamCount: Math.max(0, Number(personalPattern?.occurrences) || 0),
        similarDreamCount: similarOccurrences.length,
        sameSequenceCount,
        confirmedContextCount,
        observedPersonalDreamCount: Math.max(0, Number(observedPattern?.personalDreamCount) || 0),
        observedPublicDreamCount: Math.max(0, Number(observedPattern?.publicDreamCount) || 0),
        observedToneCounts: observedPattern?.toneCounts || undefined,
      },
    };
  }));
  const responseSymbolicNotes = applyFeedbackToSymbolicNotes(baseResponseSymbolicNotes, responseHypotheses);
  const responseScientificNotes = deduplicateScientificNotes([...(Array.isArray(analysis.scientific_context_notes)
    ? analysis.scientific_context_notes
    : []).flatMap((note: any) => {
    if (note?.ruleCode && note?.ruleStatement && Array.isArray(note?.evidenceQuotes) && note.evidenceQuotes.length > 0) {
      const linkedRule: any = ruleMap.get(String(note?.ruleId || '').trim());
      return linkedRule && canExplainPsychology(linkedRule) ? [{
        ...note,
        note: removeInternalAnalysisVocabulary(note.note),
        boundary: removeInternalAnalysisVocabulary(note.boundary),
      }] : [];
    }
    const ruleId = String(note?.ruleId || '').trim();
    const rule: any = ruleMap.get(ruleId);
    if (!rule || !canExplainPsychology(rule)) return [];
    const sources = note?.sources || [];
    const links = evidenceLinks.filter((link: any) => String(link?.ruleId || '') === ruleId);
    const evidenceQuotes = links.flatMap((link: any) => {
      const chunkId = String(link?.chunkIds?.[0] || '').trim();
      const quote = String(link?.chunkPreview || '').replace(/\.\.\.$/u, '').trim();
      return chunkId && quote ? [{ sourceId: String(link?.sourceId || ''), chunkId, quote }] : [];
    });
    const enriched = buildVerifiedScientificNote({
      rule,
      noteText: String(note?.note || '').trim(),
      narrative,
      dreamEvidence: note?.dreamEvidence || note?.matchedDreamDetails || [],
      sources,
      evidenceQuotes,
      confidence: Number(note?.confidence) || 0,
    });
    const finalNote = enriched || {
      ...note,
      ruleCode: String(rule?.ruleCode || '').trim(),
      ruleStatement: String(rule?.ruleStatement || '').trim(),
      insightTitle: buildScientificInsightTitle(rule),
    };
    return [{
      ...finalNote,
      note: removeInternalAnalysisVocabulary(finalNote.note),
      boundary: removeInternalAnalysisVocabulary(finalNote.boundary),
    }];
  })]);
  const caseConclusion = buildDreamCaseConclusion(
    narrative,
    responseHypotheses,
    responseScientificNotes,
    analysis.core_analysis,
  );

  return {
    ...publicAnalysis,
    emotional_tone_key: emotion.key,
    emotional_tone: emotion.label,
    core_analysis: removeInternalAnalysisVocabulary(buildCaseGroundedSynthesis(
      narrative,
      responseHypotheses,
      sanitizeUnsupportedDreamClaims(analysis.core_analysis),
    )),
    case_conclusion: caseConclusion,
    summary: removeInternalAnalysisVocabulary(polishGeneratedDreamProse(analysis.summary)),
    real_life_hypotheses: responseHypotheses,
    feedback_conclusion: feedbackConclusion,
    feedback_analysis: buildFeedbackAppliedAnalysis(responseHypotheses),
    grounding_summary: {
      narrativeUsed: Boolean(narrative.trim()),
      resolvedContextCount: responseHypotheses.filter((item: any) => ['yes', 'no'].includes(item?.userFeedback)).length,
      unresolvedContextCount: responseHypotheses.filter((item: any) => item?.userFeedback === 'unsure').length,
      dictionaryMotifCount: responseSymbolicNotes.filter((item: any) => item?.origin === 'dictionary').length,
      contextualMotifCount: responseSymbolicNotes.filter((item: any) => item?.origin !== 'dictionary').length,
      appliedRuleCount: responseScientificNotes.length,
      explanatoryRuleCount: responseScientificNotes.filter((note: any) => note?.applicationTier !== 'exploratory').length,
      exploratoryRuleCount: responseScientificNotes.filter((note: any) => note?.applicationTier === 'exploratory').length,
      similarDreamCount: Array.isArray(retrievedContext?.componentC?.similarDreams)
        ? retrievedContext.componentC.similarDreams.length
        : Array.isArray(analysis.similar_dreams) ? analysis.similar_dreams.length : 0,
      sleepContextFactCount: Object.keys(retrievedContext?.componentA?.sleepContext || {}).length,
    },
    interpretive_threads: responseThreads,
    practical_reflections: sanitizePracticalReflections(publicAnalysis.practical_reflections)
      .map(item => ({
        suggestion: removeInternalAnalysisVocabulary(item.suggestion),
        rationale: removeInternalAnalysisVocabulary(item.rationale),
      })),
    symbolic_notes: responseSymbolicNotes,
    scientific_context_notes: responseScientificNotes,
  };
}

export function buildRuleScientificFallback(rule: any, narrative: string): string | null {
  if (!canExplainPsychology(rule)) return null;
  void narrative;
  return null;
}

export function deduplicateAcademicSources(sources: any[]): any[] {
  const bySource = new Map<string, any>();
  for (const source of sources || []) {
    const sourceId = String(source?.sourceId || '').trim();
    if (!sourceId) continue;
    const existing = bySource.get(sourceId);
    if (!existing) {
      bySource.set(sourceId, {
        ...source,
        sourceId,
        chunkIds: [...new Set((source.chunkIds || []).map((id: unknown) => String(id)))],
      });
      continue;
    }
    existing.chunkIds = [...new Set([
      ...(existing.chunkIds || []),
      ...(source.chunkIds || []).map((id: unknown) => String(id)),
    ])];
  }
  return [...bySource.values()];
}

export interface PersonalSymbolPattern {
  symbol: string;
  occurrences: number;
  recentMeaning: string;
}

export function buildContextualMotifNotes(
  _narrative: string,
  _rules: any[],
  _limit = 6,
): any[] {
  return [];
}

export function isSupportedContextualMotif(_symbolValue: unknown, _rules: any[]): boolean {
  return false;
}

export function mergeContextualMotifNotes(primary: any[], fallback: any[]): any[] {
  const merged = new Map<string, any>();
  for (const note of [...(primary || []), ...(fallback || [])]) {
    const key = normalizeGroundingText(note?.symbol);
    if (!key || merged.has(key)) continue;
    merged.set(key, note);
  }
  return [...merged.values()].slice(0, 8);
}

export function deduplicateOverlappingMotifNotes(notes: any[]): any[] {
  const accepted: any[] = [];
  const ordered = [...(notes || [])].sort((a, b) =>
    normalizeGroundingText(a?.symbol).length - normalizeGroundingText(b?.symbol).length);
  for (const note of ordered) {
    const symbol = normalizeGroundingText(note?.symbol);
    const evidence = normalizeGroundingText(note?.dreamEvidence);
    const dictionarySymbol = normalizeGroundingText(note?.dictionarySymbol);
    const duplicate = accepted.some(existing => {
      const existingSymbol = normalizeGroundingText(existing?.symbol);
      const sameEvidence = evidence && evidence === normalizeGroundingText(existing?.dreamEvidence);
      const sameDictionary = dictionarySymbol && dictionarySymbol === normalizeGroundingText(existing?.dictionarySymbol);
      const overlappingLabel = containsGroundedPhrase(symbol, [existingSymbol]) || containsGroundedPhrase(existingSymbol, [symbol]);
      return overlappingLabel && (sameEvidence || sameDictionary);
    });
    if (!duplicate) accepted.push(note);
  }
  return accepted.slice(0, 8);
}

export function extractContextualMotifHints(narrative: string, limit = 10): string[] {
  void narrative;
  void limit;
  return [];
}

export function collectPersonalSymbolPatterns(
  dreamRows: any[],
  currentNarrative: string,
  limit = 5,
): PersonalSymbolPattern[] {
  const narrative = normalizeGroundingText(currentNarrative);
  const grouped = new Map<string, PersonalSymbolPattern>();
  for (const row of dreamRows || []) {
    const notes = row?.ai_result?.symbolic_notes;
    if (!Array.isArray(notes)) continue;
    for (const note of notes) {
      const key = normalizeGroundingText(note?.symbol);
      if (key.length < 2 || !` ${narrative} `.includes(` ${key} `)) continue;
      const existing = grouped.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        grouped.set(key, {
          symbol: String(note.symbol).trim(),
          occurrences: 1,
          recentMeaning: String(note.meaning || '').trim().slice(0, 280),
        });
      }
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.symbol.localeCompare(b.symbol, 'vi'))
    .slice(0, limit);
}
