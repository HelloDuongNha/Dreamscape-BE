import mongoose from 'mongoose';
import SourceContribution from '../../models/SourceContribution';
import {
  deleteProcessedPdfUpload,
  processPdfUpload,
  toOriginalFileRecord,
} from './pdfUpload.service';
import { deleteOriginalPdfAsset, hasStoredOriginalPdf } from './originalPdfStorage.service';

export async function storeModerationPdf(
  file: Express.Multer.File,
  contributionId: string | undefined,
  userId: any,
) {
  const upload = await processPdfUpload(file.path, file.originalname, file.mimetype);
  const originalFile = toOriginalFileRecord(upload, userId);

  try {
    let contribution: any;
    if (contributionId) {
      if (!mongoose.Types.ObjectId.isValid(contributionId)) {
        throw new Error('ID đóng góp nguồn (sourceContributionId) không hợp lệ.');
      }
      contribution = await SourceContribution.findById(contributionId);
      if (!contribution) {
        throw new Error('Không tìm thấy đóng góp nguồn (SourceContribution) tương ứng.');
      }

      const previousFile = hasStoredOriginalPdf(contribution.originalFile)
        ? { ...(contribution.originalFile as any).toObject?.(), ...contribution.originalFile }
        : undefined;
      contribution.originalFile = originalFile;
      if (!contribution.title) {
        contribution.title = upload.original_filename
          .replace(/\.[^/.]+$/, '')
          .replace(/_/g, ' ');
      }
      const needsExtraction = !contribution.readableInApp
        || (contribution.fullTextStatus !== 'imported'
          && contribution.fullTextStatus !== 'available')
        || !contribution.smartReaderStats
        || contribution.smartReaderStats.pageCount <= 1;
      if (needsExtraction) contribution.extractionStatus = 'uploaded';
      await contribution.save();

      if (previousFile) {
        try {
          await deleteOriginalPdfAsset(previousFile);
        } catch (error: any) {
          console.warn(
            'Uploaded the replacement PDF but could not delete the old asset:',
            error.message,
          );
        }
      }
    } else {
      const title = upload.original_filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
      contribution = new SourceContribution({
        submittedBy: userId,
        reviewStatus: 'pending',
        verificationStatus: 'manual',
        allowedUse: 'open_access_fulltext',
        copyrightStatus: 'copyrighted_with_open_access',
        fullTextStatus: 'available',
        title,
        metadata: { title },
        originalFile,
        sourceOrigin: 'uploaded_pdf',
        extractionStatus: 'uploaded',
      });
      await contribution.save();
    }

    return {
      storageProvider: upload.storageProvider,
      format: upload.format,
      bytes: upload.bytes,
      original_filename: upload.original_filename,
      sourceContribution: contribution,
    };
  } catch (error) {
    try {
      await deleteProcessedPdfUpload(upload);
    } catch (cleanupError: any) {
      console.error('Failed to clean up uploaded PDF asset:', cleanupError.message);
    }
    throw error;
  }
}
