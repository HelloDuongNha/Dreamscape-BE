import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import Dream from '../models/Dream';
import Comment from '../../social/models/Comment';
import Notification from '../../social/models/Notification';
import User from '../../identity/models/User';
import { calculateRank } from '../../identity/services/rank.service';
import { findAccessibleDream } from '../services/content/dreamAccessPolicy.service';
import {
  CommentLifecycleError,
  createComment as createDreamComment,
  deleteManagedComment,
  editOwnedComment,
  setOwnedDreamCommentsEnabled,
} from '../services/engagement/commentLifecycle.service';

function sendCommentLifecycleError(res: Response, error: unknown): boolean {
  if (!(error instanceof CommentLifecycleError)) return false;
  const status = error.reason === 'forbidden'
    ? 403
    : error.reason === 'not_found'
      ? 404
      : error.reason === 'comments_disabled'
        ? 409
        : 400;
  res.status(status).json({
    success: false,
    code: error.reason,
    message: error.reason === 'comments_disabled'
      ? 'Comments are disabled for this dream.'
      : error.reason === 'forbidden'
        ? 'You do not have permission to manage this comment.'
        : error.reason === 'not_found'
          ? 'Comment not found.'
          : 'Invalid comment request.',
  });
  return true;
}

// Adds a comment and applies its notification and rank side effects.
export async function addComment(req: Request, res: Response): Promise<void> {
  try {
    const myId = req.user!._id as Types.ObjectId;
    const dreamId = String(req.params.id);
    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dreamId.' });
      return;
    }

    const dream = await findAccessibleDream(dreamId, String(myId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }
    if (dream.comments_enabled === false) {
      res.status(409).json({
        success: false,
        code: 'comments_disabled',
        message: 'Comments are disabled for this dream.',
      });
      return;
    }

    const comment = await createDreamComment({
      dreamId: new Types.ObjectId(dreamId),
      authorId: myId,
      content: req.body?.content,
    });
    await comment.populate('userId', 'username display_name avatar');

    if (dream.userId.toString() !== myId.toString()) {
      try {
        const notification = await Notification.create({
          recipientId: dream.userId,
          senderId: myId,
          type: 'comment',
          postId: dream._id,
          commentId: comment._id,
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
    if (sendCommentLifecycleError(res, error)) return;
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

    const dream = await findAccessibleDream(
      dreamId,
      String(req.user?._id || '') || undefined,
    );
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }

    const comments = await Comment.find({
      dreamId: dream._id,
      is_deleted: { $ne: true },
    })
      .select('-is_deleted -deleted_at -deleted_by -deleted_by_role')
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

// Updates an active comment while retaining a bounded history of prior text.
export async function editComment(req: Request, res: Response): Promise<void> {
  try {
    const comment = await editOwnedComment({
      commentId: String(req.params.commentId),
      authorId: req.user!._id as Types.ObjectId,
      content: req.body?.content,
    });
    await comment.populate('userId', 'username display_name avatar');
    res.status(200).json({ success: true, data: comment });
  } catch (error) {
    if (sendCommentLifecycleError(res, error)) return;
    res.status(500).json({ success: false, message: 'Failed to edit comment.' });
  }
}

// Deletes a comment when the caller is its author or owns the containing Dream.
export async function deleteComment(req: Request, res: Response): Promise<void> {
  try {
    const result = await deleteManagedComment({
      commentId: String(req.params.commentId),
      actorId: req.user!._id as Types.ObjectId,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (sendCommentLifecycleError(res, error)) return;
    res.status(500).json({ success: false, message: 'Failed to delete comment.' });
  }
}

// Lets a Dream owner change whether new comments may be created.
export async function updateCommentPolicy(req: Request, res: Response): Promise<void> {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({
      success: false,
      code: 'invalid_comment_policy',
      message: 'enabled must be a boolean.',
    });
    return;
  }

  try {
    const dream = await setOwnedDreamCommentsEnabled({
      dreamId: String(req.params.id),
      ownerId: req.user!._id as Types.ObjectId,
      enabled,
    });
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }
    res.status(200).json({ success: true, data: dream });
  } catch {
    res.status(500).json({
      success: false,
      message: 'Failed to update the comment policy.',
    });
  }
}
