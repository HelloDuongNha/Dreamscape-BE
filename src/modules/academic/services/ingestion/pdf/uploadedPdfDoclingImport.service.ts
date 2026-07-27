import type {
  UploadedPdfImportInput,
  UploadedPdfImportResult,
} from '../../../dto/uploadedPdfImport.dto';
import { runDoclingPdfImport } from '../docling/doclingImport.service';
import {
  finishPdfImportProgress,
  type PdfImportProgressState,
  updatePdfImportProgress,
} from './pdfImportProgress.service';
import {
  commitUploadedPdfReplacement,
  recordUploadedPdfFailure,
  rollbackUploadedPdfReplacement,
} from './uploadedPdfImportLifecycle.service';
import {
  applyDoclingMetadataHints,
  getUploadedPdfTargetIdentifiers,
  requireUploadedPdfOriginalFile,
  requireUploadedPdfTarget,
  setUploadedPdfTargetStatus,
  type UploadedPdfTarget,
} from './uploadedPdfTarget.service';

// Compile one uploaded PDF with Docling and finish its replacement transaction.
export async function importUploadedPdfWithDocling(input: {
  target: UploadedPdfTarget;
  targetType: UploadedPdfImportInput['targetType'];
  targetId: string;
  forceReplace: boolean;
  requiresOcr: boolean;
  replacementRunId: string;
  abortSignal: AbortSignal;
  buildStartedAt: number;
  expectedDurationSeconds?: number;
  pageCount: number;
  metadataEnriched: boolean;
  timingState?: PdfImportProgressState;
}): Promise<UploadedPdfImportResult> {
  let pageCount = input.pageCount;
  await setUploadedPdfTargetStatus(
    input.target,
    input.targetType,
    input.requiresOcr ? 'ocr_processing' : 'compiling_reader',
  );

  const doclingResult = await runDoclingPdfImport({
    targetType: input.targetType,
    targetId: input.targetId,
    originalFile: requireUploadedPdfOriginalFile(input.target),
    forceReplace: input.forceReplace,
    doOcr: input.requiresOcr,
    abortSignal: input.abortSignal,
    replacementRunId: input.replacementRunId,
    buildTiming: {
      startedAt: input.buildStartedAt,
      estimatedDurationSeconds: input.expectedDurationSeconds,
      pageCount,
      ocrUsed: input.requiresOcr,
    },
    onStage: async (stage, details) => {
      if (details?.pageCount) pageCount = details.pageCount;
      await updatePdfImportProgress(input.targetType, input.targetId, stage, {
        pageCount,
        ocrExpected: input.requiresOcr,
      });
    },
  });
  const compileResult = doclingResult.compileResult;

  if (!compileResult.success) {
    await rollbackUploadedPdfReplacement(input.replacementRunId, 'failed');
    await recordUploadedPdfFailure({
      targetType: input.targetType,
      targetId: input.targetId,
      buildStartedAt: input.buildStartedAt,
      pageCount,
      ocrUsed: input.requiresOcr,
      failureCode: 'READER_COMPILE_FAILED',
      failureMessage: compileResult.message,
    });
    return {
      success: false,
      targetType: input.targetType,
      targetId: input.targetId,
      readerCreated: false,
      requiresOcr: false,
      selectedSource: 'none',
      extractionMethod: input.requiresOcr ? 'ocr' : 'pdf_text',
      metadataEnriched: input.metadataEnriched,
      message: compileResult.message,
    };
  }

  let target = await requireUploadedPdfTarget(input.targetType, input.targetId);
  const metadataResult = await applyDoclingMetadataHints(
    target,
    input.targetType,
    input.targetId,
    doclingResult.metadataHints,
  );
  target = metadataResult.target;
  const metadataEnriched = input.metadataEnriched || metadataResult.metadataEnriched;

  await commitUploadedPdfReplacement(input.replacementRunId, input.targetId);
  const timing = await finishPdfImportProgress(input.targetType, input.targetId, {
    succeeded: true,
    pageCount,
    ocrUsed: input.requiresOcr,
  });

  return {
    success: true,
    targetType: input.targetType,
    targetId: input.targetId,
    readerCreated: true,
    requiresOcr: false,
    selectedSource: 'docling_pdf',
    extractionMethod: input.requiresOcr ? 'ocr' : 'pdf_text',
    extractionQuality: target.extractionQuality || 'good',
    metadataEnriched,
    detectedIdentifiers: getUploadedPdfTargetIdentifiers(target),
    smartReaderStats: compileResult.smartReaderStats,
    timing: timing || input.timingState,
    resolvedTitle: target.title || doclingResult.metadataHints?.title,
    message: input.requiresOcr
      ? 'OCR và dựng bản đọc thông minh từ PDF scan bằng Docling thành công.'
      : 'Dựng bản đọc thông minh từ PDF bằng Docling thành công.',
  };
}
