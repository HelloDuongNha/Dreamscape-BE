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
  isResearchableOracleEvidenceClaim,
} from '../../../../oracle/services/evidence/oracleEvidenceClaim.service';
import {
  evidenceGapRuleSimilarity,
} from '../../../../oracle/services/evidence/oracleEvidenceMatching.service';
import {
  buildEvidenceGapRuleText,
  DIRECT_CLAIM_MATCH,
} from '../../../../oracle/services/evidence/oracleEvidenceRuleSupport.service';
import {
  appendDreamVerificationQuestion,
} from '../../../../oracle/services/evidence/oracleEvidenceDreamQuestion.service';

interface DreamCitationGroundingContext {
  citableRules: any[];
  validSourcesMap: Map<string, any[]>;
  validEvidenceMap: Map<string, Array<{
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

// Validates research claims, assigns citations and persists their exact locations.
export function groundDreamCitationClaims(
  analysis: ILLMOutput,
  context: DreamCitationGroundingContext,
): void {
  const candidates = collectClaimCandidates(analysis);
  const bindings: EvidenceClaimBinding[] = [];
  const citations: Array<NonNullable<ILLMOutput['citations']>[number]> = [];
  if (!Array.isArray(analysis.real_life_hypotheses)) {
    analysis.real_life_hypotheses = [];
  }

  for (const candidate of candidates) {
    const binding = createBinding(candidate);
    const rule = findSupportingRule(candidate, context.citableRules);
    const ruleId = String(rule?.ruleId || rule?._id || '');
    const source = ruleId ? context.validSourcesMap.get(ruleId)?.[0] : undefined;
    const evidence = ruleId
      ? context.validEvidenceMap.get(ruleId)?.find((item) =>
        !source?.sourceId || String(item.sourceId) === String(source.sourceId))
        || context.validEvidenceMap.get(ruleId)?.[0]
      : undefined;

    if (!rule || !source?.sourceId || !evidence?.quote) {
      bindings.push(binding);
      writeEvidenceClaimMarker(analysis, binding);
      continue;
    }

    const citationRecords: EvidenceCitationRecord[] = citations.map((citation) => ({
      index: citation.index,
      source: { sourceId: citation.sourceId },
    }));
    const resolved = resolveEvidenceClaim(binding, {
      source: { sourceId: String(source.sourceId), doi: source.doi },
      ruleId,
      evidenceId: String(evidence.chunkId),
      verificationKey: `${ruleId}:${String(evidence.chunkId)}:dream-citation-v1`,
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
          _id: String(evidence.chunkId),
          chunkId: String(evidence.chunkId),
          exactQuote: String(evidence.quote),
        },
      },
      String(source.sourceId),
    );
  }

  analysis.citation_contract_version = DREAM_CITATION_CONTRACT_VERSION;
  analysis.claim_bindings = bindings;
  analysis.citations = citations.sort((left, right) => left.index - right.index);
  delete analysis.evidence_claims;
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

function createBinding(candidate: DreamEvidenceClaimCandidate): EvidenceClaimBinding {
  return {
    claimId: createEvidenceClaimId(candidate.contentPath, candidate.claimText),
    claimText: candidate.claimText,
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
