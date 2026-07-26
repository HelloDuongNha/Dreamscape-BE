import {
  exactNarrativeExcerptExists,
  isHypothesisAnsweredByKnownContext,
  isStructurallyInvalidFollowUpQuestion,
  normalizeAnalysisText,
  validateGeneratedHypotheses,
  validateInterpretiveThreads,
} from '../contracts/dreamAnalysis.contract';
import { extractContextualMotifHints } from './contextualMotif.service';

export const normalizeGroundingText = normalizeAnalysisText;
export const isHypothesisAlreadyAnswered = isHypothesisAnsweredByKnownContext;
export const exactExcerptExists = exactNarrativeExcerptExists;
export const isVagueFollowUpQuestion = isStructurallyInvalidFollowUpQuestion;
export const sanitizeInterpretiveThreads = validateInterpretiveThreads;
export const sanitizeGeneratedHypotheses = validateGeneratedHypotheses;

export type DreamEmotionToneKey =
  | 'urgent_conflicted'
  | 'anxious'
  | 'fearful'
  | 'sad'
  | 'calm'
  | 'mixed'
  | 'neutral';

export type ContextualTone = 'threatening' | 'reassuring' | 'ambivalent' | 'neutral';

export function resolveQuestionRuleIds(hypothesis: any): string[] {
  return [...new Set<string>((hypothesis?.ruleIds || [hypothesis?.ruleId])
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean))];
}

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

export function containsGroundedPhrase(value: unknown, phrases: string[]): boolean {
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
