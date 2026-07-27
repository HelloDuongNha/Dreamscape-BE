import { deleteAsset } from '../../../../infrastructure/storage/cloudinaryStorage.service';
import { removeRuleV3SourceData } from '../../../rules_v3/services/ruleV3Lifecycle.service';
import AcademicChunk from '../../models/AcademicChunk';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSection from '../../models/AcademicSection';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { recordRejection } from './contributionStats.service';

interface RejectionBackup {
  [key: string]: unknown;
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

  const isCloudinaryUrl = (url?: string) => Boolean(
    url && (url.includes('cloudinary.com') || url.includes('res.cloudinary.com')),
  );
  if (isCloudinaryUrl(contribution.pdfUrl)) contribution.pdfUrl = undefined;
  if (isCloudinaryUrl(contribution.htmlUrl)) contribution.htmlUrl = undefined;
  if (isCloudinaryUrl(contribution.url)) {
    contribution.url = undefined;
    contribution.normalizedUrl = undefined;
  }
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
  const cloudinaryFile = originalFile?.storageProvider === 'cloudinary';
  const publicId = originalFile?.cloudinaryPublicId;
  const resourceType = originalFile?.cloudinaryResourceType || 'raw';

  contribution.reviewStatus = 'rejected';
  contribution.reviewedBy = reviewerId;
  contribution.reviewedAt = new Date();
  if (reviewNoteProvided) contribution.reviewNote = reviewNote || undefined;
  clearRejectedReaderState(contribution);
  if (cloudinaryFile) contribution.originalFile = undefined;

  try {
    await contribution.save();
  } catch (error) {
    restoreRejectionBackup(contribution, backup);
    throw error;
  }

  if (cloudinaryFile && publicId) {
    try {
      await deleteAsset(publicId, resourceType);
      console.log(`Successfully deleted Cloudinary asset for rejected contribution: ${publicId}`);
    } catch (error: any) {
      const message = String(error.message || '').toLowerCase();
      if (message.includes('not found') || message.includes('not_found')) {
        console.log('Cloudinary asset was already deleted.');
      } else {
        console.error('Failed to delete Cloudinary asset, restoring database state:', error);
        try {
          restoreRejectionBackup(contribution, backup);
          await contribution.save();
        } catch (restoreError: any) {
          console.error(
            'Critically failed to restore DB state after Cloudinary deletion failure:',
            restoreError,
          );
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
            message: `Không thể xóa tệp PDF gốc lưu trên Cloudinary: ${error.message || error}`,
            error: error.message || error,
          },
        };
      }
    }
  }

  await removeRuleV3SourceData(String(contribution._id), { deleteRunHistory: true });
  await AcademicDocument.deleteMany({ previewContributionId: contribution._id });
  await AcademicSection.deleteMany({ previewContributionId: contribution._id });
  await AcademicChunk.deleteMany({ previewContributionId: contribution._id });

  if (previousStatus !== 'rejected') {
    try {
      await recordRejection(contribution.submittedBy.toString());
    } catch (error) {
      console.error('Failed to record contribution rejection:', error);
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      message: 'Source contribution rejected.',
      data: { contribution: mapSourceOriginAndUrls(contribution) },
    },
  };
}
