import type {
  RuleV3CandidateQualityResult,
  RuleV3QualityCandidate,
  RuleV3QualityEvidence
} from './ruleV3CandidateQuality.types';
import {
  assessCandidatePolicy,
  qualitySummary
} from './ruleV3CandidatePolicy.service';
import { assessAtomicSupport } from './ruleV3EvidenceEntailment.service';

export function assessRuleV3CandidateQuality(
  candidate: RuleV3QualityCandidate,
  evidence: RuleV3QualityEvidence[],
  context: { documentType?: string } = {}
): RuleV3CandidateQualityResult {
  const supportText = evidence
    .filter(item => item.stance === 'supports')
    .map(item => item.exactQuote || '')
    .join('\n');
  const semanticSupport = assessAtomicSupport(candidate, evidence);
  const policy = assessCandidatePolicy(
    candidate,
    supportText,
    semanticSupport.level,
    context.documentType
  );

  return {
    accepted: policy.reasonCodes.length === 0,
    reasonCodes: policy.reasonCodes,
    semanticSupportLevel: semanticSupport.level,
    semanticSupportScore: semanticSupport.score,
    semanticSupportReason: semanticSupport.reason,
    applicationReadiness: policy.applicationReadiness,
    normalizedEffectPolarity: policy.normalizedEffectPolarity,
    normalizedEvidenceInterpretation: policy.normalizedEvidenceInterpretation,
    summary: qualitySummary(policy.reasonCodes[0])
  };
}
