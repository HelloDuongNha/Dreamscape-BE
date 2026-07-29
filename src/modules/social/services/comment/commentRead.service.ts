import { Types } from 'mongoose';
import Dream from '../../../dream/models/Dream';
import { buildDreamVisibilityFilter } from '../../../dream/services/content/dreamAccessPolicy.service';
import Comment from '../../models/Comment';

export class CommentReadError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CommentReadError';
  }
}

export async function loadVisibleUserComments(
  authorId: string,
  viewerId?: string,
) {
  if (!Types.ObjectId.isValid(authorId)) {
    throw new CommentReadError(400, 'Invalid userId format.');
  }

  const visibleDreamIds = await Dream.find(
    buildDreamVisibilityFilter(viewerId),
  ).distinct('_id');
  return Comment.find({
    userId: new Types.ObjectId(authorId),
    dreamId: { $in: visibleDreamIds },
    is_deleted: { $ne: true },
  })
    .select('-is_deleted -deleted_at -deleted_by -deleted_by_role')
    .sort({ created_at: -1 })
    .populate('userId', 'username display_name avatar streakCount')
    .populate('replyToUserId', 'username display_name avatar streakCount')
    .populate({
      path: 'dreamId',
      populate: { path: 'userId', select: 'username display_name avatar streakCount' },
    })
    .lean();
}
