import AcademicChunk from '../../models/AcademicChunk';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSection from '../../models/AcademicSection';
import SourceContribution from '../../models/SourceContribution';
import {
  calculateSourceContentHash,
  CanonicalBlockIdentityError,
  deriveDocumentIdFromChunks,
  mapChunkToBlock,
} from './canonicalReaderIdentity.service';
import type { CanonicalReaderIdentity } from './canonicalReaderIdentity.types';
import { resolveReaderLanguage } from './readerLanguage.service';

export class SourcePreviewError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

function hasOriginalPdf(contribution: any): boolean {
  return !!contribution.originalFile?.originalFileName
    || !!contribution.originalFile?.cloudinarySecureUrl
    || !!contribution.originalFile?.firebaseStoragePath;
}

function buildSourceData(contribution: any, readerChunkCount: number, ragChunkCount: number) {
  const originalPdfAvailable = hasOriginalPdf(contribution) || !!contribution.pdfUrl;
  return {
    _id: contribution._id,
    title: contribution.title,
    authors: contribution.authors,
    year: contribution.year,
    journal: contribution.journal || contribution.publisher || '',
    publisher: contribution.publisher || '',
    doi: contribution.doi,
    url: contribution.url,
    pdfUrl: contribution.pdfUrl || contribution.originalFile?.cloudinarySecureUrl || '',
    htmlUrl: contribution.htmlUrl || '',
    allowedUse: contribution.allowedUse,
    license: contribution.license,
    reviewStatus: contribution.reviewStatus,
    submittedNote: contribution.submittedNote,
    originalFile: contribution.originalFile,
    fullTextStatus: contribution.fullTextStatus || 'none',
    previewStatus: readerChunkCount > 0 ? 'imported' : 'none',
    chunkBuildStatus: ragChunkCount > 0 ? 'completed' : 'none',
    readableInApp: contribution.fullTextStatus === 'imported' || readerChunkCount > 0,
    copyrightStatus: 'copyrighted_with_open_access',
    metadataResolved: !!(contribution.title && contribution.authors?.length),
    fullTextAvailable: contribution.allowedUse === 'open_access_fulltext',
    originalPdfAvailable,
    smartReaderAvailable: contribution.fullTextStatus === 'imported',
    hasPdf: originalPdfAvailable,
    canInlinePreview: originalPdfAvailable,
    inlineProxyUrl: originalPdfAvailable ? `/moderation/sources/${contribution._id}/pdf-inline` : '',
    externalOpenUrl: contribution.pdfUrl || contribution.url || '',
    failureReason: contribution.fullTextStatus === 'failed' ? 'Lỗi khi nhập bản đọc.' : '',
    readerChunkCount,
    ragChunkCount,
    totalChunkCount: readerChunkCount + ragChunkCount,
    parserWarnings: [],
    ocrNeeded: false,
    sourceType: contribution.doi ? 'doi' : (hasOriginalPdf(contribution) ? 'uploaded_pdf' : 'web_url'),
    smartReaderStats: contribution.smartReaderStats,
    pdfPageCount: contribution.pdfPageCount,
    extractionMethod: contribution.extractionMethod,
    pdfImportProgress: contribution.pdfImportProgress,
    pdfImportHistory: contribution.pdfImportHistory || [],
    readerBuildSnapshots: contribution.readerBuildSnapshots || [],
  };
}

function resolveDocumentId(document: any, chunks: any[]): string {
  if (document) return document._id.toString();
  try {
    return deriveDocumentIdFromChunks(chunks);
  } catch (error: any) {
    if (error.message === 'AMBIGUOUS_DOCUMENT_ID') {
      throw new SourcePreviewError(400, 'reader_identity_ambiguous', 'Ambiguous document reference in reader chunks.');
    }
    throw new SourcePreviewError(400, 'reader_identity_unavailable', 'Reader document identity could not be determined.');
  }
}

export async function loadSourcePreview(contributionId: string) {
  const contribution = await SourceContribution.findById(contributionId);
  if (!contribution) {
    throw new SourcePreviewError(404, undefined, 'Không tìm thấy đóng góp này.');
  }

  const [readerChunkCount, ragChunkCount, document] = await Promise.all([
    AcademicChunk.countDocuments({ previewContributionId: contribution._id, chunkPurpose: 'reader' }),
    AcademicChunk.countDocuments({ previewContributionId: contribution._id, chunkPurpose: 'rag' }),
    AcademicDocument.findOne({ previewContributionId: contribution._id }),
  ]);
  const source = buildSourceData(contribution, readerChunkCount, ragChunkCount);
  const chunks = document
    ? await AcademicChunk.find({ documentId: document._id, chunkPurpose: 'reader' }).sort({ chunkOrder: 1 })
    : await AcademicChunk.find({ previewContributionId: contribution._id, chunkPurpose: 'reader' }).sort({ chunkOrder: 1 });

  if (!chunks.length) {
    return { source, fullText: null, readerIdentity: null, sections: [] };
  }

  const documentId = resolveDocumentId(document, chunks);
  const storedSections = await AcademicSection.find({ documentId }).sort({ sectionOrder: 1 });
  const sectionMap = new Map(storedSections.map(section => [section._id.toString(), section]));
  let sections;
  try {
    sections = chunks.map((chunk, index) => mapChunkToBlock(chunk, sectionMap, 0, index));
  } catch (error) {
    if (error instanceof CanonicalBlockIdentityError) {
      throw new SourcePreviewError(400, 'reader_block_identity_invalid', 'A reader block has invalid canonical identity.');
    }
    throw error;
  }

  const readerIdentity: CanonicalReaderIdentity = {
    documentId,
    sourceLanguage: resolveReaderLanguage(contribution.detectedLanguage, chunks),
    sourceContentHash: calculateSourceContentHash(chunks),
    parserEngine: document?.parserEngine || null,
    parserVersion: document?.parserVersion != null ? String(document.parserVersion) : null,
    updatedAt: document?.updatedAt ? document.updatedAt.toISOString() : null,
  };
  const fullText = {
    wordCount: chunks.reduce((total, chunk) => total + chunk.text.split(/\s+/).filter(Boolean).length, 0),
    characterCount: chunks.reduce((total, chunk) => total + chunk.text.length, 0),
    sectionCount: chunks.length,
    importedAt: document?.createdAt || (contribution as any).updatedAt,
    extractionEngine: document?.parserEngine || 'GenericHtmlParser',
    extractionQuality: 'high',
    structureVersion: 'smart-reader-v2',
  };
  if (document) {
    Object.assign(source, {
      readerSectionCount: storedSections.length,
      readerParserEngine: document.parserEngine,
      readerBuiltAt: document.updatedAt,
    });
  }
  return { source, fullText, readerIdentity, sections };
}
