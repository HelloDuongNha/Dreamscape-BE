import crypto from 'node:crypto';
import {
  ApiResponseSection,
  CanonicalReaderBlockIdentity,
  CanonicalReaderSectionIdentity
} from './canonicalReaderIdentity.types';

/**
 * Typed contract error thrown when a chunk's canonical identity fields are invalid.
 */
export class CanonicalBlockIdentityError extends Error {
  readonly code = 'reader_block_identity_invalid';
  constructor(reason: string) {
    super(`BLOCK_IDENTITY_INVALID: ${reason}`);
    this.name = 'CanonicalBlockIdentityError';
  }
}

/**
 * Computes individual chunk SHA-256 of text using UTF-8.
 */
export function calculateCanonicalChunkContentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Computes the source content hash across the full sorted canonical chunk set.
 * Makes a defensive copy and sorts by chunkOrder ascending.
 * Does NOT normalize, trim, or modify canonical text.
 */
export function calculateSourceContentHash(
  chunks: Array<{ _id: any; text: string; chunkOrder: number }>
): string {
  if (!chunks) {
    throw new CanonicalBlockIdentityError('chunks array is null or undefined');
  }

  for (const chunk of chunks) {
    if (!chunk) {
      throw new CanonicalBlockIdentityError('chunk element is null or undefined');
    }
    const chunkIdStr = chunk._id?.toString?.();
    if (!chunkIdStr) {
      throw new CanonicalBlockIdentityError('chunk._id is absent or empty');
    }
    if (typeof chunk.text !== 'string') {
      throw new CanonicalBlockIdentityError('chunk.text is not a string');
    }
    if (typeof chunk.chunkOrder !== 'number' || !Number.isFinite(chunk.chunkOrder)) {
      throw new CanonicalBlockIdentityError('chunk.chunkOrder is not a finite number');
    }
  }

  const copy = [...chunks].sort((a, b) => a.chunkOrder - b.chunkOrder);
  const joined = copy
    .map(chunk => `${chunk._id.toString()}:${chunk.text}`)
    .join('\n');
  return crypto.createHash('sha256').update(joined, 'utf8').digest('hex');
}

/**
 * Normalizes language code.
 * Accepted forms (case-insensitive):
 *   vi, vi-VN, vi_VN, en, en-US, en_GB,
 *   and other vi/en tags with exactly a two-letter alphabetic region.
 *
 * Rejected: vi-???, en-123, vi-extra-long, vi--VN, arbitrary prose,
 * unsupported languages, empty, unknown, und.
 *
 * Returns "vi", "en", or null. Never writes to the database.
 */
export function normalizeLanguageCode(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const cleaned = lang.trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned === 'unknown' || cleaned === 'und') return null;

  // Match: base tag optionally followed by exactly one [-_] and exactly two alphabetic chars
  // Rejects: double dash (vi--VN), numeric region (en-123), long region (vi-extra)
  const match = cleaned.match(/^(vi|en)(?:[_-]([a-z]{2}))?$/);
  if (!match) return null;

  // match[1] is the base: 'vi' or 'en'
  return match[1] as 'vi' | 'en';
}

/**
 * Derives documentId from chunks when they all reference one unique non-empty documentId.
 * Every chunk must have a non-empty documentId.
 * Throws a sanitized contract-level error if any chunk is missing a documentId,
 * chunks contain multiple distinct IDs, or the input is empty.
 */
export function deriveDocumentIdFromChunks(chunks: Array<{ documentId: any }>): string {
  if (!chunks || chunks.length === 0) {
    throw new Error('DOCUMENT_ID_UNAVAILABLE');
  }

  // Reject before de-duplication: any chunk missing a documentId
  for (const c of chunks) {
    const id = c.documentId?.toString?.();
    if (!id) {
      throw new Error('DOCUMENT_ID_UNAVAILABLE');
    }
  }

  const docIds = Array.from(new Set(chunks.map(c => c.documentId.toString())));

  if (docIds.length === 1) {
    return docIds[0];
  }
  throw new Error('AMBIGUOUS_DOCUMENT_ID');
}

/**
 * Maps a single chunk to the API response section with block and section identities.
 *
 * Required canonical fields on chunk:
 * - non-empty _id
 * - non-empty sectionId
 * - finite numeric chunkOrder
 * - string text
 *
 * Throws CanonicalBlockIdentityError if any required field is absent or invalid.
 * Missing AcademicSection metadata is still allowed (sectionOrder, heading, sectionType -> null).
 */
export function mapChunkToBlock(
  chunk: any,
  sectionMap: Map<string, any>,
  skip: number,
  idx: number
): ApiResponseSection {
  // Validate required canonical identity fields
  const chunkIdStr = chunk._id?.toString?.();
  if (!chunkIdStr) {
    throw new CanonicalBlockIdentityError('chunk._id is absent or empty');
  }
  const sectionIdStr = chunk.sectionId?.toString?.();
  if (!sectionIdStr) {
    throw new CanonicalBlockIdentityError('chunk.sectionId is absent or empty');
  }
  if (typeof chunk.chunkOrder !== 'number' || !Number.isFinite(chunk.chunkOrder)) {
    throw new CanonicalBlockIdentityError('chunk.chunkOrder is not a finite number');
  }
  if (typeof chunk.text !== 'string') {
    throw new CanonicalBlockIdentityError('chunk.text is not a string');
  }

  const parentSec = sectionMap.get(sectionIdStr);
  const sectionType = chunk.blockType || (parentSec ? parentSec.sectionType : 'paragraph');

  const blockIdentity: CanonicalReaderBlockIdentity = {
    chunkId: chunkIdStr,
    sectionId: sectionIdStr,
    chunkIndex: chunk.chunkOrder,
    contentHash: calculateCanonicalChunkContentHash(chunk.text)
  };

  const sectionIdentity: CanonicalReaderSectionIdentity = {
    sectionId: sectionIdStr,
    sectionOrder: parentSec && parentSec.sectionOrder != null ? parentSec.sectionOrder : null,
    heading: parentSec && parentSec.heading ? parentSec.heading : null,
    sectionType: parentSec && parentSec.sectionType ? parentSec.sectionType : null
  };

  let tableData = null;
  if (chunk.tableData) {
    const rawCells = chunk.tableData.cells || [];
    const projectedCells = rawCells.map((c: any) => ({
      row: c.row,
      column: c.column,
      rowSpan: c.rowSpan || 1,
      columnSpan: c.columnSpan || 1,
      text: c.text || '',
      role: c.role || 'data'
    }));
    tableData = {
      version: chunk.tableData.version || 1,
      source: chunk.tableData.source || '',
      reconstructionMethod: chunk.tableData.reconstructionMethod || '',
      rowCount: chunk.tableData.rowCount || 0,
      columnCount: chunk.tableData.columnCount || 0,
      cells: projectedCells
    };
  }

  return {
    sectionIndex: skip + idx,
    sectionType,
    text: chunk.text,
    html: chunk.html || null,
    marker: chunk.marker || null,
    pageStart: 1,
    pageEnd: 1,
    blockIdentity,
    sectionIdentity,
    tableData
  };
}
