import { Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logger';
import User from '../../../identity/models/User';
import { sanitizeOtherUser } from '../../../identity/services/presentation/publicUser.service';
import Notification from '../../models/Notification';

export class FollowLifecycleError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'FollowLifecycleError';
  }
}

export async function toggleUserFollow(input: {
  userId: string;
  targetUserId: string;
  socketServer?: any;
}) {
  assertFollowTarget(input.userId, input.targetUserId);

  const targetUser = await User.findById(input.targetUserId);
  if (!targetUser) {
    throw new FollowLifecycleError(404, 'User not found.');
  }
  const currentUser = await User.findById(input.userId);
  if (!currentUser) {
    throw new FollowLifecycleError(404, 'Current user not found.');
  }

  ensureFollowCollections(currentUser, targetUser);
  const wasFollowing = includesUserId(currentUser.following, input.targetUserId);
  if (wasFollowing) {
    applyFollowState(currentUser, targetUser, false);
    await saveFollowPair(currentUser, targetUser);
    return buildFollowResult(targetUser, input.userId, 'none');
  }

  const requestWasPending = includesUserId(targetUser.followRequests, input.userId);
  if (requestWasPending) {
    targetUser.followRequests = withoutUserId(targetUser.followRequests, input.userId);
    await targetUser.save();
    return buildFollowResult(targetUser, input.userId, 'none');
  }

  if (targetUser.isPrivateAccount) {
    targetUser.followRequests.push(new Types.ObjectId(input.userId));
    await targetUser.save();
    return buildFollowResult(targetUser, input.userId, 'pending');
  }

  applyFollowState(currentUser, targetUser, true);
  await saveFollowPair(currentUser, targetUser);
  await emitFollowNotificationBestEffort({
    followerId: input.userId,
    targetUser,
    socketServer: input.socketServer,
  });
  return buildFollowResult(targetUser, input.userId, 'following');
}

export async function reviewFollowRequest(input: {
  ownerId: string;
  requesterId: string;
  action: 'approve' | 'reject';
}) {
  assertFollowTarget(input.ownerId, input.requesterId);

  const [owner, requester] = await Promise.all([
    User.findById(input.ownerId),
    User.findById(input.requesterId),
  ]);
  if (!owner || !requester) {
    throw new FollowLifecycleError(404, 'User not found.');
  }

  ensureFollowCollections(requester, owner);
  if (!includesUserId(owner.followRequests, input.requesterId)) {
    throw new FollowLifecycleError(404, 'Follow request not found.');
  }

  owner.followRequests = withoutUserId(owner.followRequests, input.requesterId);
  if (input.action === 'approve') {
    applyFollowState(requester, owner, true);
    await saveFollowPair(requester, owner);
  } else {
    await owner.save();
  }

  const updatedOwner = await loadPopulatedUser(input.ownerId);
  return {
    action: input.action,
    user: sanitizeOtherUser(updatedOwner || owner, input.ownerId),
  };
}

function assertFollowTarget(userId: string, targetUserId: string): void {
  if (!Types.ObjectId.isValid(targetUserId)) {
    throw new FollowLifecycleError(400, 'Invalid target user ID format.');
  }
  if (userId === targetUserId) {
    throw new FollowLifecycleError(400, 'You cannot follow yourself.');
  }
}

function ensureFollowCollections(
  currentUser: InstanceType<typeof User>,
  targetUser: InstanceType<typeof User>,
): void {
  if (!currentUser.following) currentUser.following = [];
  if (!targetUser.followers) targetUser.followers = [];
  if (!targetUser.followRequests) targetUser.followRequests = [];
}

function applyFollowState(
  currentUser: InstanceType<typeof User>,
  targetUser: InstanceType<typeof User>,
  shouldFollow: boolean,
): void {
  const currentUserId = String(currentUser._id);
  const targetUserId = String(targetUser._id);

  if (shouldFollow) {
    currentUser.following.push(new Types.ObjectId(targetUserId));
    targetUser.followers.push(new Types.ObjectId(currentUserId));
  } else {
    currentUser.following = currentUser.following.filter(
      (id) => String(id) !== targetUserId,
    );
    targetUser.followers = targetUser.followers.filter(
      (id) => String(id) !== currentUserId,
    );
  }
  targetUser.follower_count = targetUser.followers.length;
}

function includesUserId(values: any[], userId: string): boolean {
  return (values || []).some(value => String(value?._id || value) === userId);
}

function withoutUserId(values: any[], userId: string): any[] {
  return (values || []).filter(value => String(value?._id || value) !== userId);
}

async function saveFollowPair(
  currentUser: InstanceType<typeof User>,
  targetUser: InstanceType<typeof User>,
): Promise<void> {
  await Promise.all([currentUser.save(), targetUser.save()]);
}

async function loadPopulatedUser(userId: string) {
  return User.findById(userId)
    .populate('followers', 'username display_name avatar')
    .populate('following', 'username display_name avatar')
    .populate('followRequests', 'username display_name avatar');
}

async function buildFollowResult(
  targetUser: InstanceType<typeof User>,
  requesterId: string,
  followStatus: 'none' | 'pending' | 'following',
) {
  const updatedTarget = await loadPopulatedUser(String(targetUser._id));
  return {
    following: followStatus === 'following',
    pending: followStatus === 'pending',
    followStatus,
    user: sanitizeOtherUser(updatedTarget || targetUser, requesterId),
  };
}

async function emitFollowNotificationBestEffort(input: {
  followerId: string;
  targetUser: InstanceType<typeof User>;
  socketServer?: any;
}): Promise<void> {
  try {
    const notification = await Notification.create({
      recipientId: input.targetUser._id,
      senderId: new Types.ObjectId(input.followerId),
      type: 'follow',
    });
    await notification.populate('senderId', 'username display_name avatar');
    input.socketServer
      ?.to(String(input.targetUser._id))
      .emit('new_notification', notification);
  } catch (error) {
    logger.error('Failed to create follow notification.', error, {
      followerId: input.followerId,
      targetUserId: String(input.targetUser._id),
    });
  }
}
