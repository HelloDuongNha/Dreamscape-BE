import mongoose from 'mongoose';
import KnowledgeRuleV3 from '../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../models/KnowledgeRuleEvidence';
import { assessRuleV3MergeCompatibility } from './ruleV3Relationship.service';
import { classifyRuleV3VerificationKind } from './ruleV3DreamApplication.service';

export class RuleV3MergeError extends Error {
  constructor(public readonly code: 'rule_not_found' | 'rule_not_pending' | 'no_compatible_rules' | 'merge_too_large') {
    super(code);
    this.name = 'RuleV3MergeError';
  }
}

export interface RuleV3AutoMergeResult {
  activeRuleIds: mongoose.Types.ObjectId[];
  mergedGroupCount: number;
  retiredRuleCount: number;
  failures: Array<{ ruleId: string; reason: string }>;
}

function componentSnapshot(rule: any) {
  return {
    sourceRuleId: rule._id,
    ruleCode: rule.ruleCode,
    statement: rule.statement,
    claimType: rule.claimType,
    effectPolarity: rule.effectPolarity,
    evidenceInterpretation: rule.evidenceInterpretation,
    subject: rule.subject,
    outcome: rule.outcome,
    conditions: rule.conditions || [],
    limitations: rule.limitations || [],
    dreamFeatureTags: rule.dreamFeatureTags || [],
  };
}

export function findRuleV3MergeGroup(
  selectedRuleId: string,
  rules: any[],
  evidenceChunkIdsByRule: Map<string, Set<string>>,
): any[] {
  const selected = rules.find(rule => String(rule._id) === selectedRuleId);
  if (!selected) return [];
  const group = [selected];
  const candidates = rules
    .filter(rule => String(rule._id) !== selectedRuleId && !rule.isComposite)
    .sort((left, right) => String(left._id).localeCompare(String(right._id)));
  for (const candidate of candidates) {
    const candidateChunks = evidenceChunkIdsByRule.get(String(candidate._id)) || new Set<string>();
    const compatibleWithEveryMember = group.every(current => {
      const currentChunks = evidenceChunkIdsByRule.get(String(current._id)) || new Set<string>();
      const sharesCanonicalParagraph = [...currentChunks].some(chunkId => candidateChunks.has(chunkId));
      const currentQuestionKind = classifyRuleV3VerificationKind(current);
      const candidateQuestionKind = classifyRuleV3VerificationKind(candidate);
      const assessment = assessRuleV3MergeCompatibility(current, candidate, {
        sharedEvidenceContext: sharesCanonicalParagraph,
        sameQuestionKind: currentQuestionKind !== 'none' && currentQuestionKind === candidateQuestionKind,
      });
      return assessment.canMerge;
    });
    if (compatibleWithEveryMember) group.push(candidate);
  }
  return group;
}

export async function mergePendingRuleV3Group(selectedRuleId: string) {
  if (!mongoose.Types.ObjectId.isValid(selectedRuleId)) throw new RuleV3MergeError('rule_not_found');
  const selected = await KnowledgeRuleV3.findById(selectedRuleId);
  if (!selected) throw new RuleV3MergeError('rule_not_found');
  if (selected.status !== 'pending' || selected.isComposite) throw new RuleV3MergeError('rule_not_pending');

  // Pending rules from every document are considered. Cross-document claims
  // can merge only through semantic compatibility because their canonical
  // chunk ids necessarily differ.
  const rules = await KnowledgeRuleV3.find({
    status: 'pending',
    sourceLanguage: selected.sourceLanguage,
    isComposite: { $ne: true },
  });
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: rules.map(rule => rule._id) } })
    .select('ruleId chunkId').lean();
  const chunkIdsByRule = new Map<string, Set<string>>();
  for (const item of evidence) {
    const key = String(item.ruleId);
    const ids = chunkIdsByRule.get(key) || new Set<string>();
    ids.add(String(item.chunkId));
    chunkIdsByRule.set(key, ids);
  }
  const mergeGroup = findRuleV3MergeGroup(selectedRuleId, rules, chunkIdsByRule);
  if (mergeGroup.length < 2) throw new RuleV3MergeError('no_compatible_rules');
  if (mergeGroup.length > 12) throw new RuleV3MergeError('merge_too_large');

  const primary = mergeGroup.find(rule => String(rule._id) === selectedRuleId)!;
  const secondaryRules = mergeGroup.filter(rule => String(rule._id) !== selectedRuleId);
  const primaryBackup = primary.toObject();
  const secondaryBackups = secondaryRules.map(rule => rule.toObject());
  try {
    primary.isComposite = true;
    primary.compositeComponents = mergeGroup.map(componentSnapshot);
    primary.mergedFromRuleIds = secondaryRules.map(rule => rule._id);
    primary.conditions = [...new Set(mergeGroup.flatMap(rule => rule.conditions || []))];
    primary.limitations = [...new Set(mergeGroup.flatMap(rule => rule.limitations || []))];
    primary.dreamFeatureTags = [...new Set(mergeGroup.flatMap(rule => rule.dreamFeatureTags || []))];
    primary.version += 1;
    // A merge changes the retrieval unit. Even when every component was
    // verified, the new composite must be reviewed and embedded again.
    primary.status = 'pending';
    primary.embedding = [];
    primary.embeddingModel = undefined;
    await primary.save();
    await KnowledgeRuleV3.updateMany({ _id: { $in: secondaryRules.map(rule => rule._id) } }, {
      $set: { status: 'retired', mergedIntoRuleId: primary._id },
      $unset: { embedding: 1, embeddingModel: 1 },
    });
  } catch (error) {
    await KnowledgeRuleV3.replaceOne({ _id: primaryBackup._id }, primaryBackup, { upsert: true }).catch(() => undefined);
    for (const backup of secondaryBackups) {
      await KnowledgeRuleV3.replaceOne({ _id: backup._id }, backup, { upsert: true }).catch(() => undefined);
    }
    throw error;
  }
  return {
    primaryRuleId: String(primary._id),
    retiredRuleIds: secondaryRules.map(rule => String(rule._id)),
    componentCount: mergeGroup.length,
    requiresReview: true,
  };
}

/** Tự động gộp các lập luận chờ duyệt vừa được pipeline tạo ra. */
export async function autoMergePendingRuleV3Groups(
  seedRuleIds: Array<mongoose.Types.ObjectId | string>,
): Promise<RuleV3AutoMergeResult> {
  const activeRuleIds = new Map(
    seedRuleIds.map(ruleId => [String(ruleId), new mongoose.Types.ObjectId(String(ruleId))]),
  );
  const failures: RuleV3AutoMergeResult['failures'] = [];
  let mergedGroupCount = 0;
  let retiredRuleCount = 0;

  for (const ruleId of [...activeRuleIds.keys()].sort()) {
    if (!activeRuleIds.has(ruleId)) continue;
    const rule = await KnowledgeRuleV3.findById(ruleId).select('status isComposite').lean();
    if (!rule || rule.status !== 'pending' || rule.isComposite) continue;
    try {
      const result = await mergePendingRuleV3Group(ruleId);
      mergedGroupCount += 1;
      retiredRuleCount += result.retiredRuleIds.length;
      for (const retiredRuleId of result.retiredRuleIds) activeRuleIds.delete(retiredRuleId);
      activeRuleIds.set(
        result.primaryRuleId,
        new mongoose.Types.ObjectId(result.primaryRuleId),
      );
    } catch (error) {
      if (
        error instanceof RuleV3MergeError
        && ['no_compatible_rules', 'rule_not_pending'].includes(error.code)
      ) {
        continue;
      }
      failures.push({
        ruleId,
        reason: error instanceof RuleV3MergeError ? error.code : 'automatic_merge_failed',
      });
    }
  }

  return {
    activeRuleIds: [...activeRuleIds.values()],
    mergedGroupCount,
    retiredRuleCount,
    failures,
  };
}
