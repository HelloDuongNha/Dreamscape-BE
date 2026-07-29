import { Types } from 'mongoose';
import AcademicSource from '../../../academic/models/AcademicSource';
import SourceContribution from '../../../academic/models/SourceContribution';
import KnowledgeRuleEvidenceV3 from '../../../rules_v3/models/KnowledgeRuleEvidence';
import { retrieveApprovedRuleV3 } from '../../../rules_v3/services/retrieval/ruleV3Retrieval.service';
import { evidenceGapRuleSimilarity } from '../../../../shared/evidence/evidenceClaimMatching';

export interface EvidenceGapRuleInput {
  _id: Types.ObjectId;
  ruleCode?: string;
  statement?: string;
  ruleStatement?: string;
  subject?: string;
  outcome?: string;
  status?: string;
  evidenceScore?: number;
  supportingSourceCount?: number;
  conditions?: unknown;
  dreamFeatureTags?: string[];
  compositeComponents?: Array<{
    sourceRuleId?: Types.ObjectId;
    statement?: string;
    subject?: string;
    outcome?: string;
  }>;
}

export const DIRECT_CLAIM_MATCH = 0.5;
export const CANDIDATE_CLAIM_MATCH = 0.28;
const STRONG_MULTILINGUAL_VECTOR_MATCH = 0.82;

export function buildEvidenceGapRuleText(rule: EvidenceGapRuleInput): string {
  return [
    rule.statement,
    rule.ruleStatement,
    rule.subject,
    rule.outcome,
    ...(rule.compositeComponents || []).flatMap((component) => [
      component.statement,
      component.subject,
      component.outcome,
    ]),
  ].filter(Boolean).join(' ');
}

export async function findGroundedRuleForClaim(
  claim: string,
): Promise<EvidenceGapRuleInput | null> {
  const result = await retrieveApprovedRuleV3(claim, 5);
  for (const rule of result.rules as any[]) {
    const ruleId = String(rule.ruleId || rule._id);
    const hasSupportingEvidence = result.evidenceLinks.some(
      (link: any) => String(link.ruleId) === ruleId && String(link.quote || '').trim(),
    );
    if (!hasSupportingEvidence) continue;
    const relationScore = evidenceGapRuleSimilarity(
      claim,
      buildEvidenceGapRuleText(rule as EvidenceGapRuleInput),
    );
    const vectorScore = Number(rule.retrievalSignals?.vector) || 0;
    if (
      relationScore >= DIRECT_CLAIM_MATCH
      || vectorScore >= STRONG_MULTILINGUAL_VECTOR_MATCH
    ) return rule as EvidenceGapRuleInput;
  }
  return null;
}

export async function loadRuleEvidenceSupport(
  claim: string,
  rule: EvidenceGapRuleInput,
) {
  if (evidenceGapRuleSimilarity(claim, buildEvidenceGapRuleText(rule)) < DIRECT_CLAIM_MATCH) {
    return null;
  }
  const evidenceOwnerRuleId = findEvidenceOwnerRuleId(claim, rule);
  const candidates = await KnowledgeRuleEvidenceV3.find({
    ruleId: evidenceOwnerRuleId,
    stance: 'supports',
  }).sort({ verificationScore: -1, createdAt: 1 }).lean();
  const evidence = candidates
    .filter((item) => String(item.exactQuote || '').trim())
    .map((item) => ({
      item,
      similarity: evidenceGapRuleSimilarity(claim, String(item.exactQuote || '')),
    }))
    .sort((left, right) =>
      Number(right.item.verificationScore || 0) - Number(left.item.verificationScore || 0)
      || right.similarity - left.similarity)[0];
  if (!evidence) return null;

  const [academicSource, contribution] = await Promise.all([
    AcademicSource.findById(evidence.item.sourceId).lean(),
    SourceContribution.findById(evidence.item.sourceId).lean(),
  ]);
  const approvedFromContribution = !academicSource && contribution
    ? await AcademicSource.findOne({ sourceContributionId: contribution._id }).lean()
    : null;
  const source = academicSource || approvedFromContribution;
  return source ? { evidence: evidence.item, source } : null;
}

function findEvidenceOwnerRuleId(
  claim: string,
  rule: EvidenceGapRuleInput,
): Types.ObjectId {
  const matchingComponent = (rule.compositeComponents || [])
    .filter((component) => component.sourceRuleId)
    .map((component) => ({
      sourceRuleId: component.sourceRuleId as Types.ObjectId,
      similarity: evidenceGapRuleSimilarity(
        claim,
        [component.statement, component.subject, component.outcome]
          .filter(Boolean)
          .join(' '),
      ),
    }))
    .sort((left, right) => right.similarity - left.similarity)[0];
  return matchingComponent?.sourceRuleId || rule._id;
}
