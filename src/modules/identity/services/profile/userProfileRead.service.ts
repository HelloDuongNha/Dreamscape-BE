import { Types } from 'mongoose';
import { getContributionStatsForUser } from '../../../academic/services/contribution/contributionStats.service';
import UserAchievement from '../../models/UserAchievement';
import User from '../../models/User';
import { sanitizeOtherUser } from '../presentation/publicUser.service';

export class IdentityUserReadError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityUserReadError';
  }
}

export async function loadPublicUserProfile(
  userId: string,
  requesterId: string,
) {
  assertValidUserId(userId);

  const user = await User.findById(userId)
    .populate('followers', 'username display_name avatar')
    .populate('following', 'username display_name avatar')
    .populate('followRequests', 'username display_name avatar');
  if (!user) {
    throw new IdentityUserReadError(404, 'User not found.');
  }

  const isOwner = userId === requesterId;
  const contributionStats = isOwner
    ? await getContributionStatsForUser(userId)
    : null;
  const contributionAchievements = isOwner
    ? await UserAchievement.find({
      userId: new Types.ObjectId(userId),
    }).sort({ level: 1 })
    : [];

  return {
    user: sanitizeOtherUser(user, requesterId),
    contributionStats,
    contributionAchievements,
  };
}

function assertValidUserId(userId: string): void {
  if (!Types.ObjectId.isValid(userId)) {
    throw new IdentityUserReadError(400, 'Invalid user ID format.');
  }
}
