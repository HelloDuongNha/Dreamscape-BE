import AcademicSource from '../../../academic/models/AcademicSource';
import KnowledgeRuleV3 from '../../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../rules_v3/models/KnowledgeRuleEvidence';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import { loadOracleEvidenceUsageExcerpts } from './oracleEvidenceUsage.service';
import {
  canonicalizeOracleEvidenceClaim,
  isResearchableOracleEvidenceClaim,
} from './oracleEvidenceClaim.service';
import { localizeOracleEvidenceClaim } from './oracleEvidenceLocalization.service';
import { pruneNonResearchableOracleEvidenceGaps } from './oracleEvidenceMaintenance.service';
import {
  evidenceGapRuleSimilarity,
  oracleEvidenceClaimClusterKey,
} from './oracleEvidenceMatching.service';
import { pruneOrphanedEvidenceOccurrences } from './oracleEvidenceLifecycle.service';

export async function listOracleEvidenceGapRecords(input: {
  status: string;
  page: number;
  limit: number;
}) {
  await pruneOrphanedEvidenceOccurrences();
  await pruneNonResearchableOracleEvidenceGaps();
  const rows = await loadEvidenceGaps(input.status);
  const allGaps = groupEquivalentGaps(rows);
  const gaps = allGaps.slice((input.page - 1) * input.limit, input.page * input.limit);
  const context = await loadEvidenceGapContext(gaps);
  return {
    gaps: gaps.map((gap) => presentEvidenceGap(gap, context)),
    pagination: {
      total: allGaps.length,
      page: input.page,
      limit: input.limit,
      pages: Math.max(1, Math.ceil(allGaps.length / input.limit)),
    },
  };
}

async function loadEvidenceGaps(requestedStatus: string) {
  const status = requestedStatus === 'active'
    ? { $in: ['unresolved', 'candidate_found'] }
    : ['unresolved', 'candidate_found', 'resolved'].includes(requestedStatus)
      ? requestedStatus
      : { $in: ['unresolved', 'candidate_found'] };
  return OracleEvidenceGap.find({ status } as any)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(500)
    .lean();
}

function groupEquivalentGaps(rows: any[]): any[] {
  const grouped = new Map<string, any>();
  for (const gap of rows) {
    const storedClaims = [...new Set([
      gap.claim,
      ...(Array.isArray(gap.relatedClaims) ? gap.relatedClaims : []),
    ])].filter(isResearchableOracleEvidenceClaim);
    if (!storedClaims.length) continue;
    const canonicalClaim = canonicalizeOracleEvidenceClaim(storedClaims[0]);
    const fingerprint = oracleEvidenceClaimClusterKey(canonicalClaim) || gap.normalizedClaim;
    const existing = grouped.get(fingerprint);
    if (!existing) {
      grouped.set(fingerprint, {
        ...gap,
        claim: canonicalClaim,
        occurrenceCount: Math.max(1, Number(gap.occurrenceCount) || 1),
        relatedClaims: storedClaims,
      });
      continue;
    }
    mergeEvidenceGap(existing, gap, canonicalClaim, storedClaims);
  }
  for (const gap of grouped.values()) {
    const turnIds = new Set((gap.occurrenceTurnIds || []).map(String).filter(Boolean));
    const dreamIds = new Set((gap.occurrenceDreamIds || []).map(String).filter(Boolean));
    gap.occurrenceCount = turnIds.size + dreamIds.size;
  }
  return [...grouped.values()];
}

function mergeEvidenceGap(
  target: any,
  gap: any,
  canonicalClaim: string,
  storedClaims: string[],
): void {
  target.relatedClaims = [...new Set([...target.relatedClaims, ...storedClaims])];
  target.occurrenceTurnIds = [...new Set([
    ...(target.occurrenceTurnIds || []).map(String),
    ...(gap.occurrenceTurnIds || []).map(String),
    ...(gap.turnId ? [String(gap.turnId)] : []),
  ].filter(Boolean))];
  target.occurrenceDreamIds = [...new Set([
    ...(target.occurrenceDreamIds || []).map(String),
    ...(gap.occurrenceDreamIds || []).map(String),
  ].filter(Boolean))];
  if (canonicalClaim.length < target.claim.length) {
    target.claim = canonicalClaim;
    target.turnId = gap.turnId;
  }
  target.candidateRuleIds = [...new Set([
    ...target.candidateRuleIds.map(String),
    ...gap.candidateRuleIds.map(String),
  ])];
  target.resolvedRuleIds = [...new Set([
    ...target.resolvedRuleIds.map(String),
    ...gap.resolvedRuleIds.map(String),
  ])];
  if (gap.status === 'resolved') {
    target.status = 'resolved';
    target.resolvedAt = gap.resolvedAt || target.resolvedAt;
    target.resolutionCitationIndex = gap.resolutionCitationIndex || target.resolutionCitationIndex;
  } else if (gap.status === 'candidate_found' && target.status === 'unresolved') {
    target.status = 'candidate_found';
  }
}

async function loadEvidenceGapContext(gaps: any[]) {
  const ruleIds = [...new Set(gaps.flatMap((gap) => [
    ...gap.candidateRuleIds.map(String),
    ...gap.resolvedRuleIds.map(String),
  ]))];
  const rules = await KnowledgeRuleV3.find({ _id: { $in: ruleIds } })
    .select('_id ruleCode statement subject outcome evidenceScore supportingSourceCount status compositeComponents')
    .lean();
  const ruleMap = new Map(rules.map((rule) => [String(rule._id), rule]));
  const ownerIds = [...new Set(rules.flatMap((rule) => [
    String(rule._id),
    ...(rule.compositeComponents || []).map((component) => String(component.sourceRuleId)),
  ]))];
  const evidenceRows = await KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: ownerIds },
    stance: 'supports',
  }).sort({ verificationScore: -1, createdAt: 1 }).lean();
  const sourceIds = [...new Set(evidenceRows.map((evidence) => String(evidence.sourceId)))];
  const sources = await AcademicSource.find({
    $or: [
      { _id: { $in: sourceIds } },
      { sourceContributionId: { $in: sourceIds } },
    ],
  }).select('_id sourceContributionId title year').lean();
  const sourceByEvidenceId = new Map<string, typeof sources[number]>();
  for (const source of sources) {
    sourceByEvidenceId.set(String(source._id), source);
    sourceByEvidenceId.set(String(source.sourceContributionId), source);
  }
  return {
    ruleMap,
    evidenceRows,
    sourceByEvidenceId,
    usageExcerptsByGapId: await loadOracleEvidenceUsageExcerpts(gaps),
  };
}

function presentEvidenceGap(gap: any, context: Awaited<ReturnType<typeof loadEvidenceGapContext>>) {
  const relatedClaims = gap.relatedClaims
    .map((claim: string) => canonicalizeOracleEvidenceClaim(claim))
    .filter((claim: string, index: number, claims: string[]) => claims.indexOf(claim) === index);
  const localizedClaim = localizeOracleEvidenceClaim(gap.claim);
  return {
    _id: String(gap._id),
    status: gap.status,
    claim: canonicalizeOracleEvidenceClaim(gap.claim),
    claimKey: localizedClaim.key,
    localizedClaims: { vi: localizedClaim.vi, en: localizedClaim.en },
    candidateRules: gap.candidateRuleIds.map((id: unknown) =>
      context.ruleMap.get(String(id))).filter(Boolean),
    resolvedRules: resolvedRulesForGap(gap, context.ruleMap),
    resolvedSources: resolvedSourcesForGap(gap, context),
    usageExcerpts: context.usageExcerptsByGapId.get(String(gap._id)) || [],
    resolutionCitationIndex: gap.resolutionCitationIndex || null,
    occurrenceCount: gap.occurrenceCount || 1,
    relatedClaims,
    localizedRelatedClaims: {
      vi: [...new Set(relatedClaims.map((claim: string) => localizeOracleEvidenceClaim(claim).vi))],
      en: [...new Set(relatedClaims.map((claim: string) => localizeOracleEvidenceClaim(claim).en))],
    },
    resolvedAt: gap.resolvedAt || null,
    createdAt: gap.createdAt,
    updatedAt: gap.updatedAt,
  };
}

function resolvedRulesForGap(gap: any, ruleMap: Map<string, any>) {
  return gap.resolvedRuleIds
    .map((id: unknown) => ruleMap.get(String(id)))
    .filter((rule: any) => rule && evidenceGapRuleSimilarity(
      gap.claim,
      [rule.statement, rule.subject, rule.outcome].filter(Boolean).join(' '),
    ) >= 0.5);
}

function resolvedSourcesForGap(
  gap: any,
  context: Awaited<ReturnType<typeof loadEvidenceGapContext>>,
) {
  const sources = gap.resolvedRuleIds.flatMap((id: unknown) => {
    const rule = context.ruleMap.get(String(id));
    if (!rule) return [];
    const ruleText = [rule.statement, rule.subject, rule.outcome].filter(Boolean).join(' ');
    if (evidenceGapRuleSimilarity(gap.claim, ruleText) < 0.5) return [];
    const ownerIds = new Set([
      String(rule._id),
      ...(rule.compositeComponents || []).map((component: any) =>
        String(component.sourceRuleId)),
    ]);
    const evidence = context.evidenceRows
      .filter((item) => ownerIds.has(String(item.ruleId)))
      .filter((item) => String(item.exactQuote || '').trim())
      .map((item) => ({
        item,
        similarity: evidenceGapRuleSimilarity(gap.claim, String(item.exactQuote || '')),
      }))
      .sort((left, right) =>
        Number(right.item.verificationScore || 0) - Number(left.item.verificationScore || 0)
        || right.similarity - left.similarity)[0]?.item;
    const source = evidence
      ? context.sourceByEvidenceId.get(String(evidence.sourceId))
      : null;
    return evidence && source ? [{
      sourceId: String(source._id),
      title: source.title || 'Academic source',
      year: source.year || null,
      excerpt: evidence.exactQuote,
      ruleId: String(rule._id),
    }] : [];
  });
  return [...new Map(sources.map((source: any) => [source.sourceId, source])).values()];
}
