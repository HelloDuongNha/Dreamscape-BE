import mongoose from 'mongoose';
import type { Request, Response } from 'express';
import { buildRagChunks } from '../services/reader/ragChunkBuild.service';

export async function buildChunks(req: Request, res: Response): Promise<void> {
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
    const result = await buildRagChunks(id);
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Fatal outer buildChunks controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi bắt đầu xây dựng dữ liệu RAG.',
    });
  }
}
