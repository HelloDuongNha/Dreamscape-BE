import { Types } from 'mongoose';
import Comment from '../../../social/models/Comment';
import Notification from '../../../social/models/Notification';
import User from '../../../identity/models/User';
import { calculateRank } from '../../../identity/services/rank.service';
import Dream from '../../models/Dream';

const COMMENT_MAX_LENGTH = 500;
const COMMENT_HISTORY_LIMIT = 20;

export type CommentLifecycleFailure =
  | 'invalid_comment_id'
  | 'invalid_content'
  | 'not_found'
  | 'forbidden'
  | 'comments_disabled';

export class CommentLifecycleError extends Error {
  constructor(public readonly reason: CommentLifecycleFailure) {
    super(reason);
  }
}

function normalizeCommentContent(content: unknown): string {
  const normalized = String(content ?? '').trim();
  if (!normalized || normalized.length > COMMENT_MAX_LENGTH) {
    throw new CommentLifecycleError('invalid_content');
  }
  return normalized;
}

function requireCommentId(commentId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(commentId)) {
    throw new CommentLifecycleError('invalid_comment_id');
  }
  return new Types.ObjectId(commentId);
}

/**
 * Creates a comment only while the Dream still accepts comments. The guarded
 * counter update closes the stale-composer race where the owner disables
 * comments after another user has already opened the post.
 */
export async function createComment(input: {
  dreamId: Types.ObjectId;
  authorId: Types.ObjectId;
  content: unknown;
}) {
  const content = normalizeCommentContent(input.content);
  const counter = await Dream.updateOne(
    { _id: input.dreamId, comments_enabled: { $ne: false } },
    { $inc: { comments_count: 1 } },
  );
  if (counter.modifiedCount !== 1) {
    throw new CommentLifecycleError('comments_disabled');
  }

  try {
    return await Comment.create({
      dreamId: input.dreamId,
      userId: input.authorId,
      content,
    });
  } catch (error) {
    await Dream.updateOne(
      { _id: input.dreamId, comments_count: { $gt: 0 } },
      { $inc: { comments_count: -1 } },
    );
    throw error;
  }
}

export async function editOwnedComment(input: {
  commentId: string;
  authorId: Types.ObjectId;
  content: unknown;
}) {
  const commentId = requireCommentId(input.commentId);
  const content = normalizeCommentContent(input.content);
  const current = await Comment.findOne({
    _id: commentId,
    is_deleted: { $ne: true },
  }).select('userId content');
  if (!current) throw new CommentLifecycleError('not_found');
  if (!current.userId.equals(input.authorId)) {
    throw new CommentLifecycleError('forbidden');
  }
  if (current.content === content) return current;

  const editedAt = new Date();
  const updated = await Comment.findOneAndUpdate(
    {
      _id: commentId,
      userId: input.authorId,
      is_deleted: { $ne: true },
      content: current.content,
    },
    {
      $set: { content, updated_at: editedAt },
      $push: {
        edit_history: {
          $each: [{ content: current.content, editedAt }],
          $slice: -COMMENT_HISTORY_LIMIT,
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw new CommentLifecycleError('not_found');
  return updated;
}

/**
 * Soft-deletes a comment with compare-and-set semantics. User-facing text and
 * edit history are erased, while actor/timestamp metadata remains available
 * for moderation without exposing deleted content.
 */
export async function deleteManagedComment(input: {
  commentId: string;
  actorId: Types.ObjectId;
}) {
  const commentId = requireCommentId(input.commentId);
  const current = await Comment.findOne({
    _id: commentId,
    is_deleted: { $ne: true },
  }).select('dreamId userId');
  if (!current) throw new CommentLifecycleError('not_found');

  const dream = await Dream.findById(current.dreamId).select('userId');
  if (!dream) throw new CommentLifecycleError('not_found');

  const role = current.userId.equals(input.actorId)
    ? 'author'
    : dream.userId.equals(input.actorId)
      ? 'dream_owner'
      : null;
  if (!role) throw new CommentLifecycleError('forbidden');

  const deletedAt = new Date();
  const deleted = await Comment.findOneAndUpdate(
    { _id: commentId, is_deleted: { $ne: true } },
    {
      $set: {
        content: '',
        edit_history: [],
        is_deleted: true,
        deleted_at: deletedAt,
        deleted_by: input.actorId,
        deleted_by_role: role,
      },
    },
    { returnDocument: 'after' },
  );
  if (!deleted) throw new CommentLifecycleError('not_found');

  await Promise.all([
    Dream.updateOne(
      { _id: current.dreamId, comments_count: { $gt: 0 } },
      { $inc: { comments_count: -1 } },
    ),
    Notification.deleteMany({ commentId }),
    reverseCommentRankAward({
      commentAuthorId: current.userId,
      dreamOwnerId: dream.userId,
    }),
  ]);

  return {
    commentId: String(commentId),
    dreamId: String(current.dreamId),
    commentAuthorId: String(current.userId),
    dreamOwnerId: String(dream.userId),
    deletedByRole: role,
  };
}

async function reverseCommentRankAward(input: {
  commentAuthorId: Types.ObjectId;
  dreamOwnerId: Types.ObjectId;
}): Promise<void> {
  if (input.commentAuthorId.equals(input.dreamOwnerId)) return;
  try {
    const owner = await User.findOneAndUpdate(
      { _id: input.dreamOwnerId },
      [{
        $set: {
          rankPoints: {
            $max: [
              0,
              { $subtract: [{ $ifNull: ['$rankPoints', 0] }, 15] },
            ],
          },
        },
      }],
      { returnDocument: 'after', updatePipeline: true },
    );
    if (!owner) return;
    const currentRank = calculateRank(
      owner.rankPoints,
      owner.achievements,
      owner.streakCount,
      owner.highestStreak,
    );
    await User.updateOne(
      { _id: owner._id, rankPoints: owner.rankPoints },
      { $set: { currentRank } },
    );
  } catch (error) {
    console.error('Failed to reverse the deleted comment rank award.', {
      dreamOwnerId: String(input.dreamOwnerId),
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

export async function setOwnedDreamCommentsEnabled(input: {
  dreamId: string;
  ownerId: Types.ObjectId;
  enabled: boolean;
}) {
  if (!Types.ObjectId.isValid(input.dreamId)) return null;
  return Dream.findOneAndUpdate(
    { _id: new Types.ObjectId(input.dreamId), userId: input.ownerId },
    { $set: { comments_enabled: input.enabled } },
    { returnDocument: 'after' },
  );
}
