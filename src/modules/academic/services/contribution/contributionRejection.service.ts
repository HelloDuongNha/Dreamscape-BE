import { deleteAsset } from '../../../../infrastructure/storage/cloudinaryStorage.service';
import {
  deleteReaderOwnedAssets,
  deleteReaderOwnedDatabaseData,
  prepareReaderOwnedDataCleanup,
} from '../reader/persistence/readerOwnedDataCleanup.service';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { recordRejection } from './contributionStats.service';

interface RejectionBackup {
  [key: string]: unknown;
}

export async function rejectSourceContribution(
  contribution: any,
  reviewerId: any,
  reviewNote: string,
  reviewNoteProvided: boolean,
  previousStatus: string,
) {
  const backup = captureRejectionBackup(contribution);
  const originalFile = contribution.originalFile;

  applyRejectedState(contribution, reviewerId, reviewNote, reviewNoteProvided);
  try {
    await contribution.save();
  } catch (error) {
    restoreRejectionBackup(contribution, backup);
    throw error;
  }

  const fileFailure = await deleteRejectedOriginalFile(contribution, originalFile, backup);
  if (fileFailure) return fileFailure;

  const readerCleanup = await prepareReaderOwnedDataCleanup({
    targetType: 'contribution',
    targetId: contribution._id,
  });
  await deleteReaderOwnedDatabaseData(readerCleanup.owner);
  await deleteReaderOwnedAssets(readerCleanup);
  await recordRejectionIfNeeded(contribution, previousStatus);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Source contribution rejected.',
      data: { contribution: mapSourceOriginAndUrls(contribution) },
    },
  };
}

function applyRejectedState(
  contribution: any,
  reviewerId: any,
  reviewNote: string,
  reviewNoteProvided: boolean,
): void {
  contribution.reviewStatus = 'rejected';
  contribution.reviewedBy = reviewerId;
  contribution.reviewedAt = new Date();
  if (reviewNoteProvided) contribution.reviewNote = reviewNote || undefined;
  clearRejectedReaderState(contribution);
  if (contribution.originalFile?.storageProvider === 'cloudinary') {
    contribution.originalFile = undefined;
  }
}

async function deleteRejectedOriginalFile(
  contribution: any,
  originalFile: any,
  backup: RejectionBackup,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const publicId = originalFile?.cloudinaryPublicId;
  if (originalFile?.storageProvider !== 'cloudinary' || !publicId) return null;

  try {
    await deleteAsset(publicId, originalFile.cloudinaryResourceType || 'raw');
    return null;
  } catch (error: any) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('not found') || message.includes('not_found')) return null;
    return restoreAfterFileDeletionFailure(contribution, backup, error);
  }
}

async function restoreAfterFileDeletionFailure(
  contribution: any,
  backup: RejectionBackup,
  deletionError: any,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    restoreRejectionBackup(contribution, backup);
    await contribution.save();
  } catch (restoreError: any) {
    return {
      status: 500,
      body: {
        success: false,
        message: `Lỗi nghiêm trọng: Xóa tệp Cloudinary thất bại và không thể phục hồi trạng thái cơ sở dữ liệu về ban đầu: ${restoreError.message || restoreError}`,
        error: restoreError.message || restoreError,
      },
    };
  }
  return {
    status: 500,
    body: {
      success: false,
      message: `Không thể xóa tệp PDF gốc lưu trên Cloudinary: ${deletionError.message || deletionError}`,
      error: deletionError.message || deletionError,
    },
  };
}

async function recordRejectionIfNeeded(contribution: any, previousStatus: string): Promise<void> {
  if (previousStatus === 'rejected') return;
  try {
    await recordRejection(contribution.submittedBy.toString());
  } catch (error) {
    console.error('Failed to record contribution rejection:', error);
  }
}

function captureRejectionBackup(contribution: any): RejectionBackup {
  const fields = [
    'originalFile',
    'pdfUrl',
    'htmlUrl',
    'url',
    'normalizedUrl',
    'reviewStatus',
    'reviewedBy',
    'reviewedAt',
    'reviewNote',
    'readableInApp',
    'fullTextStatus',
    'smartReaderStats',
    'extractionStatus',
    'extractionMethod',
    'extractionQuality',
    'pdfPageCount',
    'detectedLanguage',
    'detectedIdentifiers',
    'readerBuildSnapshots',
    'pdfImportProgress',
    'pdfImportHistory',
  ];
  return Object.fromEntries(fields.map(field => [field, contribution[field]]));
}

function restoreRejectionBackup(contribution: any, backup: RejectionBackup): void {
  for (const [field, value] of Object.entries(backup)) contribution[field] = value;
}

function clearRejectedReaderState(contribution: any): void {
  contribution.readableInApp = false;
  contribution.fullTextStatus = 'none';
  contribution.smartReaderStats = undefined;
  contribution.extractionStatus = undefined;
  contribution.extractionMethod = undefined;
  contribution.extractionQuality = undefined;
  contribution.pdfPageCount = undefined;
  contribution.detectedLanguage = undefined;
  contribution.detectedIdentifiers = undefined;
  contribution.readerBuildSnapshots = undefined;
  contribution.pdfImportProgress = undefined;
  contribution.pdfImportHistory = undefined;

  if (isCloudinaryUrl(contribution.pdfUrl)) contribution.pdfUrl = undefined;
  if (isCloudinaryUrl(contribution.htmlUrl)) contribution.htmlUrl = undefined;
  if (isCloudinaryUrl(contribution.url)) {
    contribution.url = undefined;
    contribution.normalizedUrl = undefined;
  }
}

function isCloudinaryUrl(url?: string): boolean {
  return Boolean(url && (
    url.includes('cloudinary.com')
    || url.includes('res.cloudinary.com')
  ));
}
