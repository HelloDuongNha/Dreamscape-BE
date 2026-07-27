import SourceContribution from '../../../models/SourceContribution';
import { extractPdfTextLayer } from './pdfTextExtraction.service';
import { enrichPdfMetadata } from './metadata/pdfMetadataEnrichment.service';
import { hasStoredOriginalPdf } from '../../storage/originalPdfStorage.service';
import {
  estimatePdfImportSeconds,
  PdfImportProgressState,
  startPdfImportProgress,
  updatePdfImportProgress,
  cancelPdfImportProgress,
} from './pdfImportProgress.service';
import {
  beginReaderReplacement,
} from '../../reader/persistence/readerReplacement.service';
import type {
  UploadedPdfImportInput,
  UploadedPdfImportResult,
} from '../../../dto/uploadedPdfImport.dto';
import {
  cancelRegisteredPdfImport,
  registerUploadedPdfImport,
} from './uploadedPdfImportTask.service';
import {
  recordUploadedPdfFailure,
  rollbackUploadedPdfReplacement,
} from './uploadedPdfImportLifecycle.service';
import {
  requireUploadedPdfTarget,
  setUploadedPdfTargetStatus,
} from './uploadedPdfTarget.service';
import { attemptStructuredPdfImport } from './uploadedPdfStructuredImport.service';
import { importUploadedPdfWithDocling } from './uploadedPdfDoclingImport.service';

export type {
  UploadedPdfImportInput,
  UploadedPdfImportResult,
} from '../../../dto/uploadedPdfImport.dto';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (
    error instanceof Error
    && (error.name === 'AbortError' || error.message === 'pdf_import_cancelled')
  );
}

export async function cancelUploadedPdfImport(
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
): Promise<boolean> {
  return cancelRegisteredPdfImport(targetType, targetId);
}

// Coordinate one uploaded-PDF import without owning the individual processing steps.
export async function runUploadedPdfImport(
  input: UploadedPdfImportInput
): Promise<UploadedPdfImportResult> {
  const buildStartedAt = Date.now();
  const { targetType, targetId, forceReplace, userId, structuredFirst = false } = input;
  let scannedPdfRequiresOcr = false;

  let target = await requireUploadedPdfTarget(targetType, targetId);
  if (!target.originalFile || !hasStoredOriginalPdf(target.originalFile)) {
    throw new Error('Tài liệu không có tệp PDF gốc được tải lên.');
  }

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
  const task = registerUploadedPdfImport(targetType, targetId);
  const { abortController, throwIfCancelled } = task;
  let timingState: PdfImportProgressState | undefined;
  let detectedPageCount = Math.max(0, Number(target.pdfPageCount) || 0);
  let expectedDurationSeconds: number | undefined;

  try {
    timingState = await startPdfImportProgress(targetType, targetId);
    expectedDurationSeconds = timingState.expectedDurationSeconds;
    await setUploadedPdfTargetStatus(target, targetType, 'inspecting');
    await updatePdfImportProgress(targetType, targetId, 'inspecting_text');
    throwIfCancelled();
    const extractedDoc = await extractPdfTextLayer({
      targetType,
      targetId,
      force: forceReplace
    });
    throwIfCancelled();

    // Docling can OCR scanned PDFs even when identifier enrichment has no usable text.
    scannedPdfRequiresOcr = !extractedDoc.hasUsableTextLayer;
    detectedPageCount = Math.max(0, Number(extractedDoc.pageCount) || 0);
    const refreshedEstimate = estimatePdfImportSeconds({
      pageCount: detectedPageCount,
      fileSizeBytes: target.originalFile?.fileSize,
      ocrExpected: scannedPdfRequiresOcr,
      history: target.pdfImportHistory || [],
    });
    expectedDurationSeconds = refreshedEstimate;
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
      } catch (enrichError: unknown) {
        console.warn('[PDF Import] Metadata enrichment failed, continuing with PDF text:', errorMessage(enrichError));
      }
    }

    target = await requireUploadedPdfTarget(targetType, targetId);

    if (!scannedPdfRequiresOcr && structuredFirst && (preferredSource === 'jats' || preferredSource === 'html')) {
      const structuredResult = await attemptStructuredPdfImport({
        target,
        targetType,
        targetId,
        userId,
        preferredSource,
        replacementRunId,
        abortSignal: abortController.signal,
        buildStartedAt,
        pageCount: detectedPageCount,
        metadataEnriched,
        timingState,
      });
      if (structuredResult) return structuredResult;
    }

    return await importUploadedPdfWithDocling({
      target,
      targetType,
      targetId,
      forceReplace: forceReplace === true,
      requiresOcr: scannedPdfRequiresOcr,
      abortSignal: abortController.signal,
      replacementRunId,
      buildStartedAt,
      expectedDurationSeconds,
      pageCount: detectedPageCount,
      metadataEnriched,
      timingState,
    });

  } catch (error: unknown) {
    if (isCancellation(error, abortController.signal)) {
      await rollbackUploadedPdfReplacement(replacementRunId, 'cancelled');
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
    await rollbackUploadedPdfReplacement(replacementRunId, 'failed');
    const message = errorMessage(error);
    console.error('[PDF Ingestion Orchestrator] Error running PDF import pipeline:', message);
    if (targetType === 'contribution' && !hasExistingReader) {
      await SourceContribution.updateOne({ _id: targetId }, { $set: { extractionStatus: 'failed' } });
    }
    await recordUploadedPdfFailure({
      targetType,
      targetId,
      buildStartedAt,
      pageCount: detectedPageCount,
      ocrUsed: scannedPdfRequiresOcr,
      failureCode: errorCode(error) || 'PDF_IMPORT_FAILED',
      failureMessage: message || 'Không thể dựng Bản đọc thông minh.',
      ignoreProgressFailure: true,
    });
    return {
      success: false,
      targetType,
      targetId,
      readerCreated: false,
      requiresOcr: false,
      selectedSource: 'none',
      metadataEnriched: false,
      message: `Đóng góp PDF thất bại: ${message}`
    };
  } finally {
    task.finish();
  }
}
