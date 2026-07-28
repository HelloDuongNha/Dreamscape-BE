import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import { classifyRuleV3VerificationKind } from '../retrieval/ruleV3DreamApplication.service';
import {
  assessRuleV3MergeCompatibility,
  classifyRuleV3Relationship,
} from '../evidence/ruleV3Relationship.service';
import { shortRuleLabel } from './ruleV3SourceSummary.service';

// Tìm và xếp hạng các lập luận có quan hệ đáng xem trong màn hình duyệt.
export async function loadRuleV3CandidateRelationships(
  rule: any,
  excludedRuleIds: any[],
  evidence: any[],
) {
  const comparableRules = await KnowledgeRuleV3.find({
    _id: { $nin: excludedRuleIds },
    sourceLanguage: rule.sourceLanguage,
    status: { $in: ['pending', 'verified'] },
  }).select('ruleCode status sourceLanguage statement subject outcome claimType effectPolarity conditions evidenceScore isComposite').lean();
  const comparableEvidence = await KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: comparableRules.map(item => item._id) },
  }).select('ruleId sourceId chunkId').lean();
  const selectedChunkIds = new Set(evidence.map(item => String(item.chunkId)));
  const selectedSourceIds = new Set(evidence.map(item => String(item.sourceId)));
  const chunkIdsByRule = groupIdsByRule(comparableEvidence, 'chunkId');
  const sourceIdsByRule = groupIdsByRule(comparableEvidence, 'sourceId');

  return comparableRules
    .map(other => buildRelationship({
      rule,
      other,
      selectedChunkIds,
      selectedSourceIds,
      chunkIdsByRule,
      sourceIdsByRule,
    }))
    .filter(item => item.relationship !== 'unrelated')
    .map(mapRelationshipForReview)
    .sort(compareRelationships)
    .slice(0, 20);
}

function groupIdsByRule(evidence: any[], field: 'chunkId' | 'sourceId') {
  const idsByRule = new Map<string, Set<string>>();
  for (const item of evidence) {
    const key = String(item.ruleId);
    const ids = idsByRule.get(key) || new Set<string>();
    ids.add(String(item[field]));
    idsByRule.set(key, ids);
  }
  return idsByRule;
}

function buildRelationship(input: {
  rule: any;
  other: any;
  selectedChunkIds: Set<string>;
  selectedSourceIds: Set<string>;
  chunkIdsByRule: Map<string, Set<string>>;
  sourceIdsByRule: Map<string, Set<string>>;
}) {
  const otherId = String(input.other._id);
  const sharedEvidenceChunkCount = [...(input.chunkIdsByRule.get(otherId) || [])]
    .filter(chunkId => input.selectedChunkIds.has(chunkId)).length;
  const selectedQuestionKind = classifyRuleV3VerificationKind(input.rule);
  const otherQuestionKind = classifyRuleV3VerificationKind(input.other);
  const sameSourceDocument = [...(input.sourceIdsByRule.get(otherId) || [])]
    .some(sourceId => input.selectedSourceIds.has(sourceId));
  const mergeAssessment = assessRuleV3MergeCompatibility(input.rule, input.other, {
    sharedEvidenceContext: sharedEvidenceChunkCount > 0,
    sameQuestionKind: selectedQuestionKind !== 'none'
      && selectedQuestionKind === otherQuestionKind,
    sameSourceDocument,
  });
  const relationship = classifyRuleV3Relationship(input.rule, input.other, {
    sharedEvidenceContext: sharedEvidenceChunkCount > 0,
  });
  const blockedByState = input.rule.isComposite || input.other.isComposite
    ? 'composite_review_boundary'
    : input.other.status !== input.rule.status ? 'different_status' : null;
  return {
    other: input.other,
    sharedEvidenceChunkCount,
    relationship,
    mergeAssessment: {
      ...mergeAssessment,
      semanticCanMerge: mergeAssessment.canMerge,
      canMerge: ['pending', 'verified'].includes(input.rule.status)
        && !blockedByState
        && mergeAssessment.canMerge,
      blockedByState,
    },
  };
}

function mapRelationshipForReview(input: any) {
  const { other, relationship, sharedEvidenceChunkCount, mergeAssessment } = input;
  return {
    ruleId: String(other._id),
    ruleCode: other.ruleCode,
    status: other.status === 'verified' ? 'approved' : other.status,
    label: shortRuleLabel(other),
    relationship,
    mergeEligibility: mergeAssessment,
    sharedEvidenceChunkCount,
    evidenceScore: other.evidenceScore,
    subject: other.subject,
    outcome: other.outcome,
    statement: other.statement,
    keepSeparateReason: mergeAssessment.canMerge ? null : relationship,
  };
}

function compareRelationships(left: any, right: any) {
  const priority: Record<string, number> = {
    contradictory: 0,
    scope_tension: 1,
    equivalent: 2,
    overlapping: 3,
    reverse_direction: 4,
    complementary: 5,
    shared_context: 6,
  };
  return (priority[left.relationship] ?? 99) - (priority[right.relationship] ?? 99)
    || right.sharedEvidenceChunkCount - left.sharedEvidenceChunkCount
    || right.evidenceScore - left.evidenceScore;
}
