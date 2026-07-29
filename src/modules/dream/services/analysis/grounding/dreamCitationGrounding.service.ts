import type { ILLMOutput } from '../../../../../infrastructure/llm.service';
import {
  createEvidenceClaimId,
  DREAM_CITATION_CONTRACT_VERSION,
  evidenceClaimContentPaths,
  readEvidenceClaimContent,
  resolveEvidenceClaim,
  writeEvidenceClaimMarker,
  type EvidenceCitationRecord,
  type EvidenceClaimBinding,
  type EvidenceClaimContentPath,
} from '../../../../../shared/evidence/citationClaim';
import {
  canonicalizeOracleEvidenceClaim,
  isResearchableOracleEvidenceClaim,
} from '../../../../../shared/evidence/evidenceClaim';
import {
  localizeOracleEvidenceClaim,
} from '../../../../oracle/services/evidence/oracleEvidenceLocalization.service';
import {
  evidenceGapRuleSimilarity,
  oracleEvidenceClaimClusterKey,
} from '../../../../../shared/evidence/evidenceClaimMatching';
import {
  buildEvidenceGapRuleText,
  DIRECT_CLAIM_MATCH,
} from '../../../../oracle/services/evidence/oracleEvidenceRuleSupport.service';
import {
  appendDreamVerificationQuestion,
} from '../evidence/dreamCitationQuestion.service';
import {
  markUnsupportedInterpretations,
} from '../../../../oracle/services/presentation/oracleAnswerFinalization.service';
import {
  ORACLE_CITATION_QUESTION_VERSION,
} from '../../../../oracle/services/presentation/oracleRulePresentation.service';

export interface DreamCitationGroundingContext {
  citableRules: any[];
  validSourcesMap: Map<string, any[]>;
  validEvidenceMap: Map<string, Array<{
    evidenceId: string;
    sourceId: string;
    chunkId: string;
    quote: string;
  }>>;
}

interface DreamEvidenceClaimCandidate {
  contentPath: EvidenceClaimContentPath;
  claimText: string;
  supportRuleId?: string;
}

interface ResolvedDreamClaimSupport {
  rule: any;
  ruleId: string;
  source: any;
  evidence: {
    evidenceId: string;
    sourceId: string;
    chunkId: string;
    quote: string;
  };
}

// Uses the same checks as final grounding so quality review cannot accept fake links.
export function countResolvableDreamCitationClaims(
  analysis: ILLMOutput,
  context: DreamCitationGroundingContext,
): number {
  return collectClaimCandidates(analysis)
    .filter(candidate => resolveDreamClaimSupport(candidate, context) !== null)
    .length;
}

// Validates research claims, assigns citations and persists their exact locations.
export function groundDreamCitationClaims(
  analysis: ILLMOutput,
  context: DreamCitationGroundingContext,
): void {
  ensureGroundedAcademicClaims(analysis, context);
  const candidates = collectClaimCandidates(analysis);
  const bindings: EvidenceClaimBinding[] = [];
  const citations: Array<NonNullable<ILLMOutput['citations']>[number]> = [];
  if (!Array.isArray(analysis.real_life_hypotheses)) {
    analysis.real_life_hypotheses = [];
  }

  for (const candidate of candidates) {
    const support = resolveDreamClaimSupport(candidate, context);
    const rule = support?.rule || findSupportingRule(candidate, context.citableRules);
    const binding = createBinding(candidate, rule);
    if (!support) {
      bindings.push(binding);
      writeEvidenceClaimMarker(analysis, binding);
      continue;
    }
    const { ruleId, source, evidence } = support;

    const citationRecords: EvidenceCitationRecord[] = citations.map((citation) => ({
      index: citation.index,
      source: { sourceId: citation.sourceId },
    }));
    const resolved = resolveEvidenceClaim(binding, {
      source: { sourceId: String(source.sourceId), doi: source.doi },
      ruleId,
      evidenceId: String(evidence.evidenceId || evidence.chunkId),
      verificationKey: `${ruleId}:${String(evidence.evidenceId || evidence.chunkId)}`
        + `:dream-citation-${ORACLE_CITATION_QUESTION_VERSION}`,
    }, citationRecords);
    bindings.push(resolved);
    if (!citations.some((citation) => citation.sourceId === String(source.sourceId))) {
      citations.push({
        index: resolved.citationIndex!,
        sourceType: 'academic_source',
        sourceId: String(source.sourceId),
        title: String(source.title || 'Academic source'),
        ...(Number(source.year) ? { year: Number(source.year) } : {}),
        excerpt: String(evidence.quote),
        detail: String(rule.statement || rule.ruleStatement || ''),
      });
    }
    writeEvidenceClaimMarker(analysis, resolved);
    appendDreamVerificationQuestion(
      analysis,
      { ...rule, _id: ruleId },
      {
        source: { ...source, _id: String(source.sourceId) },
        evidence: {
          _id: String(evidence.evidenceId || evidence.chunkId),
          chunkId: String(evidence.chunkId),
          exactQuote: String(evidence.quote),
        },
      },
      String(source.sourceId),
      [candidate.claimText],
    );
  }

  markUnsupportedDreamInterpretations(analysis);
  analysis.citation_contract_version = DREAM_CITATION_CONTRACT_VERSION;
  analysis.claim_bindings = bindings;
  analysis.citations = citations.sort((left, right) => left.index - right.index);
  delete analysis.evidence_claims;
}

function ensureGroundedAcademicClaims(
  analysis: ILLMOutput,
  context: DreamCitationGroundingContext,
): void {
  const existingCandidates = collectClaimCandidates(analysis);
  if (existingCandidates.some(candidate =>
    resolveDreamClaimSupport(candidate, context) !== null)) {
    return;
  }

  const fallbacks = context.citableRules
    .map((rule) => {
      const ruleId = String(rule?.ruleId || rule?._id || '');
      const ruleText = buildEvidenceGapRuleText(rule);
      const localized = localizeOracleEvidenceClaim(ruleText);
      return {
        rule,
        ruleId,
        ruleText,
        claimText: String(localized.vi || '').trim(),
        localized,
      };
    })
    .filter(item =>
      item.ruleId
      && item.claimText
      && item.localized.vi !== item.localized.en
      && isResearchableOracleEvidenceClaim(item.claimText)
      && context.validSourcesMap.has(item.ruleId)
      && context.validEvidenceMap.has(item.ruleId)
      && evidenceGapRuleSimilarity(item.claimText, item.ruleText) >= DIRECT_CLAIM_MATCH)
    .filter((item, index, rows) =>
      rows.findIndex(candidate => candidate.localized.key === item.localized.key) === index)
    .sort((left, right) =>
      Number(right.rule?.retrievalScore || 0) - Number(left.rule?.retrievalScore || 0))
    .slice(0, 1);
  if (fallbacks.length === 0) return;

  const appendedClaims = fallbacks.map(item => ensureSentenceEnding(item.claimText));
  analysis.core_analysis = [
    String(analysis.core_analysis || '').trim(),
    ...appendedClaims,
  ].filter(Boolean).join(' ');
  analysis.evidence_claims = [
    ...(analysis.evidence_claims || []),
    ...fallbacks.map((item, index) => ({
      contentPath: 'core_analysis' as const,
      claimText: appendedClaims[index],
      supportRuleId: item.ruleId,
    })),
  ];
}

function resolveDreamClaimSupport(
  candidate: DreamEvidenceClaimCandidate,
  context: DreamCitationGroundingContext,
): ResolvedDreamClaimSupport | null {
  const rule = findSupportingRule(candidate, context.citableRules);
  const ruleId = String(rule?.ruleId || rule?._id || '');
  if (!ruleId) return null;

  const sources = context.validSourcesMap.get(ruleId) || [];
  const evidenceItems = context.validEvidenceMap.get(ruleId) || [];
  for (const source of sources) {
    const evidence = evidenceItems.find(item =>
      String(item.sourceId) === String(source?.sourceId)
      && String(item.quote || '').trim());
    if (source?.sourceId && evidence) {
      return {
        rule,
        ruleId,
        source,
        evidence: {
          ...evidence,
          evidenceId: String(evidence.evidenceId || evidence.chunkId),
        },
      };
    }
  }
  return null;
}

function ensureSentenceEnding(value: string): string {
  return /[.!?…]$/u.test(value) ? value : `${value}.`;
}


function markUnsupportedDreamInterpretations(analysis: ILLMOutput): void {
  analysis.core_analysis = markUnsupportedDreamText(analysis.core_analysis);
  analysis.interpretive_threads = (analysis.interpretive_threads || []).map(thread => ({
    ...thread,
    reasoning: markUnsupportedDreamText(thread.reasoning),
    alternativeExplanation: markUnsupportedDreamText(thread.alternativeExplanation),
  }));
}

function markUnsupportedDreamText(value: string): string {
  return value
    .split(/(?<=[.!?])\s+/u)
    .map(sentence => markUnsupportedInterpretations(sentence))
    .join(' ');
}

function collectClaimCandidates(analysis: ILLMOutput): DreamEvidenceClaimCandidate[] {
  const explicitCandidates = (analysis.evidence_claims || []).flatMap((item) => {
    const path = item.contentPath as EvidenceClaimContentPath;
    const exactClaim = findExactClaim(readEvidenceClaimContent(analysis, path), item.claimText);
    if (!exactClaim || !isResearchableOracleEvidenceClaim(exactClaim)) return [];
    return [{
      contentPath: path,
      claimText: exactClaim,
      supportRuleId: item.supportRuleId,
    }];
  });
  const generatedCandidates = evidenceClaimContentPaths(analysis).flatMap((path) =>
    splitSentences(readEvidenceClaimContent(analysis, path))
      .filter(isResearchableOracleEvidenceClaim)
      .map(claimText => ({ contentPath: path, claimText })),
  );

  return [...explicitCandidates, ...generatedCandidates].filter((item, index, rows) =>
    rows.findIndex((candidate) => claimKey(candidate) === claimKey(item)) === index,
  ).slice(0, 8);
}

function findSupportingRule(candidate: DreamEvidenceClaimCandidate, rules: any[]): any | null {
  const explicit = candidate.supportRuleId
    ? rules.find((rule) =>
      String(rule?.ruleId || rule?._id || '') === candidate.supportRuleId)
    : null;
  if (explicit && evidenceGapRuleSimilarity(
    candidate.claimText,
    buildEvidenceGapRuleText(explicit),
  ) >= DIRECT_CLAIM_MATCH) {
    return explicit;
  }
  const ranked = rules
    .map((rule) => ({
      rule,
      similarity: evidenceGapRuleSimilarity(
        candidate.claimText,
        buildEvidenceGapRuleText(rule),
      ),
    }))
    .sort((left, right) => right.similarity - left.similarity);
  return ranked[0]?.similarity >= DIRECT_CLAIM_MATCH ? ranked[0].rule : null;
}

function createBinding(
  candidate: DreamEvidenceClaimCandidate,
  rule?: any,
): EvidenceClaimBinding {
  const evidenceClaim = canonicalizeOracleEvidenceClaim(
    String(rule?.statement || rule?.ruleStatement || candidate.claimText),
  );
  return {
    claimId: createEvidenceClaimId(candidate.contentPath, candidate.claimText),
    claimText: candidate.claimText,
    evidenceClaim,
    evidenceClaimKey: oracleEvidenceClaimClusterKey(evidenceClaim),
    contentPath: candidate.contentPath,
    status: 'unresolved',
  };
}

function findExactClaim(text: string, requested: string): string | null {
  const normalizedRequested = normalizeText(requested);
  return splitSentences(text).find((sentence) =>
    normalizeText(sentence) === normalizedRequested) || null;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

function claimKey(candidate: Pick<DreamEvidenceClaimCandidate, 'contentPath' | 'claimText'>): string {
  return `${candidate.contentPath}:${normalizeText(candidate.claimText)}`;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s*\[(?:\?|\d+)\]\s*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
