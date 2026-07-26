/**
 * Phase I18N-3B.2A — Provider-Neutral Response Validator
 *
 * Validates the JSON output from ANY translation provider (including the fake
 * test double) before results are mapped back to TranslatedTargetItem.
 *
 * I18N-3B.2B adapters (Gemini, Ollama) must reuse this validator; they must
 * not duplicate the validation logic.
 */
import {
  ProviderTranslationOutput,
  MAX_PROVIDER_OUTPUT_BYTES,
} from './readerTranslation.types';

export type ProviderResponseValidationResult =
  | { valid: true; output: ProviderTranslationOutput }
  | { valid: false; reason: 'translation_schema_invalid' | 'translation_output_too_large' };

// ─── HTML tag pattern ─────────────────────────────────────────────────────────

/**
 * Detects HTML tags in translated text.
 * Conservative — only rejects actual angle-bracket tag patterns.
 * Does NOT reject:
 *   - scientific comparisons like "p < 0.05" or "x > 3"
 *   - generic text containing < or > without a closing >
 * DOES reject:
 *   - <script>, </script>, <div>, <img ...>, <a href="...">, etc.
 */
const HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\s*\/?>/;

function containsHtmlTags(text: string): boolean {
  return HTML_TAG_RE.test(text);
}

// ─── Per-batch Validator ──────────────────────────────────────────────────────

/**
 * Validates a raw provider JSON response string for a single batch.
 *
 * Rules:
 * - Bytes ≤ MAX_PROVIDER_OUTPUT_BYTES (Buffer.byteLength, utf8)
 * - Parses as a valid JSON object
 * - Top-level has exactly one property: "items" (an array)
 * - Each item has exactly "targetId" (non-empty string) and "translatedText" (non-empty string)
 * - No HTML tags in translatedText
 * - No unknown properties on items or top level
 * - requestedTargetIds: the set of exactly which targetIds were requested
 *   - no unknown IDs in output
 *   - no duplicate IDs in output
 *   - no missing IDs from output
 */
export function validateProviderResponseJson(
  rawJson: string,
  requestedTargetIds: ReadonlySet<string>
): ProviderResponseValidationResult {
  // Check byte length before parsing
  if (Buffer.byteLength(rawJson, 'utf8') > MAX_PROVIDER_OUTPUT_BYTES) {
    return { valid: false, reason: 'translation_output_too_large' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { valid: false, reason: 'translation_schema_invalid' };
  }

  // Must be a plain object
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, reason: 'translation_schema_invalid' };
  }

  const obj = parsed as Record<string, unknown>;

  // Exactly one top-level key: "items"
  const topLevelKeys = Object.keys(obj);
  if (topLevelKeys.length !== 1 || topLevelKeys[0] !== 'items') {
    return { valid: false, reason: 'translation_schema_invalid' };
  }

  const items = obj['items'];
  if (!Array.isArray(items)) {
    return { valid: false, reason: 'translation_schema_invalid' };
  }

  const seenIds = new Set<string>();
  const resultItems: ProviderTranslationOutput['items'] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }
    const itemObj = item as Record<string, unknown>;

    // Exactly two properties: targetId, translatedText
    const itemKeys = Object.keys(itemObj);
    if (
      itemKeys.length !== 2 ||
      !itemKeys.includes('targetId') ||
      !itemKeys.includes('translatedText')
    ) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }

    const { targetId, translatedText } = itemObj;

    // targetId: non-empty string
    if (typeof targetId !== 'string' || !targetId) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }

    // translatedText: non-empty string
    if (typeof translatedText !== 'string' || !translatedText) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }

    // Reject HTML-like content
    if (containsHtmlTags(translatedText)) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }

    // Unknown ID
    if (!requestedTargetIds.has(targetId)) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }

    // Duplicate ID
    if (seenIds.has(targetId)) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }
    seenIds.add(targetId);

    resultItems.push({ targetId, translatedText: translatedText as string });
  }

  // Check for missing IDs
  for (const expectedId of requestedTargetIds) {
    if (!seenIds.has(expectedId)) {
      return { valid: false, reason: 'translation_schema_invalid' };
    }
  }

  return {
    valid: true,
    output: { items: resultItems },
  };
}

/**
 * Validates a pre-parsed ProviderTranslationOutput object.
 * (For use when the provider already returns a typed object rather than raw JSON.)
 */
export function validateProviderOutputObject(
  output: unknown,
  requestedTargetIds: ReadonlySet<string>
): ProviderResponseValidationResult {
  let json: string;
  try {
    json = JSON.stringify(output);
  } catch {
    return { valid: false, reason: 'translation_schema_invalid' };
  }
  return validateProviderResponseJson(json, requestedTargetIds);
}
