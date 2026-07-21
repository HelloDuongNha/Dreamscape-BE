import mongoose from 'mongoose';
import SourceContribution from '../../../../models/SourceContribution';
import AcademicSource from '../../../../models/AcademicSource';
import { extractPdfTextLayer } from './pdfTextExtraction.service';
import { enrichPdfMetadata } from './metadata/pdfMetadataEnrichment.service';
import { importSmartReaderForSource } from '../structured/smartReaderImport.service';
import { runDoclingPdfImport } from '../docling/doclingImport.service';
import { hasStoredOriginalPdf } from '../../../storage/originalPdfStorage.service';

export interface UploadedPdfImportInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  forceReplace?: boolean;
  userId?: mongoose.Types.ObjectId;
  structuredFirst?: boolean;
}

export interface UploadedPdfImportResult {
  success: boolean;
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  readerCreated: boolean;
  requiresOcr: boolean;
  selectedSource: 'jats' | 'html' | 'pdf_text' | 'docling_pdf' | 'none';
  extractionMethod?: 'jats' | 'html' | 'pdf_text';
  extractionQuality?: 'good' | 'partial' | 'poor';
  metadataEnriched: boolean;
  detectedIdentifiers?: {
    doi?: string;
    isbn?: string;
    pmcid?: string;
  };
  smartReaderStats?: {
    pageCount: number;
    figureCount: number;
    tableCount: number;
    referenceCount: number;
  };
  message: string;
}

/**
 * Main PDF ingestion pipeline orchestrator. Downloads, extracts, validates,
 * enriches, and compiles Smart Readers from raw PDF files.
 */
export async function runUploadedPdfImport(
  input: UploadedPdfImportInput
): Promise<UploadedPdfImportResult> {
  const { targetType, targetId, forceReplace, userId, structuredFirst = false } = input;
  let scannedPdfRequiresOcr = false;

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

  // 2. Validate originalFile exists
  if (!target.originalFile || !hasStoredOriginalPdf(target.originalFile)) {
    throw new Error('Tài liệu không có tệp PDF gốc được tải lên.');
  }

  // 3. Overwrite protection
  const hasExistingReader = target.readableInApp || target.fullTextStatus === 'imported';
  const existingMethod = target.extractionMethod;
  if (hasExistingReader && !forceReplace) {
    return {
      success: false,
      targetType,
      targetId,
      readerCreated: false,
      requiresOcr: false,
      selectedSource: (existingMethod === 'jats' || existingMethod === 'html') ? existingMethod : 'pdf_text',
      metadataEnriched: false,
      message: 'Bản đọc thông minh đã tồn tại và hoạt động. Sử dụng forceReplace = true để ghi đè.'
    };
  }

  // Set contribution state to inspecting
  if (targetType === 'contribution') {
    target.extractionStatus = 'inspecting';
    await target.save();
  }

  try {
    // 4. Perform PDF text-layer extraction
    const extractedDoc = await extractPdfTextLayer({
      targetType,
      targetId,
      force: forceReplace
    });

    // 5. A scanned PDF no longer stops here. Metadata/JATS resolution needs a
    // usable text layer, but Docling can continue with OCR below.
    scannedPdfRequiresOcr = !extractedDoc.hasUsableTextLayer;

    // 6. Enrich metadata & resolve identifiers
    let metadataEnriched = false;
    let preferredSource: 'jats' | 'html' | 'pdf_text' = 'pdf_text';
    
    if (!scannedPdfRequiresOcr) {
      try {
        const enrichment = await enrichPdfMetadata({
          targetType,
          targetId,
          userId,
          extractedDocument: extractedDoc
        });
        metadataEnriched = enrichment.metadataEnriched;
        preferredSource = enrichment.preferredSource;
      } catch (enrichErr: any) {
        console.warn('[PDF Import] Metadata enrichment failed, continuing with PDF text:', enrichErr.message);
      }
    }

    // Refresh target to pick up resolver/enrichment updates
    if (targetType === 'contribution') {
      target = await SourceContribution.findById(targetId);
    } else {
      target = await AcademicSource.findById(targetId);
    }

    // 7. Select preferred parser & compile Smart Reader
    if (!scannedPdfRequiresOcr && structuredFirst && (preferredSource === 'jats' || preferredSource === 'html')) {
      if (targetType === 'contribution') {
        target.extractionStatus = 'fetching_preferred_source';
        await target.save();
      }

      // Safe fallback: call standard importSmartReaderForSource. If JATS/HTML succeeds, return.
      const importResult = await importSmartReaderForSource(
        target,
        userId || target.submittedBy || new mongoose.Types.ObjectId(),
        true // force reimport
      );

      if (importResult.success) {
        // Refresh to read stats
        if (targetType === 'contribution') {
          target = await SourceContribution.findById(targetId);
        } else {
          target = await AcademicSource.findById(targetId);
        }

        const chosenCandidate = importResult.report?.chosenCandidate || '';
        const actualStructuredSource: 'jats' | 'html' = chosenCandidate.includes('xml')
          ? 'jats'
          : chosenCandidate.includes('html')
            ? 'html'
            : preferredSource === 'jats' ? 'jats' : 'html';

        return {
          success: true,
          targetType,
          targetId,
          readerCreated: true,
          requiresOcr: false,
          selectedSource: actualStructuredSource,
          extractionMethod: actualStructuredSource,
          extractionQuality: 'good',
          metadataEnriched,
          detectedIdentifiers: {
            doi: target.doi || undefined,
            isbn: target.isbn || undefined,
            pmcid: target.pmcid || undefined
          },
          smartReaderStats: target.smartReaderStats,
          message: `Dựng bản đọc thành công từ nguồn trực tuyến (${actualStructuredSource.toUpperCase()}).`
        };
      }
      
      console.warn(`[PDF Import] JATS/HTML import failed: ${importResult.message}. Falling back to PDF Text layer.`);
    }

    // 8. Compile the uploaded PDF with Docling. PyMuPDF above is used only for
    // quick text-layer/identifier metadata checks, never for reader persistence.
    if (targetType === 'contribution') {
      target.extractionStatus = scannedPdfRequiresOcr ? 'ocr_processing' : 'compiling_reader';
      await target.save();
    }

    const doclingResult = await runDoclingPdfImport({
      targetType,
      targetId,
      originalFile: target.originalFile,
      forceReplace: forceReplace === true,
      doOcr: scannedPdfRequiresOcr
    });
    const compileResult = doclingResult.compileResult;

    if (!compileResult.success) {
      return {
        success: false,
        targetType,
        targetId,
        readerCreated: false,
        requiresOcr: false,
        selectedSource: 'none',
        extractionMethod: 'pdf_text',
        metadataEnriched,
        message: compileResult.message
      };
    }

    if (targetType === 'contribution') {
      target = await SourceContribution.findById(targetId);
    } else {
      target = await AcademicSource.findById(targetId);
    }

    if (
      target &&
      (!Array.isArray(target.authors) || target.authors.length === 0) &&
      doclingResult.metadataHints?.authors?.length
    ) {
      target.authors = doclingResult.metadataHints.authors;
      await target.save();
      metadataEnriched = true;
    }

    return {
      success: true,
      targetType,
      targetId,
      readerCreated: true,
      requiresOcr: false,
      selectedSource: 'docling_pdf',
      extractionMethod: 'pdf_text',
      extractionQuality: target.extractionQuality || 'good',
      metadataEnriched,
      detectedIdentifiers: {
        doi: target.doi || undefined,
        isbn: target.isbn || undefined,
        pmcid: target.pmcid || undefined
      },
      smartReaderStats: compileResult.smartReaderStats,
      message: scannedPdfRequiresOcr
        ? 'OCR và dựng bản đọc thông minh từ PDF scan bằng Docling thành công.'
        : 'Dựng bản đọc thông minh từ PDF bằng Docling thành công.'
    };

  } catch (err: any) {
    console.error('[PDF Ingestion Orchestrator] Error running PDF import pipeline:', err.message);
    if (targetType === 'contribution') {
      target.extractionStatus = 'failed';
      await target.save();
    }
    return {
      success: false,
      targetType,
      targetId,
      readerCreated: false,
      requiresOcr: false,
      selectedSource: 'none',
      metadataEnriched: false,
      message: `Đóng góp PDF thất bại: ${err.message}`
    };
  }
}
