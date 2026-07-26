import { Request, Response } from 'express';
import Comment from '../models/Comment';
import { Types } from 'mongoose';

// ─── GET /api/comments/user/:userId ──────────────────────────────────────────

/**
 * Fetch all comments made by a specific user.
 * Returns comments sorted newest-first, with dreamId populated
 * (so the client can render the original post data inside ReplyCard).
 * Auth: not required — public read.
 */
export const getUserComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = String(req.params.userId);

    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId format.' });
      return;
    }

    const comments = await Comment.find({ userId: new Types.ObjectId(userId) })
      .sort({ created_at: -1 })
      .populate('userId', 'username display_name avatar')
      .populate({
        path: 'dreamId',
        populate: { path: 'userId', select: 'username display_name avatar' },
      })
      .lean();

    res.status(200).json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch user comments.', error: err });
  }
};
