import {
  normalizeGroundingText,
  removeInternalAnalysisVocabulary,
  sanitizeUnsupportedDreamClaims,
} from './dreamGroundingText.service';
import { polishGeneratedDreamProse } from './dreamFeedbackRevision.service';

export interface FeedbackAppliedAnalysis {
  confirmedFacts: string[];
  rejectedDirections: string[];
  unresolvedQuestions: string[];
  interpretation: string;
  nextSteps: string[];
}

export function buildCaseGroundedSynthesis(
  _narrative: string,
  hypotheses: any[],
  fallback: unknown,
): string {
  const base = polishGeneratedDreamProse(sanitizeUnsupportedDreamClaims(fallback))
    .replace(/\s*(?:Dữ kiện bạn vừa xác nhận được dùng để điều chỉnh mạch này:|Sau khi đối chiếu câu trả lời của bạn,)[\s\S]*$/u, '')
    .trim();
  const answered = (hypotheses || [])
    .filter(item => ['yes', 'no'].includes(item?.userFeedback))
    .map(item => {
      const meaning = item.userFeedback === 'yes' ? item.ifYesMeaning : item.ifNoMeaning;
      const cleanMeaning = removeInternalAnalysisVocabulary(String(meaning || item?.hypothesis || '').trim());
      if (!cleanMeaning) return '';
      return item.userFeedback === 'yes'
        ? `Thông tin bạn xác nhận làm hướng này phù hợp hơn với trường hợp hiện tại: ${cleanMeaning}`
        : `Thông tin bạn cung cấp làm hướng này kém phù hợp và không còn được dùng làm trọng tâm: ${cleanMeaning}`;
    })
    .filter(Boolean);
  if (!answered.length) return base;
  const feedbackText = answered
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 3)
    .join(' ');
  return polishGeneratedDreamProse(`${base} Sau khi đối chiếu câu trả lời của bạn, ${feedbackText}`);
}

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

function feedbackTokens(value: unknown): Set<string> {
  return new Set(normalizeGroundingText(value)
    .split(/\s+/u)
    .filter(token => token.length >= 3));
}

function threadFeedbackScore(thread: any, hypothesis: any): number {
  const threadTokens = feedbackTokens([
    thread?.title,
    thread?.reasoning,
    ...(thread?.dreamEvidence || []),
  ].filter(Boolean).join(' '));
  const hypothesisTokens = feedbackTokens([
    hypothesis?.hypothesis,
    ...(hypothesis?.evidenceFromDream || []),
  ].filter(Boolean).join(' '));
  if (!threadTokens.size || !hypothesisTokens.size) return 0;
  return [...hypothesisTokens].filter(token => threadTokens.has(token)).length
    / Math.max(1, Math.min(threadTokens.size, hypothesisTokens.size));
}

function stripThreadFeedback(value: unknown): string {
  return polishGeneratedDreamProse(value)
    .replace(/\s*(?:Thông tin bạn xác nhận làm mạch này phù hợp hơn:|Thông tin bạn cung cấp làm mạch này kém phù hợp:)[\s\S]*$/u, '')
    .trim();
}

export function applyFeedbackToThreads(threads: any[], hypotheses: any[]): any[] {
  const answered = (hypotheses || []).filter(item => ['yes', 'no'].includes(item?.userFeedback));
  const cleanThreads = (threads || []).map((thread: any) => ({
    ...thread,
    reasoning: stripThreadFeedback(thread?.reasoning),
    alternativeExplanation: stripThreadFeedback(thread?.alternativeExplanation),
  }));
  if (!answered.length) return cleanThreads;

  return cleanThreads.map((thread: any, threadIndex: number) => {
    const relevant = answered
      .map(hypothesis => ({ hypothesis, score: threadFeedbackScore(thread, hypothesis) }))
      .sort((left, right) => right.score - left.score)
      .find(item => item.score > 0 || (cleanThreads.length === 1 && threadIndex === 0));
    if (!relevant) return thread;
    const meaning = removeInternalAnalysisVocabulary(String(
      relevant.hypothesis.userFeedback === 'yes'
        ? relevant.hypothesis.ifYesMeaning || relevant.hypothesis.hypothesis
        : relevant.hypothesis.ifNoMeaning || relevant.hypothesis.hypothesis,
    ).trim());
    if (!meaning) return thread;
    if (relevant.hypothesis.userFeedback === 'yes') {
      return {
        ...thread,
        reasoning: polishGeneratedDreamProse(
          `${thread.reasoning} Thông tin bạn xác nhận làm mạch này phù hợp hơn: ${meaning}`,
        ),
      };
    }
    return {
      ...thread,
      alternativeExplanation: polishGeneratedDreamProse(
        `${thread.alternativeExplanation} Thông tin bạn cung cấp làm mạch này kém phù hợp: ${meaning}`,
      ),
    };
  });
}
