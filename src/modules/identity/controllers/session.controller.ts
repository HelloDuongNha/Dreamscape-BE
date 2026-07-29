import { NextFunction, Request, Response } from 'express';
import {
  presentUserSessions,
  revokeUserSession,
  SessionLifecycleError,
} from '../services/auth/sessionLifecycle.service';

export async function getSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({
      success: true,
      sessions: presentUserSessions(req.user!, req.sessionId),
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await revokeUserSession(req.user!, req.params.id, req.sessionId);
    res.status(200).json({
      success: true,
      message: 'Session revoked successfully.',
    });
  } catch (error) {
    if (error instanceof SessionLifecycleError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
}
