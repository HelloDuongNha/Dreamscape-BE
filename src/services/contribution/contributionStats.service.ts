import mongoose from 'mongoose';
import UserContributionStats from '../../models/UserContributionStats';
import UserAchievement from '../../models/UserAchievement';
import User from '../../models/User';

const CONTRIBUTION_LEVELS = [
  { level: 1, minApproved: 1, name: 'Người góp nguồn đầu tiên', key: 'contrib_level_1' },
  { level: 2, minApproved: 5, name: 'Người sưu tầm tri thức', key: 'contrib_level_2' },
  { level: 3, minApproved: 10, name: 'Người mở rộng thư viện', key: 'contrib_level_3' },
  { level: 4, minApproved: 25, name: 'Người xây nền học thuật', key: 'contrib_level_4' },
  { level: 5, minApproved: 50, name: 'Người bảo trợ tri thức', key: 'contrib_level_5' },
  { level: 6, minApproved: 100, name: 'Thủ thư DreamScape', key: 'contrib_level_6' }
];

/**
 * Infers source contribution points based on stored fields.
 * - DOI source: +10 points (has DOI)
 * - URL source: +8 points (has URL but no DOI)
 * - Manual/book source: +15 points (no DOI and no URL)
 * - Fallback: +10 points
 */
function calculatePointsForSource(contribution: any): number {
  if (!contribution) return 10;
  const doiVal = (contribution.doi || contribution.normalizedDoi || '').trim();
  const urlVal = (contribution.url || contribution.normalizedUrl || '').trim();

  if (doiVal) {
    return 10;
  } else if (urlVal) {
    return 8;
  } else {
    // Manual/book if no doi and no url
    return 15;
  }
}

/**
 * Returns descriptive current level and next level metrics for profile display.
 */
function getLevelProgressInfo(approvedCount: number) {
  let currentLevel = 0;
  let currentLevelName = 'Chưa có cấp';

  for (const lvl of CONTRIBUTION_LEVELS) {
    if (approvedCount >= lvl.minApproved) {
      currentLevel = lvl.level;
      currentLevelName = lvl.name;
    }
  }

  const nextLevel = currentLevel + 1;
  const nextLvlInfo = CONTRIBUTION_LEVELS.find(lvl => lvl.level === nextLevel);

  if (nextLvlInfo) {
    const prevMin = currentLevel === 0 ? 0 : (CONTRIBUTION_LEVELS.find(lvl => lvl.level === currentLevel)?.minApproved || 0);
    const requiredForNext = nextLvlInfo.minApproved;
    const progress = Math.max(0, Math.min(100, Math.floor(((approvedCount - prevMin) / (requiredForNext - prevMin)) * 100)));
    const remaining = Math.max(0, requiredForNext - approvedCount);

    return {
      contributionLevel: currentLevel,
      currentLevelName,
      nextLevelName: nextLvlInfo.name,
      nextLevelRequired: requiredForNext,
      progressToNextLevel: progress,
      remainingToNextLevel: remaining
    };
  } else {
    return {
      contributionLevel: currentLevel,
      currentLevelName,
      nextLevelName: null,
      nextLevelRequired: 0,
      progressToNextLevel: 100,
      remainingToNextLevel: 0
    };
  }
}

/**
 * Called when a manual source contribution is successfully saved to the database.
 */
export async function incrementSubmitted(userId: string) {
  const uId = new mongoose.Types.ObjectId(userId);
  await UserContributionStats.findOneAndUpdate(
    { userId: uId },
    {
      $inc: { submittedSourceCount: 1, pendingSourceCount: 1 },
      $set: { lastContributionAt: new Date() }
    },
    { upsert: true, new: true }
  );
}

/**
 * Evaluates approvedCount and awards user achievements.
 */
async function checkAndAwardLevelAchievements(userId: string, approvedCount: number) {
  const uId = new mongoose.Types.ObjectId(userId);
  let highestLevelUnlocked = 0;

  for (const lvl of CONTRIBUTION_LEVELS) {
    if (approvedCount >= lvl.minApproved) {
      highestLevelUnlocked = lvl.level;

      try {
        const keyExists = await UserAchievement.exists({ userId: uId, achievementKey: lvl.key });
        if (!keyExists) {
          const achievement = new UserAchievement({
            userId: uId,
            achievementKey: lvl.key,
            achievementName: lvl.name,
            level: lvl.level,
            source: 'source_contribution'
          });
          await achievement.save();

          // Mirror into User.achievements string array (safely if user exists)
          await User.findByIdAndUpdate(
            uId,
            { $addToSet: { achievements: lvl.key } }
          );
        }
      } catch (err: any) {
        if (err.code !== 11000) {
          console.error('[ContributionStats] Error awarding achievement:', err);
        }
      }
    }
  }

  if (highestLevelUnlocked > 0) {
    await UserContributionStats.updateOne(
      { userId: uId },
      { $set: { contributionLevel: highestLevelUnlocked } }
    );
  }
}

/**
 * Records source approval, awards points, and checks achievements.
 */
export async function recordApproval(userId: string, contribution: any) {
  const uId = new mongoose.Types.ObjectId(userId);
  let stats = await UserContributionStats.findOne({ userId: uId });
  if (!stats) {
    stats = new UserContributionStats({ userId: uId });
  }
  
  const newPending = Math.max(0, stats.pendingSourceCount - 1);
  const pointsToAdd = calculatePointsForSource(contribution);

  const updatedStats = await UserContributionStats.findOneAndUpdate(
    { userId: uId },
    {
      $set: { pendingSourceCount: newPending },
      $inc: { approvedSourceCount: 1, contributionPoints: pointsToAdd }
    },
    { upsert: true, new: true }
  );

  await checkAndAwardLevelAchievements(userId, updatedStats.approvedSourceCount);
}

/**
 * Records source rejection.
 */
export async function recordRejection(userId: string) {
  const uId = new mongoose.Types.ObjectId(userId);
  let stats = await UserContributionStats.findOne({ userId: uId });
  if (!stats) {
    stats = new UserContributionStats({ userId: uId });
  }

  const newPending = Math.max(0, stats.pendingSourceCount - 1);

  await UserContributionStats.findOneAndUpdate(
    { userId: uId },
    {
      $set: { pendingSourceCount: newPending },
      $inc: { rejectedSourceCount: 1 }
    },
    { upsert: true, new: true }
  );
}

/**
 * Returns formatted contribution stats structure for profile endpoint.
 */
export async function getContributionStatsForUser(userId: string) {
  const uId = new mongoose.Types.ObjectId(userId);
  const stats = await UserContributionStats.findOne({ userId: uId });

  const submittedSourceCount = stats ? stats.submittedSourceCount : 0;
  const approvedSourceCount = stats ? stats.approvedSourceCount : 0;
  const rejectedSourceCount = stats ? stats.rejectedSourceCount : 0;
  const pendingSourceCount = stats ? stats.pendingSourceCount : 0;
  const contributionPoints = stats ? stats.contributionPoints : 0;

  const progressInfo = getLevelProgressInfo(approvedSourceCount);

  return {
    submittedSourceCount,
    approvedSourceCount,
    rejectedSourceCount,
    pendingSourceCount,
    contributionPoints,
    ...progressInfo
  };
}
