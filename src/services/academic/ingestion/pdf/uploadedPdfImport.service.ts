import mongoose from 'mongoose';
import SourceContribution from '../../../../models/SourceContribution';
import AcademicSource from '../../../../models/AcademicSource';
import { extractPdfTextLayer } from './pdfTextExtraction.service';
import { enrichPdfMetadata } from './metadata/pdfMetadataEnrichment.service';
import { importSmartReaderForSource } from '../structured/smartReaderImport.service';
import { runDoclingPdfImport } from '../docling/doclingImport.service';
import { hasStoredOriginalPdf } from '../../../storage/originalPdfStorage.service';
import {
  estimatePdfImportSeconds,
  finishPdfImportProgress,
  PdfImportProgressState,
  startPdfImportProgress,
  updatePdfImportProgress,
  cancelPdfImportProgress,
} from './pdfImportProgress.service';
import { deleteAsset } from '../../../storage/cloudinaryStorage.service';
import {
  beginReaderReplacement,
  captureReaderRuleBackup,
  completeReaderReplacement,
  requestReaderReplacementCancellation,
  rollbackReaderReplacement,
  waitForReaderReplacementTerminal,
} from '../../reader/persistence/readerReplacement.service';
import { removeRuleV3SourceData } from '../../../rules/ruleV3Lifecycle.service';

const activePdfImportControllers = new Map<string, AbortController>();
const activePdfImportTasks = new Map<string, Promise<void>>();
const CANCELLATION_SETTLE_TIMEOUT_MS = 15 * 60 * 1000;

function pdfImportKey(targetType: UploadedPdfImportInput['targetType'], targetId: string): string {
  return `${targetType}:${targetId}`;
}

async function waitForActivePdfImportTask(task: Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('reader_replacement_cancellation_timeout')),
          CANCELLATION_SETTLE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function cancelUploadedPdfImport(
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
): Promise<boolean> {
  const runKey = pdfImportKey(targetType, targetId);
  const controller = activePdfImportControllers.get(runKey);
  const activeTask = activePdfImportTasks.get(runKey);
  controller?.abort();
  const durableCancellation = await requestReaderReplacementCancellation(targetType, targetId);
  if (!controller && !activeTask && !durableCancellation) return false;

  // A cancellation acknowledgement is a data-integrity promise: do not let the
  // client show "cancelled" until the worker has removed partial output and
  // restored the replacement journal.
  if (activeTask) await waitForActivePdfImportTask(activeTask);
  const terminalStatus = await waitForReaderReplacementTerminal(
    targetType,
    targetId,
    CANCELLATION_SETTLE_TIMEOUT_MS,
  );
  const safelyCancelled = terminalStatus === 'cancelled' || terminalStatus === 'failed';
  if (!safelyCancelled) return false;

  await cancelPdfImportProgress(targetType, targetId);
  return true;
}

export interface UploadedPdfImportInput {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  forceReplace?: boolean;
  userId?: mongoose.Types.ObjectId;
  structuredFirst?: boolean;
}

export interface UploadedPdfImportResult {
  success: boolean;
  cancelled?: boolean;
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  readerCreated: boolean;
  requiresOcr: boolean;
  selectedSource: 'jats' | 'html' | 'pdf_text' | 'docling_pdf' | 'none';
  extractionMethod?: 'jats' | 'html' | 'pdf_text' | 'ocr';
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
  timing?: PdfImportProgressState;
  resolvedTitle?: string;
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

  const replacementRunId = await beginReaderReplacement({
    targetType,
    targetId,
    kind: 'pdf',
  });
  const cleanupDerivedRules = async () => {
    await captureReaderRuleBackup(replacementRunId, targetId);
    await removeRuleV3SourceData(targetId);
  };

  const runKey = pdfImportKey(targetType, targetId);
  activePdfImportControllers.get(runKey)?.abort();
  const abortController = new AbortController();
  activePdfImportControllers.set(runKey, abortController);
  let resolveRunFinished: (() => void) | undefined;
  const runFinished = new Promise<void>(resolve => {
    resolveRunFinished = resolve;
  });
  activePdfImportTasks.set(runKey, runFinished);
  const throwIfCancelled = () => {
    if (abortController.signal.aborted) {
      const error = new Error('pdf_import_cancelled');
      error.name = 'AbortError';
      throw error;
    }
  };
  let timingState: PdfImportProgressState | undefined;
  let detectedPageCount = Math.max(0, Number(target.pdfPageCount) || 0);

  try {
    timingState = await startPdfImportProgress(targetType, targetId);
    // Set contribution state to inspecting
    if (targetType === 'contribution') {
      target.extractionStatus = 'inspecting';
      await target.save();
    }
    await updatePdfImportProgress(targetType, targetId, 'inspecting_text');
    throwIfCancelled();
    // 4. Perform PDF text-layer extraction
    const extractedDoc = await extractPdfTextLayer({
      targetType,
      targetId,
      force: forceReplace
    });
    throwIfCancelled();

    // 5. A scanned PDF no longer stops here. Metadata/JATS resolution needs a
    // usable text layer, but Docling can continue with OCR below.
    scannedPdfRequiresOcr = !extractedDoc.hasUsableTextLayer;
    detectedPageCount = Math.max(0, Number(extractedDoc.pageCount) || 0);
    const refreshedEstimate = estimatePdfImportSeconds({
      pageCount: detectedPageCount,
      fileSizeBytes: target.originalFile?.fileSize,
      ocrExpected: scannedPdfRequiresOcr,
      history: target.pdfImportHistory || [],
    });
    await updatePdfImportProgress(
      targetType,
      targetId,
      scannedPdfRequiresOcr ? 'ocr_processing' : 'parsing_layout',
      {
        pageCount: detectedPageCount,
        ocrExpected: scannedPdfRequiresOcr,
        expectedDurationSeconds: refreshedEstimate,
      },
    );

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
        true,
        { replacementRunId, abortSignal: abortController.signal },
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

        await cleanupDerivedRules();
        const replacement = await completeReaderReplacement(replacementRunId);
        await Promise.all(replacement.oldAssetIds.map(id => deleteAsset(id, 'image').catch(() => undefined)));
        const completedTiming = await finishPdfImportProgress(targetType, targetId, {
          succeeded: true,
          pageCount: detectedPageCount,
          ocrUsed: false,
        });
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
          timing: completedTiming || timingState,
          resolvedTitle: target.title,
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
      doOcr: scannedPdfRequiresOcr,
      abortSignal: abortController.signal,
      replacementRunId,
      onStage: async (stage, details) => {
        if (details?.pageCount) detectedPageCount = details.pageCount;
        await updatePdfImportProgress(targetType, targetId, stage, {
          pageCount: detectedPageCount,
          ocrExpected: scannedPdfRequiresOcr,
        });
      },
    });
    const compileResult = doclingResult.compileResult;

    if (!compileResult.success) {
      const rollback = await rollbackReaderReplacement(replacementRunId, 'failed').catch(() => ({ newAssetIds: [] }));
      await Promise.all(rollback.newAssetIds.map(id => deleteAsset(id, 'image').catch(() => undefined)));
      await finishPdfImportProgress(targetType, targetId, {
        succeeded: false,
        pageCount: detectedPageCount,
        ocrUsed: scannedPdfRequiresOcr,
        failureCode: 'READER_COMPILE_FAILED',
        failureMessage: compileResult.message,
      });
      return {
        success: false,
        targetType,
        targetId,
        readerCreated: false,
        requiresOcr: false,
        selectedSource: 'none',
        extractionMethod: scannedPdfRequiresOcr ? 'ocr' : 'pdf_text',
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
    if (
      target &&
      doclingResult.metadataHints?.title &&
      target.title !== doclingResult.metadataHints.title
    ) {
      target = targetType === 'contribution'
        ? await SourceContribution.findById(targetId)
        : await AcademicSource.findById(targetId);
    }

    await cleanupDerivedRules();
    const replacement = await completeReaderReplacement(replacementRunId);
    await Promise.all(replacement.oldAssetIds.map(id => deleteAsset(id, 'image').catch(() => undefined)));
    const completedTiming = await finishPdfImportProgress(targetType, targetId, {
      succeeded: true,
      pageCount: detectedPageCount,
      ocrUsed: scannedPdfRequiresOcr,
    });

    return {
      success: true,
      targetType,
      targetId,
      readerCreated: true,
      requiresOcr: false,
      selectedSource: 'docling_pdf',
      extractionMethod: scannedPdfRequiresOcr ? 'ocr' : 'pdf_text',
      extractionQuality: target.extractionQuality || 'good',
      metadataEnriched,
      detectedIdentifiers: {
        doi: target.doi || undefined,
        isbn: target.isbn || undefined,
        pmcid: target.pmcid || undefined
      },
      smartReaderStats: compileResult.smartReaderStats,
      timing: completedTiming || timingState,
      resolvedTitle: target.title || doclingResult.metadataHints?.title,
      message: scannedPdfRequiresOcr
        ? 'OCR và dựng bản đọc thông minh từ PDF scan bằng Docling thành công.'
        : 'Dựng bản đọc thông minh từ PDF bằng Docling thành công.'
    };

  } catch (err: any) {
    if (abortController.signal.aborted || err?.name === 'AbortError' || err?.message === 'pdf_import_cancelled') {
      const rollback = await rollbackReaderReplacement(replacementRunId, 'cancelled').catch(() => ({ newAssetIds: [] }));
      await Promise.all(rollback.newAssetIds.map(id => deleteAsset(id, 'image').catch(() => undefined)));
      await cancelPdfImportProgress(targetType, targetId).catch(() => {});
      return {
        success: false,
        cancelled: true,
        targetType,
        targetId,
        readerCreated: false,
        requiresOcr: scannedPdfRequiresOcr,
        selectedSource: 'none',
        extractionMethod: scannedPdfRequiresOcr ? 'ocr' : 'pdf_text',
        metadataEnriched: false,
        message: 'Đã hủy nhập PDF. Bản đọc trước đó vẫn được giữ nguyên.',
      };
    }
    const rollback = await rollbackReaderReplacement(replacementRunId, 'failed').catch(() => ({ newAssetIds: [] }));
    await Promise.all(rollback.newAssetIds.map(id => deleteAsset(id, 'image').catch(() => undefined)));
    console.error('[PDF Ingestion Orchestrator] Error running PDF import pipeline:', err.message);
    if (targetType === 'contribution' && !hasExistingReader) {
      await SourceContribution.updateOne({ _id: targetId }, { $set: { extractionStatus: 'failed' } });
    }
    await finishPdfImportProgress(targetType, targetId, {
      succeeded: false,
      pageCount: detectedPageCount,
      ocrUsed: scannedPdfRequiresOcr,
      failureCode: err?.code || 'PDF_IMPORT_FAILED',
      failureMessage: err?.message || 'Không thể dựng Bản đọc thông minh.',
    }).catch(() => {});
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
  } finally {
    resolveRunFinished?.();
    if (activePdfImportTasks.get(runKey) === runFinished) {
      activePdfImportTasks.delete(runKey);
    }
    if (activePdfImportControllers.get(runKey) === abortController) {
      activePdfImportControllers.delete(runKey);
    }
  }
}
