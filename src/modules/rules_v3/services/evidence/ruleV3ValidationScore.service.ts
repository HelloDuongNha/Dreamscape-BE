import { Types } from 'mongoose';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import RuleValidationFeedback, {
  type IRuleValidationImpact,
} from '../../models/RuleValidationFeedback';
import { scoreRuleV3Aggregate } from './ruleV3Scoring.service';

export type RuleValidationAnswer = 'yes' | 'no' | 'unsure';

export interface RuleValidationScoreUpdate {
  ruleId: string;
  score: number;
  previousScore: number;
  scoreDelta: number;
  validationAdjustment: number;
  relation: 'direct' | 'shared_quote';
  voteDelta: -2 | -1 | 0 | 1 | 2;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function certaintyTier(score: number): 'weak' | 'limited' | 'moderate' | 'strong' {
  if (score >= 85) return 'strong';
  if (score >= 65) return 'moderate';
  if (score >= 45) return 'limited';
  return 'weak';
}

function primaryRuleIdForOwner(rules: any[], ownerId: string): string | null {
  const owner = rules.find((rule) =>
    String(rule._id) === ownerId
    || (rule.compositeComponents || []).some(
      (component: any) => String(component.sourceRuleId) === ownerId,
    ));
  return owner ? String(owner._id) : null;
}

async function resolveImpacts(
  directRuleIds: string[],
  sourceId?: string,
  exactQuote?: string,
): Promise<{ impacts: IRuleValidationImpact[]; quoteHashes: string[] }> {
  const directRules = await KnowledgeRuleV3.find({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: { $in: directRuleIds } },
      { 'compositeComponents.sourceRuleId': { $in: directRuleIds } },
    ],
  }).select('_id compositeComponents.sourceRuleId').lean();
  const canonicalDirectIds = directRules.map((rule) => String(rule._id));
  const evidenceOwnerIds = directRules.flatMap((rule) => [
    String(rule._id),
    ...(rule.compositeComponents || []).map((component) => String(component.sourceRuleId)),
  ]);
  const evidenceQuery: Record<string, any> = {
    ruleId: { $in: evidenceOwnerIds },
    stance: 'supports',
  };
  if (sourceId && Types.ObjectId.isValid(sourceId)) {
    evidenceQuery.sourceId = new Types.ObjectId(sourceId);
  }
  if (exactQuote?.trim()) evidenceQuery.exactQuote = exactQuote;
  let directEvidence = await KnowledgeRuleEvidenceV3.find(evidenceQuery)
    .select('quoteHash')
    .lean();
  // Old citations can carry an approved-source alias while preserving the
  // original quote. Retry by exact quote before broadening to every supporting
  // quote owned by the direct argument.
  if (!directEvidence.length && exactQuote?.trim()) {
    directEvidence = await KnowledgeRuleEvidenceV3.find({
      ruleId: { $in: evidenceOwnerIds },
      stance: 'supports',
      exactQuote,
    }).select('quoteHash').lean();
  }
  if (!directEvidence.length) {
    directEvidence = await KnowledgeRuleEvidenceV3.find({
      ruleId: { $in: evidenceOwnerIds },
      stance: 'supports',
    }).select('quoteHash').lean();
  }
  const quoteHashes = [...new Set(directEvidence.map((item) => item.quoteHash).filter(Boolean))];
  const sharedEvidence = quoteHashes.length
    ? await KnowledgeRuleEvidenceV3.find({
      quoteHash: { $in: quoteHashes },
      stance: 'supports',
    }).select('ruleId').lean()
    : [];
  const sharedOwnerIds = [...new Set(sharedEvidence.map((item) => String(item.ruleId)))];
  const relatedRules = sharedOwnerIds.length
    ? await KnowledgeRuleV3.find({
      status: { $in: ['pending', 'verified'] },
      $or: [
        { _id: { $in: sharedOwnerIds } },
        { 'compositeComponents.sourceRuleId': { $in: sharedOwnerIds } },
      ],
    }).select('_id compositeComponents.sourceRuleId').lean()
    : [];
  const impactByRule = new Map<string, IRuleValidationImpact>();
  for (const ruleId of canonicalDirectIds) {
    impactByRule.set(ruleId, { ruleId, relation: 'direct', weight: 2 });
  }
  for (const ownerId of sharedOwnerIds) {
    const ruleId = primaryRuleIdForOwner(relatedRules, ownerId);
    if (!ruleId || impactByRule.has(ruleId)) continue;
    impactByRule.set(ruleId, { ruleId, relation: 'shared_quote', weight: 1 });
  }
  return { impacts: [...impactByRule.values()], quoteHashes };
}

export async function recomputeRuleValidationScores(ruleIds: string[]): Promise<RuleValidationScoreUpdate[]> {
  const uniqueRuleIds = [...new Set(ruleIds.filter((id) => Types.ObjectId.isValid(id)))];
  if (!uniqueRuleIds.length) return [];
  const [rules, rows] = await Promise.all([
    KnowledgeRuleV3.find({ _id: { $in: uniqueRuleIds } }),
    RuleValidationFeedback.find({ 'impacts.ruleId': { $in: uniqueRuleIds } })
      .select('effect impacts')
      .lean(),
  ]);
  const evidenceOwnerIds = [...new Set(rules.flatMap((rule: any) => [
    String(rule._id),
    ...(rule.compositeComponents || []).map((component: any) => String(component.sourceRuleId)),
  ]))];
  const evidence = evidenceOwnerIds.length
    ? await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: evidenceOwnerIds } }).lean()
    : [];
  const updates: RuleValidationScoreUpdate[] = [];
  for (const rule of rules) {
    const ruleId = String(rule._id);
    const previousScore = Number(rule.evidenceScore) || 0;
    const sourceBaseScore = scoreRuleV3Aggregate(rule, evidence).score.evidenceScore;
    let adjustment = 0;
    for (const row of rows) {
      const impact = row.impacts.find((item) => item.ruleId === ruleId);
      if (!impact || row.effect === 'unresolved') continue;
      adjustment += row.effect === 'supports' ? impact.weight : -impact.weight;
    }
    const nextScore = clampScore(sourceBaseScore + adjustment);
    rule.sourceEvidenceScore = sourceBaseScore;
    rule.userValidationAdjustment = adjustment;
    rule.evidenceScore = nextScore;
    if (rule.certaintyTier !== 'mixed') rule.certaintyTier = certaintyTier(nextScore);
    await rule.save();
    updates.push({
      ruleId,
      score: nextScore,
      previousScore,
      scoreDelta: nextScore - previousScore,
      validationAdjustment: adjustment,
      relation: 'shared_quote',
      voteDelta: 0,
    });
  }
  return updates;
}

export async function removeRuleValidationFeedbackForOrigins(input: {
  origin: 'oracle' | 'dream_analysis';
  originIds: Array<Types.ObjectId | string>;
}): Promise<RuleValidationScoreUpdate[]> {
  const originIds = input.originIds.filter(Boolean);
  if (!originIds.length) return [];
  const rows = await RuleValidationFeedback.find({
    origin: input.origin,
    originId: { $in: originIds },
  }).select('impacts.ruleId').lean();
  const affectedRuleIds = [...new Set(rows.flatMap((row) =>
    (row.impacts || []).map((impact) => impact.ruleId)))];
  await RuleValidationFeedback.deleteMany({
    origin: input.origin,
    originId: { $in: originIds },
  });
  return recomputeRuleValidationScores(affectedRuleIds);
}

export async function setRuleValidationFeedback(input: {
  userId: Types.ObjectId;
  verificationKey: string;
  origin: 'oracle' | 'dream_analysis';
  originId: Types.ObjectId;
  questionText: string;
  answer: RuleValidationAnswer | null;
  directRuleIds: string[];
  sourceId?: string;
  exactQuote?: string;
}): Promise<RuleValidationScoreUpdate[]> {
  const previous = await RuleValidationFeedback.findOne({
    userId: input.userId,
    verificationKey: input.verificationKey,
  }).lean();
  const { impacts, quoteHashes } = await resolveImpacts(
    input.directRuleIds,
    input.sourceId,
    input.exactQuote,
  );
  if (!impacts.some((impact) => impact.relation === 'direct')) {
    throw new Error('validation_has_no_current_direct_argument');
  }
  if (input.answer === null) {
    await RuleValidationFeedback.deleteOne({
      userId: input.userId,
      verificationKey: input.verificationKey,
    });
  } else {
    const effect = input.answer === 'yes'
      ? 'supports'
      : input.answer === 'no'
        ? 'weakens'
        : 'unresolved';
    await RuleValidationFeedback.findOneAndUpdate(
      { userId: input.userId, verificationKey: input.verificationKey },
      {
        $set: {
          origin: input.origin,
          originId: input.originId,
          questionText: input.questionText,
          answer: input.answer,
          effect,
          directRuleIds: impacts
            .filter((impact) => impact.relation === 'direct')
            .map((impact) => impact.ruleId),
          evidenceQuoteHashes: quoteHashes,
          impacts,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
  }
  const affectedRuleIds = [...new Set([
    ...(previous?.impacts || []).map((impact) => impact.ruleId),
    ...impacts.map((impact) => impact.ruleId),
  ])];
  const updates = await recomputeRuleValidationScores(affectedRuleIds);
  const signed = input.answer === 'yes' ? 1 : input.answer === 'no' ? -1 : 0;
  const impactByRule = new Map(impacts.map((impact) => [impact.ruleId, impact]));
  return updates.map((update) => {
    const impact = impactByRule.get(update.ruleId);
    return {
      ...update,
      relation: impact?.relation || update.relation,
      voteDelta: (impact ? signed * impact.weight : 0) as -2 | -1 | 0 | 1 | 2,
    };
  });
}

export async function getCurrentRuleValidationAnswers(
  userId: Types.ObjectId | string,
  verificationKeys: string[],
): Promise<Map<string, RuleValidationAnswer>> {
  const rows = await RuleValidationFeedback.find({
    userId,
    verificationKey: { $in: [...new Set(verificationKeys.filter(Boolean))] },
  }).select('verificationKey answer').lean();
  return new Map(rows.map((row) => [row.verificationKey, row.answer]));
}

export interface RuleValidationStats {
  supports: number;
  weakens: number;
  unsure: number;
  directResponses: number;
  sharedQuoteResponses: number;
  netAdjustment: number;
}

// Summarizes stored case feedback without treating it as academic evidence.
export async function getRuleValidationStats(
  ruleIds: string[],
): Promise<Map<string, RuleValidationStats>> {
  const ids = [...new Set(ruleIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await RuleValidationFeedback.find({ 'impacts.ruleId': { $in: ids } })
    .select('effect impacts')
    .lean();
  const stats = new Map<string, RuleValidationStats>();
  for (const ruleId of ids) {
    stats.set(ruleId, {
      supports: 0,
      weakens: 0,
      unsure: 0,
      directResponses: 0,
      sharedQuoteResponses: 0,
      netAdjustment: 0,
    });
  }
  for (const row of rows) {
    for (const impact of row.impacts || []) {
      const current = stats.get(impact.ruleId);
      if (!current) continue;
      if (row.effect === 'supports') current.supports += 1;
      else if (row.effect === 'weakens') current.weakens += 1;
      else current.unsure += 1;
      if (impact.relation === 'direct') current.directResponses += 1;
      else current.sharedQuoteResponses += 1;
      if (row.effect !== 'unresolved') {
        current.netAdjustment += row.effect === 'supports' ? impact.weight : -impact.weight;
      }
    }
  }
  return stats;
}

export function applyStoredValidationAdjustment<T extends { evidenceScore: number }>(
  score: T,
  rule: { userValidationAdjustment?: number },
): T {
  return {
    ...score,
    evidenceScore: clampScore(score.evidenceScore + (Number(rule.userValidationAdjustment) || 0)),
  };
}
