import { Types } from 'mongoose';
import { getContributionStatsForUser } from '../../../academic/services/contribution/contributionStats.service';
import Dream from '../../../dream/models/Dream';
import { toDateStr } from '../../../../middleware/streakMiddleware';
import UserAchievement from '../../models/UserAchievement';
import User from '../../models/User';
import { checkAndAwardAchievements } from './rank.service';
import { IdentityUserReadError } from '../profile/userProfileRead.service';

export async function loadStreakCalendar(userId: string) {
  const user = await User.findById(userId);
  if (!user) {
    throw new IdentityUserReadError(404, 'User not found.');
  }

  const dreams = await Dream.find({ userId: user._id });
  const activity = summarizeDreamActivity(dreams);
  const social = {
    followersCount: user.followers?.length || 0,
    followingCount: user.following?.length || 0,
  };
  const totalTimeOnline = user.totalTimeOnline ?? 0;

  const achievementsUpdated = checkAndAwardAchievements(
    user,
    activity.totalLikesReceived,
    activity.totalCommentsReceived,
    activity.postsCount,
    social.followersCount,
    social.followingCount,
    totalTimeOnline,
  );
  if (achievementsUpdated) {
    await user.save();
  }

  const contributionStats = await getContributionStatsForUser(userId);
  const contributionAchievements = await UserAchievement.find({
    userId: new Types.ObjectId(userId),
  }).sort({ level: 1 });

  return {
    loginHistory: user.loginHistory || [],
    streakCount: user.streakCount ?? 0,
    highestStreak: user.highestStreak ?? 0,
    rankPoints: user.rankPoints ?? 0,
    currentRank: user.currentRank || 'Nhà Mơ Mộng Mới',
    achievements: user.achievements || [],
    ...activity,
    timeOnlineToday: user.timeOnlineToday ?? 0,
    serverDate: toDateStr(new Date()),
    ...social,
    totalTimeOnline,
    contributionStats,
    contributionAchievements,
  };
}

function summarizeDreamActivity(dreams: InstanceType<typeof Dream>[]) {
  let totalLikesReceived = 0;
  let totalCommentsReceived = 0;

  for (const dream of dreams) {
    totalLikesReceived += dream.likes?.length || 0;
    totalCommentsReceived += dream.comments_count ?? 0;
  }

  return {
    totalLikesReceived,
    totalCommentsReceived,
    postsCount: dreams.length,
  };
}
