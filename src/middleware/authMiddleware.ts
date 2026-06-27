import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import User, { IUser } from '../models/User';
import { recordStreakAsync } from './streakMiddleware';

// ─── Augment Express Request ──────────────────────────────────────────────────
// Attach the authenticated user to the request so downstream handlers can
// access it without re-querying the DB every time.

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      sessionId?: string;
    }
  }
}

// ─── JWT Payload Shape ────────────────────────────────────────────────────────

interface JwtPayload {
  id: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Protects private routes by verifying the JWT passed in the
 * `Authorization: Bearer <token>` header.
 *
 * On success  → attaches `req.user` and calls `next()`.
 * On failure  → responds with 401 Unauthorized.
 */
const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({
      success: false,
      message: 'Server configuration error: JWT_SECRET is not set.',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;

    // Fetch the user from DB to ensure the account still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Token is valid but user no longer exists.',
      });
      return;
    }

    // Verify session is active (not revoked)
    if (decoded.sessionId && user.sessions) {
      const sessionExists = user.sessions.some(
        (s) => String(s._id) === String(decoded.sessionId)
      );
      if (!sessionExists) {
        res.status(401).json({
          success: false,
          message: 'Session has been revoked or expired.',
        });
        return;
      }
    }

    req.user = user;
    req.sessionId = decoded.sessionId;
    // Fire-and-forget streak tracker — never blocks the response
    recordStreakAsync(user);
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
};

/**
 * Middleware protecting routes requiring moderator/admin privileges.
 * Validates request sender user ID against allowlisted MODERATOR_USER_IDS env.
 */
export const isModerator = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  const userAny = req.user as any;
  const rawId = userAny?._id || userAny?.id || userAny?.userId;
  if (!rawId) {
    res.status(403).json({ success: false, message: 'Forbidden. Moderator privileges required.' });
    return;
  }

  const userId = String(rawId).trim();
  const moderatorIdsStr = process.env.MODERATOR_USER_IDS || '';
  const moderatorIds = moderatorIdsStr.split(',').map((id) => id.trim()).filter(Boolean);
  const isIncluded = moderatorIds.includes(userId);

  if (process.env.NODE_ENV !== 'production') {
    const hasEnv = !!process.env.MODERATOR_USER_IDS;
    console.log(`[moderation] currentUserId=${userId}`);
    console.log(`[moderation] hasModeratorEnv=${hasEnv}`);
    console.log(`[moderation] moderatorIdsCount=${moderatorIds.length}`);
    console.log(`[moderation] isModerator=${isIncluded}`);
  }

  if (isIncluded) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Forbidden. Moderator privileges required.' });
  }
};

export default authMiddleware;

