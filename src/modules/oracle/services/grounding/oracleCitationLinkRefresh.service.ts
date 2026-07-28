import { Types } from 'mongoose';
import KnowledgeRuleV3 from '../../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../rules_v3/models/KnowledgeRuleEvidence';
import {
  getCurrentRuleValidationAnswers,
} from '../../../rules_v3/services/evidence/ruleV3ValidationScore.service';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  localizeOracleVerificationQuestion,
  ORACLE_CITATION_QUESTION_VERSION,
} from '../presentation/oracleRulePresentation.service';
import { resolveCurrentCitationRule } from './oracleCitationRuleResolver.service';

export async function refreshOracleCitationLinks(input: {
  userId: Types.ObjectId;
  citation: any;
  canonicalSourceId: string;
  sourceContributionId?: string;
}): Promise<void> {
  const sourceAliases = [
    input.canonicalSourceId,
    input.sourceContributionId ? String(input.sourceContributionId) : '',
  ].filter(Boolean);
  const currentLinks = [];
  for (const link of input.citation.ruleLinks || []) {
    const refreshed = await refreshOneLink(link, sourceAliases, input.canonicalSourceId);
    if (refreshed) currentLinks.push(refreshed);
  }
  input.citation.ruleLinks = currentLinks;
  const answers = await getCurrentRuleValidationAnswers(
    input.userId,
    currentLinks.map((link) => link.verificationKey || '').filter(Boolean),
  );
  const scores = await loadLiveRuleScores(currentLinks);
  for (const link of currentLinks) {
    link.localizedStatement = localizeOracleRuleStatement(link);
    link.localizedVerificationQuestion = localizeOracleVerificationQuestion(
      link,
      link.verificationQuestion,
    );
    link.currentUserAnswer = link.verificationKey
      ? answers.get(link.verificationKey) || null
      : null;
    link.evidenceScore = scores.get(link.ruleId) ?? link.evidenceScore;
  }
}

async function refreshOneLink(
  link: any,
  sourceAliases: string[],
  canonicalSourceId: string,
) {
  const rule = await resolveCurrentCitationRule(link, sourceAliases);
  if (!rule) return null;
  const evidence = link.quote
    ? await KnowledgeRuleEvidenceV3.findOne({
      sourceId: { $in: sourceAliases },
      exactQuote: link.quote,
      stance: 'supports',
    }).sort({ createdAt: -1 }).select('_id').lean()
    : null;
  const verificationKey = `${String(rule._id)}:${
    evidence?._id ? String(evidence._id) : canonicalSourceId
  }:oracle-citation-${ORACLE_CITATION_QUESTION_VERSION}`;
  if (link.verificationKey !== verificationKey || !link.verificationQuestion) {
    const question = buildOracleCitationVerificationQuestion(rule);
    link.verificationKey = verificationKey;
    link.verificationQuestion = question.vi;
    link.localizedVerificationQuestion = question;
    link.currentUserAnswer = null;
  }
  link.ruleId = String(rule._id);
  link.ruleCode = String(rule.ruleCode || link.ruleCode);
  link.statement = String(rule.statement || link.statement);
  link.evidenceScore = Number(rule.evidenceScore) || 0;
  link.sourceEvidenceScore = Number(rule.sourceEvidenceScore)
    || Math.max(0, link.evidenceScore - (Number(rule.userValidationAdjustment) || 0));
  link.userValidationAdjustment = Number(rule.userValidationAdjustment) || 0;
  link.supportingSourceCount = Number(rule.supportingSourceCount) || 0;
  return link;
}

async function loadLiveRuleScores(links: any[]): Promise<Map<string, number>> {
  const ids = links.map((link) => link.ruleId).filter((id) => Types.ObjectId.isValid(id));
  const codes = links.flatMap((link) => [link.ruleId, link.ruleCode])
    .filter((code) => code && !Types.ObjectId.isValid(code));
  const rules = await KnowledgeRuleV3.find({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: { $in: ids } },
      { ruleCode: { $in: codes } },
      { 'compositeComponents.sourceRuleId': { $in: ids } },
      { 'compositeComponents.ruleCode': { $in: codes } },
    ],
  }).select('_id ruleCode evidenceScore compositeComponents.sourceRuleId compositeComponents.ruleCode').lean();
  const scores = new Map<string, number>();
  for (const rule of rules) {
    const score = Number(rule.evidenceScore) || 0;
    scores.set(String(rule._id), score);
    scores.set(String(rule.ruleCode), score);
    for (const component of rule.compositeComponents || []) {
      scores.set(String(component.sourceRuleId), score);
      scores.set(String(component.ruleCode), score);
    }
  }
  return scores;
}
