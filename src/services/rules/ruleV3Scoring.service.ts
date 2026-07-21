import {
  assessRuleV3CandidateQuality,
  hasSpecificRuleCondition,
  hasSpecificRuleLimitation,
  type RuleV3ApplicationReadiness,
  type RuleV3QualityReasonCode,
  type RuleV3SemanticSupportLevel
} from './ruleV3CandidateQuality.service';

export const RULE_V3_SCORING_VERSION = 'evidence-review-5';

export interface RuleV3ScoringRule {
  statement: string;
  subject: string;
  outcome: string;
  claimType: string;
  effectPolarity: string;
  evidenceInterpretation: string;
  conditions?: string[];
  limitations?: string[];
  dreamFeatureTags?: string[];
}

export interface RuleV3ScoringEvidence {
  sourceId: unknown;
  chunkId?: unknown;
  stance: 'supports' | 'refutes' | 'limits';
  exactness: string;
  verificationScore: number;
  exactQuote?: string;
  researchType?: string;
  researchTypeConfidence?: 'high' | 'medium' | 'low';
  sourceQuality?: 'peer_reviewed' | 'preprint' | 'informal';
}

export interface RuleV3ScoreCriterion {
  key: 'source_breadth' | 'evidence_breadth' | 'research_fit' | 'scope_definition' | 'conflict_handling';
  score: number;
  maxScore: number;
  reason: string;
  rubric: string;
}

export interface RuleV3ScoreResult {
  evidenceScore: number;
  oracleUsefulnessScore: number;
  oracleEligible: boolean;
  certaintyTier: 'weak' | 'limited' | 'moderate' | 'strong' | 'mixed';
  exactCitationCount: number;
  supportingCitationCount: number;
  limitingCitationCount: number;
  contradictingCitationCount: number;
  independentSourceCount: number;
  supportingSourceCount: number;
  contradictingSourceCount: number;
  qualityAccepted: boolean;
  qualityReasonCodes: RuleV3QualityReasonCode[];
  qualitySummary: string;
  semanticSupportLevel: RuleV3SemanticSupportLevel;
  semanticSupportScore: number;
  applicationReadiness: RuleV3ApplicationReadiness;
  scoreCriteria: RuleV3ScoreCriterion[];
}

function sourceKey(value: unknown): string {
  return String(value || '');
}

function researchTypeFitsClaim(claimType: string, researchType: string): boolean {
  const allowed: Record<string, string[]> = {
    association: ['quantitative_empirical', 'mixed', 'systematic_review', 'meta_analysis'],
    prediction: ['quantitative_empirical', 'mixed', 'systematic_review', 'meta_analysis'],
    intervention_effect: ['quantitative_empirical', 'mixed', 'systematic_review', 'meta_analysis'],
    moderation: ['quantitative_empirical', 'mixed', 'systematic_review', 'meta_analysis'],
    mediation: ['quantitative_empirical', 'mixed', 'systematic_review', 'meta_analysis'],
    null_finding: ['quantitative_empirical', 'mixed', 'systematic_review', 'meta_analysis'],
    qualitative_theme: ['qualitative_empirical', 'mixed', 'case_report'],
    theoretical_proposition: ['theoretical_or_conceptual', 'book_or_monograph', 'narrative_review'],
    review_synthesis: ['systematic_review', 'meta_analysis', 'narrative_review']
  };
  return Boolean(allowed[claimType]?.includes(researchType));
}

function scoreResearchContext(rule: RuleV3ScoringRule, supports: RuleV3ScoringEvidence[]): { score: number; reason: string } {
  const bySource = new Map<string, RuleV3ScoringEvidence>();
  for (const evidence of supports) {
    const key = sourceKey(evidence.sourceId);
    if (key && !bySource.has(key)) bySource.set(key, evidence);
  }
  const scored = [...bySource.values()].map(evidence => {
    if (!evidence.researchType || !researchTypeFitsClaim(rule.claimType, evidence.researchType)) return 0;
    let value = evidence.researchTypeConfidence === 'high' ? 25 : evidence.researchTypeConfidence === 'medium' ? 18 : 11;
    if (rule.claimType === 'intervention_effect') value = Math.min(value, 17);
    if (evidence.sourceQuality === 'preprint') value = Math.min(value, 20);
    else if (evidence.sourceQuality === 'informal') value = Math.min(value, 10);
    else if (!evidence.sourceQuality) value = Math.min(value, 16);
    return value;
  });
  const score = scored.length ? Math.round(scored.reduce((sum, item) => sum + item, 0) / scored.length) : 0;
  const matched = scored.filter(value => value > 0).length;
  return {
    score,
    reason: scored.length
      ? `${matched}/${scored.length} nguồn hỗ trợ có loại nghiên cứu phù hợp với kiểu kết luận; điểm còn được giới hạn theo độ chắc chắn phân loại và trạng thái phản biện.`
      : 'Chưa có thông tin loại nghiên cứu gắn với dẫn chứng để đánh giá độ phù hợp thiết kế.'
  };
}

export function scoreRuleV3(
  rule: RuleV3ScoringRule,
  evidence: RuleV3ScoringEvidence[]
): RuleV3ScoreResult {
  const exactEvidence = evidence.filter(item => item.exactness === 'canonical_exact' && item.verificationScore === 1);
  const supports = exactEvidence.filter(item => item.stance === 'supports');
  const limits = exactEvidence.filter(item => item.stance === 'limits');
  const refutes = exactEvidence.filter(item => item.stance === 'refutes');
  const allSources = new Set(exactEvidence.map(item => sourceKey(item.sourceId)).filter(Boolean));
  const supportingSources = new Set(supports.map(item => sourceKey(item.sourceId)).filter(Boolean));
  const contradictingSources = new Set(refutes.map(item => sourceKey(item.sourceId)).filter(Boolean));
  const quality = assessRuleV3CandidateQuality(rule, exactEvidence);

  const supportingChunkKeys = new Set(supports.map((item, index) => `${sourceKey(item.sourceId)}:${String(item.chunkId || item.exactQuote || index)}`));
  const exactGroupKeys = new Set(exactEvidence.map((item, index) => `${sourceKey(item.sourceId)}:${String(item.chunkId || item.exactQuote || index)}:${item.stance}`));
  const supportingGroupKeys = new Set(supports.map((item, index) => `${sourceKey(item.sourceId)}:${String(item.chunkId || item.exactQuote || index)}:${item.stance}`));
  const limitingGroupKeys = new Set(limits.map((item, index) => `${sourceKey(item.sourceId)}:${String(item.chunkId || item.exactQuote || index)}:${item.stance}`));
  const refutingGroupKeys = new Set(refutes.map((item, index) => `${sourceKey(item.sourceId)}:${String(item.chunkId || item.exactQuote || index)}:${item.stance}`));
  const sourceBreadth = supportingSources.size >= 3 ? 30 : supportingSources.size === 2 ? 20 : supportingSources.size === 1 ? 8 : 0;
  const evidenceBreadth = supportingChunkKeys.size >= 4 ? 15 : supportingChunkKeys.size === 3 ? 12 : supportingChunkKeys.size === 2 ? 9 : supportingChunkKeys.size === 1 ? 4 : 0;
  const researchContext = scoreResearchContext(rule, supports);
  const hasConditions = hasSpecificRuleCondition(rule.conditions);
  const hasLimitations = hasSpecificRuleLimitation(rule.limitations);
  const scopeDefinition = (hasConditions ? 7 : 0) + (hasLimitations ? 8 : 0);
  const conflictHandling = supports.length === 0 ? 0
    : refutes.length > 0 ? 5
      : supportingSources.size >= 2 ? 15 : 7;

  const scoreCriteria: RuleV3ScoreCriterion[] = [
    {
      key: 'source_breadth', score: sourceBreadth, maxScore: 30,
      reason: `${supportingSources.size} tài liệu độc lập có trích dẫn hỗ trợ đã kiểm chứng cho kết luận này.`,
      rubric: 'Không có nguồn hỗ trợ: 0 điểm. Một nguồn: 8 điểm. Hai nguồn độc lập: 20 điểm. Từ ba nguồn độc lập: 30 điểm.'
    },
    {
      key: 'evidence_breadth', score: evidenceBreadth, maxScore: 15,
      reason: `${supportingChunkKeys.size} cụm dẫn chứng ở các chunk riêng biệt đang hỗ trợ kết luận. Nhiều câu trong cùng một chunk chỉ được tính là một cụm.`,
      rubric: 'Không có cụm hỗ trợ: 0 điểm. Một chunk: 4 điểm. Hai chunk: 9 điểm. Ba chunk: 12 điểm. Từ bốn chunk: 15 điểm.'
    },
    {
      key: 'research_fit', score: researchContext.score, maxScore: 25,
      reason: researchContext.reason,
      rubric: 'Thiết kế nghiên cứu phù hợp và được nhận diện chắc chắn cao: tối đa 25 điểm. Độ chắc chắn trung bình: tối đa 18 điểm. Độ chắc chắn thấp: tối đa 11 điểm. Preprint bị giới hạn ở 20 điểm; nguồn informal ở 10 điểm; chưa rõ phản biện ở 16 điểm. Kết luận can thiệp bị giới hạn ở 17 điểm nếu chưa xác nhận thiết kế thực nghiệm.'
    },
    {
      key: 'scope_definition', score: scopeDefinition, maxScore: 15,
      reason: `${hasConditions ? 'Có' : 'Chưa có'} điều kiện áp dụng rõ ràng; ${hasLimitations ? 'có' : 'chưa có'} giới hạn suy rộng rõ ràng.`,
      rubric: 'Điều kiện áp dụng cụ thể: 7 điểm. Giới hạn suy rộng cụ thể: 8 điểm. Không cộng điểm cho cụm từ chung chung hoặc trường bị để trống.'
    },
    {
      key: 'conflict_handling', score: conflictHandling, maxScore: 15,
      reason: refutes.length > 0
        ? `Có ${refutes.length} trích dẫn phản bác bên cạnh ${supports.length} trích dẫn hỗ trợ; kết quả được giữ ở trạng thái bằng chứng hỗn hợp.`
        : supportingSources.size >= 2
          ? 'Chưa có trích dẫn phản bác trong tập bằng chứng và kết luận đã có ít nhất hai nguồn hỗ trợ.'
          : 'Chưa có trích dẫn phản bác, nhưng mới có một nguồn nên chưa thể xem là đã kiểm tra xung đột độc lập.',
      rubric: 'Không có hỗ trợ: 0; có cả hỗ trợ và phản bác: 5; chưa thấy phản bác nhưng chỉ có một nguồn: 7; chưa thấy phản bác và có từ hai nguồn hỗ trợ: 15 điểm.'
    }
  ];

  let evidenceScore = scoreCriteria.reduce((sum, item) => sum + item.score, 0);
  if (!quality.accepted) evidenceScore = Math.min(evidenceScore, 20);
  // A scope description cannot substitute for supporting evidence.
  if (supports.length === 0) evidenceScore = 0;
  if (refutes.length > 0) evidenceScore = Math.min(evidenceScore, 65);
  evidenceScore = Math.max(0, Math.min(100, evidenceScore));

  const oracleUsefulnessScore = quality.applicationReadiness === 'direct' ? 100
    : quality.applicationReadiness === 'conditional' ? 65
      : quality.applicationReadiness === 'background' ? 25 : 0;
  const oracleEligible = quality.accepted
    && quality.applicationReadiness !== 'not_usable'
    && evidenceScore >= 60
    && supportingSources.size >= 2
    && supports.length > 0;

  const certaintyTier: RuleV3ScoreResult['certaintyTier'] = refutes.length > 0 && supports.length > 0
    ? 'mixed'
    : evidenceScore >= 85 ? 'strong'
      : evidenceScore >= 65 ? 'moderate'
        : evidenceScore >= 45 ? 'limited'
          : 'weak';

  return {
    evidenceScore,
    oracleUsefulnessScore,
    oracleEligible,
    certaintyTier,
    exactCitationCount: exactGroupKeys.size,
    supportingCitationCount: supportingGroupKeys.size,
    limitingCitationCount: limitingGroupKeys.size,
    contradictingCitationCount: refutingGroupKeys.size,
    independentSourceCount: allSources.size,
    supportingSourceCount: supportingSources.size,
    contradictingSourceCount: contradictingSources.size,
    qualityAccepted: quality.accepted,
    qualityReasonCodes: quality.reasonCodes,
    qualitySummary: quality.summary,
    semanticSupportLevel: quality.semanticSupportLevel,
    semanticSupportScore: quality.semanticSupportScore,
    applicationReadiness: quality.applicationReadiness,
    scoreCriteria
  };
}
