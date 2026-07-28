import mongoose from 'mongoose';
import OracleEvidenceGap from '../../../oracle/models/OracleEvidenceGap';
import { localizeOracleEvidenceClaim } from '../../../oracle/services/oracleEvidenceGap.service';
import AcademicRuleExtractionRunV3 from '../../models/AcademicRuleExtractionRun';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import { resolveRuleV3SourceAliases } from '../lifecycle/ruleV3Lifecycle.service';

export async function getRuleV3SourceSummary(inputId: string) {
  if (!mongoose.Types.ObjectId.isValid(inputId)) throw new Error('invalid_source_id');

  const sourceAliases = await resolveRuleV3SourceAliases(inputId);
  const ruleIds = await KnowledgeRuleEvidenceV3.distinct('ruleId', { sourceId: { $in: sourceAliases } });
  const [counts, evidenceGapMatches, evidenceGapDetails, runDocuments] = await Promise.all([
    loadRuleStatusCounts(ruleIds),
    loadEvidenceGapStatusCounts(ruleIds),
    loadEvidenceGapDetails(ruleIds),
    AcademicRuleExtractionRunV3.find({ academicSourceId: { $in: sourceAliases } })
      .sort({ startedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const latestRun = runDocuments[0] || null;
  const evidenceChunkIds = latestRun
    ? await KnowledgeRuleEvidenceV3.distinct('chunkId', {
      extractionRunId: latestRun._id,
      sourceId: { $in: sourceAliases },
    })
    : [];
  const runHistory = buildRunHistory(runDocuments, latestRun, evidenceChunkIds.length);

  return {
    counts,
    evidenceGapMatches,
    evidenceGapDetails,
    totalRuleCount: counts.pending + counts.verified + counts.rejected + counts.retired,
    runHistory,
    latestRun: latestRun ? mapLatestRun(latestRun, evidenceChunkIds.length) : null,
  };
}

async function loadRuleStatusCounts(ruleIds: mongoose.Types.ObjectId[]) {
  const rows = ruleIds.length > 0
    ? await KnowledgeRuleV3.aggregate<{ _id: string; count: number }>([
      { $match: { _id: { $in: ruleIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    : [];
  const counts = { pending: 0, verified: 0, rejected: 0, retired: 0 };
  for (const row of rows) {
    if (row._id in counts) counts[row._id as keyof typeof counts] = row.count;
  }
  return counts;
}

async function loadEvidenceGapStatusCounts(ruleIds: mongoose.Types.ObjectId[]) {
  const rows = ruleIds.length > 0
    ? await OracleEvidenceGap.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          $or: [
            { candidateRuleIds: { $in: ruleIds } },
            { resolvedRuleIds: { $in: ruleIds } },
          ],
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    : [];
  const matches = { candidateFound: 0, resolved: 0 };
  for (const row of rows) {
    if (row._id === 'candidate_found') matches.candidateFound = row.count;
    if (row._id === 'resolved') matches.resolved = row.count;
  }
  return matches;
}

async function loadEvidenceGapDetails(ruleIds: mongoose.Types.ObjectId[]) {
  if (ruleIds.length === 0) return [];

  const sourceRuleIds = new Set(ruleIds.map(ruleId => String(ruleId)));
  const gaps = await OracleEvidenceGap.find({
    $or: [
      { candidateRuleIds: { $in: ruleIds } },
      { resolvedRuleIds: { $in: ruleIds } },
    ],
  })
    .select('claim status occurrenceCount candidateRuleIds resolvedRuleIds updatedAt')
    .sort({ status: 1, updatedAt: -1 })
    .limit(100)
    .lean();
  const matchedRuleIds = [...new Set(gaps.flatMap(gap => [
    ...(gap.candidateRuleIds || []),
    ...(gap.resolvedRuleIds || []),
  ].map(ruleId => String(ruleId)).filter(ruleId => sourceRuleIds.has(ruleId))))];
  const rules = matchedRuleIds.length > 0
    ? await KnowledgeRuleV3.find({ _id: { $in: matchedRuleIds } })
      .select('ruleCode statement status evidenceScore')
      .lean()
    : [];
  const ruleById = new Map(rules.map(rule => [String(rule._id), rule]));

  return gaps.map(gap => {
    const resolvedIds = new Set((gap.resolvedRuleIds || []).map(ruleId => String(ruleId)));
    const relevantRuleIds = [...new Set([
      ...(gap.candidateRuleIds || []),
      ...(gap.resolvedRuleIds || []),
    ].map(ruleId => String(ruleId)).filter(ruleId => sourceRuleIds.has(ruleId)))];
    return {
      gapId: String(gap._id),
      claim: gap.claim,
      localizedClaim: localizeOracleEvidenceClaim(String(gap.claim || '')),
      status: gap.status,
      occurrenceCount: gap.occurrenceCount || 1,
      rules: relevantRuleIds.flatMap(ruleId => {
        const rule = ruleById.get(ruleId);
        return rule ? [{
          ruleId,
          ruleCode: rule.ruleCode,
          statement: rule.statement,
          status: rule.status,
          evidenceScore: rule.evidenceScore,
          resolutionRole: resolvedIds.has(ruleId) ? 'resolved' : 'candidate',
        }] : [];
      }),
    };
  }).filter(item => item.rules.length > 0);
}

function buildRunHistory(runDocuments: any[], latestRun: any, latestEvidenceChunkCount: number) {
  return runDocuments.flatMap(run => {
    const current = [mapRunHistoryEntry(run, String(run._id), latestRun, latestEvidenceChunkCount)];
    const archived = (run.attemptHistory || []).map((attempt: any, index: number) => ({
      ...mapRunHistoryEntry(attempt, `${String(run._id)}:history:${index}`, null, 0),
      evidenceChunkCount: Number.isFinite(attempt.evidenceChunkCount) ? attempt.evidenceChunkCount : null,
    }));
    return [...current, ...archived];
  })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 10);
}

function mapRunHistoryEntry(run: any, runId: string, latestRun: any, latestEvidenceChunkCount: number) {
  return {
    runId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
    durationMs: calculateDuration(run),
    generationModel: run.generationModel,
    targetChunkCount: Number.isFinite(run.targetChunkCount) ? run.targetChunkCount : null,
    evidenceChunkCount: Number.isFinite(run.evidenceChunkCount)
      ? run.evidenceChunkCount
      : (String(run._id) === String(latestRun?._id) ? latestEvidenceChunkCount : null),
    totalBatches: run.totalBatches,
    processedBatches: run.processedBatches,
    rawCandidateCount: run.rawCandidateCount,
    verifiedCandidateCount: run.verifiedCandidateCount,
    savedCandidateCount: run.savedCandidateCount,
    mergedCandidateCount: run.mergedCandidateCount,
    rejectedCandidateCount: run.rejectedCandidateCount,
    sanitizedErrorCode: run.sanitizedErrorCode || null,
    rejectionDiagnostics: run.rejectionDiagnostics || [],
  };
}

function mapLatestRun(run: any, evidenceChunkCount: number) {
  return {
    ...mapRunHistoryEntry(run, String(run._id), run, evidenceChunkCount),
    evidenceChunkCount: Number.isFinite(run.evidenceChunkCount)
      ? run.evidenceChunkCount
      : evidenceChunkCount,
  };
}

function calculateDuration(run: any): number | null {
  return run.finishedAt && run.startedAt
    ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
    : null;
}
