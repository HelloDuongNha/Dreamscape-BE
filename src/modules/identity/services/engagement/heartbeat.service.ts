import { toDateStr } from '../../../../middleware/streakMiddleware';
import User from '../../models/User';
import { IdentityUserReadError } from '../profile/userProfileRead.service';

export async function recordUserHeartbeat(userId: string): Promise<number> {
  const user = await User.findById(userId);
  if (!user) {
    throw new IdentityUserReadError(404, 'User not found.');
  }

  const now = new Date();
  const today = toDateStr(now);
  const changed = applyHeartbeat(user, now, today);
  if (changed) {
    await user.save();
  }
  return user.timeOnlineToday;
}

function applyHeartbeat(
  user: InstanceType<typeof User>,
  now: Date,
  today: string,
): boolean {
  if (user.lastActiveDate !== today) {
    user.timeOnlineToday = 0;
    user.lastActiveDate = today;
    user.lastHeartbeatAt = now;
    return true;
  }
  if (!user.lastHeartbeatAt) {
    user.lastHeartbeatAt = now;
    return true;
  }

  const elapsedSeconds =
    (now.getTime() - new Date(user.lastHeartbeatAt).getTime()) / 1000;
  if (elapsedSeconds < 45) return false;

  user.timeOnlineToday += 1;
  user.totalTimeOnline = (user.totalTimeOnline || 0) + 1;
  user.lastHeartbeatAt = now;
  return true;
}
