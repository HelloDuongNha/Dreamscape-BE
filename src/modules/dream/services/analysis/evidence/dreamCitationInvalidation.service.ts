import {
  invalidateEvidenceClaims,
  sameEvidenceSource,
  writeEvidenceClaimMarker,
  type EvidenceClaimBinding,
  type EvidenceSourceIdentity,
} from '../../../../../shared/evidence/citationClaim';
import {
  invalidateOracleCitationMarker,
  isSourceSearchableOracleEvidenceClaim,
} from '../../../../../shared/evidence/evidenceClaim';
import type {
  OracleSourceInvalidationPlan,
} from '../../../../oracle/services/lifecycle/oracleSourceInvalidationPlan.service';

// Reopens only claims and questions tied to the removed source.
export function invalidateDreamAnalysis(
  analysis: any,
  invalidIndexes: number[],
  invalidRuleIds: Set<string>,
  plan: OracleSourceInvalidationPlan,
): void {
  const bindings: EvidenceClaimBinding[] = Array.isArray(analysis.claim_bindings)
    ? analysis.claim_bindings
    : [];
  const invalidatedBindings = invalidateEvidenceClaims(bindings, sourceIdentities(plan));
  if (bindings.length) {
    for (const binding of invalidatedBindings) {
      const previous = bindings.find((item) => item.claimId === binding.claimId);
      if (previous?.status === 'resolved' && binding.status === 'unresolved') {
        writeEvidenceClaimMarker(analysis, binding);
      }
    }
    analysis.claim_bindings = invalidatedBindings;
  }
  invalidateLegacyMarkers(analysis, invalidIndexes);
  restoreTrackedUnresolvedMarkers(analysis, invalidatedBindings);
  analysis.citations = compactDreamCitations(
    analysis,
    (analysis.citations || [])
      .filter((citation: any) => !sourceMatchesPlan(citation, plan)),
  );
  analysis.scientific_context_notes = (analysis.scientific_context_notes || [])
    .map((note: any) => ({
      ...note,
      sources: (note.sources || []).filter(
        (source: any) => !sourceMatchesPlan(source, plan),
      ),
      evidenceQuotes: (note.evidenceQuotes || []).filter(
        (quote: any) => !plan.sourceIds.includes(String(quote.sourceId)),
      ),
    }))
    .filter((note: any) => note.sources.length > 0);
  analysis.real_life_hypotheses = (analysis.real_life_hypotheses || [])
    .filter((item: any) => !hypothesisUsesInvalidSource(item, invalidRuleIds, plan));
}

function restoreTrackedUnresolvedMarkers(
  analysis: any,
  bindings: EvidenceClaimBinding[],
): void {
  for (const binding of bindings) {
    if (
      binding.status === 'unresolved'
      && isSourceSearchableOracleEvidenceClaim(
        binding.evidenceClaim || binding.claimText,
      )
    ) {
      writeEvidenceClaimMarker(analysis, binding);
    }
  }
}

// Invalidates one persisted analysis and returns every removed question key.
export function invalidateStoredDreamAnalysis(
  analysis: any,
  plan: OracleSourceInvalidationPlan,
  invalidVerificationKeys: Set<string>,
): boolean {
  if (!analysis || typeof analysis !== 'object') return false;
  const notes = Array.isArray(analysis.scientific_context_notes)
    ? analysis.scientific_context_notes
    : [];
  const invalidNotes = notes.filter((note: any) => noteUsesInvalidSource(note, plan));
  const invalidRuleIds = new Set(plan.ruleIds);
  const invalidIndexes = invalidCitationIndexes(analysis, notes, plan);
  const sources = sourceIdentities(plan);
  const hasInvalidBinding = (analysis.claim_bindings || []).some(
    (binding: EvidenceClaimBinding) =>
      binding.source && sources.some((source) =>
        sameEvidenceSource(binding.source!, source)),
  );
  const invalidHypotheses = (analysis.real_life_hypotheses || [])
    .filter((hypothesis: any) =>
      hypothesisUsesInvalidSource(hypothesis, invalidRuleIds, plan));
  if (!invalidIndexes.length && !invalidNotes.length
    && !invalidHypotheses.length && !hasInvalidBinding) {
    return false;
  }

  for (const hypothesis of invalidHypotheses) {
    const key = String(hypothesis.verificationKey || '').trim();
    if (key) invalidVerificationKeys.add(key);
  }
  invalidateDreamAnalysis(analysis, invalidIndexes, invalidRuleIds, plan);
  return true;
}

// Removes invalid rule evidence from the retrieval audit returned with a Dream.
export function pruneDreamRetrievedContext(
  retrievedContext: any,
  invalidRuleIds: Set<string>,
  plan: OracleSourceInvalidationPlan,
): boolean {
  const componentD = retrievedContext?.componentD;
  if (!componentD) return false;
  const previousRuleCount = (componentD.appliedRules || []).length;
  const previousLinkCount = (componentD.evidenceLinks || []).length;
  componentD.evidenceLinks = (componentD.evidenceLinks || []).filter((link: any) =>
    !sourceMatchesPlan(link, plan)
    && !(invalidRuleIds.has(String(link.ruleId || '')) && !hasSourceIdentity(link)));
  const remainingRuleIds = new Set(
    componentD.evidenceLinks.map((link: any) => String(link.ruleId || '')).filter(Boolean),
  );
  componentD.appliedRules = (componentD.appliedRules || []).filter((rule: any) => {
    const ruleId = String(rule.ruleId || rule._id || '');
    return !invalidRuleIds.has(ruleId) || remainingRuleIds.has(ruleId);
  });
  return previousRuleCount !== componentD.appliedRules.length
    || previousLinkCount !== componentD.evidenceLinks.length;
}

function compactDreamCitations(analysis: any, citations: any[]): any[] {
  const ordered = [...citations].sort(
    (left, right) => Number(left.index) - Number(right.index),
  );
  const indexMap = new Map<number, number>();
  const compacted = ordered.map((citation, position) => {
    const previousIndex = Number(citation.index);
    const nextIndex = position + 1;
    if (Number.isInteger(previousIndex) && previousIndex > 0) {
      indexMap.set(previousIndex, nextIndex);
    }
    return { ...citation, index: nextIndex };
  });

  remapDreamCitationMarkers(analysis, indexMap);
  for (const binding of analysis.claim_bindings || []) {
    if (binding.status !== 'resolved' || !binding.citationIndex) continue;
    const nextIndex = indexMap.get(Number(binding.citationIndex));
    if (nextIndex) binding.citationIndex = nextIndex;
  }
  return compacted;
}

function remapDreamCitationMarkers(analysis: any, indexMap: Map<number, number>): void {
  const remap = (value: unknown) => String(value || '').replace(
    /\[(\d+)\]/gu,
    (marker, rawIndex) => {
      const nextIndex = indexMap.get(Number(rawIndex));
      return nextIndex ? `[${nextIndex}]` : marker;
    },
  );
  for (const field of ['core_analysis', 'summary'] as const) {
    analysis[field] = remap(analysis[field]);
  }
  for (const thread of analysis.interpretive_threads || []) {
    thread.reasoning = remap(thread.reasoning);
    thread.alternativeExplanation = remap(thread.alternativeExplanation);
  }
}

function invalidCitationIndexes(
  analysis: any,
  notes: any[],
  plan: OracleSourceInvalidationPlan,
): number[] {
  const storedCitations = Array.isArray(analysis.citations) ? analysis.citations : [];
  if (storedCitations.length) {
    return storedCitations
      .filter((citation: any) => sourceMatchesPlan(citation, plan))
      .map((citation: any) => Number(citation.index))
      .filter((index: number) => Number.isInteger(index) && index > 0);
  }

  const indexes = new Set<number>();
  const sourceIds = orderedSourceIds(notes);
  sourceIds.forEach((sourceId, index) => {
    if (plan.sourceIds.includes(sourceId)) indexes.add(index + 1);
  });
  for (const note of notes.filter((item: any) => noteUsesInvalidSource(item, plan))) {
    for (const source of note.sources || []) {
      const index = sourceIds.indexOf(String(source.sourceId || '').trim()) + 1;
      if (index > 0) indexes.add(index);
    }
  }
  return [...indexes];
}

function invalidateLegacyMarkers(analysis: any, invalidIndexes: number[]): void {
  for (const field of ['core_analysis', 'summary'] as const) {
    analysis[field] = invalidateTextIndexes(String(analysis[field] || ''), invalidIndexes);
  }
  for (const thread of analysis.interpretive_threads || []) {
    thread.reasoning = invalidateTextIndexes(String(thread.reasoning || ''), invalidIndexes);
    thread.alternativeExplanation = invalidateTextIndexes(
      String(thread.alternativeExplanation || ''),
      invalidIndexes,
    );
  }
}

function hypothesisUsesInvalidSource(
  hypothesis: any,
  invalidRuleIds: Set<string>,
  plan: OracleSourceInvalidationPlan,
): boolean {
  const validationSourceId = String(hypothesis?.validationSourceId || '').trim();
  if (validationSourceId && plan.sourceIds.includes(validationSourceId)) return true;
  const sources = hypothesis?.sources || [];
  if (sources.some((source: any) => sourceMatchesPlan(source, plan))) return true;
  if (validationSourceId || sources.some(hasSourceIdentity)) return false;
  const ruleIds = [hypothesis?.ruleId, ...(hypothesis?.ruleIds || [])].map(String);
  return ruleIds.some((ruleId) => invalidRuleIds.has(ruleId));
}

function noteUsesInvalidSource(note: any, plan: OracleSourceInvalidationPlan): boolean {
  return (note?.sources || []).some((source: any) => sourceMatchesPlan(source, plan))
    || (note?.evidenceQuotes || []).some(
      (quote: any) => plan.sourceIds.includes(String(quote?.sourceId || '')),
    );
}

function sourceIdentities(plan: OracleSourceInvalidationPlan): EvidenceSourceIdentity[] {
  return [
    ...plan.sourceIds.map((sourceId) => ({ sourceId })),
    ...plan.sourceDois.map((doi) => ({ doi })),
  ];
}

function sourceMatchesPlan(source: any, plan: OracleSourceInvalidationPlan): boolean {
  const sourceId = String(source?.sourceId || '').trim();
  const doi = normalizeDoi(source?.doi);
  return Boolean(
    (sourceId && plan.sourceIds.includes(sourceId))
    || (doi && plan.sourceDois.includes(doi)),
  );
}

function hasSourceIdentity(source: any): boolean {
  return Boolean(String(source?.sourceId || '').trim() || normalizeDoi(source?.doi));
}

function normalizeDoi(value: unknown): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '');
}

function orderedSourceIds(notes: any[]): string[] {
  const sourceIds: string[] = [];
  for (const note of notes) {
    for (const source of note.sources || []) {
      const sourceId = String(source.sourceId || '').trim();
      if (sourceId && !sourceIds.includes(sourceId)) sourceIds.push(sourceId);
    }
  }
  return sourceIds;
}

function invalidateTextIndexes(text: string, indexes: number[]): string {
  return indexes.reduce(
    (current, index) => invalidateOracleCitationMarker(current, index),
    text,
  );
}
