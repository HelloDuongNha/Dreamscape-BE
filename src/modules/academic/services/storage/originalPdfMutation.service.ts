import mongoose from 'mongoose';
import fs from 'fs';
import AcademicSource from '../../models/AcademicSource';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { processPdfUpload, toOriginalFileRecord } from './pdfUpload.service';
import { deleteOriginalPdfAsset, hasStoredOriginalPdf } from './originalPdfStorage.service';

export interface OriginalPdfMutationResult {
  status: number;
  body: Record<string, unknown>;
}

export async function uploadOriginalPdfForSource(
  sourceId: string,
  file: Express.Multer.File,
  userId: any,
): Promise<OriginalPdfMutationResult> {
  const source = await AcademicSource.findById(sourceId);
  if (!source) {
    return {
      status: 404,
      body: { success: false, message: 'Không tìm thấy tài liệu học thuật.' },
    };
  }

  const descriptor = fs.openSync(file.path, 'r');
  const magic = Buffer.alloc(4);
  fs.readSync(descriptor, magic, 0, 4, 0);
  fs.closeSync(descriptor);
  const validPdf = magic.toString('ascii') === '%PDF'
    && file.mimetype === 'application/pdf'
    && file.originalname.toLowerCase().endsWith('.pdf');
  if (!validPdf) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Tệp tải lên không phải là định dạng PDF hợp lệ.',
      },
    };
  }

  const upload = await processPdfUpload(file.path, file.originalname, file.mimetype);
  const previousFile = hasStoredOriginalPdf(source.originalFile)
    ? { ...(source.originalFile as any).toObject?.(), ...source.originalFile }
    : undefined;
  const replaced = Boolean(previousFile);
  source.originalFile = toOriginalFileRecord(upload, userId);
  await source.save();

  let warning: string | undefined;
  if (previousFile) {
    try {
      await deleteOriginalPdfAsset(previousFile);
    } catch (error: any) {
      console.warn('Failed to delete old PDF asset on replace:', error.message);
      warning = `Lưu tệp mới thành công nhưng gặp lỗi khi dọn dẹp tệp cũ: ${error.message}`;
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      status: replaced ? 'replaced' : 'uploaded',
      source,
      originalFile: source.originalFile,
      message: replaced
        ? 'Thay thế tài liệu PDF gốc thành công.'
        : 'Tải lên tài liệu PDF gốc thành công.',
      warning,
    },
  };
}

export async function deleteOriginalPdfForSource(
  sourceId: string,
): Promise<OriginalPdfMutationResult> {
  if (!sourceId || !mongoose.Types.ObjectId.isValid(sourceId)) {
    return {
      status: 404,
      body: { success: false, message: 'Không tìm thấy tài liệu học thuật.' },
    };
  }

  const source = await AcademicSource.findById(sourceId);
  if (!source) {
    return {
      status: 404,
      body: { success: false, message: 'Không tìm thấy tài liệu học thuật.' },
    };
  }
  if (!hasStoredOriginalPdf(source.originalFile)) {
    return {
      status: 200,
      body: {
        success: true,
        status: 'no_asset',
        message: 'Không có PDF gốc đã lưu.',
        source: mapSourceOriginAndUrls(source),
      },
    };
  }

  try {
    await deleteOriginalPdfAsset(source.originalFile);
  } catch {
    return {
      status: 500,
      body: { success: false, message: 'Không thể xóa PDF khỏi kho lưu trữ.' },
    };
  }

  source.originalFile = undefined;
  await source.save();
  return {
    status: 200,
    body: {
      success: true,
      status: 'deleted',
      message: 'Đã xóa PDF gốc thành công.',
      source: mapSourceOriginAndUrls(source),
    },
  };
}
