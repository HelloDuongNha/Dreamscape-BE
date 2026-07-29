import type { Types } from 'mongoose';
import KnowledgeRuleV3 from '../../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../rules_v3/models/KnowledgeRuleEvidence';
import {
  getCurrentRuleValidationAnswers,
} from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
} from '../presentation/oracleRulePresentation.service';

export async function buildOracleCitationLinks(input: {
  userId: Types.ObjectId;
  citation: any;
  canonicalSourceId: string;
  sourceContributionId?: string;
}) {
  const sourceIds = [
    input.canonicalSourceId,
    input.sourceContributionId ? String(input.sourceContributionId) : '',
  ].filter(Boolean);
  const evidence = await KnowledgeRuleEvidenceV3.find({
    sourceId: { $in: sourceIds },
    stance: 'supports',
  }).sort({ verificationScore: -1, createdAt: 1 }).lean();
  const ownerIds = [...new Set(evidence.map((item) => String(item.ruleId)))];
  const rules = await KnowledgeRuleV3.find({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: { $in: ownerIds } },
      { 'compositeComponents.sourceRuleId': { $in: ownerIds } },
    ],
  }).lean();
  const prepared = rules.map((rule) => prepareRuleLink(
    rule,
    evidence,
    input.citation.excerpt,
    input.canonicalSourceId,
  ));
  const answers = await getCurrentRuleValidationAnswers(
    input.userId,
    prepared.map((item) => item.verificationKey),
  );
  return prepared.map((item) => ({
    ...item,
    currentUserAnswer: answers.get(item.verificationKey) || null,
  }));
}

function prepareRuleLink(
  rule: any,
  evidence: any[],
  fallbackExcerpt: string,
  canonicalSourceId: string,
) {
  const ownerIds = [
    String(rule._id),
    ...(rule.compositeComponents || []).map((item: any) => String(item.sourceRuleId)),
  ];
  const linkedEvidence = evidence.find((item) => ownerIds.includes(String(item.ruleId)));
  const question = buildOracleCitationVerificationQuestion(rule);
  const verificationKey = `${String(rule._id)}:${
    String(linkedEvidence?._id || canonicalSourceId)
  }:oracle-citation-v2`;
  return {
    ruleId: String(rule._id),
    ruleCode: rule.ruleCode,
    statement: rule.statement,
    localizedStatement: localizeOracleRuleStatement(rule),
    quote: linkedEvidence?.exactQuote || fallbackExcerpt,
    evidenceScore: rule.evidenceScore,
    sourceEvidenceScore: Number(rule.sourceEvidenceScore)
      || Math.max(0, Number(rule.evidenceScore) - (Number(rule.userValidationAdjustment) || 0)),
    userValidationAdjustment: Number(rule.userValidationAdjustment) || 0,
    supportingSourceCount: rule.supportingSourceCount,
    verificationKey,
    verificationQuestion: question.vi,
    localizedVerificationQuestion: question,
  };
}
