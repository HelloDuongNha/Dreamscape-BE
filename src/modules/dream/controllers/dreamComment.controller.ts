import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import {
  addDreamComment,
  CommentLifecycleError,
  deleteManagedComment,
  editOwnedComment,
  listDreamComments,
  setOwnedDreamCommentsEnabled,
} from '../services/engagement/commentLifecycle.service';

function sendCommentLifecycleError(res: Response, error: unknown): boolean {
  if (!(error instanceof CommentLifecycleError)) return false;
  const status = error.reason === 'forbidden'
    ? 403
    : error.reason === 'not_found' || error.reason === 'dream_not_found'
      || error.reason === 'reply_not_found'
      ? 404
      : error.reason === 'comments_disabled'
        ? 409
        : 400;
  res.status(status).json({
    success: false,
    code: error.reason,
    message: error.reason === 'comments_disabled'
      ? 'Comments are disabled for this dream.'
      : error.reason === 'invalid_dream_id'
        ? 'Invalid dreamId.'
      : error.reason === 'forbidden'
        ? 'You do not have permission to manage this comment.'
        : error.reason === 'dream_not_found'
          ? 'Dream not found.'
        : error.reason === 'reply_not_found'
          ? 'The comment being replied to is no longer available.'
        : error.reason === 'not_found'
          ? 'Comment not found.'
          : 'Invalid comment request.',
  });
  return true;
}

// Adds a comment and applies its notification and rank side effects.
export async function addComment(req: Request, res: Response): Promise<void> {
  try {
    const comment = await addDreamComment({
      dreamId: String(req.params.id),
      authorId: req.user!._id as Types.ObjectId,
      content: req.body?.content,
      replyToCommentId: req.body?.replyToCommentId,
      publishNotification: (recipientId, notification) => {
        req.app.get('io')?.to(recipientId).emit('new_notification', notification);
      },
    });
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
    const comments = await listDreamComments({
      dreamId: String(req.params.id),
      viewerId: String(req.user?._id || '') || undefined,
    });
    res.status(200).json({ success: true, data: comments });
  } catch (error) {
    if (sendCommentLifecycleError(res, error)) return;
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
    await comment.populate([
      { path: 'userId', select: 'username display_name avatar streakCount' },
      { path: 'replyToUserId', select: 'username display_name avatar streakCount' },
    ]);
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
