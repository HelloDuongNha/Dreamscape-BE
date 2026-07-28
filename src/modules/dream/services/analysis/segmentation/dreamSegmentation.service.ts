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

// Keeps the full free-form narrative instead of guessing boundaries from phrase lists.
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

// Keeps compatibility while requiring sleep context to come from structured input.
export function isExplicitSleepContextClause(_clause: string): SleepContextMatch {
  return { matched: false, reason: 'structured_sleep_context_required' };
}
