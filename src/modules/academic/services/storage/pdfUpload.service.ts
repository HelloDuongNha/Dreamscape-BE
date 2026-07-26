import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { uploadOriginalPdf } from './originalPdfStorage.service';
import { deleteFirebasePdf } from './firebasePdfStorage.service';
import {
  PDF_MAX_FILE_SIZE_BYTES,
  PDF_MAX_FILE_SIZE_LABEL,
} from '../../config/pdfLimits';

export interface ProcessPdfUploadResult {
  storageProvider: 'firebase';
  firebaseStorageBucket: string;
  firebaseStoragePath: string;
  format: string;
  bytes: number;
  original_filename: string;
  fileHash: string;
}

export function toOriginalFileRecord(upload: ProcessPdfUploadResult, uploadedBy?: any) {
  return {
    storageProvider: upload.storageProvider,
    originalFileName: upload.original_filename,
    mimeType: 'application/pdf',
    fileSize: upload.bytes,
    firebaseStorageBucket: upload.firebaseStorageBucket,
    firebaseStoragePath: upload.firebaseStoragePath,
    uploadedBy,
    uploadedAt: new Date(),
    fileHash: upload.fileHash,
  };
}

export async function deleteProcessedPdfUpload(upload: ProcessPdfUploadResult): Promise<void> {
  await deleteFirebasePdf(upload.firebaseStorageBucket, upload.firebaseStoragePath);
}

/**
 * Computes the SHA-256 hash of a file at a given path.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Performs strict validations (extension, MIME, magic bytes, size, filename)
 * on a temporary disk PDF file, computes its SHA-256 hash, and uploads it to Cloudinary.
 */
export async function processPdfUpload(
  filePath: string,
  originalName: string,
  mimeType: string,
  precomputedFileHash?: string
): Promise<ProcessPdfUploadResult> {
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

  // 4. Validate file size against the shared configured boundary.
  const stats = fs.statSync(filePath);
  if (stats.size > PDF_MAX_FILE_SIZE_BYTES) {
    throw new Error(`Kích thước tệp vượt quá giới hạn cho phép (${PDF_MAX_FILE_SIZE_LABEL}).`);
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
  const fileHash = precomputedFileHash && /^[a-f0-9]{64}$/.test(precomputedFileHash)
    ? precomputedFileHash
    : await computeFileHash(filePath);

  // 7. Sanitize original filename
  const baseName = path.basename(originalName, ext);
  const sanitizedBase = baseName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const sanitizedName = `${sanitizedBase}.pdf`;

  // 8. Store the original PDF in Firebase Storage. Cloudinary remains dedicated
  // to extracted reader images/figures.
  const storageResult = await uploadOriginalPdf(filePath, sanitizedName);

  return {
    storageProvider: storageResult.storageProvider,
    firebaseStorageBucket: storageResult.firebaseStorageBucket,
    firebaseStoragePath: storageResult.firebaseStoragePath,
    format: storageResult.format,
    bytes: stats.size,
    original_filename: sanitizedName,
    fileHash
  };
}
