import type { Types } from 'mongoose';
import User from '../../../identity/models/User';
import {
  calculateRank,
  checkAndAwardAchievements,
} from '../../../identity/services/rank.service';
import Notification from '../../../social/models/Notification';
import Dream from '../../models/Dream';

type ToggleDreamLikeInput = {
  dreamId: Types.ObjectId;
  userId: Types.ObjectId;
};

export type ToggleDreamLikeResult =
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | {
      status: 'ok';
      liked: boolean;
      likesCount: number;
      likes: string[];
      notification?: unknown;
      recipientId?: string;
    };

async function awardLikePoints(ownerId: Types.ObjectId): Promise<void> {
  const owner = await User.findById(ownerId);
  if (!owner) return;

  owner.rankPoints += 10;
  const ownerDreams = await Dream.find({ userId: owner._id });
  const totalLikes = ownerDreams.reduce(
    (sum, dream) => sum + (dream.likes?.length || 0),
    0,
  );
  const totalComments = ownerDreams.reduce(
    (sum, dream) => sum + (dream.comments_count || 0),
    0,
  );
  checkAndAwardAchievements(
    owner,
    totalLikes,
    totalComments,
    ownerDreams.length,
    owner.followers?.length || 0,
    owner.following?.length || 0,
    owner.totalTimeOnline || 0,
  );
  owner.currentRank = calculateRank(
    owner.rankPoints,
    owner.achievements,
    owner.streakCount,
    owner.highestStreak,
  );
  await owner.save();
}

export async function toggleDreamLike(
  input: ToggleDreamLikeInput,
): Promise<ToggleDreamLikeResult> {
  const dream = await Dream.findById(input.dreamId);
  if (!dream) return { status: 'not_found' };

  const userId = String(input.userId);
  const ownerId = String((dream.userId as any)?._id || dream.userId);
  if ((dream.privacy === 'private' || dream.is_public === false) && ownerId !== userId) {
    return { status: 'forbidden' };
  }

  const wasLiked = dream.likes.includes(userId);
  dream.likes = wasLiked
    ? dream.likes.filter(id => id !== userId)
    : [...dream.likes, userId];
  dream.likes_count = wasLiked
    ? Math.max(0, dream.likes_count - 1)
    : dream.likes_count + 1;
  await dream.save();

  let notification: unknown;
  if (!wasLiked && ownerId !== userId) {
    try {
      const created = await Notification.create({
        recipientId: dream.userId,
        senderId: input.userId,
        type: 'like',
        postId: dream._id,
      });
      await created.populate('senderId', 'username display_name avatar');
      notification = created;
      await awardLikePoints(dream.userId as Types.ObjectId);
    } catch (error) {
      console.error('❌ Failed to trigger like notification:', error);
    }
  }

  return {
    status: 'ok',
    liked: !wasLiked,
    likesCount: dream.likes_count,
    likes: dream.likes,
    ...(notification ? { notification, recipientId: ownerId } : {}),
  };
}
