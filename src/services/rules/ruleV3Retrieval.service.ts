import { Types } from 'mongoose';
import KnowledgeRuleV3 from '../../models/rulesV3/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/rulesV3/KnowledgeRuleEvidence';
import AcademicChunk from '../../models/AcademicChunk';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import Dream from '../../models/Dream';
import { generateEmbedding } from '../infrastructure/llm.service';
import { classifyRuleV3DreamApplication } from './ruleV3DreamApplication.service';

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : -1;
}

const RETRIEVAL_STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'for', 'with', 'from', 'into', 'than', 'are', 'was', 'were', 'can', 'may', 'will',
  'của', 'và', 'cho', 'với', 'trong', 'những', 'một', 'này', 'được', 'các', 'như', 'bởi', 'tại', 'trên', 'dưới',
]);

function words(value: string): Set<string> {
  return new Set(value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/u)
    .filter(word => word.length >= 3 && !RETRIEVAL_STOP_WORDS.has(word)));
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('vi');
}

function compositeSearchParts(rule: any): string[] {
  const components = Array.isArray(rule?.compositeComponents) ? rule.compositeComponents : [];
  return components.flatMap((component: any) => [
    component.statement,
    component.subject,
    component.outcome,
    ...(component.conditions || []),
    ...(component.dreamFeatureTags || []),
  ].filter(Boolean));
}

export function extractDreamRuleFeatures(dreamText: string): string[] {
  const text = normalized(dreamText);
  const features = new Set<string>();
  const add = (...items: string[]) => items.forEach(item => features.add(item));
  const hasPast = /(?:hôm qua|ngày hôm qua|trước đây|ngày trước|quá khứ|tuổi thơ|trường\s+[^.!?]{0,24}cũ|lớp\s+[^.!?]{0,24}cũ|nhà\s+[^.!?]{0,24}cũ|yesterday|previously|in the past|childhood|old school)/iu.test(text);
  const hasNearFuture = /(?:ngày mai|sáng mai|tối mai|tuần tới|vài ngày tới|sắp tới|tomorrow|next week|in the next few days)/iu.test(text);
  const hasDistantFuture = /(?:tháng\s+[^.!?]{0,20}năm sau|năm sau|nhiều tháng tới|one or more years|next year|months? from now)/iu.test(text);
  const hasFuture = hasNearFuture || hasDistantFuture || /(?:tương lai|sẽ xảy ra|dự định|future|anticipated|prospective)/iu.test(text);

  if (hasPast) add('past events', 'past episode', 'past event reference', 'autobiographical memory', 'recent events');
  if (hasFuture) add('future events', 'future anticipation', 'future-oriented dreams', 'prospective dreams', 'upcoming events', 'general future concerns');
  if (hasPast && hasFuture) add('past and future events', 'episodic sources', 'temporal proximity');
  if (hasNearFuture && hasDistantFuture) add('future event combination', 'multiple time points');
  if (/(?:phi thực tế|không thể xảy ra|trôi lơ lửng|bay trên|dựng thẳng lên trời|không có bánh|biến thành|impossible|implausible|floating|vertical into the sky|without wheels)/iu.test(text)) {
    add('implausible scenarios', 'weak associations', 'future anticipation');
  }
  if (/(?:gần sáng|cuối đêm|về sáng|near dawn|late in the night|toward morning)/iu.test(text)) {
    add('later in the night', 'time of night', 'temporal orientation');
  }
  if (/(?:quên|nhớ|ký\s*ức|trí\s*nhớ|cuốn\s*sổ|quyển\s*sổ|trang\s*trắng|forget|memory|notebook)/iu.test(text)) {
    add('memory', 'forgetting', 'memory consolidation');
  }
  if (/(?:đuổi|chạy\s+trốn|bắt\s+kịp|sợ|đe\s+dọa|chase|pursuit|fear|threat)/iu.test(text)) {
    add('threat', 'anxiety', 'avoidance', 'threat simulation');
  }
  return [...features];
}

export function lexicalOverlap(dreamText: string, ruleText: string): number {
  const dream = words(dreamText); const rule = words(ruleText);
  if (!dream.size || !rule.size) return 0;
  let matched = 0;
  for (const token of rule) if (dream.has(token)) matched += 1;
  return matched / Math.min(12, rule.size);
}

export function expandDreamRetrievalConcepts(dreamText: string): string {
  const normalized = dreamText.normalize('NFKC').toLocaleLowerCase('vi');
  const concepts: string[] = extractDreamRuleFeatures(dreamText);
  const add = (...items: string[]) => concepts.push(...items);
  if (/(?:quên|nhớ|ký\s*ức|trí\s*nhớ|cuốn\s*sổ|quyển\s*sổ|trang\s*trắng|forget|memory|notebook)/iu.test(normalized)) {
    add('ký ức', 'trí nhớ', 'quên thông tin', 'memory', 'forgetting', 'memory consolidation');
  }
  if (/(?:trường\s+cũ|nhà\s+cũ|bà\s+(?:ngoại|nội)|ông\s+(?:ngoại|nội)|tuổi\s*thơ|childhood|grandmother|old\s+(?:school|house))/iu.test(normalized)) {
    add('ký ức tự truyện', 'sự kiện gần đây', 'autobiographical memory', 'episodic sources', 'recent events', 'childhood memory');
  }
  if (/(?:đuổi|chạy\s+trốn|bắt\s+kịp|sợ|đe\s+dọa|chase|pursuit|fear|threat)/iu.test(normalized)) {
    add('đe dọa', 'lo âu', 'né tránh', 'threat', 'anxiety', 'avoidance', 'threat simulation');
  }
  if (/(?:người\s+thân|bà\s+(?:ngoại|nội)|ông\s+(?:ngoại|nội)|gia\s+đình|family|caregiver|grandmother)/iu.test(normalized)) {
    add('người chăm sóc', 'hỗ trợ xã hội', 'an toàn', 'caregiver', 'social support', 'attachment', 'safety');
  }
  if (/(?:cầu|cánh\s+cửa|chuyển\s+tiếp|bridge|door|transition)/iu.test(normalized)) {
    add('chuyển tiếp', 'ranh giới', 'transition', 'boundary');
  }
  return `${dreamText}\n[RETRIEVAL_CONCEPTS] ${[...new Set(concepts)].join(', ')}`;
}

function conditionIsApplicable(rule: any, dreamText: string, expandedDreamText: string): boolean {
  const conditions = (rule.conditions || []).map((item: unknown) => normalized(String(item)));
  const conditionText = conditions.join(' ');
  if (!conditionText) return true;
  if (/awakening latency|latency greater|following 90s|following 60s|following 30s/u.test(conditionText)) {
    return /awakening latency|độ trễ tỉnh giấc|sau khi được đánh thức \d+ giây/iu.test(dreamText);
  }
  if (/later in the night|late in the night/u.test(conditionText)) {
    return /gần sáng|cuối đêm|về sáng|near dawn|late in the night|toward morning/iu.test(dreamText);
  }
  if (/different time points/u.test(conditionText)) {
    return lexicalOverlap(expandedDreamText, 'multiple time points future event combination') >= 0.2;
  }
  // Sample descriptions are provenance, not applicability conditions.
  if (/^in n\s*=|reports?$|participants?$/u.test(conditionText)) return true;
  return true;
}

export function rankRuleV3Candidates(
  rules: any[],
  dreamText: string,
  dreamEmbedding: number[],
  queryLanguage: 'vi' | 'en' | 'unknown',
  feedbackByRule: Map<string, { supports: number; weakens: number }> = new Map(),
) {
  const expandedDreamText = expandDreamRetrievalConcepts(dreamText);
  return rules.map(rule => {
    const componentParts = compositeSearchParts(rule);
    const lexical = lexicalOverlap(expandedDreamText, [rule.subject, rule.outcome, ...(rule.conditions || []), ...componentParts].join(' '));
    const featureOverlap = lexicalOverlap(expandedDreamText, [...(rule.dreamFeatureTags || []), ...componentParts].join(' '));
    const statementOverlap = lexicalOverlap(expandedDreamText, [rule.statement || '', ...componentParts].join(' '));
    const vector = cosine(dreamEmbedding, rule.embedding || []);
    const feedback = feedbackByRule.get(String(rule._id)) || { supports: 0, weakens: 0 };
    const answered = feedback.supports + feedback.weakens;
    const posteriorSupport = (feedback.supports + 1) / (answered + 2);
    const feedbackConfidence = answered / (answered + 5);
    const experientialSignal = (posteriorSupport - 0.5) * 2 * feedbackConfidence;
    const semanticGate = Math.max(featureOverlap, lexical, statementOverlap);
    const applicable = conditionIsApplicable(rule, dreamText, expandedDreamText);
    const score = Math.min(1, featureOverlap) * 0.4
      + Math.min(1, lexical) * 0.23
      + Math.min(1, statementOverlap) * 0.12
      + Math.max(0, vector) * 0.15
      + (rule.evidenceScore / 100) * 0.1
      + experientialSignal * 0.05;
    const crossLanguage = queryLanguage !== 'unknown' && rule.sourceLanguage && rule.sourceLanguage !== queryLanguage;
    return { rule, score, vector, lexical, featureOverlap, statementOverlap, semanticGate, applicable, crossLanguage };
  })
    // Embeddings rank semantically eligible rules; they never admit a rule by themselves.
    .filter(item => item.applicable && item.semanticGate >= 0.1)
    .sort((a, b) => b.score - a.score);
}

function inferQueryLanguage(value: string): 'vi' | 'en' | 'unknown' {
  if (/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/iu.test(value)) return 'vi';
  if (/\b(?:the|and|dream|sleep|memory|fear)\b/iu.test(value)) return 'en';
  return 'unknown';
}

export function classifyRuleApplicationTier(rule: any): 'supported' | 'exploratory' {
  return (Number(rule?.evidenceScore) || 0) >= 60 && (Number(rule?.supportingSourceCount) || 0) >= 2
    ? 'supported'
    : 'exploratory';
}

export async function retrieveApprovedRuleV3(dreamText: string, limit = 4) {
  // All verified rules may be retrieved for case-level questions. Academic
  // strength remains a separate tier: weak or single-source rules are marked
  // exploratory and may collect confirming context, but must not be presented
  // as established mechanisms or have their score inflated by user feedback.
  const rules = await KnowledgeRuleV3.find({
    status: 'verified',
    embedding: { $exists: true, $ne: [] },
  }).lean();
  if (!rules.length) return { rules: [], evidenceLinks: [] };
  const ownerToPrimaryRuleId = new Map<string, string>();
  for (const rule of rules) {
    const primaryId = String(rule._id);
    ownerToPrimaryRuleId.set(primaryId, primaryId);
    for (const component of rule.compositeComponents || []) {
      if (component?.sourceRuleId) ownerToPrimaryRuleId.set(String(component.sourceRuleId), primaryId);
    }
  }
  const feedbackOwnerIds = [...ownerToPrimaryRuleId.keys()];
  const expandedDreamText = expandDreamRetrievalConcepts(dreamText);
  const dreamEmbedding = await generateEmbedding(expandedDreamText);
  const queryLanguage = inferQueryLanguage(dreamText);
  const feedbackRows = await Dream.aggregate<{
    _id: { ruleId: string; userId: Types.ObjectId };
    effect: 'supports' | 'weakens';
    updatedAt: Date;
  }>([
    { $unwind: '$realLifeHypothesesFeedback' },
    { $match: {
      'realLifeHypothesesFeedback.ruleId': { $in: feedbackOwnerIds },
      'realLifeHypothesesFeedback.effect': { $in: ['supports', 'weakens'] }
    } },
    { $sort: { 'realLifeHypothesesFeedback.updatedAt': -1 } },
    { $group: {
      _id: {
        ruleId: '$realLifeHypothesesFeedback.ruleId',
        userId: '$realLifeHypothesesFeedback.userId',
      },
      effect: { $first: '$realLifeHypothesesFeedback.effect' },
      updatedAt: { $first: '$realLifeHypothesesFeedback.updatedAt' },
    } },
  ]);
  const feedbackByRuleAndUser = new Map<string, Map<string, {
    effect: 'supports' | 'weakens';
    updatedAt: number;
  }>>();
  for (const row of feedbackRows) {
    const primaryRuleId = ownerToPrimaryRuleId.get(row._id.ruleId) || row._id.ruleId;
    const userId = String(row._id.userId);
    const byUser = feedbackByRuleAndUser.get(primaryRuleId) || new Map();
    const updatedAt = new Date(row.updatedAt || 0).getTime();
    const existing = byUser.get(userId);
    if (!existing || updatedAt >= existing.updatedAt) {
      byUser.set(userId, { effect: row.effect, updatedAt });
    }
    feedbackByRuleAndUser.set(primaryRuleId, byUser);
  }
  const feedbackByRule = new Map<string, { supports: number; weakens: number }>();
  for (const [primaryRuleId, byUser] of feedbackByRuleAndUser) {
    const counts = { supports: 0, weakens: 0 };
    for (const feedback of byUser.values()) counts[feedback.effect] += 1;
    feedbackByRule.set(primaryRuleId, counts);
  }
  const ranked = rankRuleV3Candidates(rules, dreamText, dreamEmbedding, queryLanguage, feedbackByRule).slice(0, limit);
  if (!ranked.length) return { rules: [], evidenceLinks: [] };

  const rankedOwnerToPrimary = new Map<string, string>();
  for (const item of ranked) {
    const primaryId = String(item.rule._id);
    rankedOwnerToPrimary.set(primaryId, primaryId);
    for (const component of item.rule.compositeComponents || []) {
      if (component?.sourceRuleId) rankedOwnerToPrimary.set(String(component.sourceRuleId), primaryId);
    }
  }
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: [...rankedOwnerToPrimary.keys()] }, stance: 'supports' }).lean();
  const chunkIds = evidence.map(item => item.chunkId);
  const chunks = await AcademicChunk.find({ _id: { $in: chunkIds } }).lean();
  const chunkMap = new Map(chunks.map(chunk => [String(chunk._id), chunk]));
  const sourceIds = [...new Set(evidence.map(item => String(item.sourceId)))];
  const [sources, contributions] = await Promise.all([
    AcademicSource.find({ _id: { $in: sourceIds } }).lean(),
    SourceContribution.find({ _id: { $in: sourceIds } }).lean()
  ]);
  const sourceMap = new Map([...sources, ...contributions].map(source => [String(source._id), source]));

  const mappedRules = ranked.map(({ rule, score, vector, lexical, featureOverlap, statementOverlap }) => {
    const feedback = feedbackByRule.get(String(rule._id)) || { supports: 0, weakens: 0 };
    const resolvedFeedback = feedback.supports + feedback.weakens;
    const evidenceScore = Number(rule.evidenceScore) || 0;
    const supportingSourceCount = Number(rule.supportingSourceCount) || 0;
    const applicationTier = classifyRuleApplicationTier(rule);
    return ({
    _id: rule._id,
    ruleId: String(rule._id),
    ruleCode: rule.ruleCode,
    ruleStatement: rule.statement,
    scientificBasis: 'Rule V3 with exact canonical citations',
    classifications: rule.classifications || [],
    confidenceCap: applicationTier === 'supported'
      ? Math.min(0.9, Math.max(0.35, evidenceScore / 100))
      : Math.min(0.35, Math.max(0.1, evidenceScore / 100)),
    evidenceScore,
    supportingSourceCount,
    applicationTier,
    claimStrength: rule.evidenceInterpretation,
    group: 'dream_psychology',
    factor: rule.subject,
    outcome: rule.outcome,
    conditions: rule.conditions || [],
    limitations: rule.limitations || [],
    dreamFeatureTags: rule.dreamFeatureTags || [],
    retrievalScore: score,
    retrievalSignals: { vector, lexical, featureOverlap, statementOverlap },
    applicationFeedback: {
      supports: feedback.supports,
      weakens: feedback.weakens,
      resolvedObservations: resolvedFeedback,
      smoothedApplicability: (feedback.supports + 2) / (resolvedFeedback + 4)
    },
    applicationRole: classifyRuleV3DreamApplication(rule),
    isComposite: Boolean(rule.isComposite),
    compositeComponents: (rule.compositeComponents || []).map((component: any) => ({
      sourceRuleId: String(component.sourceRuleId),
      ruleCode: component.ruleCode,
      statement: component.statement,
      subject: component.subject,
      outcome: component.outcome,
      conditions: component.conditions || [],
      limitations: component.limitations || [],
      dreamFeatureTags: component.dreamFeatureTags || [],
    })),
    ruleVersion: 'v3'
  });
  });
  const evidenceLinks = evidence.map(item => {
    const chunk: any = chunkMap.get(String(item.chunkId));
    const source: any = sourceMap.get(String(item.sourceId));
    return {
      ruleId: rankedOwnerToPrimary.get(String(item.ruleId)) || item.ruleId,
      componentRuleId: item.ruleId,
      quote: item.exactQuote,
      evidenceSummary: item.exactQuote,
      chunkId: {
        _id: item.chunkId,
        text: chunk?.text || item.exactQuote,
        sourceId: {
          _id: item.sourceId,
          title: source?.title || source?.metadata?.title || 'Tài liệu chưa xác định',
          authors: source?.authors || source?.metadata?.authors || [],
          year: source?.year || source?.metadata?.year,
          journal: source?.journal || source?.publisher,
          doi: source?.doi || source?.metadata?.doi,
          readableInApp: true,
          allowedUse: 'open_access_fulltext',
          chunkBuildStatus: 'completed'
        }
      }
    };
  });
  return { rules: mappedRules, evidenceLinks };
}
