import Dream from '../../../models/Dream';
import {
  createEvidenceClaimId,
  evidenceClaimContentPaths,
  readEvidenceClaimContent,
  resolveEvidenceClaim,
  sameEvidenceSource,
  writeEvidenceClaimMarker,
  type EvidenceClaimBinding,
  type EvidenceClaimContentPath,
} from '../../../../../shared/evidence/citationClaim';
import { cleanOracleEvidenceClaim } from '../../../../../shared/evidence/evidenceClaim';
import { oracleEvidenceClaimClusterKey } from '../../../../../shared/evidence/evidenceClaimMatching';
import {
  loadRuleEvidenceSupport,
  type EvidenceGapRuleInput,
} from '../../../../oracle/services/evidence/oracleEvidenceRuleSupport.service';
import {
  ORACLE_CITATION_QUESTION_VERSION,
} from '../../../../oracle/services/presentation/oracleRulePresentation.service';
import {
  appendDreamVerificationQuestion,
} from './dreamCitationQuestion.service';
import {
  addResolvedEvidenceToDreamContext,
} from './dreamCitationContext.service';
import {
  emitDreamCitationStateChanged,
} from './dreamCitationNotification.service';
import {
  appendDreamCitation,
  appendDreamScientificNote,
  collectDreamCitationRecords,
} from './dreamCitationPresentation.service';

export async function resolveEvidenceGapInDreamPosts(
  gap: {
    claim: string;
    relatedClaims?: string[];
    occurrenceDreamIds?: Array<{ toString(): string } | string>;
  },
  rule: EvidenceGapRuleInput,
): Promise<number> {
  const support = await loadRuleEvidenceSupport(String(gap.claim || ''), rule);
  if (!support) return 0;
  const variants = [...new Set([gap.claim, ...(gap.relatedClaims || [])])]
    .map(cleanOracleEvidenceClaim)
    .filter(Boolean);
  const markerPattern = buildMarkerPattern(variants);
  const claimPattern = buildClaimPattern(variants);
  if (!markerPattern || !claimPattern) return 0;
  const unresolvedBinding = buildUnresolvedBindingQuery(variants, claimPattern);
  const dreams = Dream.find({
    ai_status: 'completed',
    $or: [
      {
        _id: {
          $in: (gap.occurrenceDreamIds || []).map(String),
        },
      },
      {
        'ai_result.claim_bindings': {
          $elemMatch: unresolvedBinding,
        },
      },
      { 'ai_result.core_analysis': markerPattern },
      { 'ai_result.summary': markerPattern },
      { 'ai_result.interpretive_threads.reasoning': markerPattern },
      {
        'aiAnalysis.claim_bindings': {
          $elemMatch: unresolvedBinding,
        },
      },
      { 'aiAnalysis.core_analysis': markerPattern },
      { 'aiAnalysis.summary': markerPattern },
      { 'aiAnalysis.interpretive_threads.reasoning': markerPattern },
      {
        'edit_history.ai_result.claim_bindings': {
          $elemMatch: unresolvedBinding,
        },
      },
      { 'edit_history.ai_result.core_analysis': markerPattern },
      { 'edit_history.ai_result.summary': markerPattern },
      { 'edit_history.ai_result.interpretive_threads.reasoning': markerPattern },
    ],
  }).cursor();
  let resolvedCount = 0;
  for await (const dream of dreams) {
    if (await resolveDreamPost(dream, variants, rule, support)) resolvedCount += 1;
  }
  return resolvedCount;
}

function buildUnresolvedBindingQuery(variants: string[], claimPattern: RegExp) {
  const evidenceClaimKeys = variants
    .map(oracleEvidenceClaimClusterKey)
    .filter(Boolean);
  return {
    status: 'unresolved',
    $or: [
      { evidenceClaimKey: { $in: evidenceClaimKeys } },
      { evidenceClaim: claimPattern },
      { claimText: claimPattern },
    ],
  };
}

function buildMarkerPattern(variants: string[]): RegExp | null {
  const stems = variants
    .map((variant) => variant.replace(/[.!?]+\s*$/u, '').trim())
    .filter(Boolean)
    .map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return stems.length ? new RegExp(`(?:${stems.join('|')})\\s*\\[\\?\\]`, 'iu') : null;
}

function buildClaimPattern(variants: string[]): RegExp | null {
  const claims = variants
    .map((variant) => variant.replace(/[.!?]+\s*$/u, '').trim())
    .filter(Boolean)
    .map((claim) => claim.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return claims.length ? new RegExp(`^(?:${claims.join('|')})[.!?]?$`, 'iu') : null;
}

async function resolveDreamPost(
  dream: any,
  variants: string[],
  rule: EvidenceGapRuleInput,
  support: NonNullable<Awaited<ReturnType<typeof loadRuleEvidenceSupport>>>,
): Promise<boolean> {
  const changed = resolveDreamRecordCitationState(dream, variants, rule, support);
  if (changed) {
    await dream.save();
    emitDreamCitationStateChanged(dream);
    return true;
  }
  return dreamRecordAlreadyHasResolution(dream, variants, rule, support);
}

function dreamRecordAlreadyHasResolution(
  dream: any,
  variants: string[],
  rule: EvidenceGapRuleInput,
  support: NonNullable<Awaited<ReturnType<typeof loadRuleEvidenceSupport>>>,
): boolean {
  return [
    dream.ai_result,
    dream.aiAnalysis,
    ...(dream.edit_history || []).map((history: any) => history.ai_result),
  ].some((analysis) => analysisAlreadyHasResolution(analysis, variants, rule, support));
}

function analysisAlreadyHasResolution(
  analysis: any,
  variants: string[],
  rule: EvidenceGapRuleInput,
  support: NonNullable<Awaited<ReturnType<typeof loadRuleEvidenceSupport>>>,
): boolean {
  if (!analysis || typeof analysis !== 'object') return false;
  const normalizedVariants = new Set(variants.map(normalizeClaim));
  const clusterKeys = new Set(variants.map(oracleEvidenceClaimClusterKey).filter(Boolean));
  const source = {
    sourceId: String(support.source._id),
    doi: String((support.source as any).doi || (support.source as any).metadata?.doi || ''),
  };
  return (analysis.claim_bindings || []).some((binding: EvidenceClaimBinding) =>
    binding.status === 'resolved'
    && String(binding.ruleId || '') === String(rule._id)
    && Boolean(binding.source && sameEvidenceSource(binding.source, source))
    && bindingMatchesClaim(binding, normalizedVariants, clusterKeys));
}

// Resolves matching claims in the current result and every stored Dream version.
export function resolveDreamRecordCitationState(
  dream: any,
  variants: string[],
  rule: EvidenceGapRuleInput,
  support: NonNullable<Awaited<ReturnType<typeof loadRuleEvidenceSupport>>>,
): boolean {
  let changed = false;
  if (resolveDreamAnalysisCitation(dream.ai_result, variants, rule, support)) {
    const contextUpdate = addResolvedEvidenceToDreamContext(
      dream.retrievedContext,
      rule,
      support,
    );
    if (contextUpdate.changed) {
      dream.retrievedContext = contextUpdate.context;
      dream.markModified?.('retrievedContext');
    }
    dream.markModified?.('ai_result');
    changed = true;
  }
  if (
    dream.aiAnalysis
    && dream.aiAnalysis !== dream.ai_result
    && resolveDreamAnalysisCitation(dream.aiAnalysis, variants, rule, support)
  ) {
    const contextUpdate = addResolvedEvidenceToDreamContext(
      dream.retrievedContext,
      rule,
      support,
    );
    if (contextUpdate.changed) {
      dream.retrievedContext = contextUpdate.context;
      dream.markModified?.('retrievedContext');
    }
    dream.markModified?.('aiAnalysis');
    changed = true;
  }
  for (const history of dream.edit_history || []) {
    if (!resolveDreamAnalysisCitation(history.ai_result, variants, rule, support)) continue;
    const contextUpdate = addResolvedEvidenceToDreamContext(
      history.retrievedContext,
      rule,
      support,
    );
    if (contextUpdate.changed) history.retrievedContext = contextUpdate.context;
    changed = true;
  }
  if (changed) dream.markModified?.('edit_history');
  return changed;
}

// Applies one resolved Evidence Needed claim without owning database persistence.
export function resolveDreamAnalysisCitation(
  analysis: any,
  variants: string[],
  rule: EvidenceGapRuleInput,
  support: NonNullable<Awaited<ReturnType<typeof loadRuleEvidenceSupport>>>,
): boolean {
  if (!analysis || typeof analysis !== 'object') return false;
  const notes = Array.isArray(analysis.scientific_context_notes)
    ? analysis.scientific_context_notes
    : [];
  const sourceId = String(support.source._id);
  const bindings = findClaimBindings(analysis, variants);
  if (!bindings.length) return false;
  const citations = collectDreamCitationRecords(analysis, notes);
  const resolvedBindings = bindings
    .map((binding) => resolveEvidenceClaim(binding, {
      source: {
        sourceId,
        doi: String((support.source as any).doi || (support.source as any).metadata?.doi || ''),
      },
      ruleId: String(rule._id),
      evidenceId: String(support.evidence._id),
      verificationKey: `${String(rule._id)}:${String(support.evidence._id)}`
        + `:dream-citation-${ORACLE_CITATION_QUESTION_VERSION}`,
    }, citations))
    .filter((binding) => writeEvidenceClaimMarker(analysis, binding));
  if (!resolvedBindings.length) return false;
  for (const binding of resolvedBindings) replaceStoredBinding(analysis, binding);
  appendDreamCitation(analysis, resolvedBindings[0], rule, support);
  appendDreamScientificNote(notes, rule, support, sourceId);
  appendDreamVerificationQuestion(
    analysis,
    rule,
    support,
    sourceId,
    resolvedBindings.map((binding) => binding.claimText),
  );
  analysis.scientific_context_notes = notes;
  return true;
}

function findClaimBindings(analysis: any, variants: string[]): EvidenceClaimBinding[] {
  const normalizedVariants = new Set(variants.map(normalizeClaim));
  const clusterKeys = new Set(variants.map(oracleEvidenceClaimClusterKey).filter(Boolean));
  const stored = (analysis.claim_bindings || []).filter((binding: EvidenceClaimBinding) =>
    binding.status === 'unresolved'
    && bindingMatchesClaim(binding, normalizedVariants, clusterKeys));
  if (stored.length) return stored;

  const recovered: EvidenceClaimBinding[] = [];
  for (const contentPath of evidenceClaimContentPaths(analysis)) {
    const text = readEvidenceClaimContent(analysis, contentPath);
    const variant = variants.find((item) => claimHasUnresolvedMarker(text, item));
    if (!variant) continue;
    recovered.push({
      claimId: createEvidenceClaimId(contentPath, variant),
      claimText: variant,
      contentPath,
      status: 'unresolved',
    });
  }
  return recovered;
}

function bindingMatchesClaim(
  binding: EvidenceClaimBinding,
  normalizedVariants: Set<string>,
  clusterKeys: Set<string>,
): boolean {
  return Boolean(binding.evidenceClaimKey && clusterKeys.has(binding.evidenceClaimKey))
    || clusterKeys.has(oracleEvidenceClaimClusterKey(
      binding.evidenceClaim || binding.claimText,
    ))
    || normalizedVariants.has(normalizeClaim(binding.evidenceClaim || binding.claimText))
    || normalizedVariants.has(normalizeClaim(binding.claimText));
}

function replaceStoredBinding(analysis: any, binding: EvidenceClaimBinding): void {
  const bindings: EvidenceClaimBinding[] = Array.isArray(analysis.claim_bindings)
    ? analysis.claim_bindings
    : [];
  const index = bindings.findIndex((item) => item.claimId === binding.claimId);
  analysis.claim_bindings = index < 0
    ? [...bindings, binding]
    : bindings.map((item, itemIndex) => itemIndex === index ? binding : item);
}

function claimHasUnresolvedMarker(text: string, claim: string): boolean {
  const stem = claim.replace(/[.!?]+\s*$/u, '').trim();
  if (!stem) return false;
  return new RegExp(
    `${stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\[\\?\\]`,
    'iu',
  ).test(text);
}

function normalizeClaim(value: string): string {
  return cleanOracleEvidenceClaim(value)
    .normalize('NFKC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/gu, ' ')
    .trim();
}
