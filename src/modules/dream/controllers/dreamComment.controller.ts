import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import Dream from '../models/Dream';
import Comment from '../../social/models/Comment';
import Notification from '../../social/models/Notification';
import User from '../../identity/models/User';
import { calculateRank } from '../../identity/services/rank.service';

// Adds a comment and applies its notification and rank side effects.
export async function addComment(req: Request, res: Response): Promise<void> {
  try {
    const myId = req.user!._id as Types.ObjectId;
    const dreamId = String(req.params.id);
    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const { content } = req.body as { content?: string };
    if (!content || content.trim() === '') {
      res.status(400).json({ success: false, message: 'content is required.' });
      return;
    }

    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }

    const comment = await Comment.create({
      dreamId: new Types.ObjectId(dreamId),
      userId: myId,
      content: content.trim(),
    });
    await Dream.findByIdAndUpdate(
      new Types.ObjectId(dreamId),
      { $inc: { comments_count: 1 } },
    );
    await comment.populate('userId', 'username display_name avatar');

    if (dream.userId.toString() !== myId.toString()) {
      try {
        const notification = await Notification.create({
          recipientId: dream.userId,
          senderId: myId,
          type: 'comment',
          postId: dream._id,
        });
        await notification.populate('senderId', 'username display_name avatar');
        req.app.get('io')?.to(dream.userId.toString()).emit('new_notification', notification);

        const postOwner = await User.findById(dream.userId);
        if (postOwner) {
          postOwner.rankPoints += 15;
          const ownerDreams = await Dream.find({ userId: postOwner._id });
          const ownerLikes = ownerDreams.reduce(
            (total, item) => total + (item.likes?.length || 0),
            0,
          );
          const ownerComments = ownerDreams.reduce(
            (total, item) => total + (item.comments_count || 0),
            0,
          );
          const { checkAndAwardAchievements } = await import('../../identity/services/rank.service');
          checkAndAwardAchievements(
            postOwner,
            ownerLikes,
            ownerComments,
            ownerDreams.length,
            postOwner.followers?.length || 0,
            postOwner.following?.length || 0,
            postOwner.totalTimeOnline || 0,
          );
          postOwner.currentRank = calculateRank(
            postOwner.rankPoints,
            postOwner.achievements,
            postOwner.streakCount,
            postOwner.highestStreak,
          );
          await postOwner.save();
        }
      } catch (error) {
        console.error('❌ Failed to trigger comment notification:', error);
      }
    }

    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add comment.',
      error,
    });
  }
}

// Returns comments in their original chronological order.
export async function getComments(req: Request, res: Response): Promise<void> {
  try {
    const dreamId = String(req.params.id);
    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const comments = await Comment.find({ dreamId: new Types.ObjectId(dreamId) })
      .sort({ created_at: 1 })
      .populate('userId', 'username display_name avatar')
      .lean();
    res.status(200).json({ success: true, data: comments });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments.',
      error,
    });
  }
}
