import type { Request, Response } from 'express';
import { parsePdfImportOptions } from '../dto/pdfSource.dto';
import { getPdfImportProgress } from '../services/ingestion/pdf/pdfImportProgress.service';
import {
  cancelDispatchedPdfImport,
  dispatchUploadedPdfImport,
} from '../services/ingestion/pdf/uploadedPdfImportDispatch.service';

type PdfImportTarget = 'approved_source' | 'contribution';

async function sendProgress(
  targetType: PdfImportTarget,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const result = await getPdfImportProgress(targetType, req.params.id as string);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      message: error.message || 'Không tìm thấy trạng thái xử lý PDF.',
    });
  }
}

async function cancelImport(
  targetType: PdfImportTarget,
  req: Request,
  res: Response,
): Promise<void> {
  const cancelled = await cancelDispatchedPdfImport(targetType, req.params.id as string);
  if (!cancelled) {
    res.status(409).json({ success: false, message: 'Tác vụ nhập PDF không còn chạy.' });
    return;
  }
  res.status(200).json({ success: true, message: 'Đã hủy nhập PDF.' });
}

async function processImport(
  targetType: PdfImportTarget,
  fallbackMessage: string,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const options = parsePdfImportOptions(req.body);
    const result = await dispatchUploadedPdfImport({
      targetType,
      targetId: req.params.id as string,
      ...options,
      userId: req.user?._id,
    });
    res.status(202).json({
      success: true,
      ...result,
      message: result.reused
        ? 'Tác vụ nhập PDF này đang được xử lý.'
        : 'Đã đưa tác vụ nhập PDF vào hàng xử lý.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || fallbackMessage });
  }
}

export async function getUploadedPdfImportProgressForApprovedSource(
  req: Request,
  res: Response,
): Promise<void> {
  await sendProgress('approved_source', req, res);
}

export async function cancelUploadedPdfImportForApprovedSource(
  req: Request,
  res: Response,
): Promise<void> {
  await cancelImport('approved_source', req, res);
}

export async function processUploadedPdfForApprovedSource(
  req: Request,
  res: Response,
): Promise<void> {
  await processImport('approved_source', 'Lỗi xử lý tệp PDF nguồn.', req, res);
}

export async function getUploadedPdfImportProgressForContribution(
  req: Request,
  res: Response,
): Promise<void> {
  await sendProgress('contribution', req, res);
}

export async function cancelUploadedPdfImportForContribution(
  req: Request,
  res: Response,
): Promise<void> {
  await cancelImport('contribution', req, res);
}

export async function processUploadedPdfForContribution(
  req: Request,
  res: Response,
): Promise<void> {
  await processImport('contribution', 'Lỗi xử lý tệp PDF đóng góp.', req, res);
}
