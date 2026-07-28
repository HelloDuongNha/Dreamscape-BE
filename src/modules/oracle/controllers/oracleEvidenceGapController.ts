import { Request, Response } from 'express';
import OracleEvidenceGap from '../models/OracleEvidenceGap';
import KnowledgeRuleV3 from '../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../rules_v3/models/KnowledgeRuleEvidence';
import AcademicSource from '../../academic/models/AcademicSource';
import {
  canonicalizeOracleEvidenceClaim,
  evidenceGapRuleSimilarity,
  isResearchableOracleEvidenceClaim,
  localizeOracleEvidenceClaim,
  oracleEvidenceClaimClusterKey,
} from '../services/oracleEvidenceGap.service';
import { loadOracleEvidenceUsageExcerpts } from '../services/oracleEvidenceUsage.service';

export async function listOracleEvidenceGaps(req: Request, res: Response): Promise<void> {
  const requestedStatus = String(req.query.status || 'active');
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
  const statusFilter = requestedStatus === 'active'
    ? { $in: ['unresolved', 'candidate_found'] }
    : ['unresolved', 'candidate_found', 'resolved'].includes(requestedStatus)
      ? requestedStatus
      : { $in: ['unresolved', 'candidate_found'] };
  const filter: Record<string, unknown> = { status: statusFilter };

  const rows = await OracleEvidenceGap.find(filter as any)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(500)
    .lean();
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
    const storedOccurrences = Math.max(1, Number(gap.occurrenceCount) || 1);
    if (!existing) {
      grouped.set(fingerprint, {
        ...gap,
        claim: canonicalClaim,
        occurrenceCount: storedOccurrences,
        relatedClaims: storedClaims,
      });
      continue;
    }
    existing.occurrenceCount += storedOccurrences;
    existing.relatedClaims = [...new Set([...existing.relatedClaims, ...storedClaims])];
    existing.occurrenceTurnIds = [...new Set([
      ...(existing.occurrenceTurnIds || []).map(String),
      ...(gap.occurrenceTurnIds || []).map(String),
      String(gap.turnId),
    ])];
    if (canonicalClaim.length < existing.claim.length) {
      existing.claim = canonicalClaim;
      existing.turnId = gap.turnId;
    }
    existing.candidateRuleIds = [...new Set([
      ...existing.candidateRuleIds.map(String),
      ...gap.candidateRuleIds.map(String),
    ])];
    existing.resolvedRuleIds = [...new Set([
      ...existing.resolvedRuleIds.map(String),
      ...gap.resolvedRuleIds.map(String),
    ])];
    if (gap.status === 'resolved') {
      existing.status = 'resolved';
      existing.resolvedAt = gap.resolvedAt || existing.resolvedAt;
      existing.resolutionCitationIndex = gap.resolutionCitationIndex || existing.resolutionCitationIndex;
    } else if (gap.status === 'candidate_found' && existing.status === 'unresolved') {
      existing.status = 'candidate_found';
    }
  }
  const allGaps = [...grouped.values()];
  const total = allGaps.length;
  const gaps = allGaps.slice((page - 1) * limit, page * limit);
  const ruleIds = [...new Set(gaps.flatMap((gap) => [
    ...gap.candidateRuleIds.map(String),
    ...gap.resolvedRuleIds.map(String),
  ]))];
  const rules = await KnowledgeRuleV3.find({ _id: { $in: ruleIds } })
    .select('_id ruleCode statement subject outcome evidenceScore supportingSourceCount status compositeComponents')
    .lean();
  const ruleMap = new Map(rules.map((rule) => [String(rule._id), rule]));
  const evidenceOwnerIds = [...new Set(rules.flatMap((rule) => [
    String(rule._id),
    ...(rule.compositeComponents || []).map((component) => String(component.sourceRuleId)),
  ]))];
  const evidenceRows = await KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: evidenceOwnerIds },
    stance: 'supports',
  }).sort({ verificationScore: -1, createdAt: 1 }).lean();
  const evidenceSourceIds = [...new Set(evidenceRows.map((evidence) => String(evidence.sourceId)))];
  const academicSources = await AcademicSource.find({
    $or: [
      { _id: { $in: evidenceSourceIds } },
      { sourceContributionId: { $in: evidenceSourceIds } },
    ],
  }).select('_id sourceContributionId title year').lean();
  const sourceByEvidenceId = new Map<string, typeof academicSources[number]>();
  for (const source of academicSources) {
    sourceByEvidenceId.set(String(source._id), source);
    sourceByEvidenceId.set(String(source.sourceContributionId), source);
  }
  const usageExcerptsByGapId = await loadOracleEvidenceUsageExcerpts(gaps);
  const resolvedSourcesForGap = (gap: any) => {
    const sources = gap.resolvedRuleIds.flatMap((id: unknown) => {
      const rule = ruleMap.get(String(id));
      if (!rule) return [];
      const ruleText = [rule.statement, rule.subject, rule.outcome].filter(Boolean).join(' ');
      if (evidenceGapRuleSimilarity(gap.claim, ruleText) < 0.5) return [];
      const ownerIds = new Set([
        String(rule._id),
        ...(rule.compositeComponents || []).map((component) => String(component.sourceRuleId)),
      ]);
      const evidence = evidenceRows
        .filter((item) => ownerIds.has(String(item.ruleId)))
        .map((item) => ({
          item,
          similarity: evidenceGapRuleSimilarity(gap.claim, String(item.exactQuote || '')),
        }))
        .filter((candidate) => candidate.similarity >= 0.5)
        .sort((left, right) => right.similarity - left.similarity)[0]?.item;
      const source = evidence ? sourceByEvidenceId.get(String(evidence.sourceId)) : null;
      if (!evidence || !source) return [];
      return [{
        sourceId: String(source._id),
        title: source.title || 'Academic source',
        year: source.year || null,
        excerpt: evidence.exactQuote,
        ruleId: String(rule._id),
      }];
    });
    return [...new Map(sources.map((source: any) => [source.sourceId, source])).values()];
  };
  const resolvedRulesForGap = (gap: any) => gap.resolvedRuleIds
    .map((id: unknown) => ruleMap.get(String(id)))
    .filter((rule: any) => {
      if (!rule) return false;
      const ruleText = [rule.statement, rule.subject, rule.outcome].filter(Boolean).join(' ');
      return evidenceGapRuleSimilarity(gap.claim, ruleText) >= 0.5;
    });
  res.status(200).json({
    success: true,
    data: {
      gaps: gaps.map((gap) => {
        const relatedClaims = gap.relatedClaims
          .map((claim: string) => canonicalizeOracleEvidenceClaim(claim))
          .filter((claim: string, index: number, claims: string[]) => claims.indexOf(claim) === index);
        const localizedClaim = localizeOracleEvidenceClaim(gap.claim);
        return {
          _id: String(gap._id),
          status: gap.status,
          claim: canonicalizeOracleEvidenceClaim(gap.claim),
          claimKey: localizedClaim.key,
          localizedClaims: {
            vi: localizedClaim.vi,
            en: localizedClaim.en,
          },
          candidateRules: gap.candidateRuleIds.map((id: unknown) => ruleMap.get(String(id))).filter(Boolean),
          resolvedRules: resolvedRulesForGap(gap),
          resolvedSources: resolvedSourcesForGap(gap),
          usageExcerpts: usageExcerptsByGapId.get(String(gap._id)) || [],
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
      }),
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}
