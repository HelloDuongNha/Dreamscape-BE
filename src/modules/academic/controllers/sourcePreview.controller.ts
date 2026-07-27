import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { loadSourcePreview, SourcePreviewError } from '../services/reader/sourcePreview.service';

export async function getSourcePreview(req: Request, res: Response): Promise<void> {
  const sourceId = req.params.id as string;
  if (!sourceId || !mongoose.Types.ObjectId.isValid(sourceId)) {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
    return;
  }

  try {
    const data = await loadSourcePreview(sourceId);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof SourcePreviewError) {
      res.status(error.status).json({ success: false, ...(error.code ? { code: error.code } : {}), message: error.message });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tải dữ liệu xem trước.',
      error: error.message || error,
    });
  }
}
