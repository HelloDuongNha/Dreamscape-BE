import { buildCompositeProbeBlueprint } from './ruleV3ProbeBlueprint.service';
import { areRuleV3ComponentsEvidenceEquivalent } from '../evidence/ruleV3Relationship.service';
import { RULE_V3_SCORING_VERSION, scoreRuleV3 } from '../evidence/ruleV3Scoring.service';
import {
  cleanSourceMetadataText,
  shortRuleLabel,
  type RuleV3SourceSummary,
} from './ruleV3SourceSummary.service';
import { applyStoredValidationAdjustment } from '../evidence/ruleV3ValidationScore.service';

// Chuyển một lập luận đã lưu thành dữ liệu ổn định cho màn hình duyệt.
export function mapRuleV3Candidate(
  rule: any,
  source: RuleV3SourceSummary | undefined,
  evidence: any[] = [],
) {
  const mappedStatus = rule.status === 'verified' ? 'approved' : rule.status;
  const components = Array.isArray(rule.compositeComponents) ? rule.compositeComponents : [];
  const componentScores: Array<{ sourceRuleId: string; score: ReturnType<typeof scoreRuleV3> }> = rule.isComposite && components.length > 1
    ? components.map((component: any) => ({
      sourceRuleId: String(component.sourceRuleId),
      score: scoreRuleV3(component, evidence.filter(item => String(item.ruleId) === String(component.sourceRuleId))),
    }))
    : [];
  const baseScore = scoreRuleV3(rule, evidence.filter(item => String(item.ruleId) === String(rule._id)));
  const pooledEquivalentScore = areRuleV3ComponentsEvidenceEquivalent(components)
    ? scoreRuleV3(components[0], evidence)
    : null;
  const weakestComponent = componentScores.reduce((weakest, current) =>
    !weakest || current.score.evidenceScore < weakest.score.evidenceScore ? current : weakest,
  null as (typeof componentScores[number] | null));
  const sourceScore = pooledEquivalentScore || (weakestComponent ? {
    ...weakestComponent.score,
    evidenceScore: weakestComponent.score.evidenceScore,
    oracleUsefulnessScore: Math.min(...componentScores.map(item => item.score.oracleUsefulnessScore)),
    oracleEligible: componentScores.every(item => item.score.oracleEligible),
    qualityAccepted: componentScores.every(item => item.score.qualityAccepted),
    supportingCitationCount: componentScores.reduce((sum, item) => sum + item.score.supportingCitationCount, 0),
    limitingCitationCount: componentScores.reduce((sum, item) => sum + item.score.limitingCitationCount, 0),
    contradictingCitationCount: componentScores.reduce((sum, item) => sum + item.score.contradictingCitationCount, 0),
    exactCitationCount: componentScores.reduce((sum, item) => sum + item.score.exactCitationCount, 0),
  } : baseScore);
  const score = applyStoredValidationAdjustment(sourceScore, rule);
  const sourceId = source?._id || String(evidence[0]?.sourceId || '');

  return {
    _id: String(rule._id),
    _engine: 'v3',
    academicSourceId: sourceId || null,
    evidenceChunkIds: evidence.map(item => String(item.chunkId)),
    proposedRuleId: rule.ruleCode,
    sourceLanguage: rule.sourceLanguage,
    label: shortRuleLabel(rule),
    fullStatement: rule.statement,
    expandedExplanation: expandRuleExplanation(rule, rule.sourceLanguage),
    expandedExplanations: {
      vi: expandRuleExplanation(rule, 'vi'),
      en: expandRuleExplanation(rule, 'en'),
    },
    probeBlueprint: buildCompositeProbeBlueprint(rule),
    group: 'dream_psychology',
    category: rule.claimType,
    factor: rule.subject,
    inputSource: rule.outcome,
    inputRequired: {},
    scientificBasis: 'Các trích dẫn bên dưới đã được đối chiếu nguyên văn với Bản đọc thông minh.',
    aiInstruction: '',
    limitations: (rule.limitations || []).join('; '),
    conditionsList: rule.conditions || [],
    limitationsList: rule.limitations || [],
    dreamFeatureTags: rule.dreamFeatureTags || [],
    claimTypeV3: rule.claimType,
    effectPolarityV3: rule.effectPolarity,
    evidenceInterpretationV3: rule.evidenceInterpretation,
    claimStrength: rule.evidenceInterpretation,
    confidenceCap: Math.min(0.65, score.evidenceScore / 100),
    evidenceRole: 'primary_support',
    evidenceSummary: rule.statement,
    status: mappedStatus,
    evidenceCredibilityScore: score.evidenceScore,
    oracleUsefulnessScore: score.oracleUsefulnessScore,
    oracleEligible: score.oracleEligible,
    legitimacyScore: score.evidenceScore,
    legitimacyLevel: score.certaintyTier,
    legitimacyReason: score.qualitySummary,
    exactCitationCount: score.exactCitationCount,
    supportingCitationCount: score.supportingCitationCount,
    limitingCitationCount: score.limitingCitationCount,
    contradictingCitationCount: score.contradictingCitationCount,
    independentSourceCount: score.independentSourceCount,
    qualityAccepted: score.qualityAccepted,
    qualityReasonCodes: score.qualityReasonCodes,
    qualitySummary: score.qualitySummary,
    applicationReadiness: score.applicationReadiness,
    scoreCriteria: score.scoreCriteria,
    scoringFormulaVersion: RULE_V3_SCORING_VERSION,
    sourceTitle: source?.title,
    sourceAuthors: source?.authors,
    sourceYear: source?.year,
    sourceDoi: source?.doi,
    isComposite: Boolean(rule.isComposite),
    compositeComponents: components.map((component: any) => ({
      sourceRuleId: String(component.sourceRuleId),
      ruleCode: component.ruleCode,
      statement: component.statement,
      claimType: component.claimType,
      effectPolarity: component.effectPolarity,
      evidenceInterpretation: component.evidenceInterpretation,
      subject: component.subject,
      outcome: component.outcome,
      conditions: component.conditions || [],
      limitations: component.limitations || [],
      dreamFeatureTags: component.dreamFeatureTags || [],
      evidenceScore: componentScores.find(item => item.sourceRuleId === String(component.sourceRuleId))?.score.evidenceScore,
      qualityAccepted: componentScores.find(item => item.sourceRuleId === String(component.sourceRuleId))?.score.qualityAccepted,
      supportingCitationCount: componentScores.find(item => item.sourceRuleId === String(component.sourceRuleId))?.score.supportingCitationCount,
      expandedExplanation: expandRuleExplanation(component, rule.sourceLanguage),
      expandedExplanations: {
        vi: expandRuleExplanation(component, 'vi'),
        en: expandRuleExplanation(component, 'en'),
      },
    })),
    ...((pooledEquivalentScore || weakestComponent) ? {
      scoreAggregation: {
        method: pooledEquivalentScore ? 'pooled_equivalent_evidence' : 'minimum_component',
        weakestRuleCode: weakestComponent
          ? components.find((component: any) => String(component.sourceRuleId) === weakestComponent.sourceRuleId)?.ruleCode
          : undefined,
        explanation: pooledEquivalentScore
          ? (rule.sourceLanguage === 'vi'
            ? 'Các mệnh đề có cùng chủ thể và kết quả nên bằng chứng từ những tài liệu độc lập được gộp để chấm lại kết luận chung.'
            : 'The claims have equivalent subjects and outcomes, so evidence from independent documents is pooled to rescore the shared conclusion.')
          : (rule.sourceLanguage === 'vi'
            ? 'Điểm tổng hợp lấy theo mệnh đề yếu nhất. Việc gộp các mệnh đề từ cùng một tài liệu hoặc cùng một đoạn nguồn không tạo thêm nguồn độc lập và không làm phần điểm từ tài liệu tăng.'
            : 'The composite score follows the weakest claim. Combining claims from the same document or source paragraph does not create independent evidence and therefore does not increase academic support.'),
      },
    } : {}),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

// Viết rõ phạm vi kết luận mà không nâng một liên hệ thành quan hệ nhân quả.
function expandRuleExplanation(component: any, language: string) {
  const vi = String(language || '').toLowerCase().startsWith('vi');
  const subject = cleanSourceMetadataText(component.subject);
  const outcome = cleanSourceMetadataText(component.outcome);
  const statement = cleanSourceMetadataText(component.statement);
  if (component.claimType === 'association') {
    return vi
      ? `${statement} Cụ thể, tài liệu ghi nhận “${subject}” và “${outcome}” xuất hiện cùng nhau trong phạm vi nghiên cứu được mô tả. Mối liên hệ này giúp xác định điều cần đối chiếu trong lời kể giấc mơ, nhưng chưa chứng minh “${subject}” trực tiếp gây ra “${outcome}”.`
      : `${statement} More specifically, the source reports that “${subject}” and “${outcome}” occur together within the studied scope. This identifies what may be compared with a dream report, but it does not establish that “${subject}” directly causes “${outcome}”.`;
  }
  return vi
    ? `${statement} Tài liệu dùng “${subject}” để mô tả hoặc giải thích “${outcome}”. Đây là phạm vi chính xác của kết luận; không nên suy rộng thành quan hệ nhân quả hay một hiệu ứng đã được đo trực tiếp nếu đoạn nguồn không nêu như vậy.`
    : `${statement} The source uses “${subject}” to describe or explain “${outcome}”. This is the claim's precise scope; it should not be expanded into a causal relationship or a directly measured effect unless the source states one.`;
}
