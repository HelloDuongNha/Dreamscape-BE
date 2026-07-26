import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import User from '../models/User';
import Dream from '../../dream/models/Dream';
import { checkAndAwardAchievements } from '../services/rank.service';
import { toDateStr } from '../../../middleware/streakMiddleware';
import { getContributionStatsForUser } from '../../academic/services/contribution/contributionStats.service';
import UserAchievement from '../models/UserAchievement';
import { sanitizeOtherUser } from '../services/userProfileSanitizer.service';

/**
 * GET /api/users/:id
 * Retrieve a specific user's public profile details.
 */
export const getUserProfile = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid user ID format.' });
      return;
    }

    // Populate followers and following lists
    const user = await User.findById(id)
      .populate('followers', 'username display_name avatar')
      .populate('following', 'username display_name avatar');

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const myId = String(req.user!._id);

    const stats = await getContributionStatsForUser(id);
    const achievements = await UserAchievement.find({ userId: new Types.ObjectId(id) }).sort({ level: 1 });

    res.status(200).json({
      success: true,
      user: sanitizeOtherUser(user, myId),
      contributionStats: stats,
      contributionAchievements: achievements
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/users/me/streak-calendar
 * Returns the authenticated user's streak/rank payload for the Calendar view.
 */
export const getStreakCalendar = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = String(req.user!._id);
    const user   = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const userDreams = await Dream.find({ userId: user._id });
    let totalLikesReceived = 0;
    let totalCommentsReceived = 0;
    for (const d of userDreams) {
      totalLikesReceived += d.likes ? d.likes.length : 0;
      totalCommentsReceived += d.comments_count ?? 0;
    }

    const postsCount = userDreams.length;
    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;
    const totalTimeOnline = user.totalTimeOnline ?? 0;

    const achievementsUpdated = checkAndAwardAchievements(
      user,
      totalLikesReceived,
      totalCommentsReceived,
      postsCount,
      followersCount,
      followingCount,
      totalTimeOnline
    );
    if (achievementsUpdated) {
      await user.save();
    }

    const contributionStats = await getContributionStatsForUser(userId);
    const contributionAchievements = await UserAchievement.find({ userId: new Types.ObjectId(userId) }).sort({ level: 1 });

    res.status(200).json({
      success:      true,
      loginHistory: user.loginHistory || [],
      streakCount:  user.streakCount  ?? 0,
      highestStreak: user.highestStreak ?? 0,
      rankPoints:   user.rankPoints   ?? 0,
      currentRank:  user.currentRank  || 'Nhà Mơ Mộng Mới',
      achievements: user.achievements || [],
      totalLikesReceived,
      totalCommentsReceived,
      timeOnlineToday: user.timeOnlineToday ?? 0,
      serverDate: toDateStr(new Date()),
      postsCount,
      followersCount,
      followingCount,
      totalTimeOnline,
      contributionStats,
      contributionAchievements,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/users/me/heartbeat
 * Tracks screen-time session securely.
 * Checks the calendar date string and resets active minutes to 0 if a new server day has arrived.
 * Else, increments by 1 minute if at least 45 seconds have elapsed since last active ping.
 */
export const trackHeartbeat = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = String(req.user!._id);
    const user   = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const now = new Date();
    const today = toDateStr(now);

    let updated = false;

    // Reset online time if it's a new day
    if (user.lastActiveDate !== today) {
      user.timeOnlineToday = 0;
      user.lastActiveDate  = today;
      user.lastHeartbeatAt = now;
      updated = true;
    } else {
      if (user.lastHeartbeatAt) {
        const diffMs = now.getTime() - new Date(user.lastHeartbeatAt).getTime();
        const diffSec = diffMs / 1000;
        // Require at least 45 seconds to increment by 1 minute
        if (diffSec >= 45) {
          user.timeOnlineToday += 1;
          user.totalTimeOnline = (user.totalTimeOnline || 0) + 1;
          user.lastHeartbeatAt  = now;
          updated = true;
        }
      } else {
        // First heartbeat of the day
        user.lastHeartbeatAt = now;
        updated = true;
      }
    }

    if (updated) {
      await user.save();
    }

    res.status(200).json({
      success: true,
      timeOnlineToday: user.timeOnlineToday,
    });
  } catch (error) {
    next(error);
  }
};
