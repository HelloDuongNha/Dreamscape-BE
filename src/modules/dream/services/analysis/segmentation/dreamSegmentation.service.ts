export interface DreamSegments {
  rawText: string;
  dreamNarrative: string;
  wakingReactionText: string;
  sleepContextText: string;
  segmentationReasons: string[];
}

export interface SleepContextMatch {
  matched: boolean;
  trigger?: string;
  reason?: string;
}

/**
 * Free-form text cannot be split reliably with a finite phrase catalogue.
 *
 * The conservative fallback keeps every user word in the narrative. Structured
 * sleep fields supplied by the UI remain separate inputs to the analysis
 * pipeline. Semantic interpretation is left to the model instead of silently
 * moving or dropping clauses based on spelling and language variants.
 */
export function extractDreamSegments(rawText: string): DreamSegments {
  const normalized = String(rawText || '').normalize('NFKC').trim();
  return {
    rawText,
    dreamNarrative: normalized,
    wakingReactionText: '',
    sleepContextText: '',
    segmentationReasons: ['preserved_full_narrative_without_lexical_guessing'],
  };
}

/**
 * Kept as a compatibility boundary for callers being migrated away from text
 * heuristics. Sleep context must come from structured input, not phrase lists.
 */
export function isExplicitSleepContextClause(_clause: string): SleepContextMatch {
  return { matched: false, reason: 'structured_sleep_context_required' };
}
