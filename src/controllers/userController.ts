import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import User from '../models/User';
import Dream from '../models/Dream';
import Notification from '../models/Notification';
import { checkAndAwardAchievements } from '../utils/rankEngine';
import { toDateStr } from '../middleware/streakMiddleware';
import { getContributionStatsForUser } from '../services/contributionStats.service';
import UserAchievement from '../models/UserAchievement';

// Helper to sanitize other user profile returned
const sanitizeOtherUser = (user: any, myId: string) => {
  const isOwner = myId === user._id.toString();
  const targetFollowsMe = (user.following || []).some((u: any) => {
    const uId = u._id ? u._id.toString() : u.toString();
    return uId === myId;
  });

  let canViewFollowers = false;
  if (user.followersPrivacy === 'everyone' || !user.followersPrivacy) {
    canViewFollowers = true;
  } else if (user.followersPrivacy === 'following') {
    canViewFollowers = isOwner || targetFollowsMe;
  } else if (user.followersPrivacy === 'only_me') {
    canViewFollowers = isOwner;
  }

  let canViewFollowing = false;
  if (user.followingPrivacy === 'everyone' || !user.followingPrivacy) {
    canViewFollowing = true;
  } else if (user.followingPrivacy === 'following') {
    canViewFollowing = isOwner || targetFollowsMe;
  } else if (user.followingPrivacy === 'only_me') {
    canViewFollowing = isOwner;
  }

  const mapFollowList = (list: any[]) => {
    return (list || []).map((u: any) => {
      if (u && typeof u === 'object' && u.username) {
        return {
          _id: u._id,
          username: u.username,
          display_name: u.display_name,
          avatar: u.avatar || '',
        };
      }
      return { _id: u };
    });
  };

  return {
    _id: user._id,
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar || '',
    bio: user.bio || '',
    follower_count: user.followers ? user.followers.length : 0,
    followers: (user.followers || []).map((u: any) => (u._id ? u._id.toString() : u.toString())),
    following: (user.following || []).map((u: any) => (u._id ? u._id.toString() : u.toString())),
    followersList: canViewFollowers ? mapFollowList(user.followers) : [],
    followingList: canViewFollowing ? mapFollowList(user.following) : [],
    followersPrivacy: user.followersPrivacy || 'everyone',
    followingPrivacy: user.followingPrivacy || 'everyone',
    isPrivateAccount: user.isPrivateAccount || false,
    dmPrivacy: user.dmPrivacy || 'everyone',
    defaultPrivacy: user.defaultPrivacy || 'public',
    createdAt: user.createdAt,
    streakCount: user.streakCount ?? 0,
    highestStreak: user.highestStreak ?? 0,
    rankPoints: user.rankPoints ?? 0,
    currentRank: user.currentRank || 'Nhà Mơ Mộng Mới',
    dailyTasks: user.dailyTasks || {
      likeOtherPost: false,
      commentOtherPost: false,
      createPost: false,
      lastResetDate: '',
    },
  };
};

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
 * POST /api/users/:id/follow
 * Follow or unfollow a user.
 */
export const toggleFollow = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const myId = String(req.user!._id);
    const targetId = String(req.params.id);

    if (!Types.ObjectId.isValid(targetId)) {
      res.status(400).json({ success: false, message: 'Invalid target user ID format.' });
      return;
    }

    if (myId === targetId) {
      res.status(400).json({ success: false, message: 'You cannot follow yourself.' });
      return;
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    const currentUser = await User.findById(myId);
    if (!currentUser) {
      res.status(404).json({ success: false, message: 'Current user not found.' });
      return;
    }

    // Initialize arrays if they don't exist
    if (!targetUser.followers) targetUser.followers = [];
    if (!currentUser.following) currentUser.following = [];

    // Map elements to string for safety check
    const isFollowing = currentUser.following.map((id: any) => id.toString()).includes(targetId);

    if (isFollowing) {
      // Unfollow
      currentUser.following = currentUser.following.filter(id => id.toString() !== targetId);
      targetUser.followers = targetUser.followers.filter(id => id.toString() !== myId);
    } else {
      // Follow
      currentUser.following.push(new Types.ObjectId(targetId));
      targetUser.followers.push(new Types.ObjectId(myId));
    }

    // Update count fields
    targetUser.follower_count = targetUser.followers.length;

    await currentUser.save();
    await targetUser.save();

    // Trigger Notification & socket emission if follow occurred
    if (!isFollowing) {
      try {
        const notif = await Notification.create({
          recipientId: targetUser._id,
          senderId: new Types.ObjectId(myId),
          type: 'follow',
        });
        await notif.populate('senderId', 'username display_name avatar');
        const io = req.app.get('io');
        if (io) {
          io.to(targetId).emit('new_notification', notif);
        }
      } catch (err) {
        console.error('❌ Failed to trigger follow notification:', err);
      }
    }

    // Retrieve updated target user with populated lists to return
    const updatedTargetUser = await User.findById(targetId)
      .populate('followers', 'username display_name avatar')
      .populate('following', 'username display_name avatar');

    res.status(200).json({
      success: true,
      following: !isFollowing,
      user: updatedTargetUser ? sanitizeOtherUser(updatedTargetUser, myId) : sanitizeOtherUser(targetUser, myId),
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

