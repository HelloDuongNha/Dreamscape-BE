import {
  createEvidenceClaimId,
  DREAM_CITATION_CONTRACT_VERSION,
  evidenceClaimContentPaths,
  readEvidenceClaimContent,
  sameEvidenceSource,
  writeEvidenceClaimMarker,
  type EvidenceCitationRecord,
  type EvidenceClaimBinding,
  type EvidenceClaimContentPath,
} from '../../../../../shared/evidence/citationClaim';

export interface DreamCitationMigrationStats {
  changed: boolean;
  bindingsCreated: number;
  citationsRecovered: number;
  markersReopened: number;
  requiresReanalysis: number;
}

interface LegacyMarkerClaim {
  contentPath: EvidenceClaimContentPath;
  claimText: string;
  marker: string;
}

// Migrates only legacy markers whose exact claim location can be recovered.
export function migrateLegacyDreamCitationAnalysis(
  analysis: any,
): DreamCitationMigrationStats {
  if (!analysis || typeof analysis !== 'object'
    || analysis.citation_contract_version === DREAM_CITATION_CONTRACT_VERSION) {
    return emptyMigrationStats();
  }
  if (Array.isArray(analysis.claim_bindings) && analysis.claim_bindings.length) {
    analysis.citation_contract_version = DREAM_CITATION_CONTRACT_VERSION;
    return { ...emptyMigrationStats(), changed: true };
  }
  const markerClaims = collectLegacyMarkerClaims(analysis);
  if (!markerClaims.length) {
    if (!hasLegacyAcademicReferences(analysis)) {
      analysis.citation_contract_version = DREAM_CITATION_CONTRACT_VERSION;
      analysis.claim_bindings = [];
      return { ...emptyMigrationStats(), changed: true };
    }
    return {
      ...emptyMigrationStats(),
      requiresReanalysis: 1,
    };
  }

  const citations = collectLegacyCitations(analysis);
  const bindings: EvidenceClaimBinding[] = [];
  let markersReopened = 0;

  for (const markerClaim of markerClaims) {
    const binding = migrateMarkerClaim(markerClaim, analysis, citations);
    if (binding.status === 'unresolved' && markerClaim.marker !== '?') {
      writeEvidenceClaimMarker(analysis, binding);
      markersReopened += 1;
    }
    if (!bindings.some((item) => item.claimId === binding.claimId)) {
      bindings.push(binding);
    }
  }

  analysis.citation_contract_version = DREAM_CITATION_CONTRACT_VERSION;
  analysis.claim_bindings = bindings;
  analysis.citations = citations
    .filter((citation) => bindings.some((binding) =>
      binding.status === 'resolved' && binding.citationIndex === citation.index))
    .map((citation) => presentCitation(citation, analysis));
  return {
    changed: true,
    bindingsCreated: bindings.length,
    citationsRecovered: analysis.citations.length,
    markersReopened,
    requiresReanalysis: 0,
  };
}

// Migrates current and historical analyses without changing Dream prose.
export function migrateLegacyDreamCitationRecord(dream: any): DreamCitationMigrationStats {
  const currentAnalysis = dream?.ai_result;
  const legacyMirror = dream?.aiAnalysis;
  const analyses = [
    currentAnalysis,
    ...(legacyMirror && legacyMirror !== currentAnalysis ? [legacyMirror] : []),
    ...((dream?.edit_history || []).map((entry: any) => entry?.ai_result)),
  ];
  const stats = analyses.map(migrateLegacyDreamCitationAnalysis);
  return stats.reduce((total, item) => ({
    changed: total.changed || item.changed,
    bindingsCreated: total.bindingsCreated + item.bindingsCreated,
    citationsRecovered: total.citationsRecovered + item.citationsRecovered,
    markersReopened: total.markersReopened + item.markersReopened,
    requiresReanalysis: total.requiresReanalysis + item.requiresReanalysis,
  }), emptyMigrationStats());
}

function migrateMarkerClaim(
  markerClaim: LegacyMarkerClaim,
  analysis: any,
  citations: EvidenceCitationRecord[],
): EvidenceClaimBinding {
  const base: EvidenceClaimBinding = {
    claimId: createEvidenceClaimId(markerClaim.contentPath, markerClaim.claimText),
    claimText: markerClaim.claimText,
    contentPath: markerClaim.contentPath,
    status: 'unresolved',
  };
  const index = Number(markerClaim.marker);
  if (!Number.isInteger(index) || index < 1) return base;
  const citation = citations.find((item) => item.index === index);
  if (!citation?.source.sourceId && !citation?.source.doi) return base;
  const note = findSourceNote(analysis, citation.source);
  const hypothesis = findSourceHypothesis(analysis, citation.source);
  return {
    ...base,
    status: 'resolved',
    source: citation.source,
    citationIndex: index,
    ...(note?.ruleId ? { ruleId: String(note.ruleId) } : {}),
    ...(note?.evidenceQuotes?.[0]?.chunkId
      ? { evidenceId: String(note.evidenceQuotes[0].chunkId) }
      : {}),
    ...(hypothesis?.verificationKey
      ? { verificationKey: String(hypothesis.verificationKey) }
      : {}),
  };
}

function collectLegacyMarkerClaims(analysis: any): LegacyMarkerClaim[] {
  return evidenceClaimContentPaths(analysis).flatMap((contentPath) =>
    extractMarkerClaims(readEvidenceClaimContent(analysis, contentPath))
      .map((item) => ({ ...item, contentPath })));
}

function extractMarkerClaims(text: string): Array<Omit<LegacyMarkerClaim, 'contentPath'>> {
  const claims: Array<Omit<LegacyMarkerClaim, 'contentPath'>> = [];
  const markerPattern = /\[(\?|\d+)\]/gu;
  for (const match of text.matchAll(markerPattern)) {
    const markerIndex = match.index ?? 0;
    const claimText = claimBeforeMarker(text, markerIndex);
    if (claimText.length < 15) continue;
    claims.push({ claimText, marker: match[1] });
  }
  return claims;
}

function claimBeforeMarker(text: string, markerIndex: number): string {
  const prefix = text.slice(0, markerIndex);
  const starts = [0];
  for (const match of prefix.matchAll(/\n+|[.!?]\s+/gu)) {
    starts.push((match.index ?? 0) + match[0].length);
  }
  for (const start of starts.sort((left, right) => right - left)) {
    const candidate = prefix.slice(start).trim();
    if (candidate.length < 15) continue;
    return candidate.replace(/\s+/gu, ' ');
  }
  return '';
}

function collectLegacyCitations(analysis: any): EvidenceCitationRecord[] {
  const records: EvidenceCitationRecord[] = [];
  for (const citation of analysis.citations || []) {
    const index = Number(citation?.index);
    const source = {
      sourceId: String(citation?.sourceId || '').trim(),
      doi: String(citation?.doi || '').trim(),
    };
    if (!Number.isInteger(index) || index < 1 || (!source.sourceId && !source.doi)) continue;
    records.push({ index, source });
  }
  if (records.length) return records;

  for (const note of analysis.scientific_context_notes || []) {
    for (const source of note?.sources || []) {
      if (!source?.sourceId && !source?.doi) continue;
      if (records.some((record) => sameEvidenceSource(record.source, source))) continue;
      records.push({
        index: records.length + 1,
        source: {
          sourceId: String(source.sourceId || '').trim(),
          doi: String(source.doi || '').trim(),
        },
      });
    }
  }
  return records;
}

function presentCitation(citation: EvidenceCitationRecord, analysis: any): any {
  const existing = (analysis.citations || [])
    .find((item: any) => Number(item?.index) === citation.index);
  if (existing) return existing;
  const note = findSourceNote(analysis, citation.source);
  const source = (note?.sources || []).find((item: any) =>
    sameEvidenceSource(item, citation.source)) || {};
  const quote = (note?.evidenceQuotes || []).find((item: any) =>
    !item?.sourceId || item.sourceId === source.sourceId)?.quote || '';
  return {
    index: citation.index,
    sourceType: 'academic_source',
    sourceId: String(source.sourceId || citation.source.sourceId || ''),
    ...(source.doi || citation.source.doi ? { doi: source.doi || citation.source.doi } : {}),
    title: String(source.title || 'Academic source'),
    ...(Number(source.year) ? { year: Number(source.year) } : {}),
    excerpt: String(quote),
    detail: String(note?.ruleStatement || note?.note || ''),
  };
}

function findSourceNote(analysis: any, source: EvidenceCitationRecord['source']): any {
  return (analysis.scientific_context_notes || []).find((note: any) =>
    (note?.sources || []).some((item: any) => sameEvidenceSource(item, source)));
}

function findSourceHypothesis(analysis: any, source: EvidenceCitationRecord['source']): any {
  return (analysis.real_life_hypotheses || []).find((hypothesis: any) =>
    (hypothesis?.sources || []).some((item: any) => sameEvidenceSource(item, source))
    || sameEvidenceSource(
      { sourceId: String(hypothesis?.validationSourceId || '') },
      source,
    ));
}

function hasLegacyAcademicReferences(analysis: any): boolean {
  return Boolean(
    (analysis?.citations || []).length
    || (analysis?.scientific_context_notes || []).some((note: any) =>
      (note?.sources || []).length),
  );
}

function emptyMigrationStats(): DreamCitationMigrationStats {
  return {
    changed: false,
    bindingsCreated: 0,
    citationsRecovered: 0,
    markersReopened: 0,
    requiresReanalysis: 0,
  };
}
