import mongoose from 'mongoose';
import type {
  UploadedPdfImportInput,
  UploadedPdfImportResult,
} from '../../../dto/uploadedPdfImport.dto';
import type { PdfImportProgressState } from './pdfImportProgress.service';
import { finishPdfImportProgress } from './pdfImportProgress.service';
import { importSmartReaderForSource } from '../structured/smartReaderImport.service';
import { commitUploadedPdfReplacement } from './uploadedPdfImportLifecycle.service';
import {
  getUploadedPdfTargetIdentifiers,
  getUploadedPdfTargetOwner,
  requireUploadedPdfTarget,
  setUploadedPdfTargetStatus,
  type UploadedPdfTarget,
} from './uploadedPdfTarget.service';

// Try the resolved JATS/HTML source and return null when Docling should take over.
export async function attemptStructuredPdfImport(input: {
  target: UploadedPdfTarget;
  targetType: UploadedPdfImportInput['targetType'];
  targetId: string;
  userId?: mongoose.Types.ObjectId;
  preferredSource: 'jats' | 'html';
  replacementRunId: string;
  abortSignal: AbortSignal;
  buildStartedAt: number;
  pageCount: number;
  metadataEnriched: boolean;
  timingState?: PdfImportProgressState;
}): Promise<UploadedPdfImportResult | null> {
  await setUploadedPdfTargetStatus(input.target, input.targetType, 'fetching_preferred_source');
  const importResult = await importSmartReaderForSource(
    input.target,
    input.userId || getUploadedPdfTargetOwner(input.target) || new mongoose.Types.ObjectId(),
    true,
    {
      replacementRunId: input.replacementRunId,
      abortSignal: input.abortSignal,
      sourcePolicy: 'structured_only',
      buildStartedAt: input.buildStartedAt,
    },
  );
  if (!importResult.success) {
    console.warn(`[PDF Import] JATS/HTML import failed: ${importResult.message}. Falling back to PDF Text layer.`);
    return null;
  }

  const target = await requireUploadedPdfTarget(input.targetType, input.targetId);
  const chosenCandidate = importResult.report?.chosenCandidate || '';
  const selectedSource: 'jats' | 'html' = chosenCandidate.includes('xml')
    ? 'jats'
    : chosenCandidate.includes('html')
      ? 'html'
      : input.preferredSource;
  await commitUploadedPdfReplacement(input.replacementRunId, input.targetId);
  const timing = await finishPdfImportProgress(input.targetType, input.targetId, {
    succeeded: true,
    pageCount: input.pageCount,
    ocrUsed: false,
  });
  return {
    success: true,
    targetType: input.targetType,
    targetId: input.targetId,
    readerCreated: true,
    requiresOcr: false,
    selectedSource,
    extractionMethod: selectedSource,
    extractionQuality: 'good',
    metadataEnriched: input.metadataEnriched,
    detectedIdentifiers: getUploadedPdfTargetIdentifiers(target),
    smartReaderStats: target.smartReaderStats,
    timing: timing || input.timingState,
    resolvedTitle: target.title,
    message: `Dựng bản đọc thành công từ nguồn trực tuyến (${selectedSource.toUpperCase()}).`,
  };
}
