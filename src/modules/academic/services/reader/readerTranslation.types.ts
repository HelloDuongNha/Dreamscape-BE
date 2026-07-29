import { IncomingMessage } from 'http';

declare module 'http' {
  interface IncomingMessage {
    rawBodyLength?: number;
  }
}

export type AppLocale = 'vi' | 'en';

// ─── Request ─────────────────────────────────────────────────────────────────

/**
 * Public translation target from the client.
 * documentId and sourceLanguage are NOT accepted from clients —
 * the server derives both from the route-resolved canonical source record.
 */
export type TranslationTargetRequest =
  | {
      targetType: 'block_text' | 'figure_caption';
      chunkId: string;
      contentHash: string; // sha256(chunk.text) hex — 64 chars
    }
  | {
      targetType: 'table_cell';
      chunkId: string;
      row: number;
      column: number;
      contentHash: string; // sha256(cell.text) hex — 64 chars
    };

export interface TranslateReaderRequest {
  sourceContentHash: string;
  targetLocale: AppLocale;
  targets: TranslationTargetRequest[];
}

// ─── Target Identity ─────────────────────────────────────────────────────────

export type TranslationTargetIdentity =
  | {
      targetType: 'block_text' | 'figure_caption';
      chunkId: string;
      contentHash: string;
    }
  | {
      targetType: 'table_cell';
      chunkId: string;
      row: number;
      column: number;
      contentHash: string;
    };

// ─── Per-Target Discriminated Result ─────────────────────────────────────────

/** Provider-level failure reason codes */
export type TranslationProviderFailureCode =
  | 'translation_timeout'
  | 'translation_schema_invalid'
  | 'translation_output_too_large'
  | 'translation_provider_failed';

/**
 * Successful translation: translatedText is always a non-empty string.
 * Not present on any other variant.
 */
export type SuccessfulTranslatedTarget = TranslationTargetIdentity & {
  status: 'translated';
  translatedText: string;
};

/**
 * Non-translated target: no translatedText, no providerFailureCode.
 * Frontend falls back to canonical original text.
 */
export type NonTranslatedTarget = TranslationTargetIdentity & {
  status:
    | 'same_language'
    | 'excluded_reference'
    | 'excluded_structured_content'
    | 'source_language_unknown';
};

/**
 * Failed translation: providerFailureCode present, no translatedText.
 * Frontend falls back to canonical original text for this target only.
 */
export type FailedTranslationTarget = TranslationTargetIdentity & {
  status: 'provider_failed';
  providerFailureCode: TranslationProviderFailureCode;
};

/** Full discriminated union for one translated target item */
export type TranslatedTargetItem =
  | SuccessfulTranslatedTarget
  | NonTranslatedTarget
  | FailedTranslationTarget;

// ─── Response ─────────────────────────────────────────────────────────────────

export interface TranslateReaderResponse {
  sourceContentHash: string;
  sourceLanguage: string | null;
  targetLocale: AppLocale;
  engineName: string | null;
  modelName: string | null;
  normalizationVersion: string;
  translationSchemaVersion: string;
  /** Targets in exactly the validated request order */
  targets: TranslatedTargetItem[];
}

// ─── Canonical Context (server-derived, never from client) ────────────────────

export interface CanonicalTranslationContext {
  /** Derived from the route-resolved AcademicDocument */
  documentId: string;
  /** normalizeLanguageCode(source.detectedLanguage) */
  sourceLanguage: string | null;
  /** calculateSourceContentHash(allReaderChunks) */
  sourceContentHash: string;
}

// ─── Resolution Error (typed, sanitized) ──────────────────────────────────────

export type CanonicalResolutionErrorCode =
  | 'reader_translation_document_unavailable'  // 404: source/doc/contribution not found
  | 'reader_translation_forbidden'             // 403: source not eligible for reading
  | 'reader_block_identity_invalid'            // 400: canonical block identity contract broken
  | 'reader_translation_internal_error';       // 500: unexpected error

export class CanonicalResolutionError extends Error {
  readonly code: CanonicalResolutionErrorCode;
  readonly httpStatus: 400 | 403 | 404 | 500;

  constructor(code: CanonicalResolutionErrorCode, httpStatus: 400 | 403 | 404 | 500, detail?: string) {
    super(`CanonicalResolutionError[${code}]${detail ? ': ' + detail : ''}`);
    this.name = 'CanonicalResolutionError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ─── Provider Input / Output ──────────────────────────────────────────────────

export interface ProviderTranslationItem {
  /** Encoding: block_text/figure_caption: chunkId; table_cell: "chunkId:row:col" */
  targetId: string;
  text: string;
}

/** Exact provider-neutral data envelope — all providers use this shape */
export interface ProviderTranslationEnvelope {
  items: ProviderTranslationItem[];
}

export interface ProviderTranslationResultItem {
  targetId: string;
  translatedText: string;
}

export interface ProviderTranslationOutput {
  items: ProviderTranslationResultItem[];
}

export interface ProviderMetadata {
  name: string;
  model: string;
  isConfigured: boolean;
}

export interface ReaderTranslationBatchRequest {
  sourceLanguage: AppLocale;
  targetLocale: AppLocale;
  envelope: ProviderTranslationEnvelope;
}

export interface ReaderTranslationBatchResponse {
  output: ProviderTranslationOutput;
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface ReaderTranslationProvider {
  getMetadata(): ProviderMetadata;
  translateBatch(
    request: ReaderTranslationBatchRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ReaderTranslationBatchResponse>;
}

// ─── Application Service Limits & Constants ───────────────────────────────────

/** Maximum number of targets per request */
export const MAX_TARGETS_PER_REQUEST = 40;

/** Maximum HTTP request body bytes (protects Express layer) */
export const MAX_HTTP_BODY_BYTES = 65_536; // 64 KiB

/**
 * Maximum canonical provider-input bytes.
 * Measured as Buffer.byteLength(JSON.stringify(envelope), 'utf8') for eligible
 * targets only. Excluded targets do not count.
 */
export const MAX_CANONICAL_INPUT_BYTES = 24_576; // 24 KiB

/**
 * Maximum total serialized provider output bytes across ALL batches
 * in a single translation request.
 */
export const MAX_PROVIDER_OUTPUT_BYTES = 65_536; // 64 KiB

/** Dedicated machine-translation batch size per worker call. */
export const MT_BATCH_SIZE = 15;

/** Maximum concurrent provider batches */
export const MAX_CONCURRENCY = 2;

/** Schema and prompt versioning */
export const TRANSLATION_SCHEMA_VERSION = '3B.2A.1';
export const NORMALIZATION_VERSION = 'MT1.0';

// ─── Service Call Shape ───────────────────────────────────────────────────────

/**
 * Full call shape for translateReaderTargets.
 * routeId and path are mandatory so the service never calls resolveCanonicalContext
 * with placeholder values.
 */
export interface TranslationServiceCallParams {
  routeId: string;
  path: 'approved' | 'preview';
  request: TranslateReaderRequest;
  /** AbortSignal from client disconnect wiring (optional for tests) */
  clientSignal?: AbortSignal;
}

// ─── Dependency Injection Seams ───────────────────────────────────────────────

export interface TranslationServiceDeps {
  /** Resolves documentId, sourceLanguage, sourceContentHash from route source record */
  resolveCanonicalContext: (
    routeId: string,
    path: 'approved' | 'preview'
  ) => Promise<CanonicalTranslationContext>;

  /** Loads specific AcademicChunk records for target validation */
  loadChunks: (
    documentId: string,
    chunkIds: string[]
  ) => Promise<ChunkForTranslation[]>;

  /** Resolves active translation provider; throws TranslationProviderUnavailableError if unconfigured */
  resolveProvider: () => ReaderTranslationProvider;

  /** Clock injection for deterministic deadline tracking */
  now: () => number;

  /** Total request budget in ms (undefined = no hard cap) */
  deadlineMs: number | undefined;

  /** AbortController factory for provider call cancellation */
  createAbortController: () => AbortController;

  /**
   * Injectable timer for deterministic timeout in tests.
   * Defaults to global setTimeout/clearTimeout in production.
   */
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

/** Minimal chunk shape used within the translation service */
export interface ChunkForTranslation {
  _id: any;
  chunkPurpose: string;
  blockType?: string;
  text: string;
  html?: string;
  tableData?: {
    rowCount: number;
    columnCount: number;
    cells: Array<{
      row: number;
      column: number;
      rowSpan: number;
      columnSpan: number;
      text: string;
      role: 'header' | 'data';
    }>;
  };
  documentId: any;
}
