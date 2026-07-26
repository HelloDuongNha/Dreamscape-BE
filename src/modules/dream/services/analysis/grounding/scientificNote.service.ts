import { canExplainPsychology } from '../../../../rules_v3/services/ruleV3DreamApplication.service';
import {
  exactExcerptExists,
  normalizeGroundingText,
} from './dreamGroundingText.service';

export function structureScientificNoteText(note: unknown): {
  explanation: string;
  boundary?: string;
} {
  const text = String(note || '').trim();
  const uniqueSentences = new Map<string, string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/).map(item => item.trim()).filter(Boolean)) {
    const key = normalizeGroundingText(sentence);
    if (!uniqueSentences.has(key)) uniqueSentences.set(key, sentence);
  }
  return { explanation: [...uniqueSentences.values()].join(' ').trim() };
}

export function buildScientificInsightTitle(rule: any): string {
  const preferred = String(
    rule?.displayTitle
    || rule?.localizedStatement
    || rule?.ruleStatement
    || rule?.statement
    || '',
  ).replace(/\s+/gu, ' ').trim();
  if (!preferred) return 'Liên hệ từ tài liệu';
  return preferred.length <= 140 ? preferred : `${preferred.slice(0, 139).trimEnd()}…`;
}

export function collectScientificDreamEvidence(
  note: any,
  narrative: string,
  linkedEvidence: unknown[] = [],
): string[] {
  const quoted = String(note?.note || '').match(/[“"]([^”"]{4,220})[”"]/gu) || [];
  const candidates = [
    ...(Array.isArray(note?.dreamEvidence) ? note.dreamEvidence : []),
    ...quoted.map(value => value.slice(1, -1)),
    ...linkedEvidence,
  ];
  const exact = new Map<string, string>();
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!exactExcerptExists(value, narrative)) continue;
    const key = normalizeGroundingText(value);
    if (!exact.has(key)) exact.set(key, value);
  }
  return [...exact.values()].slice(0, 3);
}

export function buildVerifiedScientificNote(input: {
  rule: any;
  noteText: string;
  narrative: string;
  dreamEvidence?: unknown[];
  sources: any[];
  evidenceQuotes: Array<{ sourceId: string; chunkId: string; quote: string }>;
  confidence: number;
}): any | null {
  const sources = deduplicateAcademicSources(input.sources || []);
  const allowedSourceIds = new Set(sources.map(source => String(source.sourceId)));
  const evidenceByAnchor = new Map<string, { sourceId: string; chunkId: string; quote: string }>();
  for (const item of input.evidenceQuotes || []) {
    const sourceId = String(item?.sourceId || '').trim();
    const chunkId = String(item?.chunkId || '').trim();
    const quote = String(item?.quote || '').trim();
    if (!sourceId || !chunkId || !quote || !allowedSourceIds.has(sourceId)) continue;
    const key = `${sourceId}:${chunkId}:${normalizeGroundingText(quote)}`;
    if (!evidenceByAnchor.has(key)) evidenceByAnchor.set(key, { sourceId, chunkId, quote });
  }
  if (sources.length === 0 || evidenceByAnchor.size === 0) return null;

  const structured = structureScientificNoteText(input.noteText);
  if (structured.explanation.length < 40) return null;
  const ruleId = String(input.rule?.ruleId || input.rule?._id || '').trim();
  if (!ruleId) return null;
  return {
    ruleId,
    ruleCode: String(input.rule?.ruleCode || '').trim(),
    ruleStatement: String(input.rule?.ruleStatement || '').trim(),
    insightTitle: buildScientificInsightTitle(input.rule),
    note: structured.explanation,
    ...(structured.boundary ? { boundary: structured.boundary } : {}),
    matchedDreamDetails: collectScientificDreamEvidence(
      { note: input.noteText, dreamEvidence: input.dreamEvidence },
      input.narrative,
    ),
    evidenceQuotes: [...evidenceByAnchor.values()].slice(0, 2),
    confidence: Math.min(1, Math.max(0, Number(input.confidence) || 0)),
    sources,
  };
}

export function deduplicateScientificNotes(notes: any[]): any[] {
  const unique = new Map<string, any>();
  for (const note of notes || []) {
    const key = String(note?.ruleId || normalizeGroundingText(note?.note)).trim();
    if (key && !unique.has(key)) unique.set(key, note);
  }
  return [...unique.values()].slice(0, 4);
}

export function buildRuleScientificFallback(rule: any, _narrative: string): string | null {
  if (!canExplainPsychology(rule)) return null;
  return null;
}

export function deduplicateAcademicSources(sources: any[]): any[] {
  const bySource = new Map<string, any>();
  for (const source of sources || []) {
    const sourceId = String(source?.sourceId || '').trim();
    if (!sourceId) continue;
    const existing = bySource.get(sourceId);
    if (!existing) {
      bySource.set(sourceId, {
        ...source,
        sourceId,
        chunkIds: [...new Set((source.chunkIds || []).map((id: unknown) => String(id)))],
      });
      continue;
    }
    existing.chunkIds = [...new Set([
      ...(existing.chunkIds || []),
      ...(source.chunkIds || []).map((id: unknown) => String(id)),
    ])];
  }
  return [...bySource.values()];
}
