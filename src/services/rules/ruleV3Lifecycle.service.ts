import mongoose, { ClientSession } from 'mongoose';
import AcademicSource from '../../models/AcademicSource';
import AcademicRuleExtractionRunV3 from '../../models/rulesV3/AcademicRuleExtractionRun';
import KnowledgeRuleV3 from '../../models/rulesV3/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/rulesV3/KnowledgeRuleEvidence';
import { scoreRuleV3 } from './ruleV3Scoring.service';

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

/**
 * Resolve the approved-source/contribution aliases that may both own evidence
 * for the same academic source lifecycle.
 */
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

/**
 * Remove evidence owned by a source without deleting a shared rule that still
 * has evidence from another source. Remaining shared rules are rescored and a
 * verified rule is demoted when its surviving evidence is no longer eligible.
 */
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

  for (const ruleId of affectedRuleIds) {
    const evidenceQuery = KnowledgeRuleEvidenceV3.find({ ruleId });
    if (session) evidenceQuery.session(session);
    const remainingEvidence = await evidenceQuery.lean();
    if (remainingEvidence.length === 0) {
      const deleted = await KnowledgeRuleV3.deleteOne(
        { _id: ruleId },
        session ? { session } : {}
      );
      emptyResult.rulesRemoved += deleted.deletedCount || 0;
      continue;
    }

    const ruleQuery = KnowledgeRuleV3.findById(ruleId);
    if (session) ruleQuery.session(session);
    const rule = await ruleQuery;
    if (!rule) continue;
    const score = scoreRuleV3(rule, remainingEvidence);
    rule.evidenceScore = score.evidenceScore;
    rule.certaintyTier = score.certaintyTier;
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
