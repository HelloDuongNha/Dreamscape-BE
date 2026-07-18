import { Readable } from 'stream';
import cloudinary from '../../config/cloudinary';
import { deleteAsset, downloadCloudinaryRawAsset } from './cloudinaryStorage.service';
import {
  createFirebasePdfReadStream,
  deleteFirebasePdf,
  downloadFirebasePdf,
  uploadFirebasePdf,
} from './firebasePdfStorage.service';

export interface OriginalPdfReference {
  storageProvider?: 'firebase' | 'cloudinary' | 'local' | 'gridfs';
  firebaseStorageBucket?: string;
  firebaseStoragePath?: string;
  cloudinaryPublicId?: string;
  cloudinarySecureUrl?: string;
  originalFileName?: string;
}

export function hasStoredOriginalPdf(file?: OriginalPdfReference | null): boolean {
  if (!file) return false;
  if (file.storageProvider === 'firebase') return !!(file.firebaseStorageBucket && file.firebaseStoragePath);
  if (file.storageProvider === 'cloudinary') return !!file.cloudinaryPublicId;
  return false;
}

export async function uploadOriginalPdf(filePath: string, originalName: string) {
  return uploadFirebasePdf(filePath, originalName);
}

export async function downloadOriginalPdfAsset(file: OriginalPdfReference): Promise<Buffer> {
  if (file.storageProvider === 'firebase' && file.firebaseStorageBucket && file.firebaseStoragePath) {
    return downloadFirebasePdf(file.firebaseStorageBucket, file.firebaseStoragePath);
  }
  if (file.storageProvider === 'cloudinary' && file.cloudinaryPublicId) {
    return downloadCloudinaryRawAsset(file.cloudinaryPublicId);
  }
  throw new Error('Tài liệu không có tệp PDF gốc hợp lệ trong kho lưu trữ.');
}

export async function createOriginalPdfReadStream(file: OriginalPdfReference): Promise<Readable> {
  if (file.storageProvider === 'firebase' && file.firebaseStorageBucket && file.firebaseStoragePath) {
    return createFirebasePdfReadStream(file.firebaseStorageBucket, file.firebaseStoragePath);
  }
  if (file.storageProvider === 'cloudinary' && file.cloudinaryPublicId) {
    const signedUrl = cloudinary.utils.private_download_url(file.cloudinaryPublicId, '', {
      resource_type: 'raw',
      type: 'upload',
    });
    const response = await fetch(signedUrl);
    if (!response.ok || !response.body) throw new Error(`Máy chủ tài liệu trả về mã lỗi: ${response.status}`);
    return Readable.fromWeb(response.body as any);
  }
  throw new Error('Tài liệu không có tệp PDF gốc hợp lệ trong kho lưu trữ.');
}

export async function deleteOriginalPdfAsset(file?: OriginalPdfReference | null): Promise<void> {
  if (!file) return;
  if (file.storageProvider === 'firebase' && file.firebaseStorageBucket && file.firebaseStoragePath) {
    await deleteFirebasePdf(file.firebaseStorageBucket, file.firebaseStoragePath);
    return;
  }
  if (file.storageProvider === 'cloudinary' && file.cloudinaryPublicId) {
    await deleteAsset(file.cloudinaryPublicId, 'raw');
  }
}
