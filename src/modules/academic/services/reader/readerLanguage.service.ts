import { inferDocumentLanguage } from '../../rules/documentLanguage.service';
import { normalizeLanguageCode } from './canonicalReaderIdentity.service';

type ReaderLanguageChunk = { text?: unknown };

/**
 * Resolve the two supported product languages without mutating source metadata.
 * Existing persisted metadata wins; canonical reader text is only a read-only
 * fallback for older sources that predate detectedLanguage.
 */
export function resolveReaderLanguage(
  detectedLanguage: string | null | undefined,
  chunks: ReaderLanguageChunk[],
): 'vi' | 'en' | null {
  const normalized = normalizeLanguageCode(detectedLanguage);
  if (normalized === 'vi' || normalized === 'en') return normalized;

  const inferred = inferDocumentLanguage(
    chunks
      .map(chunk => (typeof chunk.text === 'string' ? chunk.text : ''))
      .filter(Boolean)
      .slice(0, 30),
  );
  return inferred === 'vi' || inferred === 'en' ? inferred : null;
}
