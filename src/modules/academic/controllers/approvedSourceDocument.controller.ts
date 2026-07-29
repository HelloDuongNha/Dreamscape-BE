import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { SsrfError } from '../../../infrastructure/security/ssrfGuard';
import { parseApprovedSourceId } from '../dto/approvedSource.dto';
import {
  ApprovedSourceDocumentError,
  openApprovedSourcePdf,
  resolveApprovedSourceDocument,
} from '../services/storage/approvedSourceDocument.service';

const NOT_FOUND_DOCUMENT = {
  success: false,
  canEmbed: false,
  hasPdf: false,
  sourceKind: 'external_link',
  message: 'Không tìm thấy tài liệu này.',
};

export async function getApprovedSourceOriginalDocument(req: Request, res: Response): Promise<void> {
  try {
    const id = parseApprovedSourceId(req.params.id);
    if (!id) {
      res.status(404).json(NOT_FOUND_DOCUMENT);
      return;
    }

    const result = await resolveApprovedSourceDocument(id);
    if (!result) {
      res.status(404).json(NOT_FOUND_DOCUMENT);
      return;
    }

    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      canEmbed: false,
      hasPdf: false,
      sourceKind: 'failed',
      message: 'Có lỗi xảy ra khi xác định tài liệu gốc.',
      error: error.message || error,
    });
  }
}

export async function getApprovedSourcePdfInline(req: Request, res: Response): Promise<void> {
  try {
    const id = parseApprovedSourceId(req.params.id);
    if (!id) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const pdf = await openApprovedSourcePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    if (pdf.kind === 'stream') {
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
      );
      res.status(200);
      await pipeline(pdf.stream, res);
      return;
    }

    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.status(200).send(pdf.buffer);
  } catch (error: any) {
    console.error('Error streaming PDF inline:', error);
    if (error instanceof ApprovedSourceDocumentError) {
      res.status(error.status).json({
        success: false,
        ...(error.code ? { code: error.code } : {}),
        message: error.message,
      });
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

    const invalidPdf = error.message?.includes('không phải PDF') || error.message?.includes('PDF');
    res.status(invalidPdf ? 400 : 500).json({
      success: false,
      code: invalidPdf ? 'PDF_INVALID' : 'PDF_FETCH_FAILED',
      message: error.message || 'Lỗi khi tải tài liệu PDF.',
    });
  }
}
