import { Request, Response } from 'express';
import OracleEvidenceGap from '../models/OracleEvidenceGap';
import KnowledgeRuleV3 from '../models/rulesV3/KnowledgeRule';
import {
  buildOracleEvidenceGapResearchBrief,
  canonicalizeOracleEvidenceClaim,
  isResearchableOracleEvidenceClaim,
  localizeOracleEvidenceClaim,
  oracleEvidenceClaimClusterKey,
} from '../services/oracle/oracleEvidenceGap.service';

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
  }
  const allGaps = [...grouped.values()];
  const total = allGaps.length;
  const gaps = allGaps.slice((page - 1) * limit, page * limit);
  const ruleIds = [...new Set(gaps.flatMap((gap) => [
    ...gap.candidateRuleIds.map(String),
    ...gap.resolvedRuleIds.map(String),
  ]))];
  const rules = await KnowledgeRuleV3.find({ _id: { $in: ruleIds } })
    .select('_id ruleCode statement subject outcome evidenceScore supportingSourceCount status')
    .lean();
  const ruleMap = new Map(rules.map((rule) => [String(rule._id), rule]));

  res.status(200).json({
    success: true,
    data: {
      gaps: gaps.map((gap) => {
        const relatedClaims = gap.relatedClaims
          .map((claim: string) => buildOracleEvidenceGapResearchBrief(claim).claim)
          .filter((claim: string, index: number, claims: string[]) => claims.indexOf(claim) === index);
        return {
          _id: String(gap._id),
          status: gap.status,
          ...buildOracleEvidenceGapResearchBrief(gap.claim, relatedClaims),
          candidateRules: gap.candidateRuleIds.map((id: unknown) => ruleMap.get(String(id))).filter(Boolean),
          resolvedRules: gap.resolvedRuleIds.map((id: unknown) => ruleMap.get(String(id))).filter(Boolean),
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
