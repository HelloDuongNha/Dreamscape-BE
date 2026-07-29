import mongoose from 'mongoose';
import AcademicChunk from '../../../academic/models/AcademicChunk';
import AcademicSource from '../../../academic/models/AcademicSource';
import { getOracleEvidenceGapMatchesForRule } from '../../../oracle/services/evidence/oracleEvidenceReconciliation.service';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import type { RuleV3CandidateQuery } from '../../dto/ruleV3Request.dto';
import { buildRuleV3NameRegex } from '../../dto/ruleV3Request.dto';
import { getRuleValidationStats } from '../evidence/ruleV3ValidationScore.service';
import { mapRuleV3Candidate } from './ruleV3CandidatePresentation.service';
import { groupRuleV3EvidenceExcerpts } from './ruleV3EvidencePresentation.service';
import { loadRuleV3CandidateRelationships } from './ruleV3CandidateRelationship.service';
import { loadRuleV3SourceSummaries } from './ruleV3SourceSummary.service';

/** Loads the complete moderation list, including source and score projections. */
export async function readRuleV3Candidates(input: RuleV3CandidateQuery) {
  const status = input.status === 'approved' ? 'verified' : input.status;
  const filter: any = { status };
  const nameRegex = input.nameQuery ? buildRuleV3NameRegex(input.nameQuery) : null;
  if (nameRegex) filter.statement = { $regex: nameRegex };
  if (input.sourceId) {
    filter._id = {
      $in: await KnowledgeRuleEvidenceV3.distinct(
        'ruleId',
        { sourceId: { $in: await resolveSourceAliases(input.sourceId) } },
      ),
    };
  }

  const rules = await KnowledgeRuleV3.find(filter).sort({ createdAt: -1 }).lean();
  const evidenceOwnerIds = rules.flatMap(rule => [
    rule._id,
    ...(rule.compositeComponents || []).map((component: any) => component.sourceRuleId),
  ]);
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: evidenceOwnerIds } })
    .select('ruleId sourceId chunkId stance exactness verificationScore exactQuote researchType researchTypeConfidence sourceQuality')
    .lean();
  const evidenceByRule = groupEvidenceByRule(evidence);
  const sourceSummaries = await loadRuleV3SourceSummaries(
    evidence.map(item => String(item.sourceId)),
  );
  const validationStats = await getRuleValidationStats(rules.map(rule => String(rule._id)));

  return rules.map(rule => {
    const ownerIds = [
      String(rule._id),
      ...(rule.compositeComponents || []).map(
        (component: any) => String(component.sourceRuleId),
      ),
    ];
    const ruleEvidence = ownerIds.flatMap(ownerId => evidenceByRule.get(ownerId) || []);
    const source = sourceSummaries.get(String(ruleEvidence[0]?.sourceId || input.sourceId || ''));
    return {
      ...mapRuleV3Candidate(rule, source, ruleEvidence),
      validationStats: validationStats.get(String(rule._id)),
    };
  }).filter(candidate => !nameRegex || nameRegex.test(candidate.label));
}

/** Loads one candidate detail and all evidence-gap relationships used by review UI. */
export async function readRuleV3CandidateDetail(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('candidate_not_found');
  const rule = await KnowledgeRuleV3.findById(id).lean();
  if (!rule) throw new Error('candidate_not_found');

  const componentRuleIds = (rule.compositeComponents || [])
    .map((component: any) => component.sourceRuleId)
    .filter((componentId: unknown) => componentId && String(componentId) !== String(rule._id));
  const feedbackRuleIds = [rule._id, ...componentRuleIds];
  const evidence = await KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: feedbackRuleIds },
  }).sort({ createdAt: 1 }).lean();
  const chunks = await AcademicChunk.find({
    _id: { $in: evidence.map(item => item.chunkId) },
  }).lean();
  const chunkMap = new Map(chunks.map(chunk => [String(chunk._id), chunk]));
  const sourceSummaries = await loadRuleV3SourceSummaries(
    evidence.map(item => String(item.sourceId)),
  );
  const source = sourceSummaries.get(String(evidence[0]?.sourceId || ''));
  const validationStats = await getRuleValidationStats([String(rule._id)]);
  const candidate = {
    ...mapRuleV3Candidate(rule, source, evidence),
    validationStats: validationStats.get(String(rule._id)),
  };
  const [evidenceGapMatches, ruleRelationships] = await Promise.all([
    getOracleEvidenceGapMatchesForRule({
      _id: rule._id,
      statement: rule.statement,
      subject: rule.subject,
      outcome: rule.outcome,
      status: rule.status,
      evidenceScore: rule.evidenceScore,
      supportingSourceCount: rule.supportingSourceCount,
      compositeComponents: rule.compositeComponents,
    }),
    loadRuleV3CandidateRelationships(rule, feedbackRuleIds, evidence),
  ]);

  return {
    candidate,
    evidenceGapMatches,
    ruleRelationships,
    evidenceChunks: chunks.map((chunk: any) => ({
      chunkId: String(chunk._id),
      sectionTitle: chunk.sectionTitle,
      sectionType: chunk.sectionType || chunk.blockType || 'paragraph',
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      sourceOrder: chunk.chunkOrder,
      chunkPreview: String(chunk.text || '').slice(0, 2000),
    })),
    evidenceExcerpts: groupRuleV3EvidenceExcerpts(evidence, chunkMap, sourceSummaries),
  };
}

async function resolveSourceAliases(sourceId: string): Promise<mongoose.Types.ObjectId[]> {
  if (!mongoose.Types.ObjectId.isValid(sourceId)) throw new Error('invalid_source_id');
  const requestedId = new mongoose.Types.ObjectId(sourceId);
  const aliases = [requestedId];
  const [approvedById, approvedByContribution] = await Promise.all([
    AcademicSource.findById(requestedId).select('sourceContributionId').lean(),
    AcademicSource.findOne({ sourceContributionId: requestedId }).select('_id').lean(),
  ]);
  if (approvedById?.sourceContributionId) aliases.push(approvedById.sourceContributionId);
  if (approvedByContribution?._id) aliases.push(approvedByContribution._id);
  return aliases;
}

function groupEvidenceByRule(evidence: any[]) {
  const evidenceByRule = new Map<string, any[]>();
  for (const item of evidence) {
    const key = String(item.ruleId);
    const rows = evidenceByRule.get(key) || [];
    rows.push(item);
    evidenceByRule.set(key, rows);
  }
  return evidenceByRule;
}
