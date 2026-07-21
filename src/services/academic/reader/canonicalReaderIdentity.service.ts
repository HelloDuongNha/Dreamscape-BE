import crypto from 'node:crypto';
import {
  ApiResponseSection,
  CanonicalReaderBlockIdentity,
  CanonicalReaderSectionIdentity
} from './canonicalReaderIdentity.types';

/**
 * Computes individual chunk SHA-256 of text using UTF-8.
 */
export function calculateCanonicalChunkContentHash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Computes the source content hash across the full sorted canonical chunk set.
 * Makes a defensive copy and sorts by chunkOrder ascending.
 */
export function calculateSourceContentHash(
  chunks: Array<{ _id: any; text: string; chunkOrder: number }>
): string {
  const copy = [...chunks].sort((a, b) => a.chunkOrder - b.chunkOrder);
  const joined = copy
    .map(chunk => `${chunk._id.toString()}:${chunk.text}`)
    .join('\n');
  return crypto.createHash('sha256').update(joined, 'utf8').digest('hex');
}

/**
 * Normalizes language code.
 * vi, vi-VN, vi_VN -> vi
 * en, en-US, en_GB -> en
 * empty, und, unknown, malformed or unsupported -> null
 */
export function normalizeLanguageCode(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const cleaned = lang.trim().toLowerCase();
  if (!cleaned || cleaned === 'unknown' || cleaned === 'und') return null;
  const base = cleaned.split(/[_-]/)[0];
  if (base === 'vi' || base === 'en') return base;
  return null;
}

/**
 * Derives documentId from chunks when they all reference one unique non-empty documentId.
 * Throws a sanitized contract-level error if ambiguous or no chunks.
 */
export function deriveDocumentIdFromChunks(chunks: Array<{ documentId: any }>): string {
  if (!chunks || chunks.length === 0) {
    throw new Error('DOCUMENT_ID_UNAVAILABLE');
  }
  const docIds = Array.from(
    new Set(
      chunks
        .map(c => c.documentId?.toString())
        .filter(Boolean)
    )
  );
  if (docIds.length === 1) {
    return docIds[0];
  }
  throw new Error('AMBIGUOUS_DOCUMENT_ID');
}

/**
 * Maps a single chunk to the API response section with block and section identities.
 */
export function mapChunkToBlock(
  chunk: any,
  sectionMap: Map<string, any>,
  skip: number,
  idx: number
): ApiResponseSection {
  const parentSec = chunk.sectionId ? sectionMap.get(chunk.sectionId.toString()) : undefined;
  const sectionType = chunk.blockType || (parentSec ? parentSec.sectionType : 'paragraph');

  const blockIdentity: CanonicalReaderBlockIdentity = {
    chunkId: chunk._id.toString(),
    sectionId: chunk.sectionId ? chunk.sectionId.toString() : '',
    chunkIndex: chunk.chunkOrder,
    contentHash: calculateCanonicalChunkContentHash(chunk.text)
  };

  const sectionIdentity: CanonicalReaderSectionIdentity | null = chunk.sectionId
    ? {
        sectionId: chunk.sectionId.toString(),
        sectionOrder: parentSec && parentSec.sectionOrder != null ? parentSec.sectionOrder : null,
        heading: parentSec && parentSec.heading ? parentSec.heading : null,
        sectionType: parentSec && parentSec.sectionType ? parentSec.sectionType : null
      }
    : null;

  return {
    sectionIndex: skip + idx,
    sectionType,
    text: chunk.text,
    html: chunk.html || null,
    marker: chunk.marker || null,
    pageStart: 1,
    pageEnd: 1,
    blockIdentity,
    sectionIdentity
  };
}
