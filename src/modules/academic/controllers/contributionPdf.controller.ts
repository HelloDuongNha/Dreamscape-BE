import mongoose from 'mongoose';
import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { SsrfError } from '../../../infrastructure/security/ssrfGuard';
import { parseForceCache } from '../dto/pdfSource.dto';
import { mapSourceOriginAndUrls } from '../services/source/academicSourceResponse.service';
import { cacheOriginalPdfForContribution } from '../services/storage/originalPdfAsset.service';
import {
  ContributionPdfError,
  openContributionPdf,
} from '../services/storage/contributionPdfDocument.service';
import { deleteContributionOriginalPdf } from '../services/storage/contributionPdfMutation.service';

function validId(id: string): boolean {
  return Boolean(id && mongoose.Types.ObjectId.isValid(id));
}

export async function getContributionPdfInline(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    if (!validId(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }
    const result = await openContributionPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      result.kind === 'stream'
        ? `inline; filename*=UTF-8''${encodeURIComponent(result.filename)}`
        : 'inline; filename="document.pdf"',
    );
    res.status(200);
    if (result.kind === 'stream') await pipeline(result.stream, res);
    else res.send(result.buffer);
  } catch (error: any) {
    if (error instanceof ContributionPdfError) {
      res.status(error.status).json({ success: false, code: error.code, message: error.message });
      return;
    }
    if (error instanceof SsrfError) {
      res.status(400).json({
        success: false,
        code: 'SSRF_BLOCKED',
        message: 'URL bị chặn bởi kiểm tra an toàn SSRF.',
      });
      return;
    }
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Lỗi hệ thống khi xử lý yêu cầu.',
    });
  }
}

export async function cacheContributionPdf(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    if (!validId(id)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy đóng góp nguồn.' });
      return;
    }
    const result = await cacheOriginalPdfForContribution(
      id,
      req.user?._id?.toString(),
      parseForceCache(req.body?.force),
    );
    const source = mapSourceOriginAndUrls(result.source);
    res.status(200).json({
      success: true,
      status: result.status,
      message: result.message,
      attemptedCandidates: result.attemptedCandidates,
      source,
      data: source,
    });
  } catch (error: any) {
    console.error('Error caching contribution PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lưu trữ PDF gốc.',
      error: error.message || error,
    });
  }
}

export async function deleteContributionPdf(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  if (!validId(id)) {
    res.status(404).json({ success: false, message: 'Không tìm thấy đóng góp nguồn.' });
    return;
  }
  try {
    const result = await deleteContributionOriginalPdf(id);
    res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error('Error deleting contribution PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi xóa PDF gốc.',
      error: error.message || error,
    });
  }
}
