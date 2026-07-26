/**
 * Test-only fake translation provider.
 *
 * NEVER import this file from any production module.
 * This file exists solely for use in test suites via dependency injection.
 * It cannot be reached through any environment variable or production registry path.
 *
 * Behavior: echoes each source text back with a "[FAKE_TRANSLATED: ...]" wrapper,
 * or can be pre-configured with explicit targetId→translatedText mappings.
 */
import {
  ReaderTranslationProvider,
  ReaderTranslationBatchRequest,
  ReaderTranslationBatchResponse,
  ProviderMetadata,
  ProviderTranslationOutput,
} from '../readerTranslation.types';

export interface FakeProviderOptions {
  /**
   * Optional explicit map of targetId → translatedText.
   * If a targetId is not in the map, the fake will echo the source text.
   */
  translations?: Record<string, string>;

  /**
   * If true, the fake will throw a provider error for all batch calls.
   */
  alwaysThrow?: boolean;

  /**
   * If set, the fake simulates a timeout error on batch calls.
   */
  alwaysTimeout?: boolean;

  /**
   * If set, the fake returns a malformed output (schema-invalid).
   */
  returnMalformedOutput?: boolean;
}

/**
 * Fake translation provider for use in tests only.
 * Injected directly via TranslationServiceDeps.resolveProvider in tests.
 * Never registered in the production registry.
 */
export class FakeReaderTranslationProvider implements ReaderTranslationProvider {
  private readonly options: FakeProviderOptions;

  constructor(options: FakeProviderOptions = {}) {
    this.options = options;
  }

  getMetadata(): ProviderMetadata {
    return {
      name: 'fake',
      model: 'fake-v1',
      isConfigured: true,
    };
  }

  async translateBatch(
    request: ReaderTranslationBatchRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ReaderTranslationBatchResponse> {
    // Respect abort signal
    if (opts?.signal?.aborted) {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      throw err;
    }

    if (this.options.alwaysTimeout) {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      throw err;
    }

    if (this.options.alwaysThrow) {
      throw new Error('Fake provider error');
    }

    if (this.options.returnMalformedOutput) {
      // Return invalid output that the validator will reject
      return {
        output: { items: [] } as unknown as ProviderTranslationOutput,
      };
    }

    const items = request.envelope.items.map((item) => ({
      targetId: item.targetId,
      translatedText:
        this.options.translations?.[item.targetId] ??
        `[FAKE_TRANSLATED: ${item.text}]`,
    }));

    return {
      output: { items },
    };
  }
}
