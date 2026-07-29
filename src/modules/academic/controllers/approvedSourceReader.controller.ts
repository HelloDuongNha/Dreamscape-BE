import type { Request, Response } from 'express';
import {
  parseApprovedSourceId,
  parseApprovedSourceReaderQuery,
} from '../dto/approvedSource.dto';
import {
  ApprovedSourceReaderError,
  loadApprovedSourceReader,
} from '../services/reader/approvedSourceReader.service';

export async function getApprovedSourceRead(req: Request, res: Response): Promise<void> {
  try {
    const id = parseApprovedSourceId(req.params.id);
    if (!id) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const data = await loadApprovedSourceReader(
      id,
      parseApprovedSourceReaderQuery(req.query),
    );
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error instanceof ApprovedSourceReaderError) {
      res.status(error.status).json({
        success: false,
        ...(error.code ? { code: error.code } : {}),
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tải nội dung bản đọc.',
      error: error.message || error,
    });
  }
}
