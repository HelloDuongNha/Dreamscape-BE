import type { Types } from 'mongoose';
import Comment from '../../../social/models/Comment';
import Notification from '../../../social/models/Notification';
import Dream from '../../models/Dream';

export type DeleteOwnedDreamInput = {
  dreamId: Types.ObjectId;
  ownerId: Types.ObjectId;
};

// Keep the original delete order: dream, comments, then notifications.
export async function deleteOwnedDream(input: DeleteOwnedDreamInput): Promise<boolean> {
  const deletedDream = await Dream.findOneAndDelete({
    _id: input.dreamId,
    userId: input.ownerId,
  });
  if (!deletedDream) return false;

  await Comment.deleteMany({ dreamId: input.dreamId });
  await Notification.deleteMany({ postId: input.dreamId });
  return true;
}
