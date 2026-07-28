import { deleteAsset } from '../../../../../infrastructure/storage/cloudinaryStorage.service';
import { removeRuleV3SourceData } from '../../../../rules_v3/services/lifecycle/ruleV3Lifecycle.service';
import {
  captureReaderRuleBackup,
  completeReaderReplacement,
  rollbackReaderReplacement,
} from '../../reader/persistence/readerReplacement.service';
import { finishPdfImportProgress } from './pdfImportProgress.service';
import { recordReaderBuildFailure } from '../../reader/history/readerBuildHistory.service';

async function deleteImageAssets(assetIds: string[]): Promise<void> {
  await Promise.all(assetIds.map((id) => deleteAsset(id, 'image').catch(() => undefined)));
}

export async function commitUploadedPdfReplacement(runId: string, targetId: string): Promise<void> {
  await captureReaderRuleBackup(runId, targetId);
  await removeRuleV3SourceData(targetId);
  const replacement = await completeReaderReplacement(runId);
  await deleteImageAssets(replacement.oldAssetIds);
}

export async function rollbackUploadedPdfReplacement(
  runId: string,
  status: 'cancelled' | 'failed',
): Promise<void> {
  const rollback = await rollbackReaderReplacement(runId, status).catch(() => ({ newAssetIds: [] }));
  await deleteImageAssets(rollback.newAssetIds);
}

export async function recordUploadedPdfFailure(input: {
  targetType: 'contribution' | 'approved_source';
  targetId: string;
  buildStartedAt: number;
  pageCount: number;
  ocrUsed: boolean;
  failureCode: string;
  failureMessage: string;
  ignoreProgressFailure?: boolean;
}) {
  const finishProgress = finishPdfImportProgress(input.targetType, input.targetId, {
    succeeded: false,
    pageCount: input.pageCount,
    ocrUsed: input.ocrUsed,
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
  });
  const timing = input.ignoreProgressFailure
    ? await finishProgress.catch(() => undefined)
    : await finishProgress;
  await recordReaderBuildFailure({
    sourceId: input.targetId,
    isContribution: input.targetType === 'contribution',
    engine: 'docling',
    sourceType: 'uploaded_pdf',
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
    timing: {
      startedAt: input.buildStartedAt,
      estimatedDurationSeconds: timing?.expectedDurationSeconds,
      pageCount: input.pageCount,
      ocrUsed: input.ocrUsed,
    },
  }).catch(() => {});
  return timing;
}
