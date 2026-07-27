import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  PDF_MAX_FILE_SIZE_BYTES,
  PDF_MAX_FILE_SIZE_LABEL,
} from '../../../config/pdfLimits';
import { storeModerationPdf } from '../services/storage/moderationPdfUpload.service';

const uploadDirectory = path.join(__dirname, '../../uploads/tmp');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      if (!fs.existsSync(uploadDirectory)) fs.mkdirSync(uploadDirectory, { recursive: true });
      callback(null, uploadDirectory);
    },
    filename: (_req, file, callback) => {
      const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      callback(null, `${file.fieldname}-${suffix}.pdf`);
    },
  }),
  limits: { fileSize: PDF_MAX_FILE_SIZE_BYTES },
});

export function uploadPdfMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  upload.single('pdfFile')(req, res, error => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? `Kích thước tệp vượt quá giới hạn cho phép (${PDF_MAX_FILE_SIZE_LABEL}).`
        : `Lỗi upload: ${error.message}`;
      res.status(400).json({ success: false, message });
      return;
    }
    if (error) {
      res.status(500).json({
        success: false,
        message: `Lỗi upload không xác định: ${error.message}`,
      });
      return;
    }
    next();
  });
}

export async function uploadPdfFile(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, message: 'Không tìm thấy tệp PDF để tải lên.' });
    return;
  }

  try {
    const data = await storeModerationPdf(
      file,
      typeof req.body?.sourceContributionId === 'string'
        ? req.body.sourceContributionId
        : undefined,
      req.user?._id,
    );
    res.status(200).json({ success: true, message: 'Tải lên PDF thành công.', data });
  } catch (error: any) {
    res.status(error.status || 400).json({
      success: false,
      message: error.message || 'Lỗi khi xử lý hoặc tải lên tệp PDF.',
    });
  } finally {
    if (fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (error: any) {
        console.error(`Lỗi khi xóa tệp tạm: ${file.path}`, error.message);
      }
    }
  }
}
