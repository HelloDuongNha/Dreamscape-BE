import { Types } from 'mongoose';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import {
  canonicalizeOracleEvidenceClaim,
  cleanOracleEvidenceClaim,
  isSourceSearchableOracleEvidenceClaim,
  normalizeOracleEvidenceText,
} from '../../../../shared/evidence/evidenceClaim';
import { oracleEvidenceClaimClusterKey } from '../../../../shared/evidence/evidenceClaimMatching';

export async function pruneNonResearchableOracleEvidenceGaps(): Promise<void> {
  const rows = await OracleEvidenceGap.find({})
    .select(
      '_id userId claim normalizedClaim relatedClaims occurrenceTurnIds occurrenceDreamIds '
      + 'occurrenceCount status candidateRuleIds resolvedRuleIds',
    )
    .lean();
  const invalidIds: Types.ObjectId[] = [];
  const sanitizedRows: any[] = [];
  for (const gap of rows) {
    const validClaims = [...new Set([gap.claim, ...(gap.relatedClaims || [])])]
      .map((claim) => cleanOracleEvidenceClaim(String(claim || '')))
      .filter(isSourceSearchableOracleEvidenceClaim);
    if (!validClaims.length) {
      invalidIds.push(gap._id as Types.ObjectId);
      continue;
    }
    const claim = canonicalizeOracleEvidenceClaim(validClaims[0]);
    const normalizedClaim = oracleEvidenceClaimClusterKey(claim)
      || normalizeOracleEvidenceText(claim);
    sanitizedRows.push({
      ...gap,
      claim,
      normalizedClaim,
      relatedClaims: validClaims.filter((candidate) =>
        oracleEvidenceClaimClusterKey(candidate) === normalizedClaim),
    });
  }
  if (invalidIds.length) {
    await OracleEvidenceGap.deleteMany({ _id: { $in: invalidIds } });
  }
  await mergeEquivalentEvidenceGaps(sanitizedRows);
}

async function mergeEquivalentEvidenceGaps(rows: any[]): Promise<void> {
  const groups = new Map<string, any[]>();
  for (const gap of rows) {
    const key = `${String(gap.userId)}:${gap.normalizedClaim}`;
    groups.set(key, [...(groups.get(key) || []), gap]);
  }
  for (const equivalentGaps of groups.values()) {
    const [primary, ...duplicates] = equivalentGaps;
    const all = [primary, ...duplicates];
    const occurrenceTurnIds = [...new Set(all.flatMap((gap) =>
      (gap.occurrenceTurnIds || []).map(String)))];
    const occurrenceDreamIds = [...new Set(all.flatMap((gap) =>
      (gap.occurrenceDreamIds || []).map(String)))];
    await OracleEvidenceGap.updateOne(
      { _id: primary._id },
      {
        $set: {
          claim: primary.claim,
          normalizedClaim: primary.normalizedClaim,
          relatedClaims: [...new Set(all.flatMap((gap) => gap.relatedClaims || []))],
          occurrenceTurnIds,
          occurrenceDreamIds,
          occurrenceCount: occurrenceTurnIds.length + occurrenceDreamIds.length,
          status: all.some((gap) => gap.status === 'resolved')
            ? 'resolved'
            : all.some((gap) => gap.status === 'candidate_found')
              ? 'candidate_found'
              : 'unresolved',
          candidateRuleIds: [...new Set(all.flatMap((gap) =>
            (gap.candidateRuleIds || []).map(String)))],
          resolvedRuleIds: [...new Set(all.flatMap((gap) =>
            (gap.resolvedRuleIds || []).map(String)))],
        },
      },
    );
    if (duplicates.length) {
      await OracleEvidenceGap.deleteMany({
        _id: { $in: duplicates.map((gap) => gap._id) },
      });
    }
  }
}
