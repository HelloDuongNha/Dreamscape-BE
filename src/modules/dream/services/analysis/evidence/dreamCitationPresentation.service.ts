import {
  sameEvidenceSource,
  type EvidenceCitationRecord,
  type EvidenceClaimBinding,
} from '../../../../../shared/evidence/citationClaim';
import {
  loadRuleEvidenceSupport,
  type EvidenceGapRuleInput,
} from '../../../../oracle/services/evidence/oracleEvidenceRuleSupport.service';

type RuleSupport = NonNullable<
  Awaited<ReturnType<typeof loadRuleEvidenceSupport>>
>;

// Reads the citation ledger used to allocate the next stable source number.
export function collectDreamCitationRecords(
  analysis: any,
  notes: any[],
): EvidenceCitationRecord[] {
  if (Array.isArray(analysis.citations) && analysis.citations.length) {
    return analysis.citations.map((citation: any) => ({
      index: Number(citation.index),
      source: { sourceId: String(citation.sourceId || ''), doi: citation.doi },
    }));
  }
  const records: EvidenceCitationRecord[] = [];
  for (const note of notes) {
    for (const source of note.sources || []) {
      if (records.some((record) => sameEvidenceSource(record.source, source))) continue;
      records.push({ index: records.length + 1, source });
    }
  }
  return records;
}

// Adds one source card without duplicating an existing academic source.
export function appendDreamCitation(
  analysis: any,
  binding: EvidenceClaimBinding,
  rule: EvidenceGapRuleInput,
  support: RuleSupport,
): void {
  const citations = Array.isArray(analysis.citations) ? analysis.citations : [];
  if (citations.some((citation: any) =>
    sameEvidenceSource({ sourceId: citation.sourceId, doi: citation.doi }, binding.source!))) {
    analysis.citations = citations;
    return;
  }
  const source = support.source as any;
  citations.push({
    index: binding.citationIndex,
    sourceType: 'academic_source',
    sourceId: String(source._id),
    doi: source.doi || source.metadata?.doi,
    title: String(source.title || source.metadata?.title || 'Academic source'),
    year: Number(source.year || source.metadata?.year) || undefined,
    excerpt: String(support.evidence.exactQuote || ''),
    detail: String(rule.statement || ''),
  });
  analysis.citations = citations.sort((left: any, right: any) => left.index - right.index);
}

// Adds the rule, exact quote and source shown by the Dream citation modal.
export function appendDreamScientificNote(
  notes: any[],
  rule: EvidenceGapRuleInput,
  support: RuleSupport,
  sourceId: string,
): void {
  if (notes.some((note: any) => String(note.ruleId || '') === String(rule._id))) return;
  const source = support.source as any;
  notes.push({
    ruleId: String(rule._id),
    ruleCode: rule.ruleCode,
    ruleStatement: rule.statement,
    note: rule.statement,
    confidence: Math.min(1, Math.max(0, Number(rule.evidenceScore || 0) / 100)),
    evidenceQuotes: [{
      sourceId,
      chunkId: String(support.evidence.chunkId),
      quote: support.evidence.exactQuote,
    }],
    sources: [{
      sourceId,
      title: String(source.title || source.metadata?.title || 'Academic source'),
      authors: source.authors || source.metadata?.authors || [],
      year: source.year || source.metadata?.year,
      journal: source.journal || source.publisher,
      doi: source.doi || source.metadata?.doi,
      chunkIds: [String(support.evidence.chunkId)],
    }],
  });
}
