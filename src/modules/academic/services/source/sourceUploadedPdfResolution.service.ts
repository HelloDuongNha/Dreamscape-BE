import mongoose from 'mongoose';
import { getAssetMetadata } from '../../../../infrastructure/storage/cloudinaryStorage.service';
import {
  SourceImportResolverInput,
  SourceImportResolverResult,
} from '../../dto/sourceImport.dto';

export async function resolveUploadedPdfSource(
  fileRef: NonNullable<SourceImportResolverInput['uploadedFileRef']>,
  userId: mongoose.Types.ObjectId | undefined,
  warnings: string[],
): Promise<SourceImportResolverResult> {
  if (!userId) {
    throw new Error('Yêu cầu định danh tài khoản kiểm duyệt để xác minh tệp tải lên.');
  }

  const publicId = fileRef.cloudinaryPublicId;
  if (!publicId || !publicId.startsWith('academic_sources/')) {
    throw new Error('Cloudinary publicId không đúng cấu trúc thư mục quy định (academic_sources/).');
  }

  let asset: any;
  try {
    asset = await getAssetMetadata(publicId, 'raw');
  } catch (error: any) {
    throw new Error(`Xác minh Cloudinary thất bại: Tệp tin không tồn tại hoặc không thể truy cập (${error.message || error}).`);
  }
  if (!asset || asset.resource_type !== 'raw') {
    throw new Error('Tài liệu đã tải lên không đúng định dạng raw/original document.');
  }

  const originalFileName = fileRef.originalFileName
    || (asset.original_filename ? `${asset.original_filename}.pdf` : 'document.pdf');
  const title = originalFileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, ' ');
  warnings.push('Tài liệu PDF được lưu trữ thành công. Nội dung toàn văn sẽ được phân tích tự động.');

  return {
    sourceType: 'pdf_upload',
    title,
    authors: [],
    openAccessStatus: 'open',
    allowedUse: 'open_access_fulltext',
    fullTextAvailable: true,
    metadataProvider: 'cloudinary_metadata',
    originalFile: {
      storageProvider: 'cloudinary',
      originalFileName,
      mimeType: fileRef.mimeType || 'application/pdf',
      fileSize: asset.bytes || 0,
      cloudinaryPublicId: publicId,
      cloudinarySecureUrl: asset.secure_url || '',
      cloudinaryResourceType: 'raw',
      cloudinaryFormat: asset.format || 'pdf',
      uploadedBy: userId,
      uploadedAt: new Date(),
    },
    warnings,
  };
}
