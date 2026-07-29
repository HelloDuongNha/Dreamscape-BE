import { Types } from 'mongoose';
import { getDreamDetail } from '../../../dream/services/content/dreamRead.service';
import User from '../../../identity/models/User';
import Comment from '../../models/Comment';
import Notification, { type INotification } from '../../models/Notification';

export type NotificationTarget =
  | {
      kind: 'dream' | 'dream_analysis';
      dream: unknown;
      commentId?: string;
    }
  | {
      kind: 'profile';
      userId: string;
    };

export class NotificationLifecycleError extends Error {
  constructor(
    public readonly code:
      | 'notification_invalid_id'
      | 'notification_not_found'
      | 'notification_target_unavailable',
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'NotificationLifecycleError';
  }
}

export async function listOwnedNotifications(userId: string) {
  return Notification.find({ recipientId: userId })
    .sort({ timestamp: -1, _id: -1 })
    .populate('senderId', 'username display_name avatar')
    .lean();
}

export async function markOwnedNotificationsRead(userId: string): Promise<void> {
  await Notification.updateMany(
    { recipientId: userId, isRead: false },
    { $set: { isRead: true } },
  );
}

/**
 * Resolves an owned notification at click time. Target data is returned only
 * after the current Dream/profile state and access policy have been checked;
 * this prevents a stale notification from becoming an authorization bypass.
 */
export async function openOwnedNotification(input: {
  notificationId: string;
  userId: string;
}): Promise<NotificationTarget> {
  validateIds(input);

  const notification = await Notification.findOne({
    _id: input.notificationId,
    recipientId: input.userId,
  }).lean();
  if (!notification) {
    throw new NotificationLifecycleError(
      'notification_not_found',
      'Notification not found.',
      404,
    );
  }

  const target = await resolveNotificationTarget(notification, input.userId);
  const updated = await Notification.updateOne(
    { _id: notification._id, recipientId: input.userId },
    { $set: { isRead: true } },
  );
  if (updated.matchedCount !== 1) {
    throw new NotificationLifecycleError(
      'notification_not_found',
      'Notification not found.',
      404,
    );
  }
  return target;
}

export async function deleteOwnedNotification(input: {
  notificationId: string;
  userId: string;
}): Promise<void> {
  validateIds(input);
  const deleted = await Notification.deleteOne({
    _id: input.notificationId,
    recipientId: input.userId,
  });
  if (deleted.deletedCount !== 1) {
    throw new NotificationLifecycleError(
      'notification_not_found',
      'Notification not found.',
      404,
    );
  }
}

async function resolveNotificationTarget(
  notification: Pick<
    INotification,
    'type' | 'senderId' | 'postId' | 'commentId' | 'replyId'
  >,
  viewerId: string,
): Promise<NotificationTarget> {
  if (notification.type === 'follow') {
    return resolveProfileTarget(notification.senderId);
  }
  return resolveDreamTarget(notification, viewerId);
}

async function resolveProfileTarget(senderId: Types.ObjectId): Promise<NotificationTarget> {
  const exists = await User.exists({ _id: senderId });
  if (!exists) throw unavailableTarget();
  return { kind: 'profile', userId: String(senderId) };
}

async function resolveDreamTarget(
  notification: Pick<INotification, 'type' | 'postId' | 'commentId' | 'replyId'>,
  viewerId: string,
): Promise<NotificationTarget> {
  if (!notification.postId) throw unavailableTarget();

  const dream = await getDreamDetail(
    { dreamId: String(notification.postId) },
    viewerId,
  ) as Record<string, unknown> | null;
  if (!dream) throw unavailableTarget();

  if (notification.type === 'dream_analysis' && dream.ai_status !== 'completed') {
    throw unavailableTarget();
  }

  if (
    (notification.type === 'comment' || notification.type === 'comment_reply')
    && notification.commentId
  ) {
    const commentExists = await Comment.exists({
      _id: notification.commentId,
      dreamId: notification.postId,
      is_deleted: { $ne: true },
    });
    if (!commentExists) throw unavailableTarget();
  }
  if (notification.type === 'comment_reply' && notification.replyId) {
    const replyExists = await Comment.exists({
      _id: notification.replyId,
      dreamId: notification.postId,
      is_deleted: { $ne: true },
    });
    if (!replyExists) throw unavailableTarget();
  }

  return {
    kind: notification.type === 'dream_analysis' ? 'dream_analysis' : 'dream',
    dream,
    ...(notification.commentId ? { commentId: String(notification.commentId) } : {}),
  };
}

function validateIds(input: { notificationId: string; userId: string }): void {
  if (
    !Types.ObjectId.isValid(input.notificationId)
    || !Types.ObjectId.isValid(input.userId)
  ) {
    throw new NotificationLifecycleError(
      'notification_invalid_id',
      'Invalid notification identifier.',
      400,
    );
  }
}

function unavailableTarget(): NotificationLifecycleError {
  return new NotificationLifecycleError(
    'notification_target_unavailable',
    'The notification target is no longer available.',
    410,
  );
}
