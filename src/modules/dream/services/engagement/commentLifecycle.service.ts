import { Types } from 'mongoose';
import Comment from '../../../social/models/Comment';
import Notification from '../../../social/models/Notification';
import User from '../../../identity/models/User';
import {
  calculateRank,
  checkAndAwardAchievements,
} from '../../../identity/services/engagement/rank.service';
import Dream from '../../models/Dream';
import { findAccessibleDream } from '../content/dreamAccessPolicy.service';

const COMMENT_MAX_LENGTH = 500;
const COMMENT_HISTORY_LIMIT = 20;

interface CommentReplyContext {
  parentCommentId: Types.ObjectId;
  replyToCommentId: Types.ObjectId;
  replyToUserId: Types.ObjectId;
}

export type CommentLifecycleFailure =
  | 'invalid_dream_id'
  | 'invalid_comment_id'
  | 'invalid_content'
  | 'dream_not_found'
  | 'reply_not_found'
  | 'not_found'
  | 'forbidden'
  | 'comments_disabled';

export class CommentLifecycleError extends Error {
  constructor(public readonly reason: CommentLifecycleFailure) {
    super(reason);
  }
}

/**
 * Adds a comment through one lifecycle: authorize the Dream, persist the
 * comment and counter atomically, then apply best-effort engagement effects.
 */
export async function addDreamComment(input: {
  dreamId: string;
  authorId: Types.ObjectId;
  content: unknown;
  replyToCommentId?: unknown;
  publishNotification?: (recipientId: string, notification: unknown) => void;
}) {
  const dreamId = requireDreamId(input.dreamId);
  const dream = await findAccessibleDream(String(dreamId), String(input.authorId));
  if (!dream) throw new CommentLifecycleError('dream_not_found');
  if (dream.comments_enabled === false) {
    throw new CommentLifecycleError('comments_disabled');
  }
  const reply = await resolveReplyContext(dreamId, input.replyToCommentId);

  const comment = await persistComment({
    dreamId,
    authorId: input.authorId,
    content: input.content,
    reply,
  });
  await comment.populate([
    { path: 'userId', select: 'username display_name avatar streakCount' },
    { path: 'replyToUserId', select: 'username display_name avatar streakCount' },
  ]);

  await applyCommentEngagementEffects({
    dream,
    commentId: comment._id as Types.ObjectId,
    authorId: input.authorId,
    reply,
    publishNotification: input.publishNotification,
  });
  return comment;
}

/** Returns visible comments only after applying the Dream access policy. */
export async function listDreamComments(input: {
  dreamId: string;
  viewerId?: string;
}) {
  const dreamId = requireDreamId(input.dreamId);
  const dream = await findAccessibleDream(String(dreamId), input.viewerId);
  if (!dream) throw new CommentLifecycleError('dream_not_found');

  return Comment.find({
    dreamId: dream._id,
    is_deleted: { $ne: true },
  })
    .select('-is_deleted -deleted_at -deleted_by -deleted_by_role')
    .sort({ created_at: 1 })
    .populate('userId', 'username display_name avatar streakCount')
    .populate('replyToUserId', 'username display_name avatar streakCount')
    .lean();
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
  }).select('dreamId userId parentCommentId');
  if (!current) throw new CommentLifecycleError('not_found');

  const dream = await Dream.findById(current.dreamId).select('userId');
  if (!dream) throw new CommentLifecycleError('not_found');

  const role = current.userId.equals(input.actorId)
    ? 'author'
    : dream.userId.equals(input.actorId)
      ? 'dream_owner'
      : null;
  if (!role) throw new CommentLifecycleError('forbidden');

  const deletionSet = await loadCommentDeletionSet(current);
  const deleted = (await Promise.all(deletionSet.map((comment) =>
    softDeleteComment({
      comment,
      actorId: input.actorId,
      role: comment._id.equals(commentId) ? role : 'parent_author',
    })))).filter(Boolean);
  if (!deleted.length) throw new CommentLifecycleError('not_found');
  const deletedCommentIds = deleted.map((comment) => comment!._id as Types.ObjectId);

  await Promise.all([
    Dream.updateOne(
      { _id: current.dreamId },
      [{
        $set: {
          comments_count: {
            $max: [
              0,
              {
                $subtract: [
                  { $ifNull: ['$comments_count', 0] },
                  deletedCommentIds.length,
                ],
              },
            ],
          },
        },
      }],
    ),
    Notification.deleteMany({
      $or: [
        { commentId: { $in: deletedCommentIds } },
        { replyId: { $in: deletedCommentIds } },
      ],
    }),
    ...deleted.map((comment) => reverseCommentRankAward({
      commentAuthorId: comment!.userId,
      dreamOwnerId: dream.userId,
    })),
  ]);

  return {
    commentId: String(commentId),
    deletedCommentIds: deletedCommentIds.map(String),
    dreamId: String(current.dreamId),
    commentAuthorId: String(current.userId),
    dreamOwnerId: String(dream.userId),
    deletedByRole: role,
  };
}

async function loadCommentDeletionSet(
  current: {
    _id: Types.ObjectId;
    dreamId: Types.ObjectId;
    parentCommentId?: Types.ObjectId;
  },
) {
  const rootId = current.parentCommentId || current._id;
  const thread = await Comment.find({
    dreamId: current.dreamId,
    is_deleted: { $ne: true },
    $or: [{ _id: rootId }, { parentCommentId: rootId }],
  }).select('_id userId dreamId parentCommentId replyToCommentId');
  if (!current.parentCommentId) return thread;

  const selectedIds = new Set([String(current._id)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const comment of thread) {
      if (
        comment.replyToCommentId
        && selectedIds.has(String(comment.replyToCommentId))
        && !selectedIds.has(String(comment._id))
      ) {
        selectedIds.add(String(comment._id));
        changed = true;
      }
    }
  }
  return thread.filter((comment) => selectedIds.has(String(comment._id)));
}

async function softDeleteComment(input: {
  comment: {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
  };
  actorId: Types.ObjectId;
  role: 'author' | 'dream_owner' | 'parent_author';
}) {
  return Comment.findOneAndUpdate(
    { _id: input.comment._id, is_deleted: { $ne: true } },
    {
      $set: {
        content: '',
        edit_history: [],
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: input.actorId,
        deleted_by_role: input.role,
      },
    },
    { returnDocument: 'after' },
  ).select('_id userId');
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

/**
 * Persists a comment only while the Dream still accepts comments. The guarded
 * counter update closes the stale-composer race where the owner disables
 * comments after another user has already opened the post.
 */
async function persistComment(input: {
  dreamId: Types.ObjectId;
  authorId: Types.ObjectId;
  content: unknown;
  reply: CommentReplyContext | null;
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
      ...(input.reply || {}),
    });
  } catch (error) {
    await Dream.updateOne(
      { _id: input.dreamId, comments_count: { $gt: 0 } },
      { $inc: { comments_count: -1 } },
    );
    throw error;
  }
}

async function applyCommentEngagementEffects(input: {
  dream: {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
  };
  commentId: Types.ObjectId;
  authorId: Types.ObjectId;
  reply: CommentReplyContext | null;
  publishNotification?: (recipientId: string, notification: unknown) => void;
}): Promise<void> {
  try {
    const notifications = await createCommentNotifications(input);
    for (const notification of notifications) {
      await notification.populate('senderId', 'username display_name avatar');
      input.publishNotification?.(String(notification.recipientId), notification);
    }
    if (!input.dream.userId.equals(input.authorId)) {
      await awardCommentRank(input.dream.userId);
    }
  } catch (error) {
    console.error('❌ Failed to trigger comment notification:', error);
  }
}

async function createCommentNotifications(input: {
  dream: {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
  };
  commentId: Types.ObjectId;
  authorId: Types.ObjectId;
  reply: CommentReplyContext | null;
}) {
  const notifications: Array<{
    recipientId: Types.ObjectId;
    senderId: Types.ObjectId;
    type: 'comment' | 'comment_reply';
    postId: Types.ObjectId;
    commentId: Types.ObjectId;
    replyId?: Types.ObjectId;
  }> = [];
  const replyRecipient = input.reply?.replyToUserId;
  if (replyRecipient && !replyRecipient.equals(input.authorId)) {
    notifications.push({
      recipientId: replyRecipient,
      senderId: input.authorId,
      type: 'comment_reply',
      postId: input.dream._id,
      commentId: input.reply!.replyToCommentId,
      replyId: input.commentId,
    });
  }
  if (
    !input.dream.userId.equals(input.authorId)
    && !input.dream.userId.equals(replyRecipient)
  ) {
    notifications.push({
      recipientId: input.dream.userId,
      senderId: input.authorId,
      type: 'comment',
      postId: input.dream._id,
      commentId: input.commentId,
    });
  }
  return notifications.length ? Notification.create(notifications) : [];
}

async function resolveReplyContext(
  dreamId: Types.ObjectId,
  rawReplyToCommentId: unknown,
): Promise<CommentReplyContext | null> {
  if (rawReplyToCommentId === undefined || rawReplyToCommentId === null) return null;
  const replyToCommentId = requireCommentId(String(rawReplyToCommentId));
  const target = await Comment.findOne({
    _id: replyToCommentId,
    dreamId,
    is_deleted: { $ne: true },
  }).select('_id userId parentCommentId');
  if (!target) throw new CommentLifecycleError('reply_not_found');

  const parentCommentId = target.parentCommentId || target._id as Types.ObjectId;
  if (target.parentCommentId) {
    const rootExists = await Comment.exists({
      _id: parentCommentId,
      dreamId,
      is_deleted: { $ne: true },
      parentCommentId: { $exists: false },
    });
    if (!rootExists) throw new CommentLifecycleError('reply_not_found');
  }
  return {
    parentCommentId,
    replyToCommentId,
    replyToUserId: target.userId,
  };
}

async function awardCommentRank(dreamOwnerId: Types.ObjectId): Promise<void> {
  const postOwner = await User.findById(dreamOwnerId);
  if (!postOwner) return;

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

function normalizeCommentContent(content: unknown): string {
  const normalized = String(content ?? '').trim();
  if (!normalized || normalized.length > COMMENT_MAX_LENGTH) {
    throw new CommentLifecycleError('invalid_content');
  }
  return normalized;
}

function requireDreamId(dreamId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(dreamId)) {
    throw new CommentLifecycleError('invalid_dream_id');
  }
  return new Types.ObjectId(dreamId);
}

function requireCommentId(commentId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(commentId)) {
    throw new CommentLifecycleError('invalid_comment_id');
  }
  return new Types.ObjectId(commentId);
}
