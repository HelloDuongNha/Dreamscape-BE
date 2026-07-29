import { Types } from 'mongoose';
import OracleEvidenceGap from '../../models/OracleEvidenceGap';
import OracleTurn from '../../models/OracleTurn';
import KnowledgeRuleV3 from '../../../rules_v3/models/KnowledgeRule';
import {
  canonicalizeOracleEvidenceClaim,
  cleanOracleEvidenceClaim,
  isResearchableOracleEvidenceClaim,
  normalizeOracleEvidenceText,
  sanitizeOracleUnresolvedMarkers,
} from '../../../../shared/evidence/evidenceClaim';
import { oracleEvidenceClaimClusterKey } from '../../../../shared/evidence/evidenceClaimMatching';
import { removeEvidenceOccurrences } from './oracleEvidenceLifecycle.service';
import { resolveCapturedEvidenceGap } from './oracleEvidenceResolution.service';
import {
  findGroundedRuleForClaim,
  type EvidenceGapRuleInput,
} from './oracleEvidenceRuleSupport.service';
import type { EvidenceClaimBinding } from '../../../../shared/evidence/citationClaim';

export async function captureOracleEvidenceGaps(input: {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  turnId: Types.ObjectId;
  answer: string;
}): Promise<void> {
  const answer = await sanitizeStoredTurn(input.turnId, input.answer);
  await removeEvidenceOccurrences({ turnIds: [input.turnId] });
  await captureEvidenceGaps({
    userId: input.userId,
    threadId: input.threadId,
    turnId: input.turnId,
    occurrenceTurnId: input.turnId,
    answer,
  });
}

export async function captureDreamEvidenceGaps(input: {
  userId: Types.ObjectId;
  dreamId: Types.ObjectId;
  answer: string;
  claimBindings?: EvidenceClaimBinding[];
}): Promise<void> {
  await removeEvidenceOccurrences({ dreamIds: [input.dreamId] });
  const preferredRules = await loadPreferredDreamEvidenceRules(input.claimBindings);
  await captureEvidenceGaps({
    userId: input.userId,
    occurrenceDreamId: input.dreamId,
    answer: input.answer,
    explicitClaims: collectDreamEvidenceClaims(input.claimBindings, input.answer),
    preferredRules,
  });
}

async function captureEvidenceGaps(input: {
  userId: Types.ObjectId;
  threadId?: Types.ObjectId;
  turnId?: Types.ObjectId;
  occurrenceTurnId?: Types.ObjectId;
  occurrenceDreamId?: Types.ObjectId;
  answer: string;
  explicitClaims?: string[];
  preferredRules?: Map<string, EvidenceGapRuleInput>;
}): Promise<void> {
  const claims = input.explicitClaims?.length
    ? groupExplicitResearchableClaims(input.explicitClaims)
    : groupResearchableClaims(input.answer);
  const entries = [...claims];
  const limitedEntries = input.explicitClaims?.length ? entries : entries.slice(0, 4);
  for (const [normalizedClaim, group] of limitedEntries) {
    const { gap, groundedRule } = await upsertEvidenceGap(input, {
      normalizedClaim,
      claim: group.claim,
      variants: [...group.variants],
    }, input.preferredRules?.get(normalizedClaim));
    if (gap) await resolveCapturedEvidenceGap(gap, groundedRule);
  }
}

async function loadPreferredDreamEvidenceRules(
  bindings: EvidenceClaimBinding[] | undefined,
): Promise<Map<string, EvidenceGapRuleInput>> {
  const resolvedBindings = (bindings || []).filter((binding) =>
    binding.status === 'resolved'
    && Types.ObjectId.isValid(String(binding.ruleId || ''))
    && isResearchableOracleEvidenceClaim(binding.evidenceClaim || binding.claimText));
  const ruleIds = [...new Set(resolvedBindings.map((binding) => String(binding.ruleId)))];
  if (!ruleIds.length) return new Map();

  const rules = await KnowledgeRuleV3.find({
    _id: { $in: ruleIds },
    status: 'verified',
  }).select(
    '_id ruleCode statement subject outcome conditions dreamFeatureTags '
    + 'status evidenceScore supportingSourceCount compositeComponents',
  ).lean() as EvidenceGapRuleInput[];
  const ruleById = new Map(rules.map((rule) => [String(rule._id), rule]));
  const preferredRules = new Map<string, EvidenceGapRuleInput>();
  for (const binding of resolvedBindings) {
    const rule = ruleById.get(String(binding.ruleId));
    if (!rule) continue;
    const claim = canonicalizeOracleEvidenceClaim(
      binding.evidenceClaim || binding.claimText,
    );
    const key = oracleEvidenceClaimClusterKey(claim)
      || normalizeOracleEvidenceText(claim);
    if (!preferredRules.has(key)) preferredRules.set(key, rule);
  }
  return preferredRules;
}

// Uses the persisted Dream ledger instead of rediscovering claims from rendered prose.
export function collectDreamEvidenceClaims(
  bindings: EvidenceClaimBinding[] | undefined,
  fallbackAnswer: string,
): string[] {
  if (bindings) {
    return [...new Map(bindings
      .map((binding) => cleanOracleEvidenceClaim(
        binding.evidenceClaim || binding.claimText,
      ))
      .filter(isResearchableOracleEvidenceClaim)
      .map((claim) => [normalizeOracleEvidenceText(claim), claim]))
      .values()];
  }

  return [...groupResearchableClaims(fallbackAnswer).values()]
    .map((group) => group.claim);
}

function groupExplicitResearchableClaims(claims: string[]) {
  const grouped = new Map<string, { claim: string; variants: Set<string> }>();
  for (const rawClaim of claims) {
    const exactClaim = cleanOracleEvidenceClaim(rawClaim)
      .replace(/\s+/gu, ' ')
      .slice(0, 1200);
    if (!isResearchableOracleEvidenceClaim(exactClaim)) continue;
    const claim = canonicalizeOracleEvidenceClaim(exactClaim);
    const key = oracleEvidenceClaimClusterKey(claim)
      || normalizeOracleEvidenceText(claim);
    const existing = grouped.get(key);
    if (existing) {
      existing.variants.add(exactClaim);
      existing.variants.add(claim);
    } else {
      grouped.set(key, { claim, variants: new Set([claim, exactClaim]) });
    }
  }
  return grouped;
}

async function sanitizeStoredTurn(turnId: Types.ObjectId, fallbackAnswer: string): Promise<string> {
  const turn = await OracleTurn.findById(turnId);
  if (!turn) return fallbackAnswer;
  let changed = false;
  turn.contentBlocks = turn.contentBlocks.map((block) => {
    const text = sanitizeOracleUnresolvedMarkers(block.text);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  if (changed) {
    turn.markModified('contentBlocks');
    await turn.save();
  }
  return turn.contentBlocks.map((block) => block.text).join('\n');
}

function groupResearchableClaims(answer: string) {
  const grouped = new Map<string, { claim: string; variants: Set<string> }>();
  const sourceClaims = answer
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((item) => item.trim())
    .filter((item) => item.includes('[?]'))
    .map((item) => cleanOracleEvidenceClaim(item).replace(/\s+/gu, ' ').slice(0, 1200))
    .filter(isResearchableOracleEvidenceClaim);
  for (const sourceClaim of [...new Set(sourceClaims)]) {
    const claim = canonicalizeOracleEvidenceClaim(sourceClaim);
    const key = oracleEvidenceClaimClusterKey(claim) || normalizeOracleEvidenceText(claim);
    const existing = grouped.get(key);
    if (existing) existing.variants.add(sourceClaim);
    else grouped.set(key, { claim, variants: new Set([sourceClaim]) });
  }
  return grouped;
}

async function upsertEvidenceGap(
  input: {
    userId: Types.ObjectId;
    threadId?: Types.ObjectId;
    turnId?: Types.ObjectId;
    occurrenceTurnId?: Types.ObjectId;
    occurrenceDreamId?: Types.ObjectId;
  },
  claim: { normalizedClaim: string; claim: string; variants: string[] },
  preferredRule?: EvidenceGapRuleInput,
): Promise<{ gap: any; groundedRule: EvidenceGapRuleInput | null }> {
  let gap = await OracleEvidenceGap.findOne({
    userId: input.userId,
    normalizedClaim: claim.normalizedClaim,
  });
  let groundedRule: EvidenceGapRuleInput | null = preferredRule || null;
  if (!gap) {
    groundedRule ||= await findGroundedRuleForClaim(claim.claim);
    if (groundedRule) {
      gap = await OracleEvidenceGap.findOne({
        userId: input.userId,
        resolvedRuleIds: groundedRule._id,
      });
    }
  }
  if (!gap) {
    gap = await OracleEvidenceGap.create({
      userId: input.userId,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      occurrenceTurnIds: input.occurrenceTurnId ? [input.occurrenceTurnId] : [],
      occurrenceDreamIds: input.occurrenceDreamId ? [input.occurrenceDreamId] : [],
      claim: claim.claim,
      normalizedClaim: claim.normalizedClaim,
      relatedClaims: claim.variants,
      occurrenceCount: 1,
      status: 'unresolved',
      candidateRuleIds: [],
      resolvedRuleIds: [],
    });
    return { gap, groundedRule };
  }
  const alreadyRecorded = [
    ...(gap.occurrenceTurnIds || []),
    ...(gap.occurrenceDreamIds || []),
  ].some((id: Types.ObjectId) =>
    String(id) === String(input.occurrenceTurnId || input.occurrenceDreamId));
  const additions: Record<string, unknown> = {
    relatedClaims: { $each: claim.variants },
  };
  if (input.occurrenceTurnId) additions.occurrenceTurnIds = input.occurrenceTurnId;
  if (input.occurrenceDreamId) additions.occurrenceDreamIds = input.occurrenceDreamId;
  await OracleEvidenceGap.updateOne(
    { _id: gap._id },
    {
      $addToSet: {
        ...additions,
      },
      ...(!alreadyRecorded ? { $inc: { occurrenceCount: 1 } } : {}),
    },
  );
  return {
    gap: await OracleEvidenceGap.findById(gap._id),
    groundedRule,
  };
}
