/**
 * Phase I18N-3B.2A — Canonical Translation Context Resolver
 *
 * Shared resolution helpers for building CanonicalTranslationContext and loading
 * AcademicChunk records for translation target validation.
 *
 * Used by both sourceController (approved path) and moderationController (preview path).
 * Zero DB writes. Identical hash formula as the established canonical identity service.
 */
import AcademicSource from '../../../models/AcademicSource';
import AcademicDocument from '../../../models/AcademicDocument';
import SourceContribution from '../../../models/SourceContribution';
import AcademicChunk from '../../../models/AcademicChunk';
import {
  calculateSourceContentHash,
  CanonicalBlockIdentityError,
} from './canonicalReaderIdentity.service';
import {
  CanonicalTranslationContext,
  CanonicalResolutionError,
  ChunkForTranslation,
} from './readerTranslation.types';
import { resolveReaderLanguage } from './readerLanguage.service';

// ─── Approved Source Path ─────────────────────────────────────────────────────

/**
 * Resolves canonical translation context for an approved academic source.
 *
 * Throws CanonicalResolutionError on all expected failure modes.
 * Never returns raw error messages or stack traces.
 */
export async function resolveApprovedSourceContext(
  sourceId: string
): Promise<CanonicalTranslationContext> {
  const source = await AcademicSource.findById(sourceId);
  if (!source) {
    throw new CanonicalResolutionError('reader_translation_document_unavailable', 404);
  }

  const srcAny = source as any;
  const isEligible =
    srcAny.readableInApp === true &&
    srcAny.fullTextStatus === 'imported' &&
    srcAny.allowedUse === 'open_access_fulltext';

  if (!isEligible) {
    throw new CanonicalResolutionError('reader_translation_forbidden', 403);
  }

  const doc = await AcademicDocument.findOne({ sourceId: source._id });
  if (!doc) {
    throw new CanonicalResolutionError('reader_translation_document_unavailable', 404);
  }

  // Load ALL reader chunks for full-document sourceContentHash
  const allChunks = await AcademicChunk.find(
    { documentId: doc._id, chunkPurpose: 'reader' },
    { _id: 1, text: 1, chunkOrder: 1 }
  )
    .sort({ chunkOrder: 1 })
    .lean();

  let sourceContentHash: string;
  try {
    sourceContentHash = calculateSourceContentHash(allChunks);
  } catch (err: any) {
    if (err instanceof CanonicalBlockIdentityError) {
      throw new CanonicalResolutionError('reader_block_identity_invalid', 400);
    }
    throw new CanonicalResolutionError('reader_translation_internal_error', 500);
  }

  return {
    documentId: doc._id.toString(),
    sourceLanguage: resolveReaderLanguage(srcAny.detectedLanguage, allChunks),
    sourceContentHash,
  };
}

// ─── Preview (Contribution) Path ──────────────────────────────────────────────

/**
 * Resolves canonical translation context for a moderation preview (contribution).
 *
 * Throws CanonicalResolutionError on all expected failure modes.
 * Moderation authorization (isModerator) is enforced at route middleware level.
 */
export async function resolvePreviewContributionContext(
  contributionId: string
): Promise<CanonicalTranslationContext> {
  const contribution = await SourceContribution.findById(contributionId);
  if (!contribution) {
    throw new CanonicalResolutionError('reader_translation_document_unavailable', 404);
  }

  const contribAny = contribution as any;
  const doc = await AcademicDocument.findOne({ previewContributionId: contribution._id });
  if (!doc) {
    throw new CanonicalResolutionError('reader_translation_document_unavailable', 404);
  }

  // Load ALL reader chunks for full-document sourceContentHash
  const allChunks = await AcademicChunk.find(
    { documentId: doc._id, chunkPurpose: 'reader' },
    { _id: 1, text: 1, chunkOrder: 1 }
  )
    .sort({ chunkOrder: 1 })
    .lean();

  let sourceContentHash: string;
  try {
    sourceContentHash = calculateSourceContentHash(allChunks);
  } catch (err: any) {
    if (err instanceof CanonicalBlockIdentityError) {
      throw new CanonicalResolutionError('reader_block_identity_invalid', 400);
    }
    throw new CanonicalResolutionError('reader_translation_internal_error', 500);
  }

  return {
    documentId: doc._id.toString(),
    sourceLanguage: resolveReaderLanguage(contribAny.detectedLanguage, allChunks),
    sourceContentHash,
  };
}

// ─── Shared Chunk Loader ──────────────────────────────────────────────────────

/**
 * Loads AcademicChunk records for translation target validation.
 * Scoped to the resolved documentId — never leaks across documents.
 * Zero writes.
 */
export async function loadTranslationChunks(
  documentId: string,
  chunkIds: string[]
): Promise<ChunkForTranslation[]> {
  return AcademicChunk.find(
    { _id: { $in: chunkIds }, documentId },
    { _id: 1, chunkPurpose: 1, blockType: 1, text: 1, html: 1, tableData: 1, documentId: 1 }
  ).lean();
}
