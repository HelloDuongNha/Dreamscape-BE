import type { Request, Response } from 'express';
import { parsePdfImportOptions } from '../dto/pdfSource.dto';
import {
  cancelUploadedPdfImport,
  runUploadedPdfImport,
} from '../services/ingestion/pdf/uploadedPdfImport.service';
import { getPdfImportProgress } from '../services/ingestion/pdf/pdfImportProgress.service';

export async function getUploadedPdfImportProgressForApprovedSource(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const result = await getPdfImportProgress('approved_source', req.params.id as string);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      message: error.message || 'Không tìm thấy trạng thái xử lý PDF.',
    });
  }
}

export async function cancelUploadedPdfImportForApprovedSource(
  req: Request,
  res: Response,
): Promise<void> {
  const cancelled = await cancelUploadedPdfImport('approved_source', req.params.id as string);
  if (!cancelled) {
    res.status(409).json({ success: false, message: 'Tác vụ nhập PDF không còn chạy.' });
    return;
  }
  res.status(200).json({ success: true, message: 'Đã hủy nhập PDF.' });
}

export async function processUploadedPdfForApprovedSource(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const options = parsePdfImportOptions(req.body);
    const result = await runUploadedPdfImport({
      targetType: 'approved_source',
      targetId: req.params.id as string,
      ...options,
      userId: req.user?._id,
    });
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Lỗi xử lý tệp PDF nguồn.',
    });
  }
}
