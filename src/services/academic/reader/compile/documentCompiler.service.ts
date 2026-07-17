import mongoose from 'mongoose';
import SourceContribution from '../../../../models/SourceContribution';
import AcademicSource from '../../../../models/AcademicSource';
import AcademicDocument from '../../../../models/AcademicDocument';
import { ExtractedDocument } from '../../types/extractedDocument.types';
import { CanonicalBlock, BlockType, SemanticType } from '../../types/canonical.types';
import { buildAndSaveSmartReaderData } from '../persistence/readerChunkBuilder.service';
import { calculateVirtualPageCount } from './paginationHelper';

export interface CompileExtractedDocumentInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  extractedDocument: ExtractedDocument;
  extractionMethod: 'pdf_text' | 'ocr' | 'jats' | 'html' | 'mixed';
  forceReplace?: boolean;
  parserEngine?: string;
  sourceType?: string;
}

export interface CompileExtractedDocumentResult {
  success: boolean;
  message: string;
  documentId?: string;
  readerChunkCount?: number;
  ragChunkCount?: number;
  sectionCount?: number;
  smartReaderStats?: {
    pageCount: number;
    figureCount: number;
    tableCount: number;
    referenceCount: number;
    updatedAt: Date;
  };
  extractionMethod: string;
  replacedExistingReader: boolean;
}

function mapSemanticType(bt: string): SemanticType {
  switch (bt) {
    case 'title':
      return 'title';
    case 'heading':
      return 'heading';
    case 'figure':
      return 'figure';
    case 'table':
      return 'table';
    case 'reference':
      return 'reference';
    case 'list_item':
      return 'list';
    case 'metadata':
      return 'metadata';
    default:
      return 'paragraph';
  }
}

/**
 * Shared compiler that converts an ExtractedDocument into the canonical Smart Reader database format.
 */
export async function compileExtractedDocument(
  input: CompileExtractedDocumentInput
): Promise<CompileExtractedDocumentResult> {
  const { targetType, targetId, extractedDocument, extractionMethod, forceReplace } = input;
  let replacedExistingReader = false;

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new Error('ID tài liệu không hợp lệ.');
  }

  // 1. Load target document
  let target: any = null;
  if (targetType === 'contribution') {
    target = await SourceContribution.findById(targetId);
  } else {
    target = await AcademicSource.findById(targetId);
  }

  if (!target) {
    throw new Error(`Không tìm thấy tài liệu với ID: ${targetId}`);
  }

  // 2. Enforce overwrite protection policies
  const hasExistingReader = target.readableInApp || target.fullTextStatus === 'imported';
  const existingMethod = target.extractionMethod;
  const isJatsOrHtml = existingMethod === 'jats' || existingMethod === 'html';

  if (hasExistingReader) {
    if (isJatsOrHtml && !forceReplace) {
      return {
        success: false,
        message: 'Tài liệu đã có bản đọc chất lượng cao (JATS XML/HTML). Bỏ qua việc ghi đè bản đọc PDF.',
        extractionMethod,
        replacedExistingReader: false
      };
    }

    if (!forceReplace && (existingMethod === 'pdf_text' || existingMethod === 'ocr')) {
      return {
        success: false,
        message: 'Tài liệu đã được dựng bản đọc từ PDF trước đó. Yêu cầu tham số forceReplace để ghi đè.',
        extractionMethod,
        replacedExistingReader: false
      };
    }
    
    replacedExistingReader = true;
  }

  // 3. Map ExtractedDocument pages/blocks to CanonicalBlock format
  const canonicalBlocks: CanonicalBlock[] = [];
  let blockCounter = 0;
  
  // Track heading context to link paragraphs to sections
  let currentSectionHeading: string | null = null;

  extractedDocument.pages.forEach((page) => {
    page.blocks.forEach((b) => {
      const blockType = b.blockType as BlockType;
      
      // Explicitly exclude metadata blocks from compiled reader blocks
      if (blockType === 'metadata') {
        return;
      }

      if (blockType === 'heading') {
        currentSectionHeading = b.text;
      }

      canonicalBlocks.push({
        blockType,
        semanticType: mapSemanticType(blockType),
        sectionHeading: currentSectionHeading || b.sectionHint || null,
        text: b.text,
        html: b.html || '',
        tableData: b.tableData,
        order: blockCounter++,
        pageNumber: page.physicalPageNumber
      });
    });
  });

  try {
    // 4. Delegate transactional database saves
    const isContribution = targetType === 'contribution';
    const persistenceResult = await buildAndSaveSmartReaderData(
      target,
      target.title || 'Untitled',
      canonicalBlocks,
      input.parserEngine || 'pymupdf',
      input.sourceType || 'pdf',
      isContribution
    );

    // 5. Calculate statistics using shared dynamic pageCount helper
    const figuresCount = canonicalBlocks.filter((b) => b.blockType === 'figure').length;
    const tablesCount = canonicalBlocks.filter((b) => b.blockType === 'table').length;
    const referencesCount = canonicalBlocks.filter((b) => b.blockType === 'reference').length;
    const smartReaderPageCount = calculateVirtualPageCount(canonicalBlocks);

    const smartReaderStats = {
      pageCount: smartReaderPageCount,
      figureCount: figuresCount,
      tableCount: tablesCount,
      referenceCount: referencesCount,
      updatedAt: new Date()
    };

    // 6. Query compiled AcademicDocument to get documentId
    const academicDoc = isContribution
      ? await AcademicDocument.findOne({ previewContributionId: target._id })
      : await AcademicDocument.findOne({ sourceId: target._id });

    // 7. Update target metadata state only after successful persistence
    target.pdfPageCount = extractedDocument.pageCount;
    target.smartReaderStats = smartReaderStats;
    target.readableInApp = true;
    target.fullTextStatus = 'imported';
    target.extractionMethod = extractionMethod;
    target.extractionQuality = extractedDocument.hasUsableTextLayer ? 'good' : 'poor';

    if (isContribution) {
      target.extractionStatus = 'completed';
    }

    await target.save();

    return {
      success: true,
      message: 'Dựng bản đọc thông minh từ PDF thành công.',
      documentId: academicDoc?._id.toString(),
      readerChunkCount: canonicalBlocks.length,
      ragChunkCount: persistenceResult.ragChunkCount,
      sectionCount: academicDoc?.sectionIds.length || 0,
      smartReaderStats,
      extractionMethod,
      replacedExistingReader
    };

  } catch (err: any) {
    console.error(`[Document Compiler] Failed to compile document ${targetId}:`, err.message);
    
    // On contribution compilation failure, only update status
    if (targetType === 'contribution') {
      target.extractionStatus = 'failed';
      await target.save();
    }

    throw err;
  }
}
