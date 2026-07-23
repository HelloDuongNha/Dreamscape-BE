/**
 * Phase I18N-3B.2A — Request & Target Validator
 *
 * Validates incoming TranslateReaderRequest before any database load or provider call.
 * Enforces both HTTP body limit (A) and canonical provider-input limit (B) separately.
 * Pure functions: no I/O other than targeted database queries delegated via loadChunks.
 */
import mongoose from 'mongoose';
import {
  TranslateReaderRequest,
  TranslationTargetRequest,
  ChunkForTranslation,
  MAX_TARGETS_PER_REQUEST,
  MAX_HTTP_BODY_BYTES,
  MAX_CANONICAL_INPUT_BYTES,
  AppLocale,
} from './readerTranslation.types';
import {
  validateTargetBlockTypeCompatibility,
  computeContentHash,
  isPurelyNonTranslatableCell,
} from './readerTranslationClassifier.service';

// ─── Error Codes ─────────────────────────────────────────────────────────────

export type TranslationValidationErrorCode =
  | 'reader_translation_request_invalid'
  | 'reader_translation_target_invalid'
  | 'reader_translation_limit_exceeded'
  | 'reader_translation_identity_stale'
  | 'reader_translation_document_unavailable';

export interface TranslationValidationError {
  code: TranslationValidationErrorCode;
  httpStatus: 400 | 404 | 409 | 413;
}

const VALID_LOCALES: ReadonlySet<string> = new Set(['vi', 'en']);
const VALID_TARGET_TYPES: ReadonlySet<string> = new Set([
  'block_text',
  'figure_caption',
  'table_cell',
]);
const CONTENT_HASH_RE = /^[a-f0-9]{64}$/;

// ─── HTTP Body Limit Check ────────────────────────────────────────────────────

/**
 * Check A: HTTP request payload limit.
 * Must be called with the raw serialized request body before any DB query.
 */
export function checkHttpBodyLimit(rawBodyBytes: number): TranslationValidationError | null {
  if (rawBodyBytes > MAX_HTTP_BODY_BYTES) {
    return { code: 'reader_translation_limit_exceeded', httpStatus: 413 };
  }
  return null;
}

// ─── Request Shape Validation ─────────────────────────────────────────────────

export function validateRequestShape(
  body: unknown
): { valid: true; request: TranslateReaderRequest } | { valid: false; error: TranslationValidationError } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: { code: 'reader_translation_request_invalid', httpStatus: 400 } };
  }
  const b = body as Record<string, unknown>;

  // sourceContentHash
  if (typeof b.sourceContentHash !== 'string' || !CONTENT_HASH_RE.test(b.sourceContentHash)) {
    return { valid: false, error: { code: 'reader_translation_request_invalid', httpStatus: 400 } };
  }

  // targetLocale
  if (typeof b.targetLocale !== 'string' || !VALID_LOCALES.has(b.targetLocale)) {
    return { valid: false, error: { code: 'reader_translation_request_invalid', httpStatus: 400 } };
  }

  // targets
  if (!Array.isArray(b.targets)) {
    return { valid: false, error: { code: 'reader_translation_request_invalid', httpStatus: 400 } };
  }

  if (b.targets.length === 0) {
    return { valid: false, error: { code: 'reader_translation_request_invalid', httpStatus: 400 } };
  }

  if (b.targets.length > MAX_TARGETS_PER_REQUEST) {
    return { valid: false, error: { code: 'reader_translation_limit_exceeded', httpStatus: 413 } };
  }

  const seenKeys = new Set<string>();

  for (const t of b.targets) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }
    const target = t as Record<string, unknown>;

    if (typeof target.targetType !== 'string' || !VALID_TARGET_TYPES.has(target.targetType)) {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }

    if (typeof target.chunkId !== 'string' || !mongoose.Types.ObjectId.isValid(target.chunkId)) {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }

    if (typeof target.contentHash !== 'string' || !CONTENT_HASH_RE.test(target.contentHash)) {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }

    // table_cell requires row and column
    if (target.targetType === 'table_cell') {
      if (
        typeof target.row !== 'number' ||
        !Number.isInteger(target.row) ||
        target.row < 0 ||
        typeof target.column !== 'number' ||
        !Number.isInteger(target.column) ||
        target.column < 0
      ) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }

      // Duplicate check for table_cell
      const key = `table_cell:${target.chunkId}:${target.row}:${target.column}`;
      if (seenKeys.has(key)) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }
      seenKeys.add(key);
    } else {
      // Duplicate check for block_text / figure_caption
      const key = `${target.targetType}:${target.chunkId}`;
      if (seenKeys.has(key)) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }
      seenKeys.add(key);
    }
  }

  return {
    valid: true,
    request: {
      sourceContentHash: b.sourceContentHash as string,
      targetLocale: b.targetLocale as AppLocale,
      targets: b.targets as TranslationTargetRequest[],
    },
  };
}

// ─── Target Validation Against Loaded Chunks ─────────────────────────────────

export type TargetValidationResult =
  | { valid: true }
  | { valid: false; error: TranslationValidationError };

/**
 * Validates each request target against the loaded canonical chunks.
 * Checks:
 * - chunk exists in document (not foreign, not from another doc)
 * - chunkPurpose === 'reader'
 * - targetType/blockType compatibility
 * - contentHash matches sha256(canonical text for target)
 * - table_cell: tableData exists, cell address valid and unique, contentHash matches cell text
 */
export function validateTargetsAgainstChunks(
  targets: TranslationTargetRequest[],
  chunkMap: Map<string, ChunkForTranslation>,
  documentId: string
): TargetValidationResult {
  for (const target of targets) {
    const chunk = chunkMap.get(target.chunkId);

    // Foreign or non-existent chunk (no existence leakage — same 400 code)
    if (!chunk) {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }

    // Must belong to the resolved document
    if (chunk.documentId?.toString() !== documentId) {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }

    // Must be a reader chunk
    if (chunk.chunkPurpose !== 'reader') {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }

    // targetType/blockType compatibility
    const compatError = validateTargetBlockTypeCompatibility(target, chunk);
    if (compatError) {
      return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
    }

    // contentHash and table_cell specific validation
    if (target.targetType === 'table_cell') {
      if (!chunk.tableData) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }
      if (target.row >= chunk.tableData.rowCount || target.column >= chunk.tableData.columnCount) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }

      // Exactly one matching cell at (row, column)
      const matchingCells = chunk.tableData.cells.filter(
        (c) => c.row === target.row && c.column === target.column
      );
      if (matchingCells.length !== 1) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }
      const cell = matchingCells[0];

      // contentHash must match cell.text
      if (computeContentHash(cell.text) !== target.contentHash) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }
    } else if (target.targetType === 'block_text' || target.targetType === 'figure_caption') {
      // contentHash must match chunk.text
      if (computeContentHash(chunk.text) !== target.contentHash) {
        return { valid: false, error: { code: 'reader_translation_target_invalid', httpStatus: 400 } };
      }
    }
  }

  return { valid: true };
}

// ─── Canonical Provider Input Limit (B) ──────────────────────────────────────

/**
 * Computes exact serialized provider envelope bytes and checks against the limit.
 * Only eligible targets (post-classifier) contribute text bytes.
 * Uses Buffer.byteLength(JSON.stringify(envelope), 'utf8') for exact measurement.
 */
export function checkCanonicalProviderInputLimit(
  eligibleItems: Array<{ targetId: string; text: string }>
): TranslationValidationError | null {
  if (eligibleItems.length === 0) return null;

  const envelope = { items: eligibleItems };
  const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');

  if (bytes > MAX_CANONICAL_INPUT_BYTES) {
    return { code: 'reader_translation_limit_exceeded', httpStatus: 413 };
  }
  return null;
}
