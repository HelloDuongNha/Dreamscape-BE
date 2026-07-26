import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { getFirebaseStorage, getFirebaseStorageBucketName } from '../../config/firebaseAdmin';
import { PDF_MAX_FILE_SIZE_BYTES, PDF_MAX_FILE_SIZE_LABEL } from '../../config/pdfLimits';

export interface FirebasePdfAsset {
  storageProvider: 'firebase';
  firebaseStorageBucket: string;
  firebaseStoragePath: string;
  bytes: number;
  format: 'pdf';
  original_filename: string;
}

function sanitizePdfName(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  const safe = base.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safe || 'document'}.pdf`;
}

function validatePdfBuffer(buffer: Buffer): void {
  if (!buffer.length) throw new Error('Tệp PDF tải xuống không có dữ liệu.');
  if (buffer.length > PDF_MAX_FILE_SIZE_BYTES) {
    throw new Error(`Kích thước tệp vượt quá giới hạn cho phép (${PDF_MAX_FILE_SIZE_LABEL}).`);
  }
  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
    throw new Error('Tệp tải xuống không phải là định dạng PDF hợp lệ.');
  }
}

export async function uploadFirebasePdf(filePath: string, originalName: string): Promise<FirebasePdfAsset> {
  const stats = fs.statSync(filePath);
  if (stats.size > PDF_MAX_FILE_SIZE_BYTES) {
    throw new Error(`Kích thước tệp vượt quá giới hạn cho phép (${PDF_MAX_FILE_SIZE_LABEL}).`);
  }

  const safeName = sanitizePdfName(originalName);
  const destination = `academic_sources/original-pdfs/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
  const bucketName = getFirebaseStorageBucketName();
  const bucket = getFirebaseStorage().bucket(bucketName);

  await bucket.upload(filePath, {
    destination,
    resumable: true,
    validation: 'crc32c',
    metadata: {
      contentType: 'application/pdf',
      cacheControl: 'private, no-store',
      metadata: { originalFileName: originalName },
    },
  });

  return {
    storageProvider: 'firebase',
    firebaseStorageBucket: bucketName,
    firebaseStoragePath: destination,
    bytes: stats.size,
    format: 'pdf',
    original_filename: safeName,
  };
}

export async function downloadFirebasePdf(bucketName: string, objectPath: string): Promise<Buffer> {
  if (!bucketName || !objectPath) throw new Error('Thiếu thông tin Firebase Storage của tài liệu.');
  const file = getFirebaseStorage().bucket(bucketName).file(objectPath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size || 0);
  if (size > PDF_MAX_FILE_SIZE_BYTES) {
    throw new Error(`Kích thước tệp vượt quá giới hạn cho phép (${PDF_MAX_FILE_SIZE_LABEL}).`);
  }
  const [buffer] = await file.download({ validation: 'crc32c' });
  validatePdfBuffer(buffer);
  return buffer;
}

export async function createFirebasePdfReadStream(bucketName: string, objectPath: string): Promise<Readable> {
  if (!bucketName || !objectPath) throw new Error('Thiếu thông tin Firebase Storage của tài liệu.');
  const file = getFirebaseStorage().bucket(bucketName).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error('Tệp PDF không còn tồn tại trong Firebase Storage.');
  return file.createReadStream({ validation: true });
}

export async function deleteFirebasePdf(bucketName: string, objectPath: string): Promise<void> {
  if (!bucketName || !objectPath) return;
  await getFirebaseStorage().bucket(bucketName).file(objectPath).delete({ ignoreNotFound: true });
}
