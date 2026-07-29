import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import { parsePdfContributionFields } from '../../dto/pdfSource.dto';
import { normalizeDoi } from '../source/openAccess.service';
import { normalizeSourceUrl } from '../source/sourceNormalization.service';
import {
  computeFileHash,
  deleteProcessedPdfUpload,
  processPdfUpload,
  toOriginalFileRecord,
} from '../storage/pdfUpload.service';
import {
  deleteOriginalPdfAsset,
  hasStoredOriginalPdf,
} from '../storage/originalPdfStorage.service';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { incrementSubmitted } from './contributionStats.service';
import {
  inspectPdfMetadata,
  isFilenameLike,
  resolvePdfContributionMetadata,
} from './pdfContributionMetadata.service';

export interface PdfContributionResult {
  status: number;
  body: Record<string, unknown>;
}

function duplicateResult(source: any, contribution: any): PdfContributionResult | null {
  if (source) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'DUPLICATE_SOURCE',
        message: `Nguồn này đã tồn tại trong thư viện với tiêu đề: "${source.title}".`,
        existingSourceId: source._id,
      },
    };
  }
  if (contribution) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'DUPLICATE_CONTRIBUTION',
        message: 'Nguồn này đã được gửi đóng góp trước đó và đang chờ duyệt.',
      },
    };
  }
  return null;
}

async function reactivateRejectedContribution(
  rejected: any,
  replacement: any,
  uploadResult: any,
): Promise<PdfContributionResult> {
  const oldOriginalFile = hasStoredOriginalPdf(rejected.originalFile)
    ? { ...(rejected.originalFile as any).toObject?.(), ...rejected.originalFile }
    : undefined;
  const resetFields = [
    'reviewedBy', 'reviewedAt', 'reviewNote', 'smartReaderStats',
    'extractionMethod', 'extractionQuality', 'pdfPageCount',
    'detectedLanguage', 'detectedIdentifiers',
  ];
  rejected.reviewStatus = 'pending';
  for (const field of resetFields) rejected[field] = undefined;
  rejected.readableInApp = false;
  rejected.fullTextStatus = 'none';
  rejected.extractionStatus = 'uploaded';
  rejected.originalFile = replacement.originalFile;

  for (const field of [
    'title', 'authors', 'year', 'doi', 'normalizedDoi',
    'url', 'normalizedUrl', 'metadata',
  ]) {
    rejected[field] = replacement[field] || rejected[field];
  }

  try {
    await rejected.save();
  } catch (error) {
    await deleteProcessedPdfUpload(uploadResult).catch(cleanupError => {
      console.error('Failed to clean up newly uploaded PDF asset:', cleanupError);
    });
    throw error;
  }

  let warning: string | undefined;
  if (oldOriginalFile) {
    try {
      await deleteOriginalPdfAsset(oldOriginalFile);
    } catch (error: any) {
      console.warn('Failed to clean up old PDF asset on reactivation:', error.message || error);
      warning = `Cảnh báo: Không thể xóa tệp PDF cũ: ${error.message || error}`;
    }
  }

  return {
    status: 201,
    body: {
      success: true,
      code: 'REACTIVATED',
      message: warning
        ? `Đóng góp trước bị từ chối đã được kích hoạt lại với PDF mới. ${warning}`
        : 'Đóng góp trước bị từ chối đã được kích hoạt lại với PDF mới.',
      data: rejected,
    },
  };
}

export async function submitPdfContribution(
  file: Express.Multer.File,
  body: any,
  userId: any,
): Promise<PdfContributionResult> {
  let fileHash: string;
  try {
    fileHash = await computeFileHash(file.path);
  } catch (error: any) {
    throw new Error(`Lỗi khi tính toán mã băm tệp: ${error.message}`);
  }

  const inspected = await inspectPdfMetadata(file.path);
  const { finalDoi, resolvedMeta } = await resolvePdfContributionMetadata(
    body,
    inspected.detectedDoi,
    userId,
  );
  const conditions: any[] = [{ 'originalFile.fileHash': fileHash }];

  if (finalDoi) {
    conditions.push({ normalizedDoi: finalDoi }, { doi: finalDoi });
    const source = await AcademicSource.findOne({
      $or: [{ normalizedDoi: finalDoi }, { doi: finalDoi }],
    });
    if (source) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'DUPLICATE_SOURCE',
          message: `Nguồn này đã tồn tại trong hệ thống với tiêu đề: "${source.title}".`,
          existingSourceId: source._id,
        },
      };
    }
    const contribution = await SourceContribution.findOne({
      reviewStatus: { $ne: 'rejected' },
      $or: [{ normalizedDoi: finalDoi }, { doi: finalDoi }],
    });
    const duplicate = duplicateResult(null, contribution);
    if (duplicate) return duplicate;
  }

  const bodyUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  const finalUrl = (bodyUrl || resolvedMeta?.sourceUrl || '').trim();
  if (finalUrl) {
    conditions.push({ normalizedUrl: normalizeSourceUrl(finalUrl) }, { url: finalUrl });
  }

  const existingContribution = await SourceContribution.findOne({
    reviewStatus: { $ne: 'rejected' },
    $or: conditions,
  });
  const existingSource = await AcademicSource.findOne({ $or: conditions });
  const duplicate = duplicateResult(existingSource, existingContribution);
  if (duplicate) return duplicate;

  const fields = parsePdfContributionFields(body);
  const uploadResult = await processPdfUpload(
    file.path,
    file.originalname,
    file.mimetype,
    fileHash,
  );
  const title = fields.title
    || resolvedMeta?.title
    || (!isFilenameLike(inspected.metadataTitle || '', file.originalname)
      ? inspected.metadataTitle
      : '');
  const authors = fields.authors.length ? fields.authors : resolvedMeta?.authors || [];
  const year = fields.year !== undefined ? fields.year : resolvedMeta?.year;
  const journal = fields.journal || resolvedMeta?.journal || '';
  const publisher = fields.publisher || resolvedMeta?.publisher || '';

  const contribution = new SourceContribution({
    submittedBy: userId,
    doi: finalDoi || undefined,
    normalizedDoi: finalDoi ? normalizeDoi(finalDoi) : undefined,
    url: finalUrl || undefined,
    normalizedUrl: finalUrl ? normalizeSourceUrl(finalUrl) : undefined,
    submittedNote: fields.submittedNote || undefined,
    reviewStatus: 'pending',
    title: title || undefined,
    authors: authors.length ? authors : undefined,
    year,
    originalFile: toOriginalFileRecord(uploadResult, userId),
    sourceOrigin: 'uploaded_pdf',
    extractionStatus: 'uploaded',
    metadata: {
      title: title || undefined,
      authors,
      year,
      journal: journal || undefined,
      publisher: publisher || undefined,
      doi: finalDoi || undefined,
      url: finalUrl || undefined,
    },
  });

  try {
    await contribution.save();
  } catch (error: any) {
    if (error.code === 11000) {
      const rejected = await SourceContribution.findOne({
        reviewStatus: 'rejected',
        $or: conditions,
      });
      if (rejected) return reactivateRejectedContribution(rejected, contribution, uploadResult);
      await deleteProcessedPdfUpload(uploadResult).catch(() => undefined);
      return {
        status: 409,
        body: { success: false, message: 'Không thể gửi đóng góp do trùng lặp dữ liệu.' },
      };
    }
    await deleteProcessedPdfUpload(uploadResult).catch(cleanupError => {
      console.error('Failed to clean up uploaded PDF asset:', cleanupError);
    });
    throw error;
  }

  if (userId) {
    try {
      await incrementSubmitted(userId.toString());
    } catch (error) {
      console.error('Failed to increment contribution stats:', error);
    }
  }

  return {
    status: 201,
    body: {
      success: true,
      message: 'Đóng góp tài liệu PDF của bạn đã được gửi thành công và đang chờ duyệt.',
      data: mapSourceOriginAndUrls(contribution),
    },
  };
}
