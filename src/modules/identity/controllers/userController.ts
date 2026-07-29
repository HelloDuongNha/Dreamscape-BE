import { NextFunction, Request, Response } from 'express';
import { recordUserHeartbeat } from '../services/engagement/heartbeat.service';
import { loadStreakCalendar } from '../services/engagement/streakCalendar.service';
import {
  IdentityUserReadError,
  loadPublicUserProfile,
} from '../services/profile/userProfileRead.service';

export async function getUserProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await loadPublicUserProfile(
      String(req.params.id),
      String(req.user!._id),
    );
    res.status(200).json({ success: true, ...profile });
  } catch (error) {
    handleIdentityUserError(error, res, next);
  }
}

export async function getStreakCalendar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const calendar = await loadStreakCalendar(String(req.user!._id));
    res.status(200).json({ success: true, ...calendar });
  } catch (error) {
    handleIdentityUserError(error, res, next);
  }
}

export async function trackHeartbeat(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const timeOnlineToday = await recordUserHeartbeat(String(req.user!._id));
    res.status(200).json({
      success: true,
      timeOnlineToday,
      role: req.user!.role,
    });
  } catch (error) {
    handleIdentityUserError(error, res, next);
  }
}

function handleIdentityUserError(
  error: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof IdentityUserReadError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return;
  }
  next(error);
}
