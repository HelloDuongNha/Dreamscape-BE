import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import SourceContribution from '../../../../models/SourceContribution';
import AcademicSource from '../../../../models/AcademicSource';
import { parsePdf } from './legacy/PdfParser';
import { downloadOriginalPdfAsset, hasStoredOriginalPdf } from '../../../storage/originalPdfStorage.service';
import { ExtractedDocument, ExtractedPage, ExtractedBlock } from '../../types/extractedDocument.types';
import { probePdfTextLayer } from './pdfTextLayerProbe.service';

export interface ExtractPdfInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  force?: boolean;
}

function mapBlockType(bt: string): 'heading' | 'paragraph' | 'figure' | 'table' | 'reference' | 'page_break' | 'metadata' {
  if (bt === 'heading' || bt === 'paragraph' || bt === 'figure' || bt === 'table' || bt === 'reference' || bt === 'page_break' || bt === 'metadata') {
    return bt;
  }
  return 'paragraph';
}

/**
 * Downloads a PDF from originalFile storage, extracts text layout blocks page by page,
 * checks for text-layer usability, and calculates quality metrics.
 */
export async function extractPdfTextLayer(input: ExtractPdfInput): Promise<ExtractedDocument> {
  const { targetType, targetId, force } = input;
  
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new Error('ID tài liệu không hợp lệ.');
  }

  // 1. Load the target document
  let target: any = null;
  if (targetType === 'contribution') {
    target = await SourceContribution.findById(targetId);
  } else {
    target = await AcademicSource.findById(targetId);
  }

  if (!target) {
    throw new Error(`Không tìm thấy tài liệu với ID: ${targetId}`);
  }

  // 2. Validate originalFile exists in the configured original-PDF store.
  const originalFile = target.originalFile;
  if (!originalFile || !hasStoredOriginalPdf(originalFile)) {
    throw new Error('Tài liệu không có tệp PDF gốc được lưu trữ trên hệ thống.');
  }

  // Update extractionStatus if contribution
  if (targetType === 'contribution') {
    target.extractionStatus = 'inspecting';
    await target.save();
  }

  const tempDir = path.join(__dirname, '../../../../../uploads/tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const tempFilename = `extract_${Date.now()}_${Math.random().toString(36).substring(2, 10)}.pdf`;
  const tempPath = path.join(tempDir, tempFilename);

  let hasTempFile = false;
  
  try {
    if (targetType === 'contribution') {
      target.extractionStatus = 'extracting_text';
      await target.save();
    }

    // 3. Download and validate PDF from Firebase or legacy Cloudinary storage.
    const buffer = await downloadOriginalPdfAsset(originalFile);

    fs.writeFileSync(tempPath, buffer);
    hasTempFile = true;

    // 4. Probe the text layer without running layout reconstruction. This is
    // intentionally cheap even for very large scanned books and prevents the
    // legacy 30-second parser from blocking OCR routing.
    const probe = await probePdfTextLayer(tempPath);
    const physicalPageCount = probe.pageCount;

    if (!probe.hasUsableTextLayer) {
      const pages: ExtractedPage[] = Array.from({ length: physicalPageCount }, (_, pageIndex) => ({
        pageIndex,
        physicalPageNumber: pageIndex + 1,
        wordCount: 0,
        characterCount: 0,
        blocks: []
      }));
      const qualitySignals = {
        pagesWithText: probe.pagesWithText,
        emptyPageCount: Math.max(0, physicalPageCount - probe.pagesWithText),
        averageCharactersPerPage: Math.round(probe.averageCharactersPerPage),
        lowTextPageCount: Math.max(0, physicalPageCount - probe.pagesWithText)
      };
      const result: ExtractedDocument = {
        pageCount: physicalPageCount,
        pages,
        totalWordCount: 0,
        totalCharacterCount: probe.totalCharacterCount,
        extractedVia: 'pdf_text',
        hasUsableTextLayer: false,
        qualitySignals
      };

      const hasValidReader = target.readableInApp || target.fullTextStatus === 'imported' || ['jats', 'html'].includes(target.extractionMethod || '');
      const canOverwriteMethod = !hasValidReader || force;
      target.pdfPageCount = physicalPageCount;
      if (canOverwriteMethod) {
        target.extractionMethod = undefined;
        target.extractionQuality = 'poor';
      }
      if (targetType === 'contribution') target.extractionStatus = 'completed';
      await target.save();
      return result;
    }

    // 5. Parse layout blocks via existing PyMuPDF wrapper
    const parseOutput = await parsePdf(tempPath);
    if (!parseOutput.success) {
      throw new Error(parseOutput.error || 'Phân tích tài liệu PDF thất bại.');
    }

    // Group blocks by page number (1-based)
    const blocksByPage = new Map<number, any[]>();
    let totalWordCount = 0;
    let totalCharacterCount = 0;

    parseOutput.blocks.forEach((b: any) => {
      const pageNum = b.pageNumber || 1;
      if (!blocksByPage.has(pageNum)) {
        blocksByPage.set(pageNum, []);
      }
      blocksByPage.get(pageNum)!.push(b);
      
      const words = (b.text || '').split(/\s+/).filter(Boolean).length;
      totalWordCount += words;
      totalCharacterCount += (b.text || '').length;
    });

    const maxBlockPage = parseOutput.blocks.reduce((max: number, b: any) => {
      return (b.pageNumber && b.pageNumber > max) ? b.pageNumber : max;
    }, 0);
    
    const finalPageCount = Math.max(physicalPageCount, maxBlockPage);

    // 6. Build ExtractedPage array
    const pages: ExtractedPage[] = [];
    let pagesWithText = 0;
    let lowTextPageCount = 0;

    for (let pageNum = 1; pageNum <= finalPageCount; pageNum++) {
      const rawBlocks = blocksByPage.get(pageNum) || [];
      const blocks: ExtractedBlock[] = rawBlocks.map((b: any) => {
        return {
          blockType: mapBlockType(b.blockType),
          text: (b.text || '').trim(),
          html: b.html || undefined,
          pageNumber: pageNum,
          readingOrder: b.order,
          sectionHint: b.sectionHeading || undefined,
          sourceMethod: 'pdf_text' as const
        };
      });

      const pageText = blocks.map(b => b.text).join(' ');
      const wordCount = pageText.split(/\s+/).filter(Boolean).length;
      const characterCount = pageText.length;

      if (characterCount > 0) {
        pagesWithText++;
      }
      if (characterCount < 100) {
        lowTextPageCount++;
      }

      pages.push({
        pageIndex: pageNum - 1,
        physicalPageNumber: pageNum,
        wordCount,
        characterCount,
        blocks
      });
    }

    // 7. Text-layer usability metrics
    const emptyPageCount = finalPageCount - pagesWithText;
    const averageCharactersPerPage = finalPageCount > 0 ? Math.round(totalCharacterCount / finalPageCount) : 0;
    const hasUsableTextLayer = totalCharacterCount > 200 && pagesWithText > 0;

    const qualitySignals = {
      pagesWithText,
      emptyPageCount,
      averageCharactersPerPage,
      lowTextPageCount
    };

    let extractionQuality: 'good' | 'partial' | 'poor' = 'good';
    if (!hasUsableTextLayer) {
      extractionQuality = 'poor';
    } else if ((pagesWithText / finalPageCount) < 0.50) {
      extractionQuality = 'partial';
    }

    const result: ExtractedDocument = {
      title: parseOutput.title || undefined,
      pageCount: finalPageCount,
      pages,
      totalWordCount,
      totalCharacterCount,
      extractedVia: 'pdf_text' as const,
      hasUsableTextLayer,
      qualitySignals
    };

    // 8. Update DB metadata if allowed
    const hasValidReader = target.readableInApp || target.fullTextStatus === 'imported' || ['jats', 'html'].includes(target.extractionMethod || '');
    const canOverwriteMethod = !hasValidReader || force;

    if (targetType === 'contribution') {
      target.pdfPageCount = finalPageCount;
      if (canOverwriteMethod) {
        target.extractionMethod = hasUsableTextLayer ? 'pdf_text' : undefined;
        target.extractionQuality = extractionQuality;
      }
      target.extractionStatus = 'completed';
      await target.save();
    } else {
      // Approved AcademicSource
      target.pdfPageCount = finalPageCount;
      if (canOverwriteMethod) {
        target.extractionMethod = hasUsableTextLayer ? 'pdf_text' : undefined;
        target.extractionQuality = extractionQuality;
      }
      await target.save();
    }

    return result;

  } catch (err: any) {
    console.error(`[PDF Extraction] Error extracting PDF text layer for ${targetId}:`, err.message);
    
    // Update target status on failure
    if (targetType === 'contribution') {
      target.extractionStatus = 'failed';
      await target.save();
    }
    
    throw err;
  } finally {
    // 9. Sync temp file clean up
    if (hasTempFile && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {}
    }
  }
}
