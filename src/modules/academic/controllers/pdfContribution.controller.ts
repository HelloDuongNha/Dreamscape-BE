import fs from 'fs';
import type { Request, Response } from 'express';
import { submitPdfContribution } from '../services/contribution/pdfContribution.service';

export async function contributePdfSource(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ success: false, message: 'Không tìm thấy tệp PDF để tải lên.' });
    return;
  }

  try {
    const result = await submitPdfContribution(file, req.body, req.user?._id);
    res.status(result.status).json(result.body);
  } catch (error: any) {
    res.status(error.status || 400).json({
      success: false,
      message: error.message || 'Lỗi khi đóng góp tài liệu PDF.',
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
