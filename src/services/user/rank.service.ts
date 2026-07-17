// ─── Rank Engine ──────────────────────────────────────────────────────────────
//
// Maps accumulated rankPoints to a Vietnamese-themed display title.
// Tiers are inclusive lower-bound, exclusive upper-bound.
// The highest tier has no upper bound.

/**
 * Rank tier definitions ordered from lowest to highest.
 */
const RANK_TIERS = [
  { minPoints: 0,     title: 'Nhà Mơ Mộng Mới' },       // 0 – 100
  { minPoints: 101,   title: 'Người Bắt Đầu Mơ' },      // 101 – 500
  { minPoints: 501,   title: 'Bậc Thầy Giải Mã' },      // 501 – 2000
  { minPoints: 2001,  title: 'Kẻ Thao Túng Giấc Mơ' },   // 2001 – 5000
  { minPoints: 5001,  title: 'Độc Hành Tinh Không' },    // 5001 – 15000
  { minPoints: 15001, title: 'Đấng Sáng Tạo Thực Tại' }, // 15001+ (Requires 30d streak + both Stage 2 achievements)
];

/**
 * Return the rank title matching the given point total, achievements, and streak.
 * @param points - cumulative rankPoints from the User document
 * @param achievements - user's unlocked achievement stage IDs
 * @param streakCount - user's current consecutive login streak days
 * @param highestStreak - user's highest consecutive login streak days
 */
export function calculateRank(
  points: number,
  achievements: string[] = [],
  streakCount: number = 0,
  highestStreak: number = 0
): string {
  // Check criteria for the ultimate rank 'Đấng Sáng Tạo Thực Tại'
  const hasLikesStage2 = achievements.includes('likes_100'); // Stage 2 is likes_100 (100 likes)
  const hasCommentsStage2 = achievements.includes('comments_100'); // Stage 2 is comments_100 (100 comments)
  const maxStreakVal = Math.max(streakCount, highestStreak);
  const meetsEndGame = hasLikesStage2 && hasCommentsStage2 && maxStreakVal >= 30;

  let rank = RANK_TIERS[0].title;
  for (const tier of RANK_TIERS) {
    if (points >= tier.minPoints) {
      if (tier.title === 'Đấng Sáng Tạo Thực Tại') {
        if (meetsEndGame) {
          rank = tier.title;
        } else {
          // Cap at the previous highest tier (Rank 5) if requirements are not satisfied
          rank = 'Độc Hành Tinh Không';
        }
      } else {
        rank = tier.title;
      }
    }
  }
  return rank;
}

/**
 * Verifies if user has reached milestone values, awards rankPoints, and marks achievements.
 * Returns true if user document was modified.
 */
export function checkAndAwardAchievements(
  user: any,
  totalLikes: number,
  totalComments: number,
  postsCount: number = 0,
  followersCount?: number,
  followingCount?: number,
  totalTimeOnlineMinutes: number = 0
): boolean {
  let modified = false;

  if (!user.achievements) {
    user.achievements = [];
    modified = true;
  }

  const actualFollowers = followersCount !== undefined ? followersCount : (user.followers ? user.followers.length : 0);
  const actualFollowing = followingCount !== undefined ? followingCount : (user.following ? user.following.length : 0);
  const actualHours = Math.floor((totalTimeOnlineMinutes || user.totalTimeOnline || 0) / 60);

  // 1. Likes Milestones: 10, 100, 1000, 10000, 100000, 1000000 -> +20 rankPoints each
  const likesMilestones = [10, 100, 1000, 10000, 100000, 1000000];
  for (const milestone of likesMilestones) {
    const achievementKey = `likes_${milestone}`;
    if (totalLikes >= milestone && !user.achievements.includes(achievementKey)) {
      user.achievements.push(achievementKey);
      user.rankPoints = (user.rankPoints || 0) + 20;
      modified = true;
    }
  }

  // 2. Comments Milestones: 10, 100, 1000, 10000, 100000, 1000000 -> +20 rankPoints each
  const commentsMilestones = [10, 100, 1000, 10000, 100000, 1000000];
  for (const milestone of commentsMilestones) {
    const achievementKey = `comments_${milestone}`;
    if (totalComments >= milestone && !user.achievements.includes(achievementKey)) {
      user.achievements.push(achievementKey);
      user.rankPoints = (user.rankPoints || 0) + 20;
      modified = true;
    }
  }

  // 3. Posts Milestones: 10, 20, 40, 60, 80, 100 -> +20 rankPoints each
  const postsMilestones = [10, 20, 40, 60, 80, 100];
  for (const milestone of postsMilestones) {
    const achievementKey = `posts_${milestone}`;
    if (postsCount >= milestone && !user.achievements.includes(achievementKey)) {
      user.achievements.push(achievementKey);
      user.rankPoints = (user.rankPoints || 0) + 20;
      modified = true;
    }
  }

  // 4. Followers Milestones: 10, 100, 1000, 10000, 100000, 1000000 -> +20 rankPoints each
  const followersMilestones = [10, 100, 1000, 10000, 100000, 1000000];
  for (const milestone of followersMilestones) {
    const achievementKey = `followers_${milestone}`;
    if (actualFollowers >= milestone && !user.achievements.includes(achievementKey)) {
      user.achievements.push(achievementKey);
      user.rankPoints = (user.rankPoints || 0) + 20;
      modified = true;
    }
  }

  // 5. Following Milestones: 10, 100, 1000, 10000, 100000, 1000000 -> +20 rankPoints each
  const followingMilestones = [10, 100, 1000, 10000, 100000, 1000000];
  for (const milestone of followingMilestones) {
    const achievementKey = `following_${milestone}`;
    if (actualFollowing >= milestone && !user.achievements.includes(achievementKey)) {
      user.achievements.push(achievementKey);
      user.rankPoints = (user.rankPoints || 0) + 20;
      modified = true;
    }
  }

  // 6. Online Hours Milestones: 10, 20, 40, 60, 80, 100 -> +20 rankPoints each
  const hoursMilestones = [10, 20, 40, 60, 80, 100];
  for (const milestone of hoursMilestones) {
    const achievementKey = `hours_${milestone}`;
    if (actualHours >= milestone && !user.achievements.includes(achievementKey)) {
      user.achievements.push(achievementKey);
      user.rankPoints = (user.rankPoints || 0) + 20;
      modified = true;
    }
  }

  // 7. Streak Milestones ('Kỷ nguyên gắn kết'):
  const currentHighestStreak = Math.max(user.highestStreak || 0, user.streakCount || 0);
  if (currentHighestStreak > (user.highestStreak || 0)) {
    user.highestStreak = currentHighestStreak;
    modified = true;
  }

  const streakMilestones = [
    { target: 10, key: 'streak_10', points: 20 },
    { target: 30, key: 'streak_30', points: 50 },
    { target: 90, key: 'streak_90', points: 100 },
    { target: 180, key: 'streak_180', points: 200 },
    { target: 270, key: 'streak_270', points: 350 },
    { target: 365, key: 'streak_365', points: 500 },
  ];
  for (const milestone of streakMilestones) {
    if (currentHighestStreak >= milestone.target && !user.achievements.includes(milestone.key)) {
      user.achievements.push(milestone.key);
      user.rankPoints = (user.rankPoints || 0) + milestone.points;
      modified = true;
    }
  }

  if (modified) {
    // Recalculate rank tier with new points, achievements, and streaks
    user.currentRank = calculateRank(user.rankPoints, user.achievements, user.streakCount, user.highestStreak);
    if (user.markModified) {
      user.markModified('achievements');
    }
  }

  return modified;
}
