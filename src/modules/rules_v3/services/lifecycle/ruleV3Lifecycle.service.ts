import mongoose, { ClientSession } from 'mongoose';
import AcademicSource from '../../../academic/models/AcademicSource';
import AcademicRuleExtractionRunV3 from '../../models/AcademicRuleExtractionRun';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import { scoreRuleV3Aggregate } from '../evidence/ruleV3Scoring.service';
import { applyStoredValidationAdjustment } from '../evidence/ruleV3ValidationScore.service';

export interface RemoveRuleV3SourceDataOptions {
  session?: ClientSession;
  deleteRunHistory?: boolean;
}

export interface RemoveRuleV3SourceDataResult {
  sourceAliases: mongoose.Types.ObjectId[];
  evidenceRemoved: number;
  rulesRemoved: number;
  rulesRescored: number;
  runsRemoved: number;
}

// Resolves every approved-source and contribution ID that owns the same evidence.
export async function resolveRuleV3SourceAliases(sourceId: string): Promise<mongoose.Types.ObjectId[]> {
  const aliases = new Map<string, mongoose.Types.ObjectId>();
  if (!mongoose.Types.ObjectId.isValid(sourceId)) return [];

  const id = new mongoose.Types.ObjectId(sourceId);
  aliases.set(String(id), id);
  const [approved, approvedFromContribution] = await Promise.all([
    AcademicSource.findById(id).select('sourceContributionId').lean(),
    AcademicSource.findOne({ sourceContributionId: id }).select('_id sourceContributionId').lean()
  ]);
  if (approved?.sourceContributionId) aliases.set(String(approved.sourceContributionId), approved.sourceContributionId);
  if (approvedFromContribution?._id) aliases.set(String(approvedFromContribution._id), approvedFromContribution._id);
  if (approvedFromContribution?.sourceContributionId) {
    aliases.set(String(approvedFromContribution.sourceContributionId), approvedFromContribution.sourceContributionId);
  }
  return [...aliases.values()];
}

// Removes one source's evidence, rescoring shared rules that still have other sources.
export async function removeRuleV3SourceData(
  sourceId: string,
  options: RemoveRuleV3SourceDataOptions = {}
): Promise<RemoveRuleV3SourceDataResult> {
  const sourceAliases = await resolveRuleV3SourceAliases(sourceId);
  const session = options.session;
  const emptyResult: RemoveRuleV3SourceDataResult = {
    sourceAliases,
    evidenceRemoved: 0,
    rulesRemoved: 0,
    rulesRescored: 0,
    runsRemoved: 0
  };
  if (sourceAliases.length === 0) return emptyResult;

  const affectedRuleIdsQuery = KnowledgeRuleEvidenceV3.distinct('ruleId', {
    sourceId: { $in: sourceAliases }
  });
  if (session) affectedRuleIdsQuery.session(session);
  const affectedRuleIds = await affectedRuleIdsQuery;

  const evidenceDelete = await KnowledgeRuleEvidenceV3.deleteMany(
    { sourceId: { $in: sourceAliases } },
    session ? { session } : {}
  );
  emptyResult.evidenceRemoved = evidenceDelete.deletedCount || 0;

  const rulesQuery = KnowledgeRuleV3.find({
    $or: [
      { _id: { $in: affectedRuleIds } },
      { 'compositeComponents.sourceRuleId': { $in: affectedRuleIds } },
    ],
  });
  if (session) rulesQuery.session(session);
  const affectedRules = await rulesQuery;

  for (const rule of affectedRules) {
    const evidenceOwnerIds = [
      rule._id,
      ...(rule.compositeComponents || []).map(component => component.sourceRuleId),
    ];
    const evidenceQuery = KnowledgeRuleEvidenceV3.find({ ruleId: { $in: evidenceOwnerIds } });
    if (session) evidenceQuery.session(session);
    const remainingEvidence = await evidenceQuery.lean();
    if (remainingEvidence.length === 0) {
      const deleted = await KnowledgeRuleV3.deleteOne(
        { _id: rule._id },
        session ? { session } : {}
      );
      emptyResult.rulesRemoved += deleted.deletedCount || 0;
      continue;
    }

    const sourceScore = scoreRuleV3Aggregate(rule, remainingEvidence).score;
    const score = applyStoredValidationAdjustment(sourceScore, rule);
    rule.sourceEvidenceScore = sourceScore.evidenceScore;
    rule.evidenceScore = score.evidenceScore;
    rule.certaintyTier = score.evidenceScore >= 85
      ? 'strong'
      : score.evidenceScore >= 65
        ? 'moderate'
        : score.evidenceScore >= 45
          ? 'limited'
          : 'weak';
    rule.supportingSourceCount = score.supportingSourceCount;
    rule.contradictingSourceCount = score.contradictingSourceCount;
    if (rule.status === 'verified' && !score.oracleEligible) {
      rule.status = 'pending';
      rule.embedding = undefined;
      rule.embeddingModel = undefined;
    }
    await rule.save(session ? { session } : undefined);
    emptyResult.rulesRescored += 1;
  }

  if (options.deleteRunHistory) {
    const runDelete = await AcademicRuleExtractionRunV3.deleteMany(
      { academicSourceId: { $in: sourceAliases } },
      session ? { session } : {}
    );
    emptyResult.runsRemoved = runDelete.deletedCount || 0;
  }

  return emptyResult;
}
