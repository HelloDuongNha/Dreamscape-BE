import type {
  CitationVerifiedCandidate,
  DeduplicatedRuleV3Candidates,
} from './ruleV3CandidateExtraction.types';

export function deduplicateRuleV3Candidates(
  sourceLanguage: string,
  candidates: CitationVerifiedCandidate[],
): DeduplicatedRuleV3Candidates {
  const candidateBySignature = new Map<string, CitationVerifiedCandidate>();
  let mergedDuplicateCount = 0;

  for (const candidate of candidates) {
    const signature = buildDeduplicationSignature(sourceLanguage, candidate);
    const existing = candidateBySignature.get(signature);
    if (!existing) {
      candidateBySignature.set(signature, candidate);
      continue;
    }

    mergedDuplicateCount += 1;
    mergeEvidence(existing, candidate);
    for (const warning of candidate.warnings) {
      if (!existing.warnings.includes(warning)) existing.warnings.push(warning);
    }
  }

  return {
    candidates: [...candidateBySignature.values()].map(toPublicCandidate),
    mergedDuplicateCount,
  };
}

function buildDeduplicationSignature(
  sourceLanguage: string,
  candidate: CitationVerifiedCandidate,
): string {
  const conditions = [...new Set(
    candidate.conditions.map(condition => condition.trim().toLowerCase()),
  )].sort();
  return [
    sourceLanguage,
    candidate.claimType,
    candidate.effectPolarity,
    candidate.evidenceInterpretation,
    candidate.subject.trim().toLowerCase(),
    candidate.outcome.trim().toLowerCase(),
    conditions.join(','),
  ].join('|');
}

function mergeEvidence(
  existing: CitationVerifiedCandidate,
  candidate: CitationVerifiedCandidate,
): void {
  for (const evidence of candidate.evidence) {
    const duplicate = existing.evidence.some(item =>
      item.chunkId === evidence.chunkId
      && item.chunkContentHash === evidence.chunkContentHash
      && item.startOffset === evidence.startOffset
      && item.endOffset === evidence.endOffset
      && item.stance === evidence.stance);
    if (!duplicate) existing.evidence.push(evidence);
  }
}

function toPublicCandidate(candidate: CitationVerifiedCandidate) {
  return {
    statement: candidate.statement,
    claimType: candidate.claimType,
    effectPolarity: candidate.effectPolarity,
    evidenceInterpretation: candidate.evidenceInterpretation,
    subject: candidate.subject,
    outcome: candidate.outcome,
    conditions: candidate.conditions,
    limitations: candidate.limitations,
    dreamFeatureTags: candidate.dreamFeatureTags,
    citationVerification: candidate.citationVerification,
    semanticVerification: candidate.semanticVerification,
    warnings: candidate.warnings,
    evidence: candidate.evidence.map(({
      chunkContentHash: _chunkContentHash,
      ...evidence
    }) => evidence),
  };
}
