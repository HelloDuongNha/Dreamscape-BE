import { Request, Response } from 'express';
import {
  CommentReadError,
  loadVisibleUserComments,
} from '../services/comment/commentRead.service';

export async function getUserComments(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const data = await loadVisibleUserComments(
      String(req.params.userId),
      String(req.user?._id || '') || undefined,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof CommentReadError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user comments.',
      error,
    });
  }
}
