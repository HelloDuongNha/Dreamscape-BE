import mongoose from 'mongoose';
import type { Request, Response } from 'express';
import { deleteSourceData } from '../services/source/sourceDeletion.service';

export async function deleteSource(req: Request, res: Response): Promise<void> {
  if (!req.user?._id) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }
  const id = req.params.id as string;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
    return;
  }

  try {
    const result = await deleteSourceData(id);
    res.status(result.status).json(result.body);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi xóa tài liệu.',
      error: error.message || error,
    });
  }
}
