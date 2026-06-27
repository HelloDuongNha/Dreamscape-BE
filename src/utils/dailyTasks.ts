import { toDateStr } from '../middleware/streakMiddleware';
import { calculateRank } from './rankEngine';

/**
 * Checks if the user's daily tasks lastResetDate matches today.
 * If not, resets completion states and updates the reset date.
 * Returns true if the user document was modified.
 */
export function checkAndResetDailyTasks(user: any): boolean {
  const today = toDateStr(new Date());
  
  if (!user.dailyTasks) {
    user.dailyTasks = {
      likeOtherPost: false,
      commentOtherPost: false,
      createPost: false,
      lastResetDate: today,
    };
    return true;
  }

  if (user.dailyTasks.lastResetDate !== today) {
    user.dailyTasks.likeOtherPost = false;
    user.dailyTasks.commentOtherPost = false;
    user.dailyTasks.createPost = false;
    user.dailyTasks.lastResetDate = today;
    return true;
  }

  return false;
}

/**
 * Completes a specific daily task for a user, awards points, and recalculates rank.
 */
export async function completeDailyTask(
  user: any,
  taskKey: 'likeOtherPost' | 'commentOtherPost' | 'createPost'
): Promise<void> {
  // Ensure tasks are reset for today first
  checkAndResetDailyTasks(user);

  // If already completed, nothing to do
  if (user.dailyTasks[taskKey]) {
    return;
  }

  // Mark task as completed
  user.dailyTasks[taskKey] = true;

  // Award +20 points
  user.rankPoints = (user.rankPoints || 0) + 20;

  // Recalculate rank tier
  user.currentRank = calculateRank(user.rankPoints);

  // Mark modified explicitly for nested objects in mongoose if saving manually
  if (user.markModified) {
    user.markModified('dailyTasks');
  }

  await user.save();
}
