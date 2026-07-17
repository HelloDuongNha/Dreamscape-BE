import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { uploadPdf } from './cloudinaryStorage.service';
import cloudinary from '../../config/cloudinary';

export interface ProcessPdfUploadResult {
  public_id: string;
  secure_url: string;
  resource_type: string;
  format: string;
  bytes: number;
  original_filename: string;
  fileHash: string;
}

/**
 * Computes the SHA-256 hash of a file at a given path.
 */
export function computeFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

/**
 * Performs strict validations (extension, MIME, magic bytes, size, filename)
 * on a temporary disk PDF file, computes its SHA-256 hash, and uploads it to Cloudinary.
 */
export async function processPdfUpload(
  filePath: string,
  originalName: string,
  mimeType: string
): Promise<ProcessPdfUploadResult> {
  // 0. Validate Cloudinary configuration first
  const missingVars: string[] = [];
  if (!process.env.CLOUDINARY_CLOUD_NAME) missingVars.push('CLOUDINARY_CLOUD_NAME');
  if (!process.env.CLOUDINARY_API_KEY) missingVars.push('CLOUDINARY_API_KEY');
  if (!process.env.CLOUDINARY_API_SECRET) missingVars.push('CLOUDINARY_API_SECRET');

  if (missingVars.length > 0) {
    console.warn(`Cloudinary config missing: ${missingVars.join(', ')}`);
    const err: any = new Error('Cấu hình lưu trữ tệp chưa sẵn sàng. Vui lòng kiểm tra Cloudinary trong backend .env.');
    err.status = 500;
    err.code = 'CLOUDINARY_CONFIG_MISSING';
    throw err;
  }

  // 1. Validate extension (.pdf)
  const ext = path.extname(originalName).toLowerCase();
  if (ext !== '.pdf') {
    throw new Error('Tệp tải lên phải có phần mở rộng .pdf.');
  }

  // 2. Validate MIME type when available
  if (mimeType && mimeType !== 'application/pdf') {
    throw new Error('Định dạng MIME không hợp lệ. Phải là application/pdf.');
  }

  // 3. Validate path traversal in filename
  if (originalName.includes('/') || originalName.includes('\\') || originalName.includes('..')) {
    throw new Error('Tên tệp không hợp lệ (nghi ngờ tấn công path traversal).');
  }

  // 4. Validate file size (<= 25MB)
  const stats = fs.statSync(filePath);
  if (stats.size > 25 * 1024 * 1024) {
    throw new Error('Kích thước tệp vượt quá giới hạn cho phép (25MB).');
  }

  // 5. Validate magic bytes begin with %PDF
  const buffer = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);
  const magicBytes = buffer.toString('ascii');
  if (magicBytes !== '%PDF') {
    throw new Error('Nội dung tệp không phải là định dạng PDF hợp lệ.');
  }

  // 6. Compute file SHA-256 hash
  const fileHash = computeFileHash(filePath);

  // 7. Sanitize original filename
  const baseName = path.basename(originalName, ext);
  const sanitizedBase = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const sanitizedName = `${sanitizedBase}.pdf`;

  // 8. Upload to Cloudinary using raw resource type
  const uniqueCloudinaryName = `${Date.now()}_${sanitizedBase}`;
  const cloudinaryResult = await uploadPdf(filePath, uniqueCloudinaryName);

  return {
    public_id: cloudinaryResult.public_id,
    secure_url: cloudinaryResult.secure_url,
    resource_type: cloudinaryResult.resource_type,
    format: cloudinaryResult.format || 'pdf',
    bytes: stats.size,
    original_filename: sanitizedName,
    fileHash
  };
}
