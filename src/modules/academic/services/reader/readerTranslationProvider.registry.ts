/**
 * Phase I18N-3B.2A — Provider Registry
 *
 * Provider selection is EXPLICIT ONLY via READER_TRANSLATION_PROVIDER env var.
 * Auto-detection from API keys or base URLs is prohibited.
 *
 * No server-side translation engine is currently registered. Smart Reader may
 * use a browser-native presentation overlay; Rule V3 remains independent.
 *
 * FakeReaderTranslationProvider lives in __test_support__ and is NEVER registered here.
 */

// ─── Provider Unavailable Error ───────────────────────────────────────────────

export class TranslationProviderUnavailableError extends Error {
  readonly code = 'reader_translation_provider_unavailable';
  readonly httpStatus = 503;
  constructor(reason: string) {
    // reason must NOT include API keys, env values, or stack traces
    super(`Translation provider unavailable`);
    this.name = 'TranslationProviderUnavailableError';
    // The sanitized internal reason is used for logging only, never exposed to clients
    if (typeof reason === 'string' && reason.length > 0) {
      Object.defineProperty(this, '_internalReason', { value: reason, enumerable: false });
    }
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

import { ReaderTranslationProvider } from './readerTranslation.types';

export function resolveTranslationProvider(): ReaderTranslationProvider {
  if (process.env.NODE_ENV === 'test' && (global as any).__mockResolveTranslationProvider) {
    return (global as any).__mockResolveTranslationProvider();
  }

  throw new TranslationProviderUnavailableError('No server-side reader translation engine is registered');
}
