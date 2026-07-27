import AcademicChunk from '../../models/AcademicChunk';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSource from '../../models/AcademicSource';
import type { ApprovedSourceReaderQuery } from '../../dto/approvedSource.dto';
import { buildReaderResponse } from './readerResponseBuilder.service';
import {
  calculateSourceContentHash,
  CanonicalBlockIdentityError,
} from './canonicalReaderIdentity.service';
import { resolveReaderLanguage } from './readerLanguage.service';

export class ApprovedSourceReaderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function loadApprovedSourceReader(id: string, query: ApprovedSourceReaderQuery) {
  const source = await AcademicSource.findById(id);
  if (!source) throw new ApprovedSourceReaderError(404, 'Không tìm thấy tài liệu này.');

  const sourceData = source as any;
  const isEligible = sourceData.readableInApp === true
    && sourceData.fullTextStatus === 'imported'
    && sourceData.allowedUse === 'open_access_fulltext';
  if (!isEligible) {
    throw new ApprovedSourceReaderError(
      403,
      'Tài liệu này không có bản đọc đầy đủ trong ứng dụng hoặc chưa được nhập.',
    );
  }

  const fullText = await AcademicDocument.findOne({ sourceId: source._id });
  if (!fullText) {
    throw new ApprovedSourceReaderError(404, 'Không tìm thấy dữ liệu văn bản cho tài liệu này.');
  }

  const skip = (query.page - 1) * query.limit;
  try {
    const readerData = await buildReaderResponse(fullText, skip, query.limit);
    if (readerData.total === 0) {
      throw new ApprovedSourceReaderError(409, 'Tài liệu này không chứa dữ liệu văn bản.');
    }

    const allChunks = await AcademicChunk.find(
      { documentId: fullText._id, chunkPurpose: 'reader' },
      { _id: 1, text: 1, chunkOrder: 1 },
    ).sort({ chunkOrder: 1 }).lean();
    const fullTextData = fullText as any;

    return {
      source: {
        id: source._id,
        title: source.title,
        authors: source.authors,
        year: source.year,
        journal: source.journal,
        doi: source.doi,
        license: source.license,
      },
      fullText: {
        wordCount: fullTextData.wordCount || 0,
        characterCount: fullTextData.characterCount || 0,
        sectionCount: readerData.total,
        importedAt: fullTextData.importedAt || fullTextData.createdAt,
        extractionEngine: fullTextData.extractionEngine || fullTextData.parserEngine,
        extractionQuality: fullTextData.extractionQuality || 'high',
        structureVersion: fullTextData.structureVersion || 'smart-reader-v2',
        hasStructuredReferences: fullTextData.hasStructuredReferences,
        hasDetectedSections: fullTextData.hasDetectedSections,
        sourceUsedUrl: fullTextData.sourceUsedUrl,
        sourceUsedType: fullTextData.sourceUsedType,
        smartReaderSourceType: fullTextData.smartReaderSourceType,
        sourceUrlUsed: fullTextData.sourceUrlUsed,
        parserQuality: fullTextData.parserQuality,
        layoutQuality: fullTextData.layoutQuality,
        warnings: fullTextData.warnings,
      },
      readerIdentity: {
        documentId: fullText._id.toString(),
        sourceLanguage: resolveReaderLanguage(source.detectedLanguage, allChunks),
        sourceContentHash: calculateSourceContentHash(allChunks),
        parserEngine: fullText.parserEngine || null,
        parserVersion: fullText.parserVersion != null ? String(fullText.parserVersion) : null,
        updatedAt: fullText.updatedAt ? fullText.updatedAt.toISOString() : null,
      },
      sections: readerData.sections,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: readerData.total,
        pages: Math.ceil(readerData.total / query.limit),
      },
    };
  } catch (error) {
    if (error instanceof ApprovedSourceReaderError) throw error;
    if (error instanceof CanonicalBlockIdentityError) {
      throw new ApprovedSourceReaderError(
        400,
        'Dữ liệu đoạn văn bản không hợp lệ.',
        'reader_block_identity_invalid',
      );
    }
    throw error;
  }
}
