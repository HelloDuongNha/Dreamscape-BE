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

import { ReaderTranslationProvider } from './readerTranslation.types';

export function resolveTranslationProvider(): ReaderTranslationProvider {
  throw new TranslationProviderUnavailableError('No server-side reader translation engine is registered');
}
