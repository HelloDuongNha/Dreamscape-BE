import { normalizeAnalysisText } from '../contracts/dreamAnalysis.contract';

export interface PersonalSymbolPattern {
  symbol: string;
  occurrences: number;
  recentMeaning: string;
}

function containsPhrase(value: unknown, phrases: string[]): boolean {
  const haystack = ` ${normalizeAnalysisText(value)} `;
  return phrases.some(phrase => haystack.includes(` ${normalizeAnalysisText(phrase)} `));
}

// Contextual motifs are model-authored; this boundary only merges and validates them.
export function buildContextualMotifNotes(
  _narrative: string,
  _rules: any[],
  _limit = 6,
): any[] {
  return [];
}

export function isSupportedContextualMotif(_symbolValue: unknown, _rules: any[]): boolean {
  return false;
}

export function mergeContextualMotifNotes(primary: any[], fallback: any[]): any[] {
  const merged = new Map<string, any>();
  for (const note of [...(primary || []), ...(fallback || [])]) {
    const key = normalizeAnalysisText(note?.symbol);
    if (!key || merged.has(key)) continue;
    merged.set(key, note);
  }
  return [...merged.values()].slice(0, 8);
}

export function deduplicateOverlappingMotifNotes(notes: any[]): any[] {
  const accepted: any[] = [];
  const ordered = [...(notes || [])].sort((a, b) =>
    normalizeAnalysisText(a?.symbol).length - normalizeAnalysisText(b?.symbol).length);
  for (const note of ordered) {
    const symbol = normalizeAnalysisText(note?.symbol);
    const evidence = normalizeAnalysisText(note?.dreamEvidence);
    const duplicate = accepted.some(existing => {
      const existingSymbol = normalizeAnalysisText(existing?.symbol);
      const sameEvidence = evidence && evidence === normalizeAnalysisText(existing?.dreamEvidence);
      const overlappingLabel = containsPhrase(symbol, [existingSymbol])
        || containsPhrase(existingSymbol, [symbol]);
      return overlappingLabel && sameEvidence;
    });
    if (!duplicate) accepted.push(note);
  }
  return accepted.slice(0, 8);
}

export function extractContextualMotifHints(_narrative: string, _limit = 10): string[] {
  return [];
}

export function collectPersonalSymbolPatterns(
  dreamRows: any[],
  currentNarrative: string,
  limit = 5,
): PersonalSymbolPattern[] {
  const narrative = normalizeAnalysisText(currentNarrative);
  const grouped = new Map<string, PersonalSymbolPattern>();
  for (const row of dreamRows || []) {
    const notes = row?.ai_result?.symbolic_notes;
    if (!Array.isArray(notes)) continue;
    for (const note of notes) {
      const key = normalizeAnalysisText(note?.symbol);
      if (key.length < 2 || !` ${narrative} `.includes(` ${key} `)) continue;
      const existing = grouped.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        grouped.set(key, {
          symbol: String(note.symbol).trim(),
          occurrences: 1,
          recentMeaning: String(note.meaning || '').trim().slice(0, 280),
        });
      }
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.symbol.localeCompare(b.symbol, 'vi'))
    .slice(0, limit);
}
