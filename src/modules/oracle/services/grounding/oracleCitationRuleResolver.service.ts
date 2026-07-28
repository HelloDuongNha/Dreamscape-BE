import { Types } from 'mongoose';
import KnowledgeRuleV3 from '../../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../rules_v3/models/KnowledgeRuleEvidence';

export interface OracleSavedRuleLink {
  ruleId: string;
  ruleCode: string;
  quote?: string;
}

export async function resolveCurrentCitationRule(
  ruleLink: OracleSavedRuleLink,
  sourceIds: string[],
): Promise<any | null> {
  const currentRule = await findCurrentRuleByIdentity(ruleLink);
  if (currentRule) return currentRule;
  const evidenceRule = await findCurrentRuleByEvidence(ruleLink, sourceIds);
  if (evidenceRule) return evidenceRule;
  return findMergedRule(ruleLink);
}

async function findCurrentRuleByIdentity(ruleLink: OracleSavedRuleLink) {
  const ruleIds = [ruleLink.ruleId].filter((value) => Types.ObjectId.isValid(value));
  const ruleCodes = [ruleLink.ruleCode, ruleLink.ruleId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return KnowledgeRuleV3.findOne({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: { $in: ruleIds } },
      { ruleCode: { $in: ruleCodes } },
      { 'compositeComponents.sourceRuleId': { $in: ruleIds } },
      { 'compositeComponents.ruleCode': { $in: ruleCodes } },
    ],
  }).lean();
}

async function findCurrentRuleByEvidence(
  ruleLink: OracleSavedRuleLink,
  sourceIds: string[],
) {
  const evidenceSourceIds = sourceIds
    .filter((value) => Types.ObjectId.isValid(value))
    .map((value) => new Types.ObjectId(value));
  if (!ruleLink.quote?.trim() || !evidenceSourceIds.length) return null;
  const evidence = await KnowledgeRuleEvidenceV3.findOne({
    sourceId: { $in: evidenceSourceIds },
    exactQuote: ruleLink.quote.trim(),
    stance: 'supports',
  }).sort({ createdAt: -1 }).select('ruleId').lean();
  if (!evidence?.ruleId) return null;
  return KnowledgeRuleV3.findOne({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: evidence.ruleId },
      { 'compositeComponents.sourceRuleId': evidence.ruleId },
    ],
  }).lean();
}

async function findMergedRule(ruleLink: OracleSavedRuleLink) {
  const ruleIds = [ruleLink.ruleId].filter((value) => Types.ObjectId.isValid(value));
  const ruleCodes = [ruleLink.ruleCode, ruleLink.ruleId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const retired = await KnowledgeRuleV3.findOne({
    $or: [
      { _id: { $in: ruleIds } },
      { ruleCode: { $in: ruleCodes } },
    ],
    mergedIntoRuleId: { $exists: true },
  }).select('mergedIntoRuleId').lean();
  if (!retired?.mergedIntoRuleId) return null;
  return KnowledgeRuleV3.findOne({
    _id: retired.mergedIntoRuleId,
    status: { $in: ['pending', 'verified'] },
  }).lean();
}
