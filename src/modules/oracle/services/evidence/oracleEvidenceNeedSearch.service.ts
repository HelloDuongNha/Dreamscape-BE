import { inferDocumentLanguage } from '../../../rules_v3/services/planning/documentLanguage.service';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import { isResearchableOracleEvidenceClaim } from './oracleEvidenceClaim.service';
import { localizeOracleEvidenceClaim } from './oracleEvidenceLocalization.service';
import { evidenceGapRuleSimilarity } from './oracleEvidenceMatching.service';

export async function findOracleEvidenceNeedsForTexts(
  texts: string[],
  limit = 8,
  sourceLanguage = 'en',
): Promise<Array<{ gapId: string; claim: string; similarity: number }>> {
  const searchableText = texts
    .map((text) => String(text || '').replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!searchableText) return [];
  const gaps = await OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .select('_id claim')
    .lean();
  const wantsVietnamese = sourceLanguage.toLowerCase().startsWith('vi');
  const matches = gaps
    .filter((gap) => isResearchableOracleEvidenceClaim(String(gap.claim || '')))
    .map((gap) => {
      const localized = localizeOracleEvidenceClaim(String(gap.claim || ''));
      return {
        gapId: String(gap._id),
        claimKey: localized.key,
        claim: wantsVietnamese ? localized.vi : localized.en,
        similarity: evidenceGapRuleSimilarity(String(gap.claim || ''), searchableText),
      };
    })
    .filter((match) => wantsVietnamese || inferDocumentLanguage([match.claim]) !== 'vi')
    .filter((match) => match.similarity >= 0.28)
    .sort((left, right) => right.similarity - left.similarity);
  const deduplicated = new Map<string, typeof matches[number]>();
  for (const match of matches) {
    if (!deduplicated.has(match.claimKey)) deduplicated.set(match.claimKey, match);
  }
  return [...deduplicated.values()]
    .slice(0, Math.max(0, Math.min(20, limit)))
    .map(({ gapId, claim, similarity }) => ({ gapId, claim, similarity }));
}
