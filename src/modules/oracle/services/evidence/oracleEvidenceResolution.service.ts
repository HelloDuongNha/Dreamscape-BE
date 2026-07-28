import KnowledgeRuleV3 from '../../../rules_v3/models/KnowledgeRule';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import { resolveEvidenceGapInDreamPosts } from './oracleEvidenceDreamResolution.service';
import {
  findGroundedRuleForClaim,
  type EvidenceGapRuleInput,
} from './oracleEvidenceRuleSupport.service';
import { resolveEvidenceGapInOracleTurns } from './oracleEvidenceTurnResolution.service';

export async function resolveCapturedEvidenceGap(
  gap: any,
  preferredRule?: EvidenceGapRuleInput | null,
): Promise<void> {
  const rule = await resolveRule(gap, preferredRule);
  if (!rule) return;
  const [citationIndex, resolvedDreamCount] = await Promise.all([
    resolveEvidenceGapInOracleTurns(gap, rule),
    resolveEvidenceGapInDreamPosts(gap, rule),
  ]);
  if (!citationIndex && resolvedDreamCount === 0) return;
  await OracleEvidenceGap.updateOne(
    { _id: gap._id },
    {
      $set: {
        status: 'resolved',
        resolvedAt: gap.resolvedAt || new Date(),
        ...(citationIndex ? { resolutionCitationIndex: citationIndex } : {}),
      },
      $addToSet: { resolvedRuleIds: rule._id },
    },
  );
}

async function resolveRule(
  gap: any,
  preferredRule?: EvidenceGapRuleInput | null,
): Promise<EvidenceGapRuleInput | null> {
  if (preferredRule) return preferredRule;
  if (gap.resolvedRuleIds?.length) {
    const storedRule = await KnowledgeRuleV3.findById(gap.resolvedRuleIds[0])
      .lean() as EvidenceGapRuleInput | null;
    if (storedRule) return storedRule;
  }
  return findGroundedRuleForClaim(String(gap.claim || ''));
}
