import { IUser } from '../models/User';
import User from '../models/User';
import { calculateRank, checkAndAwardAchievements } from '../utils/rankEngine';
import Dream from '../models/Dream';

// ─── Streak Tracker ───────────────────────────────────────────────────────────
//
// Called from authMiddleware on every authenticated request.
// Fire-and-forget: never blocks the response pipeline.
//
// Logic:
//   1. Compute today's UTC date string 'YYYY-MM-DD'.
//   2. If it already exists in loginHistory → skip (already counted today).
//   3. Otherwise push today, compute streak vs lastLoginDate, save.

/**
 * Returns a 'YYYY-MM-DD' string for a given Date in UTC.
 */
export function toDateStr(d: Date): string {
  const y   = d.getUTCFullYear();
  const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the UTC 'YYYY-MM-DD' for the day before dateStr.
 */
function previousDayStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return toDateStr(d);
}

/**
 * Asynchronously updates the user's loginHistory and streakCount.
 * Safe to call without await — errors are caught and logged.
 *
 * @param user - the IUser document already loaded by authMiddleware
 */
export function recordStreakAsync(user: IUser): void {
  const today = toDateStr(new Date());

  // Bail early if today is already recorded (avoids redundant DB writes)
  if (user.loginHistory && user.loginHistory.includes(today)) return;

  // Run in background
  (async () => {
    try {
      const fresh = await User.findById(user._id);
      if (!fresh) return;

      // ── Streak calculation ────────────────────────────────────────────
      const yesterday = previousDayStr(today);
      const lastDate  = fresh.lastLoginDate ? toDateStr(fresh.lastLoginDate) : null;

      if (lastDate === yesterday) {
        // Consecutive day — increment streak
        fresh.streakCount += 1;
      } else if (lastDate !== today) {
        // Gap detected or first ever login — reset to 1
        fresh.streakCount = 1;
      }
      // If lastDate === today: guard above already exited early

      if (fresh.streakCount > (fresh.highestStreak || 0)) {
        fresh.highestStreak = fresh.streakCount;
      }

      // ── TFT-Style Login Interest & Base Points calculation ─────────────────
      let baseStageMax = 0;
      const s = fresh.streakCount;
      if (s <= 10) {
        baseStageMax = 0;
      } else if (s <= 30) {
        baseStageMax = 2;
      } else if (s <= 90) {
        baseStageMax = 5;
      } else if (s <= 180) {
        baseStageMax = 10;
      } else if (s <= 270) {
        baseStageMax = 15;
      } else {
        baseStageMax = 20;
      }

      const interest = Math.min(Math.floor(s / 10), 5);
      const dailyPoints = 10 + baseStageMax + interest;

      // Deduplicated push
      if (!fresh.loginHistory.includes(today)) {
        fresh.loginHistory.push(today);
        fresh.rankPoints = (fresh.rankPoints || 0) + dailyPoints;
      }

      fresh.lastLoginDate = new Date();

      // Query dreams, likes/comments to check/award achievements
      const userDreams = await Dream.find({ userId: fresh._id });
      let totalLikesReceived = 0;
      let totalCommentsReceived = 0;
      for (const d of userDreams) {
        totalLikesReceived += d.likes ? d.likes.length : 0;
        totalCommentsReceived += d.comments_count ?? 0;
      }

      checkAndAwardAchievements(
        fresh,
        totalLikesReceived,
        totalCommentsReceived,
        userDreams.length,
        fresh.followers ? fresh.followers.length : 0,
        fresh.following ? fresh.following.length : 0,
        fresh.totalTimeOnline ?? 0
      );

      fresh.currentRank = calculateRank(fresh.rankPoints, fresh.achievements, fresh.streakCount, fresh.highestStreak);

      await fresh.save();
    } catch (err) {
      console.error('❌ streakMiddleware: failed to update login streak:', err);
    }
  })();
}

