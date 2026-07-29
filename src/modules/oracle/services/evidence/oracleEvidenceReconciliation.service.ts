import { Types } from 'mongoose';
import KnowledgeRuleV3 from '../../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../../rules_v3/models/KnowledgeRuleEvidence';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import {
  isSourceSearchableOracleEvidenceClaim,
} from '../../../../shared/evidence/evidenceClaim';
import {
  resolveEvidenceGapInDreamPosts,
} from '../../../dream/services/analysis/evidence/dreamCitationResolution.service';
import { localizeOracleEvidenceClaim, type LocalizedOracleEvidenceClaim } from './oracleEvidenceLocalization.service';
import { pruneNonResearchableOracleEvidenceGaps } from './oracleEvidenceMaintenance.service';
import { evidenceGapRuleSimilarity } from '../../../../shared/evidence/evidenceClaimMatching';
import {
  buildEvidenceGapRuleText,
  CANDIDATE_CLAIM_MATCH,
  DIRECT_CLAIM_MATCH,
  type EvidenceGapRuleInput,
} from './oracleEvidenceRuleSupport.service';
import { resolveEvidenceGapInOracleTurns } from './oracleEvidenceTurnResolution.service';

export interface OracleEvidenceGapRuleMatch {
  gapId: string;
  claim: LocalizedOracleEvidenceClaim;
  status: 'unresolved' | 'candidate_found' | 'resolved';
  occurrenceCount: number;
  similarity: number;
  linkedAsCandidate: boolean;
  resolvedByRule: boolean;
  resolutionReady: boolean;
  blockers: Array<'similarity'>;
}

export async function reconcileOracleEvidenceGapsForRule(
  rule: EvidenceGapRuleInput,
): Promise<void> {
  const ruleText = buildEvidenceGapRuleText(rule);
  if (!ruleText) return;
  const cursor = OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .cursor();
  for await (const gap of cursor) {
    if (evidenceGapRuleSimilarity(gap.claim, ruleText) < CANDIDATE_CLAIM_MATCH) continue;
    if (rule.status !== 'verified') {
      await markEvidenceGapCandidate(gap._id, [rule._id]);
      continue;
    }
    await reconcileGapWithRule(gap, rule, [rule._id], false);
  }
}

export async function getOracleEvidenceGapMatchesForRule(
  rule: EvidenceGapRuleInput,
): Promise<OracleEvidenceGapRuleMatch[]> {
  const ruleText = buildEvidenceGapRuleText(rule);
  if (!ruleText) return [];
  const gaps = await OracleEvidenceGap.find({
    $or: [{ status: { $ne: 'resolved' } }, { resolvedRuleIds: rule._id }],
  })
    .sort({ updatedAt: -1 })
    .select('_id claim status occurrenceCount candidateRuleIds resolvedRuleIds')
    .lean();
  return gaps
    .map((gap) => presentRuleMatch(gap, rule, ruleText))
    .filter((match): match is OracleEvidenceGapRuleMatch => Boolean(match))
    .sort((left, right) => Number(right.resolvedByRule) - Number(left.resolvedByRule)
      || Number(right.linkedAsCandidate) - Number(left.linkedAsCandidate)
      || right.similarity - left.similarity)
    .slice(0, 12);
}

export async function reconcileOracleEvidenceGapsForRules(
  rules: EvidenceGapRuleInput[],
): Promise<void> {
  await pruneNonResearchableOracleEvidenceGaps();
  if (!rules.length) return;
  const cursor = OracleEvidenceGap.find({ status: { $ne: 'resolved' } })
    .sort({ updatedAt: -1 })
    .cursor();
  for await (const gap of cursor) {
    const matches = rules
      .map((rule) => ({
        rule,
        similarity: evidenceGapRuleSimilarity(gap.claim, buildEvidenceGapRuleText(rule)),
      }))
      .filter((match) => match.similarity >= CANDIDATE_CLAIM_MATCH)
      .sort((left, right) => right.similarity - left.similarity);
    if (!matches.length) continue;
    const resolvable = matches.find((match) =>
      match.rule.status === 'verified'
      && match.similarity >= DIRECT_CLAIM_MATCH);
    if (resolvable) {
      const resolved = await reconcileGapWithRule(
        gap,
        resolvable.rule,
        matches.map((match) => match.rule._id),
        true,
      );
      if (resolved) continue;
    }
    await markEvidenceGapCandidate(
      gap._id,
      matches.map((match) => match.rule._id),
    );
  }
}

async function markEvidenceGapCandidate(
  gapId: Types.ObjectId,
  ruleIds: Types.ObjectId[],
): Promise<void> {
  await OracleEvidenceGap.updateOne(
    { _id: gapId },
    {
      $set: { status: 'candidate_found' },
      $addToSet: { candidateRuleIds: { $each: ruleIds } },
    },
  );
}

// Loads newly extracted rules and immediately rematches every unresolved claim.
export async function reconcileOracleEvidenceGapsForRuleIds(
  ruleIds: Array<string | Types.ObjectId>,
): Promise<void> {
  const normalizedRuleIds = ruleIds
    .map(String)
    .filter(Types.ObjectId.isValid)
    .map((ruleId) => new Types.ObjectId(ruleId));
  if (!normalizedRuleIds.length) return;
  const rules = await KnowledgeRuleV3.find({ _id: { $in: normalizedRuleIds } })
    .select(
      '_id ruleCode statement subject outcome conditions dreamFeatureTags '
      + 'status evidenceScore supportingSourceCount compositeComponents',
    )
    .lean() as EvidenceGapRuleInput[];
  await reconcileOracleEvidenceGapsForRules(rules);
}

export async function reconcileOracleEvidenceGapsForSources(
  sourceIds: Array<string | Types.ObjectId>,
): Promise<void> {
  const normalizedSourceIds = sourceIds
    .map(String)
    .filter(Types.ObjectId.isValid)
    .map((sourceId) => new Types.ObjectId(sourceId));
  if (!normalizedSourceIds.length) return;
  const evidence = await KnowledgeRuleEvidenceV3.find({
    sourceId: { $in: normalizedSourceIds },
    stance: 'supports',
  }).select('ruleId').lean();
  const ownerIds = [...new Set(evidence.map((item) => String(item.ruleId)))]
    .map((ruleId) => new Types.ObjectId(ruleId));
  if (!ownerIds.length) return;
  const rules = await KnowledgeRuleV3.find({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: { $in: ownerIds } },
      { 'compositeComponents.sourceRuleId': { $in: ownerIds } },
    ],
  }).select(
    '_id ruleCode statement subject outcome conditions dreamFeatureTags '
    + 'status evidenceScore supportingSourceCount compositeComponents',
  ).lean() as EvidenceGapRuleInput[];
  await reconcileOracleEvidenceGapsForRules(rules);
}

async function reconcileGapWithRule(
  gap: any,
  rule: EvidenceGapRuleInput,
  candidateRuleIds: Types.ObjectId[],
  addCandidatesWhenResolved: boolean,
): Promise<boolean> {
  const [citationIndex, resolvedDreamCount] = await Promise.all([
    resolveEvidenceGapInOracleTurns(gap, rule),
    resolveEvidenceGapInDreamPosts(gap, rule),
  ]);
  if (!citationIndex && resolvedDreamCount === 0) {
    await OracleEvidenceGap.updateOne(
      { _id: gap._id },
      {
        $set: { status: 'candidate_found' },
        $addToSet: { candidateRuleIds: { $each: candidateRuleIds } },
      },
    );
    return false;
  }
  await OracleEvidenceGap.updateOne(
    { _id: gap._id },
    {
      $set: {
        status: 'resolved',
        resolvedAt: new Date(),
        ...(citationIndex ? { resolutionCitationIndex: citationIndex } : {}),
      },
      $addToSet: {
        ...(addCandidatesWhenResolved
          ? { candidateRuleIds: { $each: candidateRuleIds } }
          : {}),
        resolvedRuleIds: rule._id,
      },
    },
  );
  return true;
}

function presentRuleMatch(
  gap: any,
  rule: EvidenceGapRuleInput,
  ruleText: string,
): OracleEvidenceGapRuleMatch | null {
  if (!isSourceSearchableOracleEvidenceClaim(String(gap.claim || ''))) return null;
  const similarity = evidenceGapRuleSimilarity(String(gap.claim || ''), ruleText);
  const linkedAsCandidate = (gap.candidateRuleIds || []).some(
    (id: unknown) => String(id) === String(rule._id));
  const resolvedByRule = (gap.resolvedRuleIds || []).some(
    (id: unknown) => String(id) === String(rule._id));
  if (!linkedAsCandidate && !resolvedByRule && similarity < CANDIDATE_CLAIM_MATCH) return null;
  const blockers: OracleEvidenceGapRuleMatch['blockers'] = [];
  if (similarity < DIRECT_CLAIM_MATCH) blockers.push('similarity');
  return {
    gapId: String(gap._id),
    claim: localizeOracleEvidenceClaim(String(gap.claim || '')),
    status: gap.status,
    occurrenceCount: Number(gap.occurrenceCount || 0),
    similarity,
    linkedAsCandidate,
    resolvedByRule,
    resolutionReady: resolvedByRule || blockers.length === 0,
    blockers,
  };
}
