// Phase I18N-3B.2B — Shared Translation Deadline Configuration

const DEFAULT_DEADLINE_MS = 60000;
const MIN_DEADLINE_MS = 5000;
const MAX_DEADLINE_MS = 120000;

/**
 * Parses and validates translation deadline string strictly.
 * - Accept only a complete positive integer string (no decimals, signs, or trailing junk).
 * - Enforce range 5000–120000 ms.
 * - Invalid values deterministically fall back to the default (60000).
 */
export function parseTranslationDeadline(envVal?: string): number {
  if (!envVal || !envVal.trim()) return DEFAULT_DEADLINE_MS;
  const trimmed = envVal.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_DEADLINE_MS;
  const parsed = parseInt(trimmed, 10);
  if (parsed < MIN_DEADLINE_MS || parsed > MAX_DEADLINE_MS) {
    return DEFAULT_DEADLINE_MS;
  }
  return parsed;
}

/**
 * Returns the active translation deadline from environment.
 */
export function getTranslationDeadlineMs(): number {
  return parseTranslationDeadline(process.env.READER_TRANSLATION_DEADLINE_MS);
}
