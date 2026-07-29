import fs from 'fs';
import type { Request, Response } from 'express';
import { parseForceCache } from '../dto/pdfSource.dto';
import { cacheOriginalPdfForSource } from '../services/storage/originalPdfAsset.service';
import {
  deleteOriginalPdfForSource,
  uploadOriginalPdfForSource,
} from '../services/storage/originalPdfMutation.service';

export async function cacheOriginalPdf(req: Request, res: Response): Promise<void> {
  try {
    const result = await cacheOriginalPdfForSource(
      req.params.id as string,
      req.user?._id?.toString(),
      parseForceCache(req.body?.force),
    );
    res.status(200).json({
      success: true,
      status: result.status,
      message: result.message,
      attemptedCandidates: result.attemptedCandidates,
      source: result.source,
      data: result.source,
    });
  } catch (error: any) {
    console.error('Error caching original PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lưu trữ PDF gốc.',
      error: error.message || error,
    });
  }
}

export async function uploadOriginalPdf(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, message: 'Không tìm thấy tệp PDF để tải lên.' });
    return;
  }

  try {
    const result = await uploadOriginalPdfForSource(
      req.params.id as string,
      file,
      req.user?._id,
    );
    res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error('Error uploading original PDF:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi máy chủ khi tải lên tài liệu PDF gốc.',
      error: error.message || error,
    });
  } finally {
    if (fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (error: any) {
        console.error(`Lỗi khi dọn dẹp file tạm multer: ${file.path}`, error.message);
      }
    }
  }
}

export async function deleteOriginalPdf(req: Request, res: Response): Promise<void> {
  try {
    const result = await deleteOriginalPdfForSource(req.params.id as string);
    res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error('Error deleting original PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi xóa PDF gốc.',
      error: error.message || error,
    });
  }
}
