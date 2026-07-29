import { Types } from 'mongoose';
import {
  ApprovalContribution,
  ApprovalOutcome,
  PreparedApprovalContext,
} from '../../dto/contributionWorkflow.dto';
import AcademicChunk from '../../models/AcademicChunk';
import AcademicDocument from '../../models/AcademicDocument';
import { IAcademicSource } from '../../models/AcademicSource';
import AcademicSection from '../../models/AcademicSection';
import { importFullTextForSource } from '../source/fullTextImport.service';

async function promotePreview(
  academicSource: IAcademicSource,
  contribution: ApprovalContribution,
  reviewerId: Types.ObjectId,
): Promise<void> {
  await AcademicDocument.updateOne(
    { previewContributionId: contribution._id },
    { $set: { sourceId: academicSource._id }, $unset: { previewContributionId: 1 } },
  );
  await AcademicSection.updateMany(
    { previewContributionId: contribution._id },
    { $set: { sourceId: academicSource._id }, $unset: { previewContributionId: 1 } },
  );
  await AcademicChunk.updateMany(
    { previewContributionId: contribution._id },
    { $set: { sourceId: academicSource._id }, $unset: { previewContributionId: 1 } },
  );

  academicSource.allowedUse = 'open_access_fulltext';
  if (contribution.fullTextStatus === 'importing') {
    throw new Error('reader_import_in_progress');
  }
  academicSource.fullTextStatus = contribution.fullTextStatus || 'imported';
  academicSource.readableInApp = true;
  academicSource.chunkBuildStatus = 'completed';
  academicSource.chunkCount = await AcademicChunk.countDocuments({
    sourceId: academicSource._id,
    chunkPurpose: 'rag',
  });
  academicSource.chunkEmbeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  academicSource.chunkBuiltAt = new Date();
  academicSource.fullTextImportedAt = new Date();
  academicSource.fullTextImportedBy = reviewerId;
  academicSource.fullTextImportError = undefined;
  await academicSource.save();
}

export async function finalizeApprovedSource(
  academicSource: IAcademicSource,
  prepared: PreparedApprovalContext,
  reviewerId: Types.ObjectId,
): Promise<ApprovalOutcome> {
  if (prepared.previewDocument) {
    await promotePreview(academicSource, prepared.contribution, reviewerId);
    return {
      message: 'Nguồn đã được duyệt và dữ liệu xem trước đã được chuyển giao thành công.',
      warning: false,
    };
  }
  if (prepared.metadata.openAccessStatus === 'hybrid') {
    return {
      message: 'Hybrid Open Access metadata saved. Full text import is available only if a direct public PDF/HTML URL exists.',
      warning: true,
      code: 'HYBRID_OA_METADATA_ONLY',
    };
  }
  if (academicSource.allowedUse !== 'open_access_fulltext'
    || (!academicSource.pdfUrl && !academicSource.url && !academicSource.fullTextUrl)) {
    return {
      message: 'Nguồn đã được duyệt, nhưng chưa có toàn văn để nhập.',
      warning: true,
      code: 'APPROVED_METADATA_ONLY',
    };
  }

  const allowedCopyright = prepared.uploadedPdf
    || academicSource.copyrightStatus === 'copyrighted_with_open_access'
    || academicSource.copyrightStatus === 'public_domain'
    || academicSource.allowedUse === 'open_access_fulltext';
  if (!allowedCopyright) {
    return {
      message: 'Nguồn đã được duyệt, nhưng chưa có toàn văn để nhập.',
      warning: true,
      code: 'APPROVED_METADATA_ONLY',
    };
  }

  try {
    const result = await importFullTextForSource(academicSource, reviewerId);
    if (result.success && !result.warning) {
      return {
        message: 'Nguồn đã được duyệt và nhập bản đọc thành công.',
        warning: false,
        fullText: result.data?.fullText,
      };
    }
    if (result.success) {
      return {
        message: result.message || 'Nguồn đã được duyệt, nhưng nhập bản đọc tự động bị chặn.',
        warning: true,
        code: result.code,
        details: result.details,
      };
    }
    return {
      message: 'Nguồn đã được duyệt, nhưng nhập bản đọc tự động thất bại.',
      warning: true,
      code: 'FULLTEXT_IMPORT_FAILED',
      details: { error: result.error || result.message },
    };
  } catch (error: unknown) {
    console.error('Auto-import on approval crashed:', error);
    return {
      message: 'Nguồn đã được duyệt, nhưng nhập bản đọc tự động gặp lỗi hệ thống.',
      warning: true,
      code: 'FULLTEXT_IMPORT_SYSTEM_ERROR',
      details: { error: errorMessage(error) },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
